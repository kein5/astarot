//! Whether sending is on, and the daily record that keeps each event to once a day
//! (`state.py`).
//!
//! The file (`telemetry_state.json`) keeps the Python module's shape, so either can read what
//! the other wrote:
//!
//! ```json
//! {
//!   "last_app_started_date": "YYYY-MM-DD",
//!   "errors_sent": {"YYYY-MM-DD": ["ERROR_CODE_1", ...]},
//!   "sent": [{"at": "YYYY-MM-DD HH:MM", "accepted": true, "body": {...}}, ...]
//! }
//! ```
//!
//! Days are UTC, the day of the timestamp an event carries: the receiver counts by that day.
//! `sent` is what went out, the latest [`SENT_LIMIT`], shown on the settings page; its `at` is
//! this PC's local time.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{Local, Utc};

use crate::json::{Json, Object};

/// How many sent events stay readable on this PC.
pub const SENT_LIMIT: usize = 20;

pub(crate) fn today() -> String {
    Utc::now().date_naive().format("%Y-%m-%d").to_string()
}

#[derive(Clone, Debug, PartialEq)]
pub struct SentRow {
    pub at: String,
    pub accepted: bool,
    pub body: Object,
}

impl SentRow {
    fn from_json(row: &Json) -> Option<SentRow> {
        let row = row.as_object()?;
        let at = row.get("at")?.as_str()?.to_string();
        let accepted = match row.get("accepted")? {
            Json::Bool(b) => *b,
            _ => return None,
        };
        let body = row.get("body")?.as_object()?.clone();
        Some(SentRow { at, accepted, body })
    }

    pub fn to_json(&self) -> Json {
        Object::new().with("at", self.at.as_str()).with("accepted", self.accepted).with("body", self.body.clone()).into()
    }
}

#[derive(Clone, Debug)]
struct Data {
    last_app_started_date: Json,
    errors_sent: Object,
    sent: Vec<SentRow>,
}

impl Data {
    fn empty() -> Data {
        Data { last_app_started_date: Json::Null, errors_sent: Object::new(), sent: Vec::new() }
    }

    fn to_json(&self) -> Json {
        Object::new()
            .with("last_app_started_date", self.last_app_started_date.clone())
            .with("errors_sent", self.errors_sent.clone())
            .with("sent", self.sent.iter().map(SentRow::to_json).collect::<Vec<_>>())
            .into()
    }

    fn codes_on(&self, day: &str) -> Vec<String> {
        self.errors_sent.get(day).and_then(Json::as_array).map(|codes| codes.iter().filter_map(|c| c.as_str().map(str::to_string)).collect()).unwrap_or_default()
    }
}

struct Inner {
    enabled: bool,
    storage_path: Option<PathBuf>,
    data: Data,
}

/// Thread-safe; every write goes to the file at once. A failed read starts empty and a failed
/// write is ignored: telemetry never stops the app.
pub struct TelemetryState {
    inner: Mutex<Inner>,
}

fn load(path: Option<&Path>) -> Data {
    let Some(path) = path else { return Data::empty() };
    let Ok(text) = std::fs::read(path) else { return Data::empty() };
    let Ok(Json::Object(loaded)) = Json::parse_slice(&text) else { return Data::empty() };
    let sent = loaded.get("sent").and_then(Json::as_array).map(|rows| rows.iter().filter_map(SentRow::from_json).collect::<Vec<_>>()).unwrap_or_default();
    let skip = sent.len().saturating_sub(SENT_LIMIT);
    Data {
        last_app_started_date: loaded.get("last_app_started_date").cloned().unwrap_or(Json::Null),
        errors_sent: loaded.get("errors_sent").and_then(Json::as_object).cloned().unwrap_or_default(),
        sent: sent.into_iter().skip(skip).collect(),
    }
}

