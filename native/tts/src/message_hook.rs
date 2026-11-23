//! Turn existing pipeline values into speech events without changing them.

use crate::events::{Source, SpeechMessageEvent};
use crate::settings::is_blank;

/// One translation slot (`"1"`, `"2"`, `"3"`) as the pipeline configures it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationTarget {
    pub slot: String,
    pub enable: bool,
    pub language: Option<String>,
}

fn target<'a>(targets: &'a [TranslationTarget], slot: &str) -> Option<&'a TranslationTarget> {
    targets.iter().find(|target| target.slot == slot)
}

fn usable(text: Option<&Option<String>>) -> Option<&String> {
    text.and_then(Option::as_ref).filter(|text| !is_blank(text))
}

/// A chat message's speech event. The translation is used only when the
/// selected slot is enabled, translated successfully and was really translated
/// (not passed through).
///
/// `translations`, `success` and `provenance` follow `target_slots`.
#[allow(clippy::too_many_arguments)]
pub fn chat_event(
    message: &str,
    translations: &[Option<String>],
    success: &[bool],
    provenance: &[String],
    event_id: Option<&str>,
    started_ns: i64,
    source_language: Option<&str>,
    targets: &[TranslationTarget],
    target_slots: &[String],
    selected_slot: &str,
) -> SpeechMessageEvent {
    let mut translated_text = None;
    let mut target_language = None;
    if let Some(index) = target_slots.iter().position(|slot| slot == selected_slot) {
        if let Some(target) = target(targets, selected_slot) {
            if target.enable && success.get(index) == Some(&true) && provenance.get(index).map(String::as_str) == Some("translated") {
                if let Some(text) = usable(translations.get(index)) {
                    translated_text = Some(text.clone());
                    target_language = target.language.clone();
                }
            }
        }
    }
    SpeechMessageEvent {
        translated_text,
        source_language: source_language.map(Into::into),
        target_language,
        timestamp_ns: started_ns,
        ..SpeechMessageEvent::new(event_id.map(Into::into).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()), Source::Chat, message)
    }
}

/// A recognized microphone update, as the speech path needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptUpdate {
    pub source: String,
    pub is_final: bool,
    pub state: String,
    pub namespace: String,
    pub item_id: String,
    pub text: String,
    pub revision: i64,
    pub received_ns: i64,
}

/// The original of a trusted microphone final.
pub fn microphone_original_event(update: &TranscriptUpdate, source_language: Option<&str>) -> Option<SpeechMessageEvent> {
    if update.source != "mic" || !update.is_final || update.state != "final" {
        return None;
    }
    let identity = format!("{}:{}", update.namespace, update.item_id);
    Some(SpeechMessageEvent {
        event_id: identity.clone(),
        source: Source::Mic,
        original_text: update.text.clone(),
        translated_text: None,
        source_language: source_language.map(Into::into),
        target_language: None,
        utterance_id: Some(identity),
        revision: update.revision,
        is_final: true,
        timestamp_ns: update.received_ns,
    })
}

/// A trusted microphone final with a successful translation of the selected slot.
/// `translations` and `success` follow the enabled targets, in order.
pub fn microphone_event(
    update: &TranscriptUpdate,
    translations: &[Option<String>],
    success: &[bool],
    source_language: Option<&str>,
    targets: &[TranslationTarget],
    selected_slot: &str,
) -> Option<SpeechMessageEvent> {
    let mut event = microphone_original_event(update, source_language)?;
    let enabled: Vec<&TranslationTarget> = targets.iter().filter(|target| target.enable).collect();
    let index = enabled.iter().position(|target| target.slot == selected_slot)?;
    if success.get(index) != Some(&true) {
        return None;
    }
    let text = usable(translations.get(index))?;
    event.translated_text = Some(text.clone());
    event.target_language = enabled[index].language.clone();
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets() -> Vec<TranslationTarget> {
        vec![
            TranslationTarget { slot: "1".into(), enable: true, language: Some("English".into()) },
            TranslationTarget { slot: "2".into(), enable: false, language: Some("Korean".into()) },
            TranslationTarget { slot: "3".into(), enable: true, language: Some("French".into()) },
        ]
    }

    fn slots() -> Vec<String> {
        vec!["1".into(), "3".into()]
    }

    #[test]
    fn chat_uses_only_a_real_selected_translation() {
        let translations = [Some("hello".to_string()), Some("bonjour".to_string())];
        let event = chat_event("こんにちは", &translations, &[true, true], &["translated".into(), "translated".into()], Some("7"), 5, Some("Japanese"), &targets(), &slots(), "3");
        assert_eq!((event.event_id.as_str(), event.translated_text.as_deref(), event.target_language.as_deref()), ("7", Some("bonjour"), Some("French")));
        assert_eq!((event.source, event.timestamp_ns, event.source_language.as_deref()), (Source::Chat, 5, Some("Japanese")));
        for (success, provenance, slot) in [([true, false], "translated", "3"), ([true, true], "original", "3"), ([true, true], "translated", "2")] {
            let event = chat_event("x", &translations, &success, &[provenance.into(), provenance.into()], None, 1, None, &targets(), &slots(), slot);
            assert_eq!(event.translated_text, None);
            assert_eq!(event.event_id.len(), 36, "a missing id is a new UUID");
        }
        let blank = chat_event("x", &[Some(" ".into()), None], &[true, true], &["translated".into(), "translated".into()], None, 1, None, &targets(), &slots(), "3");
        assert_eq!(blank.translated_text, None);
    }

    fn update() -> TranscriptUpdate {
        TranscriptUpdate {
            source: "mic".into(), is_final: true, state: "final".into(), namespace: "session".into(), item_id: "item".into(), text: "こんにちは".into(), revision: 3, received_ns: 42
        }
    }

    #[test]
    fn microphone_finals_with_a_successful_selected_translation_only() {
        let translations = [Some("hello".to_string()), Some("bonjour".to_string())];
        let event = microphone_event(&update(), &translations, &[true, true], Some("ja"), &targets(), "3").unwrap();
        assert_eq!(event.event_id, "session:item");
        assert_eq!(event.utterance_id.as_deref(), Some("session:item"));
        assert_eq!((event.translated_text.as_deref(), event.target_language.as_deref(), event.revision, event.timestamp_ns), (Some("bonjour"), Some("French"), 3, 42));
        assert!(microphone_event(&update(), &translations, &[true, false], None, &targets(), "3").is_none());
        assert!(microphone_event(&update(), &translations, &[true, true], None, &targets(), "2").is_none());
        assert!(microphone_event(&update(), &[Some("".into())], &[true], None, &targets(), "1").is_none());
        for change in [|u: &mut TranscriptUpdate| u.is_final = false, |u: &mut TranscriptUpdate| u.state = "partial".into(), |u: &mut TranscriptUpdate| u.source = "speaker".into()] {
            let mut rejected = update();
            change(&mut rejected);
            assert!(microphone_event(&rejected, &translations, &[true, true], None, &targets(), "1").is_none());
        }
    }
}
