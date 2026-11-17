//! The diagnostic logs: `process.log` (requests, answers and steps) and `error.log`.
//!
//! The rules are those of `src-python/utils.py`:
//!
//! - Values of endpoints whose name looks secret (`auth_key`, `token`, `voice_settings`, ...) are
//!   written as `***MASKED***`, and so are such keys inside an aggregate answer.
//! - Conversation text (chat, transcripts, translations, OCR) is never written: the fields that
//!   carry it are replaced with `***CONVERSATION***`, and the high-rate or private notifications
//!   (`/run/realtime_caption`, `/run/io_trace`, ...) are not logged at all.
//! - Successful answers to the states the UI polls, and the volume meters, are not logged.
//! - URLs lose their user info and their query values.
//! - A file over 10 MB is emptied and written again from the start.

use serde_json::{Map, Value};
use std::fs::{File, OpenOptions, create_dir_all};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const LIMIT: u64 = 10 * 1024 * 1024;

/// Python's markers, `client_id` for the Client ID that goes with Papago's secret (core only), and
/// `user_model`: the names and file paths of the models a user registers (#403).
pub const SENSITIVE_ENDPOINT_MARKERS: [&str; 9] =
    ["auth_key", "api_key", "password", "token", "secret", "voice_settings", "instructions", "client_id", "user_model"];

/// Notifications that are never written to the log.
pub const UNLOGGED_ENDPOINTS: [&str; 4] = ["/run/vr_panel_pointer", "/run/realtime_caption", "/run/word_filter", "/run/io_trace"];

/// States the UI asks for every 0.5 to 1 s.
pub const POLLED_ENDPOINTS: [&str; 9] = [
    "/get/data/ocr_capture_status",
    "/get/data/voice_status",
    "/get/data/voice_route",
    "/get/data/direct_voice_state",
    "/get/data/speech_server_state",
    "/get/data/realtime_asr_state",
    "/get/data/model_download_state",
    "/get/data/model_download_hardware",
    "/get/data/vc_runtime_state",
];

const METER_ENDPOINTS: [&str; 2] = ["/run/check_mic_volume", "/run/check_speaker_volume"];

const CONVERSATION_ENDPOINTS: [&str; 4] = [
    "/run/send_message_box",
    "/run/transcription_send_mic_message",
    "/run/transcription_receive_speaker_message",
    "/run/transcription_ocr_message",
];

const CONVERSATION_KEYS: [&str; 6] = ["message", "original", "translation", "translations", "transliteration", "text"];

pub fn is_sensitive_endpoint(endpoint: &str) -> bool {
    let lowered = endpoint.to_lowercase().replace(' ', "_");
    SENSITIVE_ENDPOINT_MARKERS.iter().any(|marker| lowered.contains(marker))
}

/// A successful answer to a polled state, or a meter value: not logged.
pub fn is_quiet_poll(endpoint: &str, status: u16) -> bool {
    status == 200 && (POLLED_ENDPOINTS.contains(&endpoint) || METER_ENDPOINTS.contains(&endpoint))
}

fn mask_value(value: &Value) -> Value {
    match value {
        Value::Null => Value::Null,
        Value::String(s) if s.is_empty() => value.clone(),
        _ => Value::String("***MASKED***".into()),
    }
}

/// Masks every value under a key that looks secret, at any depth.
pub fn mask_sensitive(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| {
                    let item = if is_sensitive_endpoint(key) { mask_value(item) } else { mask_sensitive(item) };
                    (key.clone(), item)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(mask_sensitive).collect()),
        _ => value.clone(),
    }
}

fn empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

/// Replaces the text of a chat, a transcript or a translation.
pub fn redact_conversation(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| {
                    let item = if CONVERSATION_KEYS.contains(&key.as_str()) && !empty(item) {
                        Value::String("***CONVERSATION***".into())
                    } else {
                        redact_conversation(item)
                    };
                    (key.clone(), item)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(redact_conversation).collect()),
        _ => value.clone(),
    }
}

