//! Measures how long the core takes from `Backend::start` to `/run/initialization_complete`,
//! the way the application starts it (`src-tauri/src/backend_host.rs`): in this process, with
//! the settings in `--config-dir` and the application folder `--app-dir` (where the bundled
//! speech.cpp is found). It gave the core's numbers of the baseline before the move from the
//! Python sidecar ("切り替え前の基準値" in docs/voice-stack/core-integration.md).
//!
//! cargo run --release --locked --manifest-path native/core/Cargo.toml --example startup_time --
//!     --app-dir <extracted package> --config-dir <empty folder> --runs 5
//!
//! Prints one JSON line per run: `{"backend": "core", "run": n, "seconds": s}`. No request is
//! sent; the run is stopped once start-up has ended.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use astarot_core::config::{Environment, Platform};
use astarot_core::{Backend, Options, Sink};

fn main() {
    let mut app_dir = None;
    let mut config_dir = None;
    let mut runs = 5usize;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| panic!("{arg} needs a value"));
        match arg.as_str() {
            "--app-dir" => app_dir = Some(PathBuf::from(value())),
            "--config-dir" => config_dir = Some(PathBuf::from(value())),
            "--runs" => runs = value().parse().expect("--runs takes a number"),
            other => panic!("unknown argument {other}"),
        }
    }
    let app_dir = app_dir.expect("--app-dir is required");
    let config_dir = config_dir.expect("--config-dir is required");
    std::fs::create_dir_all(&config_dir).expect("the settings folder can be made");

    for run in 1..=runs {
        let environment = Environment {
            version: "0.0.0".into(),
            state_dir: config_dir.clone(),
            app_dir: app_dir.clone(),
            data_dir: app_dir.clone(),
            platform: Platform::current(),
            compute_devices: vec![Environment::cpu_device()],
            devices: None,
            websocket_token: None,
        };
        let (done, ready) = mpsc::channel();
        let sink = Sink {
            line: std::sync::Arc::new(move |line: String| {
                // Only the endpoint is read; no setting or message is printed.
                if line.contains("\"/run/initialization_complete\"") {
                    let _ = done.send(());
                }
            }),
            exit: std::sync::Arc::new(|_| {}),
        };
        let started = Instant::now();
        let backend = Backend::start(Options::new(environment), sink);
        ready.recv_timeout(Duration::from_secs(180)).expect("start-up ends within 180 s");
        let seconds = started.elapsed().as_secs_f64();
        println!("{{\"backend\": \"core\", \"run\": {run}, \"seconds\": {seconds:.3}}}");
        backend.kill();
        // Let the run release its ports and child processes before the next one.
        std::thread::sleep(Duration::from_secs(2));
    }
}
