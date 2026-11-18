//! The term dictionary in the pipeline (#446). The entries are the speech recognition
//! vocabulary of the realtime settings (`REALTIME_ASR_SETTINGS.vocabulary`: the user's terms and,
//! unless turned off, the built-in VRChat terms); `vrct_transcription::terms` applies them.
//!
//! - Recognition: a realtime session corrects its own captions; the recorder's engines (cloud
//!   Whisper, Deepgram) are corrected here, as their text enters the pipeline.
//! - Speech: Japanese text is read with the terms' readings, just before it is queued.
//!
//! Nothing here logs a term or a text.

use super::Core;
use vrct_transcription::speechcpp;
use vrct_transcription::terms::Dictionary;
use vrct_tts::SpeechMessageEvent;

const SETTINGS_KEY: &str = "REALTIME_ASR_SETTINGS";
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
