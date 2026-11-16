//! A backend driven the way the UI drives it: request lines in, answer and notification lines
//! out, with the settings in a temporary folder.
#![allow(dead_code)]

pub mod fake_asr;
pub mod fake_audio;
pub mod fake_capture;
pub mod fake_osc;
pub mod fake_tts;
pub mod fake_voice;
pub mod net;

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use vrct_core::config::{Environment, Platform};
use vrct_core::controller::Services;
use vrct_core::protocol::request_line;
use vrct_core::{Backend, Options, Sink};

pub const TIMEOUT: Duration = Duration::from_secs(10);
pub const VERSION: &str = "0.4.0-beta.1";

#[derive(Default)]
struct Seen {
    lines: Vec<Value>,
    exit: Option<i32>,
}

pub struct Ui {
    pub backend: Backend,
    seen: Arc<(Mutex<Seen>, Condvar)>,
    pub dir: PathBuf,
    _temp: Option<tempfile::TempDir>,
}

pub struct Setup {
    pub saved: Option<Value>,
    pub raw: Option<String>,
    pub services: Services,
    pub watchdog: Option<(Duration, Duration)>,
    pub grace: Duration,
    pub platform: Platform,
    pub dir: Option<PathBuf>,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            saved: None,
            raw: None,
            // The OSC link without mDNS: no test joins UDP 5353 on every interface. The
            // translation providers never leave this PC: a saved key is not sent anywhere. No
            // audio device is listed or watched. No VR runtime: a SteamVR that does not run, and
            // no VR panel page.
            services: Services {
                osc: fake_osc::factory(false).0,
                translation_transport: vrct_translation::http::loopback_only(),
                translation_endpoints: vrct_translation::providers::Endpoints::all_at("http://provider.invalid"),
                audio: fake_audio::FakeAudio::new().platform(),
                vr: Arc::new(vrct_core::vr_overlay::runtime::fake::FakeVr::default()),
                vr_panel_surface: None,
                steamvr_poll: Duration::from_millis(20),
                // No real microphone or speaker, and no recognition service beyond this PC.
                transcription_capture: fake_capture::FakeCapture::new().factory(),
                transcription_endpoints: vrct_transcription::providers::Endpoints::all_at("http://provider.invalid"),
                // No speech output, microphone, gate or worker runtime of the PC.
                voice: fake_voice::FakeVoice::new().platform(),
                ..Services::default()
            },
            watchdog: None,
            grace: Duration::from_secs(5),
            platform: Platform::current(),
            dir: None,
        }
    }
}

pub fn environment(dir: &Path, platform: Platform) -> Environment {
    Environment {
        version: VERSION.into(),
        state_dir: dir.to_path_buf(),
        app_dir: dir.join("app"),
        data_dir: dir.join("data"),
        platform,
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: Some("test-token".into()),
    }
}

impl Ui {
    pub fn start() -> Ui {
        Self::with(Setup::default())
    }

    pub fn with(setup: Setup) -> Ui {
        let (temp, dir) = match setup.dir {
            Some(dir) => (None, dir),
            None => {
                let temp = tempfile::tempdir().unwrap();
                let dir = temp.path().to_path_buf();
                (Some(temp), dir)
            }
        };
        if let Some(saved) = &setup.saved {
            std::fs::write(dir.join("config.json"), serde_json::to_string_pretty(saved).unwrap()).unwrap();
        }
        if let Some(raw) = &setup.raw {
            std::fs::write(dir.join("config.json"), raw).unwrap();
        }
        let seen = Arc::new((Mutex::new(Seen::default()), Condvar::new()));
        let lines = Arc::clone(&seen);
        let exits = Arc::clone(&seen);
        let sink = Sink {
            line: Arc::new(move |line| {
                let value: Value = serde_json::from_str(&line).expect("every line is JSON");
                lines.0.lock().unwrap().lines.push(value);
                lines.1.notify_all();
            }),
            exit: Arc::new(move |code| {
                exits.0.lock().unwrap().exit = Some(code);
                exits.1.notify_all();
            }),
        };
        let mut options = Options::new(environment(&dir, setup.platform));
        options.watchdog = setup.watchdog;
        options.grace = setup.grace;
        options.services = setup.services;
        let backend = Backend::start(options, sink);
        Ui { backend, seen, dir, _temp: temp }
    }

    pub fn send(&self, endpoint: &str, data: Option<Value>) -> usize {
        let mark = self.seen.0.lock().unwrap().lines.len();
        self.backend.write_line(&request_line(endpoint, data.as_ref()));
        mark
    }

    pub fn send_raw(&self, line: &str) -> usize {
        let mark = self.seen.0.lock().unwrap().lines.len();
        self.backend.write_line(line);
        mark
    }

    /// The first line after `from` that matches.
    pub fn wait_from(&self, from: usize, what: &str, matches: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + TIMEOUT;
        let (lock, cond) = &*self.seen;
        let mut seen = lock.lock().unwrap();
        loop {
            if let Some(found) = seen.lines.iter().skip(from).find(|l| matches(l)) {
                return found.clone();
            }
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "no {what} within {TIMEOUT:?}; lines: {:#?}", seen.lines);
            seen = cond.wait_timeout(seen, left).unwrap().0;
        }
    }

    pub fn wait_endpoint(&self, from: usize, endpoint: &str) -> Value {
        self.wait_from(from, endpoint, |l| l["endpoint"] == endpoint)
    }

    /// Sends a request and returns its answer.
    pub fn request(&self, endpoint: &str, data: Option<Value>) -> Value {
        let mark = self.send(endpoint, data);
        self.wait_endpoint(mark, endpoint)
    }

    /// The result of a request that must succeed.
    pub fn ok(&self, endpoint: &str, data: Option<Value>) -> Value {
        let answer = self.request(endpoint, data);
        assert_eq!(answer["status"], 200, "{endpoint}: {answer}");
        answer["result"].clone()
    }

    pub fn ready(&self) -> Value {
        self.wait_endpoint(0, "/run/initialization_complete")["result"].clone()
    }

    pub fn lines(&self) -> Vec<Value> {
        self.seen.0.lock().unwrap().lines.clone()
    }

    /// Lines after `from` on an endpoint, in order.
    pub fn on(&self, from: usize, endpoint: &str) -> Vec<Value> {
        self.lines().into_iter().skip(from).filter(|l| l["endpoint"] == endpoint).collect()
    }

    pub fn wait_exit(&self, timeout: Duration) -> Option<i32> {
        let deadline = Instant::now() + timeout;
        let (lock, cond) = &*self.seen;
        let mut seen = lock.lock().unwrap();
        while seen.exit.is_none() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            seen = cond.wait_timeout(seen, left).unwrap().0;
        }
        seen.exit
    }

    pub fn saved(&self) -> Value {
        serde_json::from_str(&std::fs::read_to_string(self.dir.join("config.json")).unwrap()).unwrap()
    }

    /// Stops the run and waits for it, so that a test leaves no threads behind.
    pub fn stop(self) -> Option<i32> {
        self.backend.kill();
        self.wait_exit(TIMEOUT)
    }
}

pub fn error_code(answer: &Value) -> &str {
    answer["result"]["error_code"].as_str().unwrap_or_default()
}

pub fn languages(language: &str, country: &str) -> Value {
    json!({ "language": language, "country": country, "enable": true })
}
