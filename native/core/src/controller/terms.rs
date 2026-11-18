//! The term dictionary in the pipeline (#446). The entries are the speech recognition
//! vocabulary of the realtime settings (`REALTIME_ASR_SETTINGS.vocabulary`: the user's terms and,
//! unless turned off, the built-in VRChat terms); `vrct_transcription::terms` applies them.
//!
//! - Recognition: a realtime session corrects its own captions; the recorder's engines (cloud
//!   Whisper, Deepgram) are corrected here, as their text enters the pipeline.
//!
//! Nothing here logs a term or a text.

use super::Core;
use vrct_transcription::speechcpp;
use vrct_transcription::terms::Dictionary;

const SETTINGS_KEY: &str = "REALTIME_ASR_SETTINGS";

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
