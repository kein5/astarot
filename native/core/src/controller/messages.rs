//! The message pipeline (`Controller._processMessage` and its callers in `controller.py`): a
//! typed message (`/run/send_message_box`) and the text the microphone, the speaker and OCR
//! recognise go through the same steps.
//!
//! word filter (recognised text only) → repeat check → translation → readings → chatbox →
//! overlay → clipboard (microphone only) → the UI → WebSocket → the conversation log →
//! translation history → speech.
//!
//! Every output runs on its own: one that fails is reported (`/run/message_output_error`,
//! `MESSAGE_OUTPUT_FAILED`) and the others still run. Nothing here writes the user's text to the
//! diagnostic log; the conversation log is written only while the user has it on.
//!
//! Other areas use [`Core::deliver_transcription`] (recognition and OCR), and get the
//! messages through the hooks of [`MessageHooks`] (the VR overlay and speech), which do
//! nothing until those areas set them.

use super::routes::{Builder, WAIT};
use super::{ok, Core};
use crate::errors::ErrorReply;
use crate::protocol::Reply;
use serde_json::{json, Map, Value};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

// ------------------------------------------------------------------------- directions

/// What differs between the directions of the pipeline (`MessageDirectionSpec`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spec {
    /// "mic", "speaker", "ocr" or "chat" (history, log lines, failures).
    pub kind: &'static str,
    pub word_filter: bool,
    /// `Some(true)` checks repeats of sent messages, `Some(false)` of received ones.
    pub repeat_of_sent: Option<bool>,
    /// The own languages translate to every enabled target (mic, chat); else the first own
    /// language is the target (speaker, OCR).
    pub multi_target: bool,
    /// Readings of the original when the own language is Japanese (mic, chat); else when the
    /// detected language is.
    pub readings_by_own_language: bool,
    pub vram_code: &'static str,
    pub vram_notification: &'static str,
    /// The switch that must be on for the outputs; `None` for always.
    pub feature: Option<&'static str>,
    /// The switch that sends to the chatbox; `None` never sends (OCR, the other party).
    pub chatbox: Option<&'static str>,
    /// "SEND" or "RECEIVED" (the format parts).
    pub format: &'static str,
    pub overlay_direction: &'static str,
    pub small_log: bool,
    pub clipboard: bool,
    pub websocket_type: &'static str,
    pub log_prefix: &'static str,
    /// The `run_mapping` name the result is pushed on; `None` returns it instead.
    pub push: Option<&'static str>,
    pub payload_source: Option<&'static str>,
    pub render_overlay: bool,
    /// Realtime recognition: delivery outcomes in the result.
    pub realtime: bool,
}

pub const MIC: Spec = Spec {
    kind: "mic",
    word_filter: true,
    repeat_of_sent: Some(true),
    multi_target: true,
    readings_by_own_language: true,
    vram_code: "TRANSLATION_VRAM_MIC",
    vram_notification: "error_translation_mic_vram_overflow",
    feature: Some("ENABLE_TRANSCRIPTION_SEND"),
    chatbox: Some("SEND_MESSAGE_TO_VRC"),
    format: "SEND",
    overlay_direction: "send",
    small_log: false,
    clipboard: true,
    websocket_type: "SENT",
    log_prefix: "[SENT]",
    push: Some("transcription_mic"),
    payload_source: None,
    render_overlay: true,
    realtime: false,
};

pub const SPEAKER: Spec = Spec {
    kind: "speaker",
    word_filter: true,
    repeat_of_sent: Some(false),
    multi_target: false,
    readings_by_own_language: false,
    vram_code: "TRANSLATION_VRAM_SPEAKER",
    vram_notification: "error_translation_speaker_vram_overflow",
    feature: Some("ENABLE_TRANSCRIPTION_RECEIVE"),
    chatbox: Some("SEND_RECEIVED_MESSAGE_TO_VRC"),
    format: "RECEIVED",
    overlay_direction: "receive",
    small_log: true,
    clipboard: false,
    websocket_type: "RECEIVED",
    log_prefix: "[RECEIVED]",
    push: Some("transcription_speaker"),
    payload_source: None,
    render_overlay: true,
    realtime: false,
};

/// Realtime recognition updates its own caption rows; it returns the result.
pub const REALTIME_MIC: Spec = Spec {
    repeat_of_sent: None,
    readings_by_own_language: false,
    feature: None,
    push: None,
    websocket_type: "REALTIME_MIC",
    render_overlay: false,
    realtime: true,
    ..MIC
};

pub const REALTIME_SPEAKER: Spec = Spec {
    repeat_of_sent: None,
    feature: None,
    chatbox: None,
    push: None,
    websocket_type: "REALTIME_SPEAKER",
    render_overlay: false,
    realtime: true,
    ..SPEAKER
};

