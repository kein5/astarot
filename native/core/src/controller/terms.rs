//! The term dictionary in the pipeline (#446). The entries are the speech recognition
//! vocabulary of the realtime settings (`REALTIME_ASR_SETTINGS.vocabulary`: the user's terms and,
//! unless turned off, the built-in VRChat terms); `astarot_transcription::terms` applies them.
//!
//! - Recognition: a realtime session corrects its own captions; the recorder's engines (cloud
//!   Whisper, Deepgram) are corrected here, as their text enters the pipeline.
//! - Speech: Japanese text is read with the terms' readings, just before it is queued.
//! - Translation: the AI translators are told which of the user's own terms the text holds.
//!
//! Nothing here logs a term or a text.

use super::Core;
use astarot_transcription::speechcpp;
use astarot_transcription::terms::Dictionary;
use astarot_tts::SpeechMessageEvent;

const SETTINGS_KEY: &str = "REALTIME_ASR_SETTINGS";
/// The most terms one translation's prompt lists.
const MAX_GLOSSARY: usize = 20;
const JAPANESE: &str = "Japanese";

impl Core {
    /// The saved vocabulary, the user's terms first, then the built-in ones.
    pub(crate) fn term_dictionary(&self) -> Dictionary {
        Dictionary::new(&speechcpp::merged_terms(&self.config().get(SETTINGS_KEY)["vocabulary"]))
    }

    /// Recognised text with the dictionary's written forms (what a realtime session does to
    /// its own captions).
    pub(crate) fn corrected_recognition(&self, text: &str) -> String {
        self.term_dictionary().corrected(text)
    }

    /// The user's own terms that appear in a text to translate. The built-in VRChat terms are
    /// left to the translator; they are mostly ordinary words.
    pub(crate) fn translation_glossary(&self, text: &str) -> Vec<String> {
        let vocabulary = &self.config().get(SETTINGS_KEY)["vocabulary"];
        let own: Vec<String> =
            vocabulary["terms"].as_array().into_iter().flatten().filter_map(|t| t.as_str()).map(str::to_string).collect();
        if own.is_empty() {
            return Vec::new();
        }
        Dictionary::new(&own).occurring(text, MAX_GLOSSARY)
    }
}

/// A speech event's Japanese texts read with the terms' readings ("VRChat" is read
/// "ブイアールチャット"). Text in another language is left as it is: the readings are kana.
pub(crate) fn read_terms(event: &mut SpeechMessageEvent, terms: &Dictionary) {
    if event.source_language.as_deref() == Some(JAPANESE) {
        event.original_text = terms.spoken(&event.original_text);
    }
    if event.target_language.as_deref() == Some(JAPANESE) {
        if let Some(text) = event.translated_text.as_mut() {
            *text = terms.spoken(text);
        }
    }
}
