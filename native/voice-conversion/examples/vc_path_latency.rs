//! The converted voice's delay on Windows from end to end, without a microphone (#531).
//!
//! A synthetic tone is played into a silent output device (`--input-device`). The application's
//! own conversion owner ([`VcProcess`] on a [`DeviceRoute`]: its block timing, its worker and its
//! WASAPI output) takes that device's loopback in place of a microphone and plays the converted
//! voice into another silent output (`--output-device`). Both devices' loopbacks are recorded with
//! the audio engine's own timestamps, and each burst is found in the input and in the converted
//! voice. Only timing numbers are printed: no audio is written anywhere and no text is involved.
//!
//! ```text
//! cargo run --release --example vc_path_latency -- --worker <astarot-rvc-worker.exe> \
//!     --runtime <state>/vc_runtimes/rvc [--directml <state>/vc_runtimes/onnxruntime-directml/lib] \
//!     --model <voice.pth> [--device cuda] [--block-ms 80|auto] [--output app] [--bursts 15] \
//!     [--input-device "Speakers (Steam Streaming Microphone)"] \
//!     [--output-device "Speakers (Steam Streaming Speakers)"]
//! ```
//!
//! `--output` chooses what plays the converted voice:
//! - `app`: the application's output (`WindowsOutput`: a 100 ms buffer that starts once full).
//! - `full:<ms>`: the same rule with a buffer of `<ms>`, noting how full it is at each block.
//! - `margin:<ms>`: a prototype that starts after `<ms>` of silence and never waits for room.
//!
//! The capture stands in for the microphone's: the crate's loopback capture, read every 10 ms like
//! the microphone capture, mixed down to mono. The two devices must be silent ones (the Steam
//! Streaming devices are, without a stream) and different; the input runs at 48 kHz.
//!
//! Each line of output is one JSON object: the delay from each burst's onset in the input to its
//! onset in the converted voice (where the voice's 5 ms RMS first reaches a tenth of its peak), and
//! the lag at which the two envelopes match best (the delay of the content).

#[cfg(not(windows))]
fn main() {
    eprintln!("vc_path_latency measures the Windows route; it does nothing on this system.");
}

#[cfg(windows)]
fn main() {
    windows_main::run();
}

#[cfg(windows)]
mod windows_main {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use serde_json::json;
    use astarot_audio_routing::graph::Endpoint;
    use astarot_audio_routing::monitor::{open_monitor_output, MonitorFactory};
    use astarot_audio_routing::naming::{output_identity, WASAPI_HOST};
    use astarot_audio_routing::router::{CancelToken, Output, PlaybackToken};
    use astarot_audio_routing::wasapi::capture::{DeviceCapture, DeviceTarget};
    use astarot_audio_routing::windows_route::{Capture, CaptureCallbacks, RouteDevices, WasapiDevices};
    use astarot_voice_conversion::{DeviceRoute, VcProcess};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    const RATE: usize = 48_000;
    const BURST_MS: usize = 400;
    const GAP_MS: usize = 1600;

    struct Arguments {
        worker: PathBuf,
        runtime: String,
        directml: Option<PathBuf>,
        model: String,
        device: String,
        block_ms: u32,
        output: OutputKind,
        bursts: usize,
        input_device: String,
        output_device: String,
    }