/// OCR reads the other party: never to the chatbox, only the large log.
pub const OCR: Spec = Spec {
    kind: "ocr",
    repeat_of_sent: None,
    feature: Some("ENABLE_OCR_CAPTURE"),
    chatbox: None,
    small_log: false,
    log_prefix: "[OCR]",
    push: Some("transcription_ocr"),
    payload_source: Some("ocr"),
    ..SPEAKER
};

pub const CHAT: Spec = Spec {
    kind: "chat",
    word_filter: false,
    repeat_of_sent: None,
    vram_code: "TRANSLATION_VRAM_CHAT",
    vram_notification: "error_translation_chat_vram_overflow",
    feature: None,
    clipboard: false,
    websocket_type: "CHAT",
    log_prefix: "[CHAT]",
    push: None,
    ..MIC
};

/// Where recognised text came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Mic,
    Speaker,
    Ocr,
}

/// Text a recognition or OCR produced.
#[derive(Clone, Debug, Default)]
pub struct Recognized {
    pub text: String,
    /// The detected language by name (`Japanese`), if known.
    pub language: Option<String>,
    /// An id to carry to the UI (OCR: `transcription-ocr-<segment>`).
    pub id: Option<String>,
    /// How long the recognition took, for the latency line.
    pub asr_ms: Option<u64>,
}

/// Whether a message may still be published (a stop or a mute after it was admitted).
pub type Guard = Arc<dyn Fn() -> bool + Send + Sync>;

// ------------------------------------------------------------------------- hooks

/// The log of the VR overlay a message goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayLog {
    Small,
    Large,
}

/// A message for the VR overlay (`createOverlayImageSmallLog`, `publishMessageOverlayLargeLog`).
/// The overlay area decides whether it can show it.
#[derive(Clone, Debug)]
pub struct OverlayMessage {
    pub log: OverlayLog,
    pub kind: &'static str,
    /// "send" or "receive".
    pub direction: &'static str,
    /// `None` when only translations are shown.
    pub message: Option<String>,
    pub source_language: Option<String>,
    pub translations: Vec<String>,
    /// The destination languages by slot (`language_payload`).
    pub languages: Value,
    pub transliteration_message: Value,
    pub transliteration_translations: Value,
}

