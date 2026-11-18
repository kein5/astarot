//! The caption state of one realtime connection (`realtime_events.py`): only items the server
//! announced can produce a final, at most once while tracked. No audio, translation or output.

use serde_json::Value;
use std::collections::{HashMap, VecDeque};

const PREFIX: &str = "conversation.item.input_audio_transcription.";
const SPEAKER_MIN_MS: f64 = 400.0;
const MAX_SPEAKERS: usize = 4;

/// A caption update (`TranscriptUpdate`).
#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    pub source: &'static str,
    pub namespace: String,
    pub item_id: String,
    pub revision: u64,
    pub text: String,
    pub is_final: bool,
    /// "partial", "final" or "discarded".
    pub state: &'static str,
    /// When the transport received it.
    pub received: Option<std::time::Instant>,
    /// The language code a final reports, else empty.
    pub language: String,
    /// Who spoke, by the server's diarization labels.
    pub speakers: Vec<String>,
}

#[derive(Default)]
struct Pending {
    text: String,
    revision: u64,
}

/// A bounded history of keys (an `OrderedDict` used as a set).
#[derive(Default)]
struct History {
    order: VecDeque<String>,
    limit: usize,
}

impl History {
    fn new(limit: usize) -> Self {
        History { order: VecDeque::new(), limit }
    }

    fn contains(&self, key: &str) -> bool {
        self.order.iter().any(|k| k == key)
    }

    fn remember(&mut self, key: &str) {
        if let Some(at) = self.order.iter().position(|k| k == key) {
            self.order.remove(at);
        }
        self.order.push_back(key.to_string());
        while self.order.len() > self.limit {
            self.order.pop_front();
        }
    }
}

/// `TranscriptEvents`.
pub struct Events {
    pub source: &'static str,
    pub namespace: String,
    pub closed: bool,
    pub clearing: bool,
    pending: Vec<(String, Pending)>,
    terminal: History,
    events: History,
}

fn label(text: &str) -> bool {
    (1..=3).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_uppercase())
}

fn detected(event: &Value) -> String {
    let code = event["languages"].as_array().and_then(|rows| rows.first()).and_then(|row| row["code"].as_str());
    let Some(code) = code else { return String::new() };
    let (base, rest) = match code.split_once('-') {
        Some((base, rest)) => (base, Some(rest)),
        None => (code, None),
    };
    let base_ok = (2..=3).contains(&base.len()) && base.bytes().all(|b| b.is_ascii_lowercase());
    let rest_ok = rest.is_none_or(|r| (2..=8).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_alphanumeric()));
    if base_ok && rest_ok { code.to_string() } else { String::new() }
}

fn speakers(event: &Value) -> Vec<String> {
    let Some(rows) = event["speakers"].as_array() else { return Vec::new() };
    if rows.len() > 256 {
        return Vec::new();
    }
    let mut spoken: HashMap<String, f64> = HashMap::new();
    let mut first: HashMap<String, f64> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for row in rows {
        let (Some(name), Some(start), Some(end)) = (row["speaker"].as_str(), row["start_ms"].as_f64(), row["end_ms"].as_f64())
        else {
            return Vec::new();
        };
        if !label(name) || row["start_ms"].is_boolean() || !(0.0 <= start && start <= end) {
            return Vec::new();
        }
        if !spoken.contains_key(name) {
            order.push(name.to_string());
        }
        *spoken.entry(name.to_string()).or_default() += end - start;
        let earliest = first.entry(name.to_string()).or_insert(start);
        *earliest = earliest.min(start);
    }
    if spoken.is_empty() {
        return Vec::new();
    }
    let mut kept: Vec<String> = order.iter().filter(|l| spoken[*l] >= SPEAKER_MIN_MS).cloned().collect();
    if kept.is_empty() {
        let longest = order.iter().fold(None::<&String>, |best, l| match best {
            Some(b) if spoken[b] >= spoken[l] => Some(b),
            _ => Some(l),
        });
        kept = longest.into_iter().cloned().collect();
    }
    kept.sort_by(|a, b| spoken[b].partial_cmp(&spoken[a]).unwrap_or(std::cmp::Ordering::Equal));
    kept.truncate(MAX_SPEAKERS);
    kept.sort_by(|a, b| first[a].partial_cmp(&first[b]).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(b)));
    kept
}

impl Events {
    pub fn new(source: &'static str, namespace: String) -> Events {
        Events {
            source,
            namespace,
            closed: false,
            clearing: false,
            pending: Vec::new(),
            terminal: History::new(256),
            events: History::new(512),
        }
    }