    fn arguments() -> Arguments {
        let mut values: BTreeMap<String, String> = BTreeMap::new();
        let mut args = std::env::args().skip(1);
        while let Some(name) = args.next() {
            let Some(value) = args.next() else { usage(&format!("{name} needs a value")) };
            values.insert(name.trim_start_matches("--").to_owned(), value);
        }
        let take = |name: &str, default: Option<&str>| values.get(name).cloned().or(default.map(str::to_owned)).unwrap_or_else(|| usage(&format!("--{name} is required")));
        let output = take("output", Some("app"));
        let output = match (output.strip_prefix("margin:"), output.strip_prefix("full:")) {
            (Some(ms), _) => OutputKind::Margin(ms.parse().unwrap_or_else(|_| usage("margin:<ms>"))),
            (_, Some(ms)) => OutputKind::Full(ms.parse().unwrap_or_else(|_| usage("full:<ms>"))),
            _ if output == "app" => OutputKind::App,
            _ => usage("--output is app, full:<ms> or margin:<ms>"),
        };
        Arguments {
            worker: take("worker", None).into(),
            runtime: take("runtime", None),
            directml: values.get("directml").map(PathBuf::from),
            model: take("model", None),
            device: take("device", Some("cuda")),
            block_ms: match take("block-ms", Some("80")).as_str() {
                // The worker chooses (`--block-ms auto`), as the application does by default.
                "auto" => astarot_voice_conversion::worker::AUTO_BLOCK_MS,
                ms => ms.parse().unwrap_or_else(|_| usage("--block-ms is auto or a number")),
            },
            output,
            bursts: take("bursts", Some("15")).parse().unwrap_or_else(|_| usage("--bursts is a number")),
            input_device: take("input-device", Some("Speakers (Steam Streaming Microphone)")),
            output_device: take("output-device", Some("Speakers (Steam Streaming Speakers)")),
        }
    }

    fn usage(problem: &str) -> ! {
        eprintln!("vc_path_latency: {problem} (see the comment at the top of the example)");
        std::process::exit(2);
    }

    fn identity(name: &str) -> String {
        output_identity(WASAPI_HOST, name)
    }

    // ------------------------------------------------------------ the route's devices

    #[derive(Clone, Copy)]
    enum OutputKind {
        App,
        Margin(u32),
        Full(u32),
    }

    /// What a prototype output saw: how often it ran dry, and how full it was at each block.
    #[derive(Default)]
    struct Watch {
        underflows: AtomicUsize,
        levels_ms: Mutex<Vec<f64>>,
    }

    struct Devices {
        kind: OutputKind,
        input: String,
        output: String,
        watch: Arc<Watch>,
    }

    impl RouteDevices for Devices {
        fn outputs(&self, keep: &[String]) -> astarot_audio_routing::Result<Vec<String>> {
            WasapiDevices.outputs(keep)
        }
        fn open_output(&self, device: &str) -> astarot_audio_routing::Result<Box<dyn Output>> {
            match self.kind {
                OutputKind::App => WasapiDevices.open_output(device),
                OutputKind::Margin(ms) => Ok(Box::new(PrototypeOutput::open(&self.output, ms, None, self.watch.clone()))),
                OutputKind::Full(ms) => Ok(Box::new(PrototypeOutput::open(&self.output, 0, Some(ms), self.watch.clone()))),
            }
        }
        fn capture(&self, _source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
            Box::new(LoopbackMicrophone { device: self.input.clone(), callbacks: Some(callbacks), capture: None })
        }
    }

    /// The input device's loopback in place of the microphone, mixed down to mono.
    struct LoopbackMicrophone {
        device: String,
        callbacks: Option<CaptureCallbacks>,
        capture: Option<DeviceCapture>,
    }

    impl Capture for LoopbackMicrophone {
        fn start(&mut self) -> astarot_audio_routing::Result<()> {
            let Some(CaptureCallbacks { mut on_audio, on_error }) = self.callbacks.take() else {
                return Err(astarot_audio_routing::Error::runtime("source_bridge_capture_failed"));
            };
            let (capture, format) = DeviceCapture::start(
                DeviceTarget::Identity(identity(&self.device)),
                true,
                false,
                Duration::from_secs(5),
                Box::new(move |pcm, format| {
                    let channels = usize::from(format.channels);
                    let mut mono = Vec::with_capacity(pcm.len() / channels);
                    for frame in pcm.chunks_exact(2 * channels) {
                        let sum: i32 = frame.chunks_exact(2).map(|s| i32::from(i16::from_le_bytes([s[0], s[1]]))).sum();
                        mono.extend_from_slice(&((sum / channels as i32) as i16).to_le_bytes());
                    }
                    on_audio(&mono)
                }),
                on_error,
            )?;
            if format.rate as usize != RATE {
                usage("the input device must run at 48 kHz");
            }
            self.capture = Some(capture);
            Ok(())
        }
        fn request_stop(&self) {
            if let Some(capture) = &self.capture {
                capture.request_stop();
            }
        }
        fn stop(&mut self) {
            if let Some(capture) = &mut self.capture {
                capture.stop();
            }
        }
    }