/// `redact_urls`: user info and query values removed from every URL in the strings of a value.
pub fn redact_urls(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(object.iter().map(|(k, v)| (k.clone(), redact_urls(v))).collect()),
        Value::Array(items) => Value::Array(items.iter().map(redact_urls).collect()),
        Value::String(text) => Value::String(redact_urls_in(text)),
        _ => value.clone(),
    }
}

pub fn redact_urls_in(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < text.len() {
        let rest = &lower[index..];
        let start = [rest.find("http://"), rest.find("https://")].into_iter().flatten().min();
        let Some(offset) = start else {
            out.push_str(&text[index..]);
            break;
        };
        let begin = index + offset;
        out.push_str(&text[index..begin]);
        let end = text[begin..]
            .char_indices()
            .find(|(_, c)| c.is_whitespace() || *c == '<' || *c == '>')
            .map_or(text.len(), |(i, _)| begin + i);
        out.push_str(&redact_url(&text[begin..end]));
        index = end;
    }
    out
}

fn redact_url(url: &str) -> String {
    let (before_fragment, _) = url.split_once('#').unwrap_or((url, ""));
    let (base, query) = before_fragment.split_once('?').map_or((before_fragment, None), |(b, q)| (b, Some(q)));
    let Some((scheme, rest)) = base.split_once("://") else {
        return "[redacted URL]".into();
    };
    let (authority, path) = rest.find('/').map_or((rest, ""), |i| (&rest[..i], &rest[i..]));
    let authority = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let mut out = format!("{scheme}://{authority}{path}");
    if let Some(query) = query {
        let keys: Vec<String> = query
            .split(['&', ';'])
            .filter(|part| !part.is_empty())
            .map(|part| format!("{}=REDACTED", part.split_once('=').map_or(part, |(k, _)| k)))
            .collect();
        if !keys.is_empty() {
            out.push('?');
            out.push_str(&keys.join("&"));
        }
    }
    out
}

/// The forms of the user's home folder as they appear in paths (`C:\Users\name`, and with `/`),
/// from `USERPROFILE` on Windows and `HOME` elsewhere. Empty when it is unknown or too short to
/// replace safely (`/`).
pub fn home_prefixes() -> Vec<String> {
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let Some(home) = std::env::var_os(variable).map(|h| h.to_string_lossy().trim_end_matches(['/', '\\']).to_string()) else {
        return Vec::new();
    };
    if home.chars().filter(|c| !matches!(c, '/' | '\\')).count() < 2 {
        return Vec::new();
    }
    let short = short_name(&home);
    home_forms(&home, short)
}

/// How a home folder can be written: as it is, with `/`, with each `\` doubled (Rust's `{:?}` and
/// JSON escapes), and the same for its 8.3 short name (`C:\Users\TARO~1`) when it has one.
fn home_forms(home: &str, short: Option<String>) -> Vec<String> {
    let mut forms = Vec::new();
    for base in std::iter::once(home.to_string()).chain(short) {
        for form in [base.clone(), base.replace('\\', "/"), base.replace('\\', "\\\\")] {
            if !forms.contains(&form) {
                forms.push(form);
            }
        }
    }
    forms
}

/// The 8.3 short form of `path`, when it differs.
#[cfg(windows)]
fn short_name(path: &str) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;
    let wide: Vec<u16> = path.encode_utf16().chain([0]).collect();
    let length = unsafe { GetShortPathNameW(wide.as_ptr(), std::ptr::null_mut(), 0) };
    if length == 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize];
    let written = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), length) };
    if written == 0 || written >= length {
        return None;
    }
    let short = String::from_utf16(&buffer[..written as usize]).ok()?;
    (!short.eq_ignore_ascii_case(path)).then_some(short)
}