impl OverlayMessage {
    /// What the VR overlay area draws (`createOverlayImage*` reads the enabled destination
    /// languages as a list, in slot order).
    pub(crate) fn for_overlay(&self) -> super::overlay::OverlayMessage {
        let target_languages = self
            .languages
            .as_object()
            .map(|slots| {
                slots
                    .values()
                    .filter(|slot| slot["enable"] == true)
                    .filter_map(|slot| slot["language"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        super::overlay::OverlayMessage {
            received: self.direction == "receive",
            small_log: self.log == OverlayLog::Small,
            message: self.message.clone().unwrap_or_default(),
            source_language: self.source_language.clone(),
            translations: self.translations.clone(),
            target_languages,
            transliteration_message: self.transliteration_message.clone(),
            transliteration_translation: self.transliteration_translations.clone(),
        }
    }
}

/// When a message reaches speech.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpeechStage {
    /// Before translation: the original only ("original" voice mode).
    Original,
    /// After translation, outputs and history ("translated" voice mode).
    Translated,
}

/// A message for speech (TTS and voice conversion; `_publishChatVoice`, `_publishMicVoice`).
#[derive(Clone, Debug)]
pub struct SpokenMessage {
    pub stage: SpeechStage,
    /// "chat" or "mic".
    pub kind: &'static str,
    pub id: Option<String>,
    pub message: String,
    pub translations: Vec<String>,
    pub success: Vec<bool>,
    /// "translated", "unsupported" or "failed" for each translation.
    pub provenance: Vec<&'static str>,
    /// The enabled target slots, in the order of `translations`.
    pub target_slots: Vec<String>,
    pub destinations: Value,
    pub translation_enabled: bool,
    /// The speech generation at admission (stamped by the receiver for typed chat): a stop or a
    /// settings change since then refuses the speech.
    pub voice_generation: Option<u64>,
    /// When the pipeline took the message, on the speech clock.
    pub started_ns: i64,
    pub source_language: Option<String>,
}

/// An output the other areas plug in. `Err` reports a failed output.
pub type Hook<T> = Arc<dyn Fn(&T) -> Result<(), ()> + Send + Sync>;

/// The outbound hooks; unset ones do nothing.
#[derive(Clone, Default)]
pub struct MessageHooks {
    pub overlay: Option<Hook<OverlayMessage>>,
    pub speech: Option<Hook<SpokenMessage>>,
}

// ------------------------------------------------------------------------- state

/// The conversation log (`ConversationLogger`): one file per start under `logs/`, written only
/// while `LOGGER_FEATURE` is on, emptied past 10 MB.
#[derive(Default)]
struct ConversationLog {
    file: Option<(PathBuf, Option<File>)>,
}

const LOG_LIMIT: u64 = 10 * 1024 * 1024;

impl ConversationLog {
    fn start(&mut self, directory: &Path) {
        let name = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S.log").to_string();
        self.file = Some((directory.join(name), None));
    }

    fn stop(&mut self) {
        self.file = None;
    }

    fn write(&mut self, text: &str) -> std::io::Result<bool> {
        let Some((path, file)) = self.file.as_mut() else { return Ok(false) };
        if file.is_none() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            *file = Some(OpenOptions::new().create(true).append(true).open(&*path)?);
        }
        let handle = file.as_mut().expect("opened above");
        let line = format!("{} - log - INFO - {text}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"));
        if handle.metadata().map(|m| m.len()).unwrap_or(0) + line.len() as u64 > LOG_LIMIT {
            *handle = OpenOptions::new().create(true).write(true).truncate(true).open(&*path)?;
        }
        handle.write_all(line.as_bytes())?;
        Ok(true)
    }
}

/// The order messages reach the chatbox in (`model.chatbox_order`): a message admitted earlier
/// is not sent after a later one.
#[derive(Default)]
struct ChatboxOrder {
    admitted: u64,
    sent: u64,
}

/// What the pipeline keeps between messages.
#[derive(Default)]
pub(crate) struct Messages {
    hooks: RwLock<MessageHooks>,
    log: Mutex<ConversationLog>,
    chatbox: Mutex<ChatboxOrder>,
    previous_sent: Mutex<Option<String>>,
    previous_received: Mutex<Option<String>>,
    no_readings_noted: AtomicBool,
}

/// The settings a message keeps from its admission to its last output (`MessageSnapshot`).
#[derive(Clone, Debug)]
pub(crate) struct Snapshot {
    pub tab: String,
    pub source_language: Option<String>,
    pub your: Value,
    pub target: Value,
    pub translation_enabled: bool,
    pub engine: String,
    pub weight: String,
    pub hiragana: bool,
    pub romaji: bool,
    pub send_only_translated: bool,
    pub overlay_only_translated: bool,
    pub format_parts: Value,
    pub multi_target: bool,
    pub history_generation: u64,
}

impl Snapshot {
    fn capture(core: &Core, spec: &Spec, language: Option<&str>) -> Snapshot {
        let _guard = core.language_lock.lock().unwrap();
        let config = core.config();
        let generation = config.history_generation();
        let tab = config.get_str("SELECTED_TAB_NO");
        let your = config.get("SELECTED_YOUR_LANGUAGES")[&tab].clone();
        let target = config.get("SELECTED_TARGET_LANGUAGES")[&tab].clone();
        let source = if spec.multi_target { &your } else { &target };
        let pushed_recognition = matches!(spec.kind, "mic" | "speaker") && spec.push.is_some();
        let source_language = if pushed_recognition {
            // Batch recognition may give text without a detected language.
            language.map(str::to_string)
        } else {
            language.map(str::to_string).or_else(|| source["1"]["language"].as_str().map(str::to_string))
        };
        let format_key =
            if spec.format == "SEND" { "SEND_MESSAGE_FORMAT_PARTS" } else { "RECEIVED_MESSAGE_FORMAT_PARTS" };
        Snapshot {
            source_language,
            engine: config.get("SELECTED_TRANSLATION_ENGINES")[&tab].as_str().unwrap_or("").to_string(),
            tab,
            your,
            target,
            translation_enabled: config.get_bool("ENABLE_TRANSLATION"),
            weight: config.get_str("CTRANSLATE2_WEIGHT_TYPE"),
            hiragana: config.get_bool("CONVERT_MESSAGE_TO_HIRAGANA"),
            romaji: config.get_bool("CONVERT_MESSAGE_TO_ROMAJI"),
            send_only_translated: config.get_bool("SEND_ONLY_TRANSLATED_MESSAGES"),
            overlay_only_translated: config.get_bool("OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES"),
            format_parts: config.get(format_key),
            multi_target: spec.multi_target,
            history_generation: generation,
        }
    }

    fn destinations(&self) -> &Value {
        if self.multi_target {
            &self.target
        } else {
            &self.your
        }
    }

