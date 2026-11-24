use super::{Core, State, invalid, ok};
use crate::protocol::Reply;
use astarot_audio_routing::router::{CancelToken, Output, PlaybackToken};
use astarot_talk_ai::{
    Talk,
    protocol::{BYTES_PER_MS, RATE},
};
use astarot_transcription::{
    capture::{Source, Target},
    pcm,
};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak, mpsc};
use std::time::Duration;

enum Destination {
    Headphones(String),
    Virtual(String),
}

#[derive(Default)]
struct Playback {
    token: Arc<CancelToken>,
    generation: u64,
}

struct Chunk {
    item: String,
    bytes: Vec<u8>,
    generation: u64,
}

pub(super) struct Audio {
    stopped: AtomicBool,
    sending: AtomicBool,
    overrun: AtomicBool,
    playback: Mutex<Playback>,
    output: mpsc::SyncSender<Chunk>,
}

impl Audio {
    pub(super) fn sending(&self) -> bool {
        self.sending.load(Ordering::Acquire) && !self.stopped.load(Ordering::Acquire)
    }

    pub(super) fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.interrupt();
    }

    pub(super) fn interrupt(&self) {
        let mut playback = self.playback.lock().unwrap();
        playback.token.cancel();
        playback.token = Arc::default();
        playback.generation += 1;
    }

    pub(super) fn push(&self, item: String, bytes: Vec<u8>) {
        if !self.sending() {
            return;
        }
        let generation = self.playback.lock().unwrap().generation;
        if self
            .output
            .try_send(Chunk {
                item,
                bytes,
                generation,
            })
            .is_err()
        {
            self.overrun.store(true, Ordering::Release);
            self.stop();
        }
    }
}

pub(super) fn start(core: &Arc<Core>, data: &Value) -> Reply {
    let session = core.talk_ai.lock().unwrap();
    let (Some(state), Some(talk)) = (&session.state, &session.talk) else {
        return Reply::conflict("talk_not_ready");
    };
    {
        let state = state.lock().unwrap();
        if state.phase != "ready" || data["session_id"].as_u64() != Some(state.id) {
            return Reply::conflict("talk_not_ready");
        }
        if state.audio.is_some() {
            return Reply::conflict("talk_audio_already_running");
        }
    }
    if data["indicator_visible"] != true {
        return invalid("talk_indicator_required");
    }
    let destination = match &data["output"] {
        Value::Null => Destination::Headphones(String::new()),
        Value::String(device) if device.len() <= 1024 && !device.chars().any(char::is_control) => {
            if astarot_audio_routing::graph::is_virtual_name(device)
                || astarot_audio_routing::naming::is_virtual_cable(device)
            {
                if data["share_output"] != true {
                    return invalid("talk_output_consent_required");
                }
                Destination::Virtual(device.clone())
            } else {
                Destination::Headphones(device.clone())
            }
        }
        _ => return invalid("talk_output_invalid"),
    };
    // Disable both the selected microphone recorder and any realtime session. The session lock
    // serializes this handover with the ordinary microphone enable endpoint.
    core.set_disable_transcription(Source::Mic, &Value::Null);
    core.stop_realtime_for_recorder(Source::Mic);
    if !core.drain_realtime(Source::Mic) {
        return Reply::conflict("talk_microphone_in_use");
    }
    core.run(200, "/set/disable/transcription_send", json!(false));

    let (output, chunks) = mpsc::sync_channel(64);
    let audio = Arc::new(Audio {
        stopped: AtomicBool::new(false),
        sending: AtomicBool::new(false),
        overrun: AtomicBool::new(false),
        playback: Mutex::default(),
        output,
    });
    {
        let mut state = state.lock().unwrap();
        if state.phase != "ready" {
            return Reply::conflict("talk_not_ready");
        }
        state.audio = Some(Arc::clone(&audio));
    }
    let (state, talk, core) = (
        Arc::clone(state),
        Arc::downgrade(talk),
        Arc::downgrade(core),
    );
    let worker_state = Arc::clone(&state);
    let worker = std::thread::Builder::new()
        .name("talk-ai-audio".into())
        .spawn(move || {
            let result = run(&core, &talk, &audio, destination, chunks);
            if let Err(code) = result {
                fail(&worker_state, code);
                if let Some(talk) = talk.upgrade() {
                    talk.cancel();
                }
            }
        });
    if worker.is_err() {
        fail(&state, "talk_audio_worker");
        session.talk.as_ref().unwrap().cancel();
    }
    ok(session.status())
}

fn fail(state: &Mutex<State>, code: &'static str) {
    let mut state = state.lock().unwrap();
    state.stop_media();
    state.phase = "failed";
    state.error = Some(code);
}

pub(super) fn control(core: &Core, data: &Value, end_turn: bool) -> Reply {
    let session = core.talk_ai.lock().unwrap();
    let (Some(state), Some(talk)) = (&session.state, &session.talk) else {
        return Reply::conflict("talk_not_ready");
    };
    let state = state.lock().unwrap();
    let Some(audio) = state.audio.as_ref().filter(|audio| audio.sending()) else {
        return Reply::conflict("talk_not_ready");
    };
    if data["session_id"].as_u64() != Some(state.id) {
        return Reply::conflict("talk_not_ready");
    }
    if end_turn {
        if !state.local {
            return invalid("talk_automatic_turns");
        }
        talk.end_turn();
    } else {
        audio.interrupt();
        talk.interrupt();
    }
    ok(true)
}