    fn position(&self, item: &str) -> Option<usize> {
        self.pending.iter().position(|(id, _)| id == item)
    }

    fn emit(&mut self, item: &str, text: String, state: &'static str, language: String, speakers: Vec<String>) -> Update {
        let at = self.position(item).expect("a pending item");
        let pending = &mut self.pending[at].1;
        pending.text = text.clone();
        pending.revision += 1;
        Update {
            source: self.source,
            namespace: self.namespace.clone(),
            item_id: item.to_string(),
            revision: pending.revision,
            text,
            is_final: state == "final",
            state,
            received: None,
            language,
            speakers,
        }
    }

    fn retire(&mut self, item: &str) {
        if let Some(at) = self.position(item) {
            self.pending.remove(at);
        }
        self.terminal.remember(item);
    }

    fn discard(&mut self) -> Vec<Update> {
        let items: Vec<String> = self.pending.iter().map(|(id, _)| id.clone()).collect();
        let updates = items.iter().map(|item| self.emit(item, String::new(), "discarded", String::new(), Vec::new())).collect();
        for item in items {
            self.retire(&item);
        }
        updates
    }

    pub fn begin_clear(&mut self) -> Vec<Update> {
        if self.closed {
            return Vec::new();
        }
        self.clearing = true;
        self.discard()
    }

    pub fn pending_ids(&self) -> Vec<String> {
        self.pending.iter().map(|(id, _)| id.clone()).collect()
    }

    pub fn close(&mut self) -> Vec<Update> {
        self.closed = true;
        self.discard()
    }

