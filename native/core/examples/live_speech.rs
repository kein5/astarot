//! Speech through the core with a real speech.cpp server and a real output device: the start
//! delay, speech one message after another and a stop (#279). It replaces the Windows part of
//! `tools/live_tts_acceptance.py`, which ran the Python bus; the PipeWire gate and the VRChat
//! window of that tool are not here.
//!
//! cargo run --release --locked --manifest-path native/core/Cargo.toml --example live_speech --
//!     --app-dir <extracted package> --state-dir <empty folder> --model <Irodori GGUF>
//!     --output "Steam Streaming Speakers" [--device auto] [--samples 3]
//!
//! The core runs in this process as the application runs it, with the bundled speech.cpp of
//! `--app-dir` and the first output whose label contains `--output`. Set `VRCT_TELEMETRY=off`.
//! The chat box is not sent to VRChat. Prints one JSON line per case and a summary; no text,
//! audio, path or device name is printed.

use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use vrct_core::config::{Environment, Platform};
use vrct_core::{Backend, Options, Sink};

const BRIEF: &str = "了解です。";
const SHORT: &str = "こんにちは。音声の接続テストです。";
const LONG: &str = "これは音声を途中で止めるための接続試験です。マイクの出力と停止後の無音を確認しています。\
これは音声を途中で止めるための接続試験です。マイクの出力と停止後の無音を確認しています。\
これは音声を途中で止めるための接続試験です。マイクの出力と停止後の無音を確認しています。";

struct Run {
    backend: Backend,
}

impl Run {
    fn call(&self, endpoint: &str, data: Value) -> Value {
        let reply = self.backend.dispatcher().call(Some(endpoint), &data);
        json!({ "status": reply.status, "result": reply.result })
    }

    fn ok(&self, endpoint: &str, data: Value) -> Value {
        let answer = self.call(endpoint, data);
        assert_eq!(
            answer["status"], 200,
            "{endpoint} answered {}",
            answer["status"]
        );
        answer["result"].clone()
    }

    fn status(&self) -> Value {
        self.ok("/get/data/voice_status", Value::Null)
    }

