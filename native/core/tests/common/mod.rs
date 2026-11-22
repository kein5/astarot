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
pub const VERSION: &str = "0.4.0";

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
    /// The start-up's deadline; none unless a test is about it.
    pub startup_limit: Option<Duration>,
    pub platform: Platform,
    pub dir: Option<PathBuf>,
    /// Write process.log after what an earlier run left there (a run started again).
    pub continue_logs: bool,
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
                transcription_transport: vrct_translation::http::loopback_only(),
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
                // The app's key store over `secrets.json`, with a stand-in for the OS store that
                // lives as long as the test process: keys survive a restart in the same folder,
                // and the PC's own credentials are never touched.
                secret_store: shared_vault().system_source(),
                ..Services::default()
            },
            watchdog: None,
            grace: Duration::from_secs(5),
            startup_limit: None,
            platform: Platform::current(),
            dir: None,
            continue_logs: false,
        }
    }
}

/// The stand-in OS key store of this test process. Each settings folder has its own id in it.
pub fn shared_vault() -> Arc<vrct_core::config::secrets::MemoryStore> {
    static VAULT: std::sync::OnceLock<Arc<vrct_core::config::secrets::MemoryStore>> = std::sync::OnceLock::new();
    Arc::clone(VAULT.get_or_init(vrct_core::config::secrets::MemoryStore::new))
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
        options.startup_limit = setup.startup_limit;
        options.continue_logs = setup.continue_logs;
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
        let start = Instant::now();
        let deadline = start + Duration::from_secs(60);
        let (lock, cond) = &*self.seen;
        let mut seen = lock.lock().unwrap();
        loop {
            if let Some(found) = seen.lines.iter().skip(from).find(|l| matches(l)) {
                if start.elapsed() > Duration::from_millis(1000) {
                    eprintln!("[861] wait_from: {what} took {} ms", start.elapsed().as_millis());
                }
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

    /// One saved API key, from the key store (`config.json` holds none): `null` if none is kept.
    pub fn kept_key(&self, map: &str, provider: &str) -> Value {
        assert!(self.saved().get(map).is_none(), "{map} is not written to config.json");
        let store = self.backend.core().config().secret_store();
        store.read(&format!("{map}/{provider}")).expect("the store answers").map_or(Value::Null, Value::String)
    }

    /// The saved API keys of a map, from the key store: only the providers that have one.
    pub fn kept_keys(&self, map: &str) -> Value {
        let providers = self.backend.core().config().get(map);
        let kept = providers
            .as_object()
            .expect("a map of keys")
            .keys()
            .filter_map(|provider| match self.kept_key(map, provider) {
                Value::Null => None,
                key => Some((provider.clone(), key)),
            })
            .collect();
        Value::Object(kept)
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