    fn fail(&mut self, reason: &'static str) -> Result<Vec<Update>, &'static str> {
        self.close();
        Err(reason)
    }

    /// One server event; `Err` closes the session with a fixed reason.
    pub fn accept(&mut self, event: &Value) -> Result<Vec<Update>, &'static str> {
        if self.closed {
            return Ok(Vec::new());
        }
        let (Some(event_id), Some(kind)) = (event["event_id"].as_str(), event["type"].as_str()) else {
            return self.fail("invalid_event");
        };
        if event_id.is_empty() || event_id.chars().count() > 256 {
            return self.fail("invalid_event");
        }
        if self.events.contains(event_id) {
            return Ok(Vec::new());
        }
        self.events.remember(event_id);
        if kind == "input_audio_buffer.cleared" {
            let updates = self.discard();
            self.clearing = false;
            return Ok(updates);
        }
        let delta = format!("{PREFIX}delta");
        let completed = format!("{PREFIX}completed");
        let failed = format!("{PREFIX}failed");
        let opening = kind == "input_audio_buffer.speech_started" || kind == "input_audio_buffer.committed";
        if !(opening || kind == delta || kind == completed || kind == failed) {
            return Ok(Vec::new());
        }
        let Some(item) = event["item_id"].as_str().filter(|i| !i.is_empty() && i.chars().count() <= 256) else {
            return self.fail("invalid_item");
        };
        let item = item.to_string();
        if self.clearing {
            self.retire(&item);
            return Ok(Vec::new());
        }
        if self.terminal.contains(&item) {
            return Ok(Vec::new());
        }
        if opening {
            if self.position(&item).is_none() {
                if self.pending.len() >= 8 {
                    return self.fail("pending_limit");
                }
                self.pending.push((item, Pending::default()));
            }
            return Ok(Vec::new());
        }
        let Some(at) = self.position(&item) else { return Ok(Vec::new()) };
        if kind == failed || (kind == completed && event["stop"] != "complete") {
            let update = self.emit(&item, String::new(), "discarded", String::new(), Vec::new());
            self.retire(&item);
            return Ok(vec![update]);
        }
        let field = if kind == delta { "delta" } else { "transcript" };
        let Some(text) = event[field].as_str() else { return self.fail("invalid_text") };
        let text = if kind == delta { format!("{}{text}", self.pending[at].1.text) } else { text.to_string() };
        if text.chars().count() > 4000 {
            return self.fail("text_limit");
        }
        if kind == delta {
            return Ok(vec![self.emit(&item, text, "partial", String::new(), Vec::new())]);
        }
        let update = self.emit(&item, text, "final", detected(event), speakers(event));
        self.retire(&item);
        Ok(vec![update])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(id: u32, kind: &str, item: &str, extra: Value) -> Value {
        let mut value = json!({ "event_id": format!("e{id}"), "type": kind, "item_id": item });
        for (k, v) in extra.as_object().unwrap() {
            value[k] = v.clone();
        }
        value
    }

    #[test]
    fn deltas_grow_and_a_final_ends_an_item_once() {
        let mut events = Events::new("mic", "ns".into());
        assert!(events.accept(&event(1, "input_audio_buffer.speech_started", "a", json!({}))).unwrap().is_empty());
        let partial = events.accept(&event(2, &format!("{PREFIX}delta"), "a", json!({ "delta": "he" }))).unwrap();
        assert_eq!((partial[0].text.as_str(), partial[0].state, partial[0].revision), ("he", "partial", 1));
        let partial = events.accept(&event(3, &format!("{PREFIX}delta"), "a", json!({ "delta": "llo" }))).unwrap();
        assert_eq!(partial[0].text, "hello");
        let done = event(4, &format!("{PREFIX}completed"), "a", json!({ "transcript": "hello.", "stop": "complete", "languages": [{ "code": "en" }] }));
        let final_ = events.accept(&done).unwrap();
        assert_eq!((final_[0].state, final_[0].is_final, final_[0].language.as_str()), ("final", true, "en"));
        assert!(events.accept(&event(5, &format!("{PREFIX}completed"), "a", json!({ "transcript": "x", "stop": "complete" }))).unwrap().is_empty());
        // A replayed event id changes nothing.
        assert!(events.accept(&event(2, "input_audio_buffer.speech_started", "b", json!({}))).unwrap().is_empty());
        assert!(events.pending_ids().is_empty());
    }

    #[test]
    fn only_a_final_carries_the_detected_language_and_only_a_well_formed_one() {
        // `test_completed_events_carry_the_detected_language_only_on_finals`.
        let mut events = Events::new("speaker", "ns".into());
        events.accept(&event(1, "input_audio_buffer.speech_started", "a", json!({}))).unwrap();
        let partial = events.accept(&event(2, &format!("{PREFIX}delta"), "a", json!({ "delta": "Guten", "languages": [{ "code": "de" }] }))).unwrap();
        let done = json!({ "transcript": "Guten Abend.", "stop": "complete", "languages": [{ "code": "de" }, { "code": "en" }] });
        let final_ = events.accept(&event(3, &format!("{PREFIX}completed"), "a", done)).unwrap();
        assert_eq!((partial[0].language.as_str(), final_[0].language.as_str(), final_[0].text.as_str()), ("", "de", "Guten Abend."));
        let malformed = [json!([]), json!([{ "code": "DE; drop" }]), json!("de"), json!([{ "code": 3 }]), Value::Null, json!([{ "code": "zh-Hant-TW" }]), json!([{ "code": "e" }])];
        for (i, languages) in malformed.into_iter().enumerate() {
            let (item, id) = (format!("b{i}"), 10 + 2 * i as u32);
            events.accept(&event(id, "input_audio_buffer.speech_started", &item, json!({}))).unwrap();
            let mut extra = json!({ "transcript": "x", "stop": "complete" });
            if !languages.is_null() {
                extra["languages"] = languages.clone();
            }
            let final_ = events.accept(&event(id + 1, &format!("{PREFIX}completed"), &item, extra)).unwrap();
            assert_eq!(final_[0].language, "", "{languages}");
        }
        events.accept(&event(40, "input_audio_buffer.speech_started", "c", json!({}))).unwrap();
        let region = json!({ "transcript": "x", "stop": "complete", "languages": [{ "code": "pt-BR" }] });
        assert_eq!(events.accept(&event(41, &format!("{PREFIX}completed"), "c", region)).unwrap()[0].language, "pt-BR");
    }

    #[test]
    fn an_incomplete_item_is_discarded_and_bad_events_fail() {
        let mut events = Events::new("speaker", "ns".into());
        events.accept(&event(1, "input_audio_buffer.committed", "a", json!({}))).unwrap();
        let done = events.accept(&event(2, &format!("{PREFIX}completed"), "a", json!({ "transcript": "x", "stop": "length" }))).unwrap();
        assert_eq!(done[0].state, "discarded");
        assert_eq!(events.accept(&json!({ "type": "x" })), Err("invalid_event"));
        assert!(events.closed);
    }

    #[test]
    fn speakers_keep_the_longest_voices_in_order_of_speaking() {
        let rows = json!({ "speakers": [
            { "speaker": "B", "start_ms": 0, "end_ms": 500 },
            { "speaker": "A", "start_ms": 600, "end_ms": 1600 },
            { "speaker": "C", "start_ms": 1700, "end_ms": 1800 },
        ] });
        assert_eq!(speakers(&rows), vec!["B".to_string(), "A".to_string()]);
        assert!(speakers(&json!({ "speakers": [{ "speaker": "bad", "start_ms": 0, "end_ms": 1 }] })).is_empty());
    }
}