    /// Waits until `done` holds, polling every 2 ms; the time it took.
    fn wait(&self, what: &str, limit: Duration, done: impl Fn(&Value) -> bool) -> Duration {
        let started = Instant::now();
        loop {
            if done(&self.status()) {
                return started.elapsed();
            }
            assert!(
                started.elapsed() < limit,
                "{what} did not happen within {limit:?}"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// Sends a typed message; how long the request took.
    fn send(&self, id: &str, message: &str) -> Duration {
        let started = Instant::now();
        self.ok(
            "/run/send_message_box",
            json!({ "id": id, "message": message }),
        );
        started.elapsed()
    }

    /// Waits until the bus is idle with `count` more messages spoken, failed or dropped (a
    /// message that waited longer than 5 s expires); the codes of the failures.
    fn finish(&self, what: &str, count: u64, limit: Duration) -> Vec<String> {
        let before = self.status();
        let done = |s: &Value| {
            ["completed", "errors", "dropped"]
                .iter()
                .map(|k| s[k].as_u64().unwrap_or(0) - before[k].as_u64().unwrap_or(0))
                .sum::<u64>()
        };
        self.wait(what, limit, |s| {
            done(s) >= count && s["active"] == false && s["queued"] == 0
        });
        let after = self.status();
        let failed = after["errors"].as_u64().unwrap_or(0) - before["errors"].as_u64().unwrap_or(0);
        (0..failed)
            .map(|_| after["last_error"].as_str().unwrap_or("unknown").to_owned())
            .collect()
    }
}

fn ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1000.0 * 10.0).round() / 10.0
}

fn main() {
    let (mut app_dir, mut state_dir, mut model, mut output) = (None, None, None, None);
    let mut device = "auto".to_owned();
    let mut samples = 3usize;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| panic!("{arg} needs a value"));
        match arg.as_str() {
            "--app-dir" => app_dir = Some(PathBuf::from(value())),
            "--state-dir" => state_dir = Some(PathBuf::from(value())),
            "--model" => model = Some(PathBuf::from(value())),
            "--output" => output = Some(value()),
            "--device" => device = value(),
            "--samples" => samples = value().parse().expect("--samples takes a number"),
            other => panic!("unknown argument {other}"),
        }
    }
    let app_dir = app_dir.expect("--app-dir is required");
    let state_dir = state_dir.expect("--state-dir is required");
    let model = model
        .expect("--model is required")
        .canonicalize()
        .expect("the model exists");
    let output = output.expect("--output is required");
    assert!((1..=30).contains(&samples), "1..30 samples");
    std::fs::create_dir_all(&state_dir).expect("the state folder can be made");

    // The chat box stays here: no OSC to VRChat and no OSCQuery on the network.
    let row = |model: &str| json!({ "model": model, "vad_model": "", "diarization_model": "", "voice_file": "", "device": device, "low_latency": false });
    let config = json!({
        "SEND_MESSAGE_TO_VRC": false,
        "OSC_IP_ADDRESS": "127.0.0.2",
        "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "japanese": row(model.to_str().unwrap()), "multilingual": row(""), "asr": row("") } },
    });
    std::fs::write(
        state_dir.join("config.json"),
        serde_json::to_vec_pretty(&config).unwrap(),
    )
    .expect("the settings can be written");

    let environment = Environment {
        version: "0.0.0".into(),
        state_dir: state_dir.clone(),
        app_dir,
        data_dir: state_dir.clone(),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: None,
    };
    let (done, ready) = mpsc::channel();
    let sink = Sink {
        line: std::sync::Arc::new(move |line: String| {
            if line.contains("\"/run/initialization_complete\"") {
                let _ = done.send(());
            }
        }),
        exit: std::sync::Arc::new(|_| {}),
    };
    let run = Run {
        backend: Backend::start(Options::new(environment), sink),
    };
    // The UI feeds the watchdog from the start; without it the core stops itself.
    let core = run.backend.core().clone();
    std::thread::spawn(move || {
        loop {
            core.feed_watchdog();
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    ready
        .recv_timeout(Duration::from_secs(180))
        .expect("start-up ends within 180 s");

    let devices = run.ok("/get/data/voice_output_devices", Value::Null);
    let chosen = devices["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|d| d["label"].as_str().is_some_and(|l| l.contains(&output)))
        .expect("an output with that label");
    let saved = run.call(
        "/set/data/voice_settings",
        json!({ "mode": "original", "output_device": chosen["id"], "japanese_server": "bundled" }),
    );
    assert_eq!(
        saved["status"], 200,
        "the voice settings were refused: {}",
        saved["result"]["error_code"]
    );

    // The process of the server the core starts, to end it while it speaks; never another one.
    let listener: std::sync::Arc<std::sync::Mutex<Option<u32>>> = Default::default();
    let heard = listener.clone();
    run.backend
        .core()
        .speech_servers()
        .on_listener(std::sync::Arc::new(move |_, listening| {
            *heard.lock().unwrap() = listening.map(|(_, pid)| pid)
        }));

    // ON starts the bundled server and waits until it is ready.
    let started = Instant::now();
    let generation = run.status()["tts_generation"].clone();
    let on = run.call("/run/enable_tts", json!({ "generation": generation }));
    assert_eq!(
        on["status"], 200,
        "TTS did not turn on: {}",
        on["result"]["error_code"]
    );
    println!(
        "{}",
        json!({ "case": "enable", "server_ready_ms": ms(started.elapsed()) })
    );

    let mut report = Vec::new();
    // The start delay: from the message to its first audible write (the bus's own measure),
    // and from the request to the core until then.
    for index in 1..=samples {
        let previous = run.status()["last_first_write_ms"].clone();
        let sent = Instant::now();
        let request = run.send(&format!("p-{index}"), SHORT);
        // The bus keeps the last value until the next first write.
        run.wait("the first audio", Duration::from_secs(20), |s| {
            s["last_first_write_ms"].is_number() && s["last_first_write_ms"] != previous
        });
        let first = sent.elapsed();
        let bus = run.status()["last_first_write_ms"].as_f64();
        let failures = run.finish("the speech", 1, Duration::from_secs(30));
        let case = json!({ "case": "start", "sample": index, "first_write_ms": bus, "request_ms": ms(request), "send_to_first_write_seen_ms": ms(first), "whole_ms": ms(sent.elapsed()), "failures": failures });
        println!("{case}");
        report.push(case);
    }

    // One after another: three messages sent at once. A message that waits longer than 5 s
    // in the queue expires (as in Python), so short ones all speak and longer ones may not.
    for (name, text) in [("order_brief", BRIEF), ("order_short", SHORT)] {
        let before = run.status();
        let sent = Instant::now();
        for index in 1..=3 {
            run.send(&format!("{name}-{index}"), text);
        }
        let failures = run.finish("three messages", 3, Duration::from_secs(60));
        let after = run.status();
        let delta =
            |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
        let order = json!({ "case": name, "messages": 3, "completed": delta("completed"), "dropped": delta("dropped"), "expired": delta("expired"), "errors": delta("errors"), "cancelled": delta("cancelled"), "whole_ms": ms(sent.elapsed()), "failures": failures });
        println!("{order}");
        report.push(order);
    }

    // A stop while speaking: from the request until nothing plays, with one more waiting.
    let before = run.status();
    let previous = before["last_first_write_ms"].clone();
    run.send("c-1", LONG);
    run.send("c-2", SHORT);
    run.wait("the long speech", Duration::from_secs(20), |s| {
        s["active"] == true && s["last_first_write_ms"] != previous && s["queued"] == 1
    });
    std::thread::sleep(Duration::from_millis(800));
    let stopping = Instant::now();
    run.ok("/run/stop_voice", Value::Null);
    let answered = stopping.elapsed();
    let idle = run.wait("the stop", Duration::from_secs(5), |s| s["active"] == false);
    let after = run.status();
    let delta = |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
    let stop = json!({ "case": "stop", "answer_ms": ms(answered), "stop_to_idle_ms": ms(idle), "cancelled": delta("cancelled"), "dropped": delta("dropped"), "completed": delta("completed"), "queued": after["queued"], "tts_enabled": after["tts_enabled"] });
    println!("{stop}");
    report.push(stop);

    // The next message after the stop still speaks.
    run.send("a-1", SHORT);
    let failures = run.finish("speech after the stop", 1, Duration::from_secs(30));
    println!("{}", json!({ "case": "after_stop", "failures": failures }));

    // The server ends while it speaks: the speech ends with it, without waiting for a timeout.
    let before = run.status();
    let previous = before["last_first_write_ms"].clone();
    run.send("x-1", LONG);
    run.wait("the long speech", Duration::from_secs(20), |s| {
        s["active"] == true && s["last_first_write_ms"] != previous
    });
    std::thread::sleep(Duration::from_millis(800));
    let pid = listener.lock().unwrap().expect("the core's server listens");
    let ending = Instant::now();
    // When the core hears the run's end, and when the process is gone (polled with tasklist).
    let heard = {
        let listener = listener.clone();
        std::thread::spawn(move || {
            while listener.lock().unwrap().is_some() && ending.elapsed() < Duration::from_secs(15) {
                std::thread::sleep(Duration::from_millis(1));
            }
            ending.elapsed()
        })
    };
    let gone = std::thread::spawn(move || {
        let filter = format!("PID eq {pid}");
        while ending.elapsed() < Duration::from_secs(15) {
            let listed = std::process::Command::new("tasklist")
                .args(["/FI", &filter, "/NH", "/FO", "CSV"])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")))
                .unwrap_or(true);
            if !listed {
                break;
            }
        }
        ending.elapsed()
    });
    let killed = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output()
        .is_ok_and(|o| o.status.success());
    let kill_returned = ending.elapsed();
    run.wait(
        "the end of the speech with the server",
        Duration::from_secs(15),
        |s| s["active"] == false,
    );
    let idle = ending.elapsed();
    let (heard, gone) = (heard.join().unwrap(), gone.join().unwrap());
    std::thread::sleep(Duration::from_millis(500));
    let after = run.status();
    let delta = |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
    println!(
        "{}",
        json!({ "case": "server_end", "killed": killed, "kill_returned_ms": ms(kill_returned), "process_gone_ms": ms(gone), "end_heard_ms": ms(heard), "kill_to_idle_ms": ms(idle), "errors": delta("errors"), "cancelled": delta("cancelled"), "last_error": after["last_error"], "tts_enabled_after_500ms": after["tts_enabled"] })
    );

    run.ok("/run/disable_tts", Value::Null);
    let stopped = run.backend.kill_and_wait(Duration::from_secs(10));
    println!("{}", json!({ "case": "end", "stopped_cleanly": stopped }));
}