#[cfg(not(windows))]
fn short_name(_path: &str) -> Option<String> {
    None
}

/// Whether the home folder's name ends where `rest` begins: `rest` does not go on with more of a
/// name (`C:\Users\Taro2`, `C:\Users\TARO~1`). A full stop ends it only before a space or the end.
fn ends_name(rest: &str) -> bool {
    let mut chars = rest.chars();
    match chars.next() {
        None => true,
        Some('.') => chars.next().is_none_or(char::is_whitespace),
        Some(c) => !(c.is_alphanumeric() || matches!(c, '_' | '-' | '~' | '$')),
    }
}

/// Every string of a value with the home folder written `~`: the folder's name is the user's
/// name on the OS, which a log attached to a bug report must not carry.
pub fn redact_home(value: &Value, homes: &[String]) -> Value {
    if homes.is_empty() {
        return value.clone();
    }
    match value {
        Value::Object(object) => Value::Object(object.iter().map(|(k, v)| (k.clone(), redact_home(v, homes))).collect()),
        Value::Array(items) => Value::Array(items.iter().map(|v| redact_home(v, homes)).collect()),
        Value::String(text) => Value::String(redact_home_in(text, homes)),
        _ => value.clone(),
    }
}

/// `text` with each home folder written `~` where its name ends ([`ends_name`]): before a
/// separator, a quote, a bracket, a line break or the end. Windows paths are matched without
/// regard to ASCII case.
pub fn redact_home_in(text: &str, homes: &[String]) -> String {
    let mut out = text.to_string();
    for home in homes {
        out = replace_path_prefix(&out, home);
    }
    out
}

fn replace_path_prefix(text: &str, home: &str) -> String {
    let fold = |s: &str| if cfg!(windows) { s.to_ascii_lowercase() } else { s.to_string() };
    let (haystack, needle) = (fold(text), fold(home));
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while let Some(offset) = haystack[index..].find(&needle) {
        let begin = index + offset;
        let end = begin + needle.len();
        let boundary = ends_name(&text[end..]);
        out.push_str(&text[index..begin]);
        out.push_str(if boundary { "~" } else { &text[begin..end] });
        index = end;
    }
    out.push_str(&text[index..]);
    out
}

/// The shape of a value without its contents, for an answer that could not be written.
pub fn shape_of(value: &Value, depth: usize) -> Value {
    if depth >= 4 {
        return Value::String("...".into());
    }
    match value {
        Value::Object(object) => Value::Object(object.iter().take(20).map(|(k, v)| (k.clone(), shape_of(v, depth + 1))).collect()),
        Value::Array(items) => {
            let mut shapes: Vec<Value> = items.iter().take(5).map(|v| shape_of(v, depth + 1)).collect();
            if items.len() > 5 {
                shapes.push(Value::String(format!("... {} items", items.len())));
            }
            Value::Array(shapes)
        }
        Value::Null => Value::String("NoneType".into()),
        Value::Bool(_) => Value::String("bool".into()),
        Value::Number(n) => Value::String(if n.is_f64() { "float" } else { "int" }.into()),
        Value::String(_) => Value::String("str".into()),
    }
}

struct LogFile {
    path: PathBuf,
    file: Option<File>,
}

impl LogFile {
    fn write(&mut self, level: &str, name: &str, line: &str) {
        if self.file.is_none() {
            if let Some(parent) = self.path.parent() {
                let _ = create_dir_all(parent);
            }
            self.file = OpenOptions::new().create(true).append(true).open(&self.path).ok();
        }
        let Some(file) = self.file.as_mut() else {
            return;
        };
        if file.metadata().is_ok_and(|m| m.len() > LIMIT) {
            // Emptied in place rather than rotated: a numbered backup used to wake the dev file watcher.
            let _ = file.set_len(0);
        }
        let _ = writeln!(file, "{} - {name} - {level} - {line}", timestamp());
    }
}

