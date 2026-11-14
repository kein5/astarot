//! Immutable values passed between recognition, translation and speech.

use crate::clock::monotonic_ns;

/// Where a message came from. Only `Chat` and `Mic` can be spoken.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Source {
    Chat,
    Mic,
    /// Any other origin (speaker capture, OCR, a remote client). Never spoken.
    Other(String),
}

impl Source {
    pub fn parse(value: &str) -> Self {
        match value {
            "chat" => Source::Chat,
            "mic" => Source::Mic,
            other => Source::Other(other.to_owned()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Source::Chat => "chat",
            Source::Mic => "mic",
            Source::Other(value) => value,
        }
    }
}

/// One message that may be spoken (`SpeechMessageEvent` in Python).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeechMessageEvent {
    pub event_id: String,
    pub source: Source,
    pub original_text: String,
    pub translated_text: Option<String>,
    pub source_language: Option<String>,
    pub target_language: Option<String>,
    pub utterance_id: Option<String>,
    pub revision: i64,
    pub is_final: bool,
    /// When the message was received, on [`monotonic_ns`].
    pub timestamp_ns: i64,
}

impl SpeechMessageEvent {
    /// A final message stamped now, with the remaining fields empty.
    pub fn new(event_id: impl Into<String>, source: Source, original_text: impl Into<String>) -> Self {
        Self {
            event_id: event_id.into(),
            source,
            original_text: original_text.into(),
            translated_text: None,
            source_language: None,
            target_language: None,
            utterance_id: None,
            revision: 0,
            is_final: true,
            timestamp_ns: monotonic_ns(),
        }
    }
}

/// Interleaved signed 16-bit little-endian PCM, never a WAV container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioFrame {
    pcm: Vec<u8>,
    sample_rate: u32,
    channels: u16,
}

impl AudioFrame {
    pub fn new(pcm: Vec<u8>, sample_rate: u32, channels: u16) -> Result<Self, &'static str> {
        if !valid_rate(sample_rate) || !matches!(channels, 1 | 2) {
            return Err("Unsupported PCM format");
        }
        if !pcm.len().is_multiple_of(2 * channels as usize) {
            return Err("Incomplete PCM frame");
        }
        Ok(Self { pcm, sample_rate, channels })
    }

    pub fn mono(pcm: Vec<u8>, sample_rate: u32) -> Result<Self, &'static str> {
        Self::new(pcm, sample_rate, 1)
    }

    pub fn pcm(&self) -> &[u8] {
        &self.pcm
    }

    pub fn into_pcm(self) -> Vec<u8> {
        self.pcm
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }
}

pub(crate) fn valid_rate(rate: u32) -> bool {
    (8000..=192_000).contains(&rate)
}

#[cfg(test)]
mod tests {
    use super::AudioFrame;

    #[test]
    fn frames_are_whole_s16le_samples_at_supported_rates() {
        assert!(AudioFrame::mono(vec![1, 0], 48000).is_ok());
        assert!(AudioFrame::new(vec![0; 4], 8000, 2).is_ok());
        assert!(AudioFrame::mono(vec![1], 48000).is_err());
        assert!(AudioFrame::new(vec![0; 2], 48000, 2).is_err());
        assert!(AudioFrame::mono(vec![], 7999).is_err());
        assert!(AudioFrame::mono(vec![], 192_001).is_err());
        assert!(AudioFrame::new(vec![], 48000, 3).is_err());
    }
}