    /// The enabled destination slots, in order.
    fn target_slots(&self) -> Vec<String> {
        self.destinations()
            .as_object()
            .map(|o| o.iter().filter(|(_, t)| t["enable"] == true).map(|(slot, _)| slot.clone()).collect())
            .unwrap_or_default()
    }
}

/// `messageFormatter`: the original and the translations joined as the format parts say.
pub fn format_message(parts: &Value, translations: &[String], message: &str) -> String {
    let text = |v: &Value| v.as_str().unwrap_or("").to_string();
    let message_part = format!("{}{message}{}", text(&parts["message"]["prefix"]), text(&parts["message"]["suffix"]));
    let translation_part = format!(
        "{}{}{}",
        text(&parts["translation"]["prefix"]),
        translations.join(&text(&parts["translation"]["separator"])),
        text(&parts["translation"]["suffix"])
    );
    if !translations.is_empty() && !message.is_empty() {
        if parts["translation_first"] == true {
            format!("{translation_part}{}{message_part}", text(&parts["separator"]))
        } else {
            format!("{message_part}{}{translation_part}", text(&parts["separator"]))
        }
    } else if !translations.is_empty() {
        translation_part
    } else {
        message_part
    }
}

/// A word of the filter appears in the text (`KeywordProcessor.extract_keywords`): case is
/// ignored, and a word made of letters, digits or `_` must not be part of a longer such word.
pub fn word_filtered(words: &Value, text: &str) -> bool {
    let word_char = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let haystack: Vec<char> = text.to_lowercase().chars().collect();
    for word in words.as_array().into_iter().flatten().filter_map(Value::as_str) {
        let needle: Vec<char> = word.to_lowercase().chars().collect();
        if needle.is_empty() || needle.len() > haystack.len() {
            continue;
        }
        for start in 0..=haystack.len() - needle.len() {
            if haystack[start..start + needle.len()] != needle[..] {
                continue;
            }
            let before = start.checked_sub(1).map(|i| haystack[i]);
            let after = haystack.get(start + needle.len()).copied();
            let starts_word = needle.first().is_some_and(|c| word_char(*c));
            let ends_word = needle.last().is_some_and(|c| word_char(*c));
            let left = !(starts_word && before.is_some_and(word_char));
            let right = !(ends_word && after.is_some_and(word_char));
            if left && right {
                return true;
            }
        }
    }
    false
}

fn language_payload(languages: &Value) -> Value {
    languages.clone()
}

// ------------------------------------------------------------------------- the pipeline

impl Core {
    fn messages(&self) -> &Messages {
        &self.messages
    }

    /// Sets the hooks of the VR overlay and of speech (each area sets its own; `None` keeps
    /// what is set).
    pub fn set_message_hooks(&self, overlay: Option<Hook<OverlayMessage>>, speech: Option<Hook<SpokenMessage>>) {
        let mut hooks = self.messages().hooks.write().unwrap();
        if overlay.is_some() {
            hooks.overlay = overlay;
        }
        if speech.is_some() {
            hooks.speech = speech;
        }
    }

    /// Recognised text from the microphone, the speaker or OCR (`micMessage`,
    /// `speakerMessage`, `ocrMessage` once the text is known): the outputs are pushed to the
    /// UI. `guard` may stop the publication after admission (a stop, a newer generation).
    /// Returns whether the message was still current at the end (OCR's answer).
    pub fn deliver_transcription(
        self: &Arc<Self>,
        source: Source,
        recognized: Recognized,
        guard: Option<Guard>,
    ) -> bool {
        let spec = match source {
            Source::Mic => MIC,
            Source::Speaker => SPEAKER,
            Source::Ocr => OCR,
        };
        if recognized.text.is_empty() {
            return false;
        }
        if source == Source::Ocr && !self.config().get_bool("ENABLE_OCR_CAPTURE") {
            return false;
        }
        let language = recognized.language.as_deref().filter(|l| !l.is_empty());
        self.process_message(
            &spec,
            &recognized.text,
            language,
            recognized.id.clone(),
            recognized.asr_ms,
            guard.clone(),
        );
        guard.is_none_or(|g| g()) && !self.shutdown_requested()
    }

    /// The pipeline for any [`Spec`] (`_processMessage`). Returns the result of a returning
    /// direction (chat, realtime); a pushing one answers `None`.
    pub fn process_message(
        self: &Arc<Self>,
        spec: &Spec,
        message: &str,
        language: Option<&str>,
        id: Option<String>,
        asr_ms: Option<u64>,
        guard: Option<Guard>,
    ) -> Option<Value> {
        self.process_message_stamped(spec, message, language, id, asr_ms, guard, None)
    }