fn timestamp() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02},{:03} UTC", rem / 3600, rem % 3600 / 60, rem % 60, now.subsec_millis())
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// The two log files of one backend run.
pub struct Log {
    process: Mutex<LogFile>,
    error: Mutex<LogFile>,
    /// The home folder's forms, written `~` ([`redact_home`]).
    homes: Vec<String>,
}

impl Log {
    /// Logs in `directory` (`<settings folder>/logs`). `process.log` starts empty, as `removeLog` did.
    pub fn new(directory: &Path) -> Self {
        let log = Self::continuing(directory);
        let _ = File::create(directory.join("process.log"));
        log
    }

    /// Logs in `directory` after what an earlier run of this process wrote there: a run started
    /// again after a failed one keeps the failed run's record (the 10 MB rule still applies).
    pub fn continuing(directory: &Path) -> Self {
        let process = directory.join("process.log");
        let _ = create_dir_all(directory);
        Self {
            process: Mutex::new(LogFile { path: process, file: None }),
            error: Mutex::new(LogFile { path: directory.join("error.log"), file: None }),
            homes: home_prefixes(),
        }
    }

    /// A log that writes nowhere.
    pub fn disabled() -> Self {
        Self {
            process: Mutex::new(LogFile { path: PathBuf::new(), file: None }),
            error: Mutex::new(LogFile { path: PathBuf::new(), file: None }),
            homes: Vec::new(),
        }
    }

    /// Writes `home` as `~` instead of the user's home folder (tests).
    pub fn with_home(mut self, home: &str) -> Self {
        self.homes = home_forms(home, None);
        self
    }

    fn enabled(file: &LogFile) -> bool {
        !file.path.as_os_str().is_empty()
    }

    /// `printLog(label, data)`: a step, or a request as it arrived.
    pub fn step(&self, label: &str, data: Option<&Value>) {
        let data = data.cloned().unwrap_or(Value::Null);
        let mut logged = if is_sensitive_endpoint(label) { mask_value(&data) } else { data };
        if CONVERSATION_ENDPOINTS.contains(&label) {
            logged = redact_conversation(&logged);
        }
        let mut record = Map::new();
        record.insert("status".into(), 348.into());
        record.insert("log".into(), Value::String(redact_home_in(&redact_urls_in(label), &self.homes)));
        record.insert("data".into(), redact_home(&redact_urls(&logged), &self.homes));
        let mut file = self.process.lock().unwrap();
        if Self::enabled(&file) {
            file.write("INFO", "process", &Value::Object(record).to_string());
        }
    }

    /// `printResponse`: an answer or a notification, with the same masking.
    pub fn response(&self, status: u16, endpoint: Option<&str>, result: &Value) {
        let name = endpoint.unwrap_or("");
        if UNLOGGED_ENDPOINTS.contains(&name) || is_quiet_poll(name, status) {
            return;
        }
        let mut logged = if is_sensitive_endpoint(name) { mask_value(result) } else { mask_sensitive(result) };
        if CONVERSATION_ENDPOINTS.contains(&name) {
            logged = redact_conversation(&logged);
        }
        let mut record = Map::new();
        record.insert("status".into(), status.into());
        record.insert("endpoint".into(), endpoint.map_or(Value::Null, |e| Value::String(e.into())));
        record.insert("result".into(), redact_home(&redact_urls(&logged), &self.homes));
        let mut file = self.process.lock().unwrap();
        if Self::enabled(&file) {
            file.write("INFO", "process", &Value::Object(record).to_string());
        }
    }