    /// `margin`: a 300 ms buffer that is never full, started after `margin` ms of silence ahead
    /// of the first block. `full`: `WindowsOutput`'s rule with a buffer of that length.
    struct PrototypeOutput {
        client: IAudioClient,
        render: IAudioRenderClient,
        frames: u32,
        margin: usize,
        start_when_full: bool,
        started: bool,
        watch: Arc<Watch>,
    }

    // The interfaces live in the multithreaded apartment; one thread uses the output at a time.
    unsafe impl Send for PrototypeOutput {}

    impl PrototypeOutput {
        fn open(name: &str, margin_ms: u32, full_ms: Option<u32>, watch: Arc<Watch>) -> Self {
            let format =
                WAVEFORMATEX { wFormatTag: WAVE_FORMAT_PCM as u16, nChannels: 1, nSamplesPerSec: RATE as u32, nAvgBytesPerSec: RATE as u32 * 2, nBlockAlign: 2, wBitsPerSample: 16, cbSize: 0 };
            let request = full_ms.map_or(3_000_000, |ms| i64::from(ms) * 10_000);
            // SAFETY: plain WASAPI calls on interfaces this function owns.
            let (client, render, frames) = unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let client: IAudioClient = find(name).Activate(CLSCTX_ALL, None).expect("the output device opens");
                client
                    .Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, request, 0, &format, None)
                    .expect("the output takes 48 kHz mono");
                let frames = client.GetBufferSize().expect("a buffer size");
                let render: IAudioRenderClient = client.GetService().expect("a render client");
                (client, render, frames)
            };
            Self { client, render, frames, margin: margin_ms as usize * RATE / 1000, start_when_full: full_ms.is_some(), started: false, watch }
        }

        fn level(&self) -> u32 {
            // SAFETY: a WASAPI query on an owned client.
            unsafe { self.client.GetCurrentPadding() }.unwrap_or(0)
        }

        fn put(&self, pcm: &[u8]) {
            let frames = pcm.len() / 2;
            // SAFETY: the engine hands out room for `frames`, which the copy fills exactly.
            unsafe {
                let target = self.render.GetBuffer(frames as u32).expect("room in the buffer");
                std::ptr::copy_nonoverlapping(pcm.as_ptr(), target, frames * 2);
                self.render.ReleaseBuffer(frames as u32, 0).expect("the buffer is released");
            }
        }

        fn start(&mut self) {
            // SAFETY: a WASAPI call on an owned client.
            unsafe { self.client.Start() }.expect("the output starts");
            self.started = true;
        }
    }

    impl Output for PrototypeOutput {
        fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> astarot_audio_routing::Result<()> {
            if !self.started && !self.start_when_full {
                self.put(&vec![0u8; self.margin * 2]);
                self.put(pcm);
                self.start();
                return Ok(());
            }
            let level = self.level();
            if self.started {
                if level == 0 {
                    self.watch.underflows.fetch_add(1, Ordering::SeqCst);
                }
                self.watch.levels_ms.lock().expect("levels").push(f64::from(level) * 1000.0 / RATE as f64);
            }
            let mut pending = &pcm[..pcm.len() / 2 * 2];
            while !pending.is_empty() {
                let room = (self.frames - self.level()) as usize;
                if room == 0 {
                    if !self.started {
                        self.start();
                        continue;
                    }
                    token.wait(Duration::from_millis(if self.start_when_full { 5 } else { 2 }));
                    continue;
                }
                let frames = room.min(pending.len() / 2);
                self.put(&pending[..frames * 2]);
                pending = &pending[frames * 2..];
            }
            Ok(())
        }
        fn close(&mut self, _drain: bool, _token: &dyn PlaybackToken) -> astarot_audio_routing::Result<()> {
            // SAFETY: a WASAPI call on an owned client.
            let _ = unsafe { self.client.Stop() };
            Ok(())
        }
    }

    // ------------------------------------------------------------ recording

    fn find(name: &str) -> IMMDevice {
        // SAFETY: device enumeration with COM initialized on this thread.
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).expect("the device list");
            let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).expect("the outputs");
            for i in 0..devices.GetCount().expect("a count") {
                let device = devices.Item(i).expect("an output");
                let store = device.OpenPropertyStore(STGM_READ).expect("its properties");
                if store.GetValue(&PKEY_Device_FriendlyName).map(|v| v.to_string()).unwrap_or_default() == name {
                    return device;
                }
            }
        }
        usage(&format!("no active output named {name:?}"));
    }

    /// A loopback recording: chunks stamped with the engine's time of their first frame, in 100 ns.
    type Chunks = Vec<(u64, Vec<f32>)>;

    fn record(name: String, stop: Arc<AtomicBool>) -> thread::JoinHandle<Chunks> {
        thread::spawn(move || {
            let mut chunks = Chunks::new();
            // SAFETY: a loopback capture on interfaces this thread owns; every buffer the engine
            // hands out is read within its `frames` and released.
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED).ok().expect("COM");
                let client: IAudioClient = find(&name).Activate(CLSCTX_ALL, None).expect("the device opens");
                let mix = client.GetMixFormat().expect("a mix format");
                let (channels, bits) = (usize::from((*mix).nChannels), (*mix).wBitsPerSample);
                if (*mix).nSamplesPerSec as usize != RATE {
                    usage("both devices must run at 48 kHz");
                }
                client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, mix, None).expect("a loopback");
                let reader: IAudioCaptureClient = client.GetService().expect("a capture client");
                client.Start().expect("the loopback starts");
                while !stop.load(Ordering::SeqCst) {
                    while reader.GetNextPacketSize().expect("a packet size") > 0 {
                        let (mut data, mut frames, mut flags, mut qpc) = (std::ptr::null_mut(), 0u32, 0u32, 0u64);
                        reader.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc)).expect("a packet");
                        let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null();
                        let mono: Vec<f32> = (0..frames as usize)
                            .map(|f| {
                                if silent {
                                    return 0.0;
                                }
                                let sample = |c: usize| if bits == 32 { *(data as *const f32).add(f * channels + c) } else { f32::from(*(data as *const i16).add(f * channels + c)) / 32768.0 };
                                (0..channels).map(sample).sum::<f32>() / channels as f32
                            })
                            .collect();
                        reader.ReleaseBuffer(frames).expect("the packet is released");
                        chunks.push((qpc, mono));
                    }
                    thread::sleep(Duration::from_millis(2));
                }
                let _ = client.Stop();
            }
            chunks
        })
    }

    /// (time in ms, value) of every recorded sample.
    fn samples(chunks: &Chunks) -> Vec<(f64, f32)> {
        let mut out = Vec::new();
        for (qpc, data) in chunks {
            let start = *qpc as f64 / 10_000.0;
            out.extend(data.iter().enumerate().map(|(i, v)| (start + i as f64 * 1000.0 / RATE as f64, *v)));
        }
        out
    }

    // ------------------------------------------------------------ analysis

    /// Each burst's onset in the input: a sample over 0.05 after at least 300 ms under 0.01.
    fn input_onsets(input: &[(f64, f32)]) -> Vec<f64> {
        let (mut onsets, mut quiet_since, mut loud) = (Vec::new(), f64::NEG_INFINITY, false);
        for &(t, v) in input {
            let a = v.abs();
            if quiet_since == f64::NEG_INFINITY && a < 0.01 {
                quiet_since = t;
            }
            if a > 0.05 {
                if !loud && t - quiet_since >= 300.0 {
                    onsets.push(t);
                }
                loud = true;
            } else if a < 0.01 {
                if loud {
                    quiet_since = t;
                }
                loud = false;
            }
        }
        onsets
    }

    /// RMS per millisecond, keyed by the millisecond.
    fn envelope_ms(samples: &[(f64, f32)]) -> BTreeMap<i64, f64> {
        let mut bins: BTreeMap<i64, (f64, usize)> = BTreeMap::new();
        for &(t, v) in samples {
            let bin = bins.entry(t.floor() as i64).or_insert((0.0, 0));
            bin.0 += f64::from(v).powi(2);
            bin.1 += 1;
        }
        bins.into_iter().map(|(k, (s, n))| (k, (s / n as f64).sqrt())).collect()
    }

    /// After each input onset, where the converted voice's 5 ms RMS first reaches a tenth of its
    /// peak within the next second, above twice its level in the 300 ms before.
    fn output_onsets(output: &BTreeMap<i64, f64>, inputs: &[f64]) -> Vec<f64> {
        let rms5 = |t: i64| ((t - 4..=t).filter_map(|k| output.get(&k)).map(|v| v * v).sum::<f64>() / 5.0).sqrt();
        inputs
            .iter()
            .filter_map(|&t0| {
                let t0 = t0.floor() as i64;
                let floor = (t0 - 300..t0).map(rms5).fold(0.0, f64::max);
                let span: Vec<(i64, f64)> = (t0..t0 + 1000).map(|t| (t, rms5(t))).collect();
                let peak = span.iter().map(|e| e.1).fold(0.0, f64::max);
                if peak <= floor * 3.0 {
                    return None;
                }
                let threshold = (peak * 0.1).max(floor * 2.0);
                span.iter().find(|e| e.1 >= threshold).map(|e| (e.0 - t0) as f64)
            })
            .collect()
    }

    /// The lag (ms) at which the converted voice's envelope best matches the input's around each
    /// burst: the delay of the content rather than of its first sound.
    fn content_lags(input: &BTreeMap<i64, f64>, output: &BTreeMap<i64, f64>, onsets: &[f64]) -> Vec<f64> {
        onsets
            .iter()
            .filter_map(|&t0| {
                let t0 = t0.floor() as i64;
                let xs: Vec<(i64, f64)> = (t0 - 100..t0 + BURST_MS as i64 + 200).filter_map(|t| input.get(&t).map(|v| (t, *v))).collect();
                let (mut best, mut best_lag) = (f64::MIN, None);
                for lag in 0..=600i64 {
                    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
                    for &(t, x) in &xs {
                        if let Some(y) = output.get(&(t + lag)) {
                            sxy += x * y;
                            sxx += x * x;
                            syy += y * y;
                        }
                    }
                    if sxx > 0.0 && syy > 0.0 && sxy / (sxx * syy).sqrt() > best {
                        best = sxy / (sxx * syy).sqrt();
                        best_lag = Some(lag as f64);
                    }
                }
                best_lag
            })
            .collect()
    }

    fn percentile(values: &[f64], q: f64) -> serde_json::Value {
        if values.is_empty() {
            return serde_json::Value::Null;
        }
        let mut v = values.to_vec();
        v.sort_by(f64::total_cmp);
        let at = (v.len() - 1) as f64 * q;
        let (low, high) = (at.floor() as usize, (at.floor() as usize + 1).min(v.len() - 1));
        json!(((v[low] + (v[high] - v[low]) * (at - at.floor())) * 10.0).round() / 10.0)
    }

    fn tone_burst() -> Vec<u8> {
        let n = BURST_MS * RATE / 1000;
        let mut phase = 0.0f64;
        let mut out = Vec::with_capacity(n * 2);
        for i in 0..n {
            let t = i as f64 / RATE as f64;
            phase += 2.0 * std::f64::consts::PI * (180.0 + 20.0 * (2.0 * std::f64::consts::PI * 5.0 * t).sin()) / RATE as f64;
            let ramp = (i as f64 / (RATE as f64 * 0.005)).min(1.0);
            let v: f64 = (1..6).map(|k| 0.12 / f64::from(k) * (f64::from(k) * phase).sin()).sum::<f64>() * ramp;
            out.extend_from_slice(&((v * 32767.0).round().clamp(-32768.0, 32767.0) as i16).to_le_bytes());
        }
        out
    }

    // ------------------------------------------------------------ the run

    pub fn run() {
        let args = arguments();
        if args.input_device == args.output_device {
            usage("the input and output devices must differ");
        }
        // SAFETY: COM for this thread, kept for the whole run.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().expect("COM");
        let stop = Arc::new(AtomicBool::new(false));
        let input_recording = record(args.input_device.clone(), stop.clone());
        let output_recording = record(args.output_device.clone(), stop.clone());

        // The player: silence until `play`, then the bursts, then silence, so the input device's
        // loopback runs throughout.
        let (play, played) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
        let player = {
            let (stop, play, played, device, bursts) = (stop.clone(), play.clone(), played.clone(), args.input_device.clone(), args.bursts);
            thread::spawn(move || {
                let mut out = WasapiDevices.open_output(&identity(&device)).expect("the input device plays");
                let token = CancelToken::default();
                let (silence, burst, gap) = (vec![0u8; RATE / 100 * 2], tone_burst(), vec![0u8; RATE * 2 * GAP_MS / 1000]);
                while !stop.load(Ordering::SeqCst) {
                    if play.load(Ordering::SeqCst) && !played.load(Ordering::SeqCst) {
                        for _ in 0..bursts {
                            out.write(&burst, &token).expect("a burst");
                            out.write(&gap, &token).expect("a gap");
                        }
                        played.store(true, Ordering::SeqCst);
                    } else {
                        out.write(&silence, &token).expect("silence");
                    }
                }
                let _ = out.close(false, &token);
            })
        };

        let watch = Arc::new(Watch::default());
        let devices = Arc::new(Devices { kind: args.output, input: args.input_device.clone(), output: args.output_device.clone(), watch: watch.clone() });
        let monitor: MonitorFactory = Arc::new(open_monitor_output);
        let route = Arc::new(DeviceRoute::new(&identity(&args.output_device), devices, monitor));
        let options = json!({ "engine": "rvc", "runtime": args.runtime, "model": args.model, "index": "", "index_rate": 0, "pitch": 0, "device": args.device, "block_ms": args.block_ms });
        let process = VcProcess::rvc(&options, &args.worker, args.directml.as_deref(), route, None).unwrap_or_else(|code| usage(&format!("the conversion did not start: {code}")));
        // Not muted: the converted voice is played.
        process.set_monitor_muted(false);
        process.start(Endpoint { cookie: 0, serial: 0, name: identity(&args.input_device), media_class: "Audio/Source".into() }).expect("a start");
        let started = Instant::now();
        while !(process.health().active && !process.health().pending) {
            if let Some(error) = process.health().error {
                usage(&format!("the conversion failed before it ran: {error}"));
            }
            if started.elapsed() > Duration::from_secs(180) {
                usage("the conversion did not become ready within 3 minutes");
            }
            thread::sleep(Duration::from_millis(100));
        }
        let ready_s = started.elapsed().as_secs_f64();
        thread::sleep(Duration::from_secs(3));
        play.store(true, Ordering::SeqCst);
        while !played.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(50));
        }
        thread::sleep(Duration::from_secs(2));
        let health = process.health();
        stop.store(true, Ordering::SeqCst);
        process.stop();
        process.close(Duration::from_secs(10));
        player.join().expect("the player");
        let input = samples(&input_recording.join().expect("the input recording"));
        let converted = samples(&output_recording.join().expect("the output recording"));

        let onsets = input_onsets(&input);
        let (input_env, output_env) = (envelope_ms(&input), envelope_ms(&converted));
        let delays = output_onsets(&output_env, &onsets);
        let lags = content_lags(&input_env, &output_env, &onsets);
        let levels = watch.levels_ms.lock().expect("levels").clone();
        let output = match args.output {
            OutputKind::App => "app".to_owned(),
            OutputKind::Margin(ms) => format!("margin:{ms}"),
            OutputKind::Full(ms) => format!("full:{ms}"),
        };
        println!(
            "{}",
            json!({
                "device": args.device, "block_ms": health.block_ms, "output": output, "ready_s": (ready_s * 10.0).round() / 10.0,
                "bursts": onsets.len(), "found": delays.len(),
                "onset_delay_ms": { "p50": percentile(&delays, 0.5), "p95": percentile(&delays, 0.95), "min": percentile(&delays, 0.0), "max": percentile(&delays, 1.0) },
                "content_lag_ms": { "p50": percentile(&lags, 0.5), "min": percentile(&lags, 0.0), "max": percentile(&lags, 1.0) },
                "round_trip_ms": health.round_trip_ms, "error": health.error,
                "output_level_ms": { "p5": percentile(&levels, 0.05), "p50": percentile(&levels, 0.5) },
                "underflows": watch.underflows.load(Ordering::SeqCst),
            })
        );
    }
}