    /// [`Core::process_message`] with the speech generation the receiver stamped.
    #[allow(clippy::too_many_arguments)]
    fn process_message_stamped(
        self: &Arc<Self>,
        spec: &Spec,
        message: &str,
        language: Option<&str>,
        id: Option<String>,
        asr_ms: Option<u64>,
        guard: Option<Guard>,
        voice_generation: Option<u64>,
    ) -> Option<Value> {
        let mic = spec.kind == "mic";
        // A message refused at admission stays refused after unmute.
        if mic && self.mic_held_back() {
            return None;
        }
        let current = {
            let core = Arc::clone(self);
            move || !core.shutdown_requested() && guard.as_ref().is_none_or(|g| g()) && !(mic && core.mic_held_back())
        };
        if !current() {
            return None;
        }
        let config = self.config();
        let feature_enabled = spec.feature.is_none_or(|key| config.get_bool(key));
        let snapshot = Snapshot::capture(self, spec, language);
        let voice_generation = voice_generation.or_else(|| self.voice_generation());
        let sequence = spec.chatbox.map(|_| {
            let mut order = self.messages().chatbox.lock().unwrap();
            order.admitted += 1;
            order.admitted
        });
        let mut failures: Vec<Value> = Vec::new();

        if spec.word_filter && word_filtered(&config.get("MIC_WORD_FILTER"), message) {
            if current() {
                self.notify("word_filter", json!({ "message": format!("Detected by word filter: {message}") }));
            }
            return None;
        }
        if let Some(sent) = spec.repeat_of_sent {
            let previous = if sent { &self.messages().previous_sent } else { &self.messages().previous_received };
            let mut previous = previous.lock().unwrap();
            let repeated = previous.as_deref() == Some(message);
            *previous = Some(message.to_string());
            if repeated {
                return None;
            }
        }

        let started = Instant::now();
        let started_ns = vrct_tts::clock::monotonic_ns();
        let trace = self.io_trace_begin(spec.kind, message, id.as_deref(), started_ns, asr_ms);
        let voice = (voice_generation, started_ns);
        let slots = snapshot.target_slots();
        let speaks = matches!(spec.kind, "chat" | "mic");
        if speaks {
            self.speak(SpeechStage::Original, spec, &snapshot, id.as_ref(), message, &[], voice, &current, &mut failures);
        }

        // Translation
        let mut translations: Vec<String> = Vec::new();
        let mut outcomes: Vec<super::translation::Translated> = Vec::new();
        let mut translate_ms = 0;
        if snapshot.translation_enabled {
            let translate_started = Instant::now();
            let result = self.translate_message(spec, &snapshot, message);
            translate_ms = translate_started.elapsed().as_millis();
            if !current() {
                return None;
            }
            match result {
                Ok(done) => {
                    outcomes = done;
                    translations = outcomes.iter().map(|o| o.text.clone()).collect();
                    if outcomes.iter().any(|o| !o.success) {
                        self.fall_back_to_local(&snapshot);
                        self.notify_error(
                            super::run_endpoint("error_translation_engine"),
                            ErrorReply::new("TRANSLATION_ENGINE_LIMIT", Value::Null),
                        );
                    }
                }
                Err(vram) => {
                    self.step("Translation: the GPU ran out of memory; translation was turned off");
                    self.notify_error(
                        super::run_endpoint(spec.vram_notification),
                        ErrorReply::new(spec.vram_code, json!(vram)),
                    );
                    let _ = config.set("ENABLE_TRANSLATION", json!(false));
                    self.notify_error(
                        super::run_endpoint("enable_translation"),
                        ErrorReply::new("TRANSLATION_DISABLED_VRAM", json!(false)),
                    );
                    if spec.push.is_some() {
                        return None;
                    }
                    let mut result = Map::new();
                    if spec.realtime {
                        result.insert("delivery_outcome".into(), json!("failed"));
                        result.insert("delivery_reason".into(), json!("processing_failed"));
                    }
                    result.insert("id".into(), id.map_or(Value::Null, Value::String));
                    result.insert("original".into(), json!({ "message": message, "transliteration": [] }));
                    let empty: Vec<Value> =
                        slots.iter().map(|_| json!({ "message": "", "transliteration": [] })).collect();
                    result.insert("translations".into(), Value::Array(empty));
                    return Some(Value::Object(result));
                }
            }
        }
        if !current() {
            return None;
        }

        // Readings
        let mut readings_message = Value::Array(Vec::new());
        let mut readings_translations: Vec<Value> = Vec::new();
        let readings = snapshot.hiragana || snapshot.romaji;
        if readings {
            let own = if spec.readings_by_own_language {
                snapshot.your["1"]["language"].as_str().map(str::to_string)
            } else {
                snapshot.source_language.clone()
            };
            if own.as_deref() == Some("Japanese") {
                readings_message = self.readings(message, &snapshot);
            }
        }
        for (slot, text) in slots.iter().zip(&translations) {
            if readings && snapshot.destinations()[slot]["language"] == "Japanese" {
                readings_translations.push(self.readings(text, &snapshot));
            } else {
                readings_translations.push(Value::Array(Vec::new()));
            }
        }
        if !current() {
            return None;
        }

        let mut payload = Map::new();
        if let Some(id) = &id {
            payload.insert("id".into(), json!(id));
        }
        payload.insert("original".into(), json!({ "message": message, "transliteration": readings_message }));
        let translated: Vec<Value> = translations
            .iter()
            .zip(&readings_translations)
            .map(|(text, readings)| json!({ "message": text, "transliteration": readings }))
            .collect();
        payload.insert("translations".into(), Value::Array(translated));
        if let Some(source) = spec.payload_source {
            payload.insert("source".into(), json!(source));
        }

        if feature_enabled {
            // The chatbox
            if let (Some(gate), Some(sequence)) = (spec.chatbox, sequence) {
                if !config.get_bool(gate) {
                    Self::io_trace_chatbox(trace.as_ref(), None);
                    if spec.format == "SEND" {
                        payload.insert("delivery_reason".into(), json!("vrchat_off"));
                    }
                } else if current() {
                    let original =
                        if snapshot.send_only_translated && snapshot.translation_enabled { "" } else { message };
                    let text = format_message(&snapshot.format_parts, &translations, original);
                    let chatbox_current = || current() && self.config().get_bool(gate);
                    let sent = {
                        let mut order = self.messages().chatbox.lock().unwrap();
                        if sequence < order.sent {
                            Ok(false)
                        } else {
                            let sent = self.chatbox_send(&text, &chatbox_current);
                            if sent.is_ok() {
                                order.sent = sequence;
                            }
                            sent
                        }
                    };
                    if let Ok(sent) = &sent {
                        Self::io_trace_chatbox(trace.as_ref(), Some(*sent));
                    }
                    match sent {
                        Ok(true) => {}
                        Ok(false) => {
                            if spec.realtime && spec.kind == "mic" {
                                payload.insert("delivery_outcome".into(), json!("not_delivered"));
                                payload.insert("delivery_reason".into(), json!("superseded"));
                            }
                        }
                        Err(_) => self.output_failed("osc", spec, id.as_ref(), &current, &mut failures),
                    }
                }
            }

            // The VR overlay
            // The VR overlay area shows it unless a hook replaces it.
            let overlay_hook = self.messages().hooks.read().unwrap().overlay.clone();
            let overlay_hook: Hook<OverlayMessage> = overlay_hook.unwrap_or_else(|| {
                let core = Arc::downgrade(self);
                let current = current.clone();
                Arc::new(move |event: &OverlayMessage| {
                    if let Some(core) = core.upgrade() {
                        core.show_overlay_log(event.log == OverlayLog::Small, &event.for_overlay(), &|| current());
                    }
                    Ok(())
                })
            });
            if let Some(hook) = Some(overlay_hook).filter(|_| spec.render_overlay) {
                let skip = snapshot.overlay_only_translated && translations.is_empty();
                for (log, on) in [
                    (OverlayLog::Small, spec.small_log && config.get_bool("OVERLAY_SMALL_LOG")),
                    (OverlayLog::Large, config.get_bool("OVERLAY_LARGE_LOG")),
                ] {
                    if !on || skip || !current() {
                        continue;
                    }
                    let event = OverlayMessage {
                        log,
                        kind: spec.kind,
                        direction: spec.overlay_direction,
                        message: (!snapshot.overlay_only_translated).then(|| message.to_string()),
                        source_language: if snapshot.overlay_only_translated {
                            None
                        } else {
                            snapshot.source_language.clone()
                        },
                        translations: translations.clone(),
                        languages: language_payload(snapshot.destinations()),
                        transliteration_message: readings_message.clone(),
                        transliteration_translations: Value::Array(readings_translations.clone()),
                    };
                    if hook(&event).is_err() {
                        let output = if log == OverlayLog::Small { "overlay_small" } else { "overlay_large" };
                        self.output_failed(output, spec, id.as_ref(), &current, &mut failures);
                    }
                }
            }

            // The clipboard (the microphone only)
            if spec.clipboard && config.get_bool("ENABLE_CLIPBOARD") && current() {
                let text = format_message(&snapshot.format_parts, &translations, message);
                if current() && self.config().get_bool("ENABLE_CLIPBOARD") {
                    (self.services().clipboard)(&text);
                }
            }

            // The UI
            if let Some(name) = spec.push.filter(|_| current()) {
                self.notify(name, Value::Object(payload.clone()));
            }

            // WebSocket (and the OBS page, which reads it)
            if current() {
                let sources = if spec.multi_target { &snapshot.your } else { &snapshot.target };
                let event = json!({
                    "type": spec.websocket_type,
                    "src_languages": language_payload(sources),
                    "dst_languages": language_payload(snapshot.destinations()),
                    "message": message,
                    "translation": translations,
                    "transliteration": readings_translations,
                });
                if let Some(Err(_)) = self.websocket_send(&event.to_string()) {
                    self.output_failed("websocket", spec, id.as_ref(), &current, &mut failures);
                }
            }

            // The conversation log
            if config.get_bool("LOGGER_FEATURE") && current() {
                let joined =
                    if translations.is_empty() { String::new() } else { format!(" ({})", translations.join("/")) };
                let line = format!("{} {message}{joined}", spec.log_prefix);
                if self.messages().log.lock().unwrap().write(&line).is_err() {
                    self.output_failed("logger", spec, id.as_ref(), &current, &mut failures);
                }
            }
        }

        if !current() {
            return None;
        }
        self.add_history(spec.kind, message, &snapshot);

        if speaks {
            let outcome: Vec<_> = outcomes.clone();
            self.speak_translated(spec, &snapshot, id.as_ref(), message, &outcome, voice, &current, &mut failures);
        }
        if !failures.is_empty() {
            payload.insert("output_failures".into(), Value::Array(failures));
        }
        let total = started.elapsed().as_millis();
        let translated = snapshot.translation_enabled.then_some(translations.as_slice());
        let failed: Vec<Value> = payload.get("output_failures").and_then(Value::as_array).cloned().unwrap_or_default();
        self.io_trace_publish(trace, translated, translate_ms, total.saturating_sub(translate_ms), &failed);
        let asr = asr_ms.map(|ms| format!("asr={ms}ms ")).unwrap_or_default();
        self.step(&format!(
            "[latency][{}] {asr}translate={translate_ms}ms output={}ms total={}ms",
            spec.kind,
            total.saturating_sub(translate_ms),
            total + u128::from(asr_ms.unwrap_or(0))
        ));
        if spec.push.is_none() {
            return Some(Value::Object(payload));
        }
        None
    }