    /// A failure: a fixed description, never the text or the value that caused it.
    pub fn error(&self, what: &str) {
        let mut file = self.error.lock().unwrap();
        if Self::enabled(&file) {
            file.write("ERROR", "error", &redact_home_in(&redact_urls_in(what), &self.homes));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_home_folder_is_written_as_a_tilde_in_paths_only() {
        let homes = vec![r"C:\Users\Taro".to_string(), "C:/Users/Taro".to_string()];
        assert_eq!(redact_home_in(r"C:\Users\Taro\AppData\Local\VRCT-VOX\translation-models", &homes), r"~\AppData\Local\VRCT-VOX\translation-models");
        assert_eq!(redact_home_in("C:/Users/Taro/certs/key.pem", &homes), "~/certs/key.pem");
        assert_eq!(redact_home_in(r"\\?\C:\Users\Taro\config.json", &homes), r"\\?\~\config.json");
        assert_eq!(redact_home_in(r"C:\Users\Taro", &homes), "~");
        // Another user whose name starts the same keeps the path.
        assert_eq!(redact_home_in(r"C:\Users\Taro2\file", &homes), r"C:\Users\Taro2\file");
        if cfg!(windows) {
            assert_eq!(redact_home_in(r"c:\users\taro\file", &homes), r"~\file");
        }
        let value = json!({ "backup": r"C:\Users\Taro\config.json.broken", "list": ["C:/Users/Taro/a"], "n": 1 });
        assert_eq!(redact_home(&value, &homes), json!({ "backup": r"~\config.json.broken", "list": ["~/a"], "n": 1 }));
        assert_eq!(redact_home(&value, &[]), value);
    }

    #[test]
    fn the_home_folder_is_found_in_brackets_lines_debug_text_and_its_short_name() {
        // #470: these ways of writing a path kept the user's name.
        let homes = home_forms(r"C:\Users\Taro", Some(r"C:\Users\TARO~1".to_string()));
        for (text, redacted) in [
            (r"(C:\Users\Taro)", "(~)"),
            (r"[C:\Users\Taro]", "[~]"),
            (r"C:\Users\Taro: denied", "~: denied"),
            ("C:\\Users\\Taro\nnext", "~\nnext"),
            (r"saved in C:\Users\Taro.", "saved in ~."),
            (r#"Os { path: "C:\\Users\\Taro\\a.txt" }"#, r#"Os { path: "~\\a.txt" }"#),
            (r"C:\Users\TARO~1\AppData", r"~\AppData"),
        ] {
            assert_eq!(redact_home_in(text, &homes), redacted, "{text}");
        }
        if cfg!(windows) {
            assert_eq!(redact_home_in(r"c:\users\taro~1\x", &homes), r"~\x");
        }
        // Other users, and other folders that only start the same, stay.
        for text in [r"C:\Users\Taro2\a", r"C:\Users\Taro.old\a", r"C:\Users\Taro_b", r"C:\Users\TARO~12\a", r"C:\Users\Taro-x"] {
            assert_eq!(redact_home_in(text, &homes), text);
        }
    }

    #[test]
    fn steps_answers_and_errors_leave_the_home_folder_out_of_the_files() {
        let dir = std::env::temp_dir().join(format!("vrct-log-test-{}", std::process::id()));
        let home = "/home/taro";
        let log = Log::new(&dir).with_home(home);
        log.step("Loaded /home/taro/.config/vrct-vox", Some(&json!({ "path": "/home/taro/.config/vrct-vox/config.json" })));
        log.response(200, Some("/get/data/model_download_catalog"), &json!({ "translation_models_folder": "/home/taro/.local/share/vrct-vox/translation-models" }));
        log.response(200, Some("/run/config_file_unreadable"), &json!({ "backup": "/home/taro/.config/vrct-vox/config.json.unreadable" }));
        log.error("could not open /home/taro/cert.pem");
        let process = std::fs::read_to_string(dir.join("process.log")).unwrap();
        let errors = std::fs::read_to_string(dir.join("error.log")).unwrap();
        assert!(!process.contains("taro") && !errors.contains("taro"), "{process}\n{errors}");
        assert!(process.contains("~/.local/share/vrct-vox/translation-models"), "{process}");
        let _ = std::fs::remove_dir_all(dir);
    }
}