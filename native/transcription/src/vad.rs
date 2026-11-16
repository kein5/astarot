//! The seam where voice activity detection plugs into the recorder (`MIC_ENABLE_VAD`,
//! `SPEAKER_ENABLE_VAD`).
//!
//! Python cut phrases with Silero VAD when the switch was on (`audio_vad.VadSegmenter`) and with
//! the energy listener otherwise. Which runtime and model run Silero VAD here is not decided yet
//! (decisions 2 and 13 in `docs/voice-stack/core-integration.md`), so [`bundled`] offers no
//! engine and the recorder keeps cutting by energy. A VAD engine implements [`VadEngine`]; the
//! recorder then asks it for a [`Segmenter`] per device format, and the transcriber treats what
//! it cuts as Python's VAD path did ([`crate::phrases::Phrases::segmented`]).

use crate::energy::{EnergyListener, Heard};
use std::fmt;
use std::sync::Arc;

/// Why a segment ended.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Cut {
    /// A natural end: quiet after speech, or the stream flushed (`silence`, `flush`).
    #[default]
    Silence,
    /// Speech went on past the longest segment and was cut without a pause (`max_duration`).
    Limit,
}

/// One cut piece of audio: interleaved samples at the device's format.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Segment {
    pub samples: Vec<i16>,
    pub cut: Cut,
}

/// What a segmenter found in the audio it was given.
#[derive(Debug, Default, PartialEq)]
pub struct Segments {
    /// The rms of each buffer of 1024 frames, in order, for the volume meter.
    pub energies: Vec<u32>,
    pub segments: Vec<Segment>,
}

/// Cuts a device's audio into segments. One lives on the recorder's listener thread.
pub trait Segmenter: Send {
    /// Feeds interleaved samples; returns what is complete so far.
    fn feed(&mut self, samples: &[i16]) -> Segments;
    /// Starts again from nothing (after a pause).
    fn reset(&mut self);
}

impl Segmenter for EnergyListener {
    fn feed(&mut self, samples: &[i16]) -> Segments {
        let Heard { energies, phrases } = EnergyListener::feed(self, samples);
        // The energy path joins phrases by time (`Phrases::drain`), so how one ended is not used.
        Segments { energies, segments: phrases.into_iter().map(|samples| Segment { samples, cut: Cut::Silence }).collect() }
    }

    fn reset(&mut self) {
        EnergyListener::reset(self);
    }
}

/// A voice activity detector the recorder can use in place of the energy listener.
pub trait VadEngine: Send + Sync {
    /// A segmenter for audio of `rate` and `channels`. `max_speech_seconds` is the longest
    /// segment (`*_RECORD_TIMEOUT`, 0 for none); longer speech ends with [`Cut::Limit`].
    fn segmenter(&self, rate: u32, channels: usize, max_speech_seconds: f64) -> Box<dyn Segmenter>;
}

/// A shared VAD engine, as the recorder's settings hold it.
#[derive(Clone)]
pub struct Vad(pub Arc<dyn VadEngine>);

impl fmt::Debug for Vad {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Vad")
    }
}

impl PartialEq for Vad {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

/// The VAD engine this build ships: none until the runtime and the model of Silero VAD are
/// decided (decisions 2 and 13).
pub fn bundled() -> Option<Vad> {
    None
}