fn open_output(core: &Core, destination: &Destination) -> Result<Box<dyn Output>, &'static str> {
    let voice = &core.services().voice;
    let opened = match destination {
        Destination::Headphones(device) => {
            let exclude = if cfg!(windows) {
                core.services()
                    .audio
                    .outputs(&[])
                    .map_err(|_| "talk_output_failed")?
                    .into_iter()
                    .map(|output| output.id)
                    .filter(|id| astarot_audio_routing::naming::is_virtual_cable(id))
                    .collect()
            } else {
                Vec::new()
            };
            (voice.monitor_output())(device, RATE, 1, &exclude)
        }
        Destination::Virtual(device) => voice.speech_output(device, RATE, 1),
    };
    opened.map_err(|_| "talk_output_failed")
}

fn run(
    core: &Weak<Core>,
    talk: &Weak<Talk>,
    audio: &Arc<Audio>,
    destination: Destination,
    chunks: mpsc::Receiver<Chunk>,
) -> Result<(), &'static str> {
    let Some(app) = core.upgrade() else {
        return Ok(());
    };
    let capture = (app.services().transcription_capture)(app.config().environment());
    let target = app
        .audio_devices()
        .target(Source::Mic, true)
        .filter(|device| !device.is_no_device())
        .map(Target::Device)
        .or_else(|| {
            capture
                .default_endpoint(Source::Mic)
                .ok()
                .map(Target::Endpoint)
        })
        .ok_or("talk_microphone_missing")?;
    let mut output = Some(open_output(&app, &destination)?);
    drop(app);
    if audio.stopped.load(Ordering::Acquire) {
        return Ok(());
    }
    let mic_fault = Arc::new(AtomicBool::new(false));
    let fault = Arc::clone(&mic_fault);
    let mut resample = None;
    let mut pending = Vec::new();
    let mut microphone = capture
        .open(
            Source::Mic,
            &target,
            Duration::from_secs(5),
            Box::new({
                let (talk, core, audio) = (talk.clone(), core.clone(), audio.clone());
                move |samples, rate, channels, _| {
                    if audio.stopped.load(Ordering::Acquire) {
                        return false;
                    }
                    if core.upgrade().is_none_or(|app| app.mic_held_back()) {
                        resample = None;
                        pending.clear();
                        return true;
                    }
                    if rate == 0 || channels == 0 {
                        return true;
                    }
                    audio.sending.store(true, Ordering::Release);
                    if resample.as_ref().is_none_or(|(old_rate, old_channels, _)| {
                        (*old_rate, *old_channels) != (rate, channels)
                    }) {
                        resample = Some((rate, channels, pcm::Resampler::new(rate, RATE)));
                        pending.clear();
                    }
                    let (_, _, resampler) = resample.as_mut().unwrap();
                    let mono = pcm::to_mono(samples, channels.into());
                    pending.extend(pcm::to_i16(&resampler.process(&pcm::to_f32(&mono))));
                    let Some(talk) = talk.upgrade() else {
                        return false;
                    };
                    const FRAME: usize = RATE as usize / 50;
                    for block in pending.chunks_exact(FRAME) {
                        if audio.stopped.load(Ordering::Acquire) {
                            return false;
                        }
                        talk.send_audio(pcm::bytes(block));
                    }
                    let consumed = pending.len() / FRAME * FRAME;
                    pending.drain(..consumed);
                    true
                }
            }),
            Box::new(move |_| fault.store(true, Ordering::Release)),
        )
        .map_err(|_| "talk_microphone_failed")?;

    let result = play(
        core,
        talk,
        audio,
        destination,
        &chunks,
        &mic_fault,
        &mut output,
    );
    audio.stop();
    microphone.request_stop();
    let _ = microphone.stop();
    if let Some(mut output) = output {
        let _ = output.close(false, &CancelToken::default());
    }
    result
}

fn play(
    core: &Weak<Core>,
    talk: &Weak<Talk>,
    audio: &Audio,
    destination: Destination,
    chunks: &mpsc::Receiver<Chunk>,
    mic_fault: &AtomicBool,
    output: &mut Option<Box<dyn Output>>,
) -> Result<(), &'static str> {
    let mut item = String::new();
    let mut bytes = 0_u64;
    let mut current_generation = 0;
    while !audio.stopped.load(Ordering::Acquire) {
        if mic_fault.load(Ordering::Acquire) {
            return Err("talk_microphone_failed");
        }
        let (token, generation) = {
            let playback = audio.playback.lock().unwrap();
            (Arc::clone(&playback.token), playback.generation)
        };
        if current_generation != generation {
            if let Some(mut opened) = output.take() {
                let _ = opened.close(false, &CancelToken::default());
            }
            current_generation = generation;
        }
        let chunk = match chunks.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => chunk,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        if chunk.generation != generation {
            continue;
        }
        if item != chunk.item {
            item = chunk.item;
            bytes = 0;
        }
        if output.is_none() {
            let Some(core) = core.upgrade() else {
                return Ok(());
            };
            *output = Some(open_output(&core, &destination)?);
        }
        if output
            .as_mut()
            .unwrap()
            .write(&chunk.bytes, token.as_ref())
            .is_err()
        {
            if token.is_set() || audio.stopped.load(Ordering::Acquire) {
                continue;
            }
            return Err("talk_output_failed");
        }
        bytes += chunk.bytes.len() as u64;
        if let Some(talk) = talk.upgrade() {
            talk.played(&item, bytes / BYTES_PER_MS);
        }
    }
    if audio.overrun.load(Ordering::Acquire) {
        Err("talk_playback_overrun")
    } else {
        Ok(())
    }
}