    /// The translations of a message to every destination (`getInputTranslate`,
    /// `getOutputTranslate`), in slot order; several targets at the same time.
    fn translate_message(
        &self,
        spec: &Spec,
        snapshot: &Snapshot,
        message: &str,
    ) -> Result<Vec<super::translation::Translated>, String> {
        let targets: Vec<(String, String)> = if spec.multi_target {
            snapshot
                .target
                .as_object()
                .into_iter()
                .flat_map(|o| o.values())
                .filter(|t| t["enable"] == true)
                .map(|t| {
                    (t["language"].as_str().unwrap_or("").to_string(), t["country"].as_str().unwrap_or("").to_string())
                })
                .collect()
        } else {
            let own = &snapshot.your["1"];
            vec![(
                own["language"].as_str().unwrap_or("").to_string(),
                own["country"].as_str().unwrap_or("").to_string(),
            )]
        };
        let one = |(language, country): &(String, String)| {
            self.translate(
                &snapshot.engine,
                &snapshot.weight,
                snapshot.source_language.as_deref(),
                language,
                country,
                message,
                snapshot.history_generation,
            )
        };
        if targets.len() <= 1 {
            return targets.iter().map(one).collect();
        }
        std::thread::scope(|scope| {
            let handles: Vec<_> = targets.iter().map(|target| scope.spawn(move || one(target))).collect();
            handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("translation failed".into()))).collect()
        })
    }

    /// The readings of a text (`convertMessageToTransliteration`). Until a dictionary is
    /// chosen there are none: the message goes out without them.
    fn readings(&self, text: &str, snapshot: &Snapshot) -> Value {
        let tokenizer = self.services().transliteration.clone();
        match vrct_translation::transliteration::convert(tokenizer.as_ref(), text, snapshot.hiragana, snapshot.romaji) {
            Ok(readings) => Value::Array(readings),
            Err(_) => {
                if !self.messages().no_readings_noted.swap(true, Ordering::SeqCst) {
                    self.step("Transliteration: no dictionary; messages go out without readings");
                }
                Value::Array(Vec::new())
            }
        }
    }

    fn output_failed(
        &self,
        output: &str,
        spec: &Spec,
        id: Option<&String>,
        current: &dyn Fn() -> bool,
        failures: &mut Vec<Value>,
    ) {
        let failure = json!({ "output": output, "error_code": "MESSAGE_OUTPUT_FAILED" });
        failures.push(failure);
        self.step(&format!("Message output failed: {output}"));
        if current() {
            let data =
                json!({ "id": id, "source": spec.kind, "output": output, "error_code": "MESSAGE_OUTPUT_FAILED" });
            self.notify_error(
                super::run_endpoint("message_output_error"),
                ErrorReply::new("MESSAGE_OUTPUT_FAILED", data),
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn speak(
        &self,
        stage: SpeechStage,
        spec: &Spec,
        snapshot: &Snapshot,
        id: Option<&String>,
        message: &str,
        outcomes: &[super::translation::Translated],
        (voice_generation, started_ns): (Option<u64>, i64),
        current: &dyn Fn() -> bool,
        failures: &mut Vec<Value>,
    ) {
        let Some(hook) = self.messages().hooks.read().unwrap().speech.clone() else { return };
        if !current() {
            return;
        }
        let event = SpokenMessage {
            stage,
            kind: spec.kind,
            id: id.cloned(),
            message: message.to_string(),
            translations: outcomes.iter().map(|o| o.text.clone()).collect(),
            success: outcomes.iter().map(|o| o.success).collect(),
            provenance: outcomes.iter().map(|o| o.provenance).collect(),
            target_slots: snapshot.target_slots(),
            destinations: snapshot.destinations().clone(),
            translation_enabled: snapshot.translation_enabled,
            voice_generation,
            started_ns,
            source_language: snapshot.source_language.clone(),
        };
        if hook(&event).is_err() {
            self.output_failed("tts", spec, id, current, failures);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn speak_translated(
        &self,
        spec: &Spec,
        snapshot: &Snapshot,
        id: Option<&String>,
        message: &str,
        outcomes: &[super::translation::Translated],
        voice: (Option<u64>, i64),
        current: &dyn Fn() -> bool,
        failures: &mut Vec<Value>,
    ) {
        self.speak(SpeechStage::Translated, spec, snapshot, id, message, outcomes, voice, current, failures);
    }

    /// `chatMessage`.
    fn send_message_box(self: &Arc<Self>, data: &Value) -> Reply {
        // Python read both keys at once and let a missing one raise: 500.
        let (Some(id), Some(message)) = (data.get("id"), data.get("message")) else {
            return Reply::status(500, "Internal error");
        };
        let Some(text) = message.as_str() else { return Reply::status(500, "Internal error") };
        if self.shutdown_requested() {
            return ok(Value::Null);
        }
        let id_text = id.as_str().map(str::to_string).unwrap_or_else(|| id.to_string());
        if text.is_empty() {
            return ok(json!({ "id": id, "original": { "message": "", "transliteration": [] }, "translations": [] }));
        }
        // The receiver's stamp: a stop while this waited in the queue refuses its speech.
        let stamped = data.get("_voice_generation").and_then(Value::as_u64);
        match self.process_message_stamped(&CHAT, text, None, Some(id_text), None, None, stamped) {
            Some(mut result) => {
                // The id goes back as the UI sent it.
                result["id"] = id.clone();
                ok(result)
            }
            None => ok(Value::Null),
        }
    }

    // ------------------------------------------------------------ the conversation log

    /// Opens a new conversation log when the feature is on (`init`'s "Init Logger").
    pub(crate) fn start_conversation_log(&self) {
        if self.config().get_bool("LOGGER_FEATURE") {
            let directory = self.config().environment().state_dir.join("logs");
            self.messages().log.lock().unwrap().start(&directory);
        }
    }

    pub(crate) fn stop_conversation_log(&self) {
        self.messages().log.lock().unwrap().stop();
    }

    fn set_logger(&self, on: bool) -> Reply {
        let config = self.config();
        if config.get_bool("LOGGER_FEATURE") != on {
            if on {
                let directory = config.environment().state_dir.join("logs");
                self.messages().log.lock().unwrap().start(&directory);
            } else {
                self.stop_conversation_log();
            }
            let _ = config.set("LOGGER_FEATURE", json!(on));
        }
        ok(config.get("LOGGER_FEATURE"))
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/run/send_message_box", WAIT, |core, data| core.send_message_box(data));
    b.get("/get/data/logger_feature", super::routes::OPEN, "LOGGER_FEATURE");
    b.with("/set/enable/logger_feature", super::routes::OPEN, |core, _| core.set_logger(true));
    b.with("/set/disable/logger_feature", super::routes::OPEN, |core, _| core.set_logger(false));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(first: bool) -> Value {
        json!({
            "message": { "prefix": "", "suffix": "" },
            "separator": "\n",
            "translation": { "prefix": "(", "separator": " / ", "suffix": ")" },
            "translation_first": first,
        })
    }

    #[test]
    fn messages_are_formatted_as_python_formats_them() {
        let translations = vec!["Hello".to_string(), "Hallo".to_string()];
        assert_eq!(format_message(&parts(false), &translations, "こんにちは"), "こんにちは\n(Hello / Hallo)");
        assert_eq!(format_message(&parts(true), &translations, "こんにちは"), "(Hello / Hallo)\nこんにちは");
        assert_eq!(format_message(&parts(false), &translations, ""), "(Hello / Hallo)");
        assert_eq!(format_message(&parts(false), &[], "こんにちは"), "こんにちは");
    }

    #[test]
    fn the_word_filter_matches_whole_words_and_any_japanese() {
        let words = json!(["bad", "ばか"]);
        assert!(word_filtered(&words, "That is BAD."));
        assert!(!word_filtered(&words, "a badge"));
        assert!(word_filtered(&words, "おまえはばかだ"));
        assert!(!word_filtered(&json!([]), "anything"));
        assert!(word_filtered(&json!(["a b"]), "x a b y"));
    }

    #[test]
    fn the_specs_differ_where_python_said() {
        assert_eq!((CHAT.word_filter, CHAT.clipboard, CHAT.websocket_type), (false, false, "CHAT"));
        assert_eq!((OCR.chatbox, OCR.small_log, OCR.payload_source), (None, false, Some("ocr")));
        assert_eq!((REALTIME_SPEAKER.chatbox, REALTIME_MIC.chatbox), (None, Some("SEND_MESSAGE_TO_VRC")));
        let readings = [SPEAKER, MIC, REALTIME_MIC].map(|spec| spec.readings_by_own_language);
        assert_eq!(readings, [false, true, false]);
    }
}