impl Inner {
    fn save(&self) {
        let Some(path) = &self.storage_path else { return };
        // As os.makedirs(dirname): a bare file name has no folder to make, and fails.
        let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) else { return };
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
        let _ = std::fs::write(path, self.data.to_json().to_python_indented());
    }

    /// Only today's error codes are kept.
    fn prune(&mut self) {
        let today = today();
        let kept = self.data.errors_sent.get(&today).cloned();
        self.data.errors_sent = Object::new();
        if let Some(kept) = kept {
            self.data.errors_sent.insert(today, kept);
        }
    }
}

impl TelemetryState {
    pub fn new(storage_path: Option<&Path>) -> Self {
        TelemetryState { inner: Mutex::new(Inner { enabled: true, storage_path: storage_path.map(Path::to_path_buf), data: load(storage_path) }) }
    }

    /// Sets (late) where the record lives, and reads it from there.
    pub fn set_storage_path(&self, path: &Path) {
        let mut inner = self.inner.lock().unwrap();
        inner.storage_path = Some(path.to_path_buf());
        inner.data = load(Some(path));
    }

    pub fn storage_path(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().storage_path.clone()
    }

    pub fn set_enabled(&self, value: bool) {
        self.inner.lock().unwrap().enabled = value;
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.lock().unwrap().enabled
    }

    pub fn should_send_app_started_today(&self) -> bool {
        self.inner.lock().unwrap().data.last_app_started_date != Json::from(today())
    }

    pub fn mark_app_started_sent_today(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.data.last_app_started_date = today().into();
        inner.prune();
        inner.save();
    }

    pub fn should_send_error_today(&self, error_code: &str) -> bool {
        if error_code.is_empty() {
            return false;
        }
        let today = today();
        !self.inner.lock().unwrap().data.codes_on(&today).iter().any(|c| c == error_code)
    }

    pub fn mark_error_sent_today(&self, error_code: &str) {
        if error_code.is_empty() {
            return;
        }
        let today = today();
        let mut inner = self.inner.lock().unwrap();
        let mut codes = inner.data.codes_on(&today);
        if !codes.iter().any(|c| c == error_code) {
            codes.push(error_code.to_string());
        }
        inner.data.errors_sent = Object::new().with(today, codes.into_iter().map(Json::from).collect::<Vec<_>>());
        inner.save();
    }

    /// Keeps what was sent, as it went out (the latest [`SENT_LIMIT`]).
    pub fn record_sent(&self, body: &Object, accepted: bool) {
        let row = SentRow { at: Local::now().format("%Y-%m-%d %H:%M").to_string(), accepted, body: body.clone() };
        let mut inner = self.inner.lock().unwrap();
        inner.data.sent.push(row);
        let skip = inner.data.sent.len().saturating_sub(SENT_LIMIT);
        inner.data.sent.drain(..skip);
        inner.save();
    }

    /// The record of what was sent, oldest first.
    pub fn sent(&self) -> Vec<SentRow> {
        self.inner.lock().unwrap().data.sent.clone()
    }

    /// `{enabled, storage_path, last_app_started_date, errors_sent}`.
    pub fn debug_info(&self) -> Json {
        let inner = self.inner.lock().unwrap();
        Object::new()
            .with("enabled", inner.enabled)
            .with("storage_path", inner.storage_path.as_ref().map(|p| p.to_string_lossy().into_owned()))
            .with("last_app_started_date", inner.data.last_app_started_date.clone())
            .with("errors_sent", inner.data.errors_sent.clone())
            .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry_state.json");
        (dir, path)
    }

    #[test]
    fn initializes_from_missing_or_corrupt_file() {
        let (_dir, path) = fresh();
        assert!(TelemetryState::new(Some(&path)).should_send_app_started_today());
        std::fs::write(&path, "{ not json").unwrap();
        let state = TelemetryState::new(Some(&path));
        assert!(state.should_send_app_started_today() && state.sent().is_empty());
        std::fs::write(&path, "[1, 2]").unwrap();
        assert!(TelemetryState::new(Some(&path)).should_send_app_started_today());
    }

