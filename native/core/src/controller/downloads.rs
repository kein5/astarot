//! Model downloads and the hardware probe behind them (`controller.py`: `getModelDownload*`,
//! `startModelDownload`, `cancelModelDownload`, `applyModelDownload`; `vrct_ops::downloads`).
//!
//! A download starts only from the user's consent to one entry of the current catalog; nothing
//! here reaches the network or the disk otherwise. Applying a finished download is a separate
//! request that writes the verified paths into the settings, and only when the settings still
//! hold what the user saw (`expected`) and nothing runs on that target. The failures answer
//! `{"error_code": ...}` without the error body, as Python's `_modelDownloadFailure` did: 409
//! for a state that may pass, 400 otherwise.

use super::routes::{Builder, OPEN};
use super::{Core, Services, ok};
use crate::config::Environment;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrct_ops::downloads::catalog::{self, Model};
use vrct_ops::downloads::hardware::{BinarySource, HardwareProbe};
use vrct_ops::downloads::{Downloads, Error};
use vrct_ops::telemetry::Telemetry;

/// The codes answered with 409: the request may pass once the state changes.
const CONFLICTS: [&str; 6] = ["download_busy", "downloads_closed", "stale_job", "download_not_ready", "settings_changed", "model_target_busy"];
/// How long the hardware probe may take (`HardwareProbe(timeout=3)`).
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// How long shutdown waits for a download, an apply or a probe (`close(timeout=2)`).
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

/// Makes the download manager of a root ([`Services::model_downloads`]).
pub type DownloadsSource = Arc<dyn Fn(&Path) -> Result<Downloads, Error> + Send + Sync>;
/// Finds the bundled speech.cpp ([`Services::speech_binary`]).
pub type SpeechBinary = Arc<dyn Fn(&Environment) -> Result<PathBuf, String> + Send + Sync>;

/// The default [`Services::model_downloads`]: the reviewed catalog over the public transport.
pub(crate) fn default_downloads(root: &Path) -> Result<Downloads, Error> {
    Downloads::new(root)
}

/// The default [`Services::speech_binary`]: the checked speech.cpp of the app's bundle
/// (`runtime.bundled_binary`, `<resources>/build/speechcpp`).
pub(crate) fn default_speech_binary(env: &Environment) -> Result<PathBuf, String> {
    vrct_speech_server::bundle::bundled_binary(&super::speech::bundle_folder(env)).map_err(str::to_string)
}

/// What the download and usage-event endpoints keep for the run.
pub(crate) struct Ops {
    pub(super) downloads: Downloads,
    pub(super) hardware: HardwareProbe,
    pub(super) telemetry: Telemetry,
    /// Held while an apply checks and writes the settings (Python's `_speech_settings_lock` and
    /// `_voice_settings_lock`).
    apply_lock: Mutex<()>,
}

impl Ops {
    fn new(env: &Environment, services: &Services) -> Self {
        // Next to config.json, as Python's `Path(config_path).parent / 'downloaded_models'`;
        // chat reading finds the OCR models there too.
        let root = env.state_dir.join("downloaded_models");
        let downloads = (services.model_downloads)(&root).expect("the reviewed catalog is valid");
        let (source, env_copy) = (Arc::clone(&services.speech_binary), env.clone());
        let binary: BinarySource = Arc::new(move || source(&env_copy));
        let hardware = HardwareProbe::new(Arc::clone(&binary), PROBE_TIMEOUT);
        let telemetry = (services.telemetry)();
        telemetry.set_hardware_source(Arc::new(move || {
            let binary = binary().ok();
            Some(vrct_ops::telemetry::hardware::cached(binary.as_deref(), vrct_ops::telemetry::hardware::TIMEOUT))
        }));
        // Every reported error code reaches the usage events (`register_error_report_hook`);
        // the telemetry itself sends nothing until it is started, and once a day per code.
        let reporter = telemetry.clone();
        crate::errors::register_report_hook(Arc::new(move |code| reporter.track_error(code)));
        Ops { downloads, hardware, telemetry, apply_lock: Mutex::new(()) }
    }
}

impl Core {
    /// Made on first use, so that a run that never asks touches nothing.
    pub(crate) fn ops(&self) -> &Ops {
        self.ops.get_or_init(|| Ops::new(self.config().environment(), self.services()))
    }

    /// Stops the downloads and the probe at shutdown: every owner is told first, then each is
    /// waited for (`Controller.shutdown`).
    pub(crate) fn close_model_downloads(&self) {
        let Some(ops) = self.ops.get() else { return };
        ops.downloads.request_close();
        if !ops.downloads.close(CLOSE_TIMEOUT) {
            self.step("[models] download/apply shutdown pending");
        }
        if !ops.hardware.close(CLOSE_TIMEOUT) {
            self.step("[models] hardware inspection shutdown pending");
        }
    }

    /// Writes the paths of a verified download into the settings (the callback of
    /// `applyModelDownload`). It runs at the manager's commit point; a refusal leaves the
    /// download ready.
    fn apply_download_paths(&self, entry: &Model, paths: &[(String, String)], expected: &Value) -> Result<(), Error> {
        let path = |role: &str| paths.iter().find(|(r, _)| r == role).map(|(_, p)| p.clone());
        if entry.target == "ocr" {
            // Chat reading finds verified downloads by catalog id; no setting holds a path.
            if !(expected.is_null() || *expected == json!({})) {
                return Err(Error::Code("download_request_invalid"));
            }
            return Ok(());
        }
        let rvc = entry.target == "rvc";
        let keys: &[&str] = if rvc { &["model", "index"] } else { &["model"] };
        let shaped = expected.as_object().is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.get(*k).is_some_and(Value::is_string)));
        if !shaped {
            return Err(Error::Code("download_request_invalid"));
        }
        let ops = self.ops();
        let _held = ops.apply_lock.lock().unwrap();
        let config = self.config();
        if rvc {
            if !(self.services().model_target_idle)("rvc") {
                return Err(Error::Code("model_target_busy"));
            }
            let mut settings = config.get("DIRECT_VOICE_SETTINGS");
            if keys.iter().any(|k| settings[format!("rvc_{k}")] != expected[*k]) {
                return Err(Error::Code("settings_changed"));
            }
            settings["rvc_model"] = json!(path("model").unwrap_or_default());
            settings["rvc_index"] = json!(path("index").unwrap_or_default());
            config.set("DIRECT_VOICE_SETTINGS", settings).map_err(|_| Error::Code("download_apply_failed"))?;
        } else {
            // A VAD or diarization file goes to a field of the asr profile; `expected` names
            // that field's value, not the recognizer's.
            let Some((profile, field)) = catalog::speech_field(&entry.target) else {
                return Err(Error::Code("download_request_invalid"));
            };
            let running = vrct_speech_server::settings::Profile::from_name(profile).is_ok_and(|p| self.speech_servers().is_running(p));
            if running || !(self.services().model_target_idle)(profile) {
                return Err(Error::Code("model_target_busy"));
            }
            let mut settings = config.get("SPEECH_SERVER_SETTINGS");
            if settings["profiles"][profile][field] != expected["model"] {
                return Err(Error::Code("settings_changed"));
            }
            settings["profiles"][profile][field] = json!(path("model").unwrap_or_default());
            config.set("SPEECH_SERVER_SETTINGS", settings).map_err(|_| Error::Code("download_apply_failed"))?;
        }
        Ok(())
    }
}

fn to_value(json: vrct_ops::json::Json) -> Value {
    serde_json::to_value(json).expect("plain JSON converts")
}

/// `_modelDownloadFailure`.
fn failure(code: &str) -> Reply {
    Reply::status(if CONFLICTS.contains(&code) { 409 } else { 400 }, json!({ "error_code": code }))
}

fn answer(result: Result<vrct_ops::json::Json, Error>, other: &str) -> Reply {
    match result {
        Ok(state) => ok(to_value(state)),
        Err(Error::Code(code)) => failure(code),
        // A file error or a fixed description: neither is shown; the UI gets the fixed code.
        Err(_) => failure(other),
    }
}

/// `_modelDownloadRequest`: exactly `{id, job_id}` (and `expected` to apply), both non-empty
/// strings.
fn request(data: &Value, apply: bool) -> Option<(&str, &str)> {
    let fields = data.as_object()?;
    let required: &[&str] = if apply { &["id", "job_id", "expected"] } else { &["id", "job_id"] };
    if fields.len() != required.len() || !required.iter().all(|k| fields.contains_key(*k)) {
        return None;
    }
    let text = |key: &str| fields[key].as_str().filter(|s| !s.is_empty());
    Some((text("id")?, text("job_id")?))
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/model_download_catalog", OPEN, |core, _| {
        let mut catalog = to_value(core.ops().downloads.catalog());
        // The reviews of the built-in CTranslate2 downloads (`legacyModelCatalog`) come with
        // that download, which the core does not run yet: none is offered.
        catalog["legacy_models"] = json!([]);
        ok(catalog)
    });
    b.with("/get/data/model_download_hardware", OPEN, |core, _| ok(to_value(core.ops().hardware.state())));
    b.with("/run/refresh_model_download_hardware", OPEN, |core, data| {
        // The probe takes nothing from the UI: no binary, no options.
        if !(data.is_null() || *data == json!({})) {
            return failure("download_request_invalid");
        }
        match core.ops().hardware.refresh() {
            Ok(state) => ok(to_value(state)),
            Err(code) => Reply::status(409, json!({ "error_code": code })),
        }
    });
    b.with("/get/data/model_download_state", OPEN, |core, _| ok(to_value(core.ops().downloads.state())));
    b.with("/run/start_model_download", OPEN, |core, data| answer(core.ops().downloads.start(data), "download_failed"));
    b.with("/run/cancel_model_download", OPEN, |core, data| match request(data, false) {
        Some((id, job_id)) => answer(core.ops().downloads.cancel(id, job_id), "download_failed"),
        None => failure("download_request_invalid"),
    });
    b.with("/run/apply_model_download", OPEN, |core, data| {
        let Some((id, job_id)) = request(data, true) else { return failure("download_request_invalid") };
        let expected = &data["expected"];
        let result = core.ops().downloads.apply(id, job_id, |entry, paths| core.apply_download_paths(entry, paths, expected));
        answer(result, "download_apply_failed")
    });
}