    #[test]
    fn app_started_once_a_day_and_again_the_next_day() {
        let (_dir, path) = fresh();
        let state = TelemetryState::new(Some(&path));
        assert!(state.should_send_app_started_today());
        state.mark_app_started_sent_today();
        assert!(!state.should_send_app_started_today());
        assert!(!TelemetryState::new(Some(&path)).should_send_app_started_today());
        std::fs::write(&path, r#"{"last_app_started_date": "2000-01-01", "errors_sent": {}}"#).unwrap();
        assert!(TelemetryState::new(Some(&path)).should_send_app_started_today());
    }

    #[test]
    fn errors_once_per_code_per_day_and_it_persists() {
        let (_dir, path) = fresh();
        let state = TelemetryState::new(Some(&path));
        assert!(state.should_send_error_today("A"));
        state.mark_error_sent_today("A");
        assert!(!state.should_send_error_today("A") && state.should_send_error_today("B"));
        assert!(!TelemetryState::new(Some(&path)).should_send_error_today("A"));
        // An empty code is never sent and never recorded.
        assert!(!state.should_send_error_today(""));
        state.mark_error_sent_today("");
        assert_eq!(state.debug_info().get("errors_sent").unwrap().get(&today()).unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn old_error_days_are_pruned_on_write() {
        let (_dir, path) = fresh();
        std::fs::write(&path, r#"{"last_app_started_date": null, "errors_sent": {"2000-01-01": ["OLD"]}}"#).unwrap();
        let state = TelemetryState::new(Some(&path));
        state.mark_app_started_sent_today();
        let saved = Json::parse(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(saved.get("errors_sent").unwrap().as_object().unwrap().is_empty());
        std::fs::write(&path, r#"{"errors_sent": {"2000-01-01": ["OLD"]}}"#).unwrap();
        let state = TelemetryState::new(Some(&path));
        state.mark_error_sent_today("NEW");
        let saved = Json::parse(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved.get("errors_sent").unwrap().as_object().unwrap().keys().collect::<Vec<_>>(), [today().as_str()]);
    }

    #[test]
    fn only_the_latest_sent_events_are_kept_and_damaged_rows_are_dropped() {
        let (_dir, path) = fresh();
        let state = TelemetryState::new(Some(&path));
        for number in 0..SENT_LIMIT + 5 {
            state.record_sent(&Object::new().with("event", "error").with("error_code", format!("CODE_{number}")), number % 2 == 0);
        }
        let kept = TelemetryState::new(Some(&path)).sent();
        let codes: Vec<String> = kept.iter().map(|r| r.body.get("error_code").unwrap().as_str().unwrap().to_string()).collect();
        assert_eq!(codes, (5..SENT_LIMIT + 5).map(|n| format!("CODE_{n}")).collect::<Vec<_>>());
        assert!(kept.iter().all(|r| r.at.len() == 16 && &r.at[4..5] == "-" && &r.at[10..11] == " "));
        let mut data = Json::parse(&std::fs::read_to_string(&path).unwrap()).unwrap();
        if let Json::Object(o) = &mut data {
            o.insert("sent", vec![Json::parse(r#"{"at": 1, "body": {}, "accepted": true}"#).unwrap(), "x".into(), kept[0].to_json()]);
        }
        std::fs::write(&path, data.to_python_indented()).unwrap();
        assert_eq!(TelemetryState::new(Some(&path)).sent(), [kept[0].clone()]);
    }

    #[test]
    fn the_file_is_what_python_writes() {
        let (_dir, path) = fresh();
        let state = TelemetryState::new(Some(&path));
        state.record_sent(&Object::new().with("event", "app_started").with("v", 2u64), true);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\n  \"last_app_started_date\": null,\n  \"errors_sent\": {},\n  \"sent\": [\n    {\n      \"at\": "), "{text}");
        assert!(text.ends_with("\"body\": {\n        \"event\": \"app_started\",\n        \"v\": 2\n      }\n    }\n  ]\n}"), "{text}");
    }
}
