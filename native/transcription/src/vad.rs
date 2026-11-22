//! The seam where voice activity detection plugs into the recorder (`MIC_ENABLE_VAD`,
//! `SPEAKER_ENABLE_VAD`).
//!
//! Python cut phrases with Silero VAD when the switch was on (`audio_vad.VadSegmenter`) and with
//! the energy listener otherwise. Here Silero VAD runs in speech.cpp, as its GGUF model
//! (decision 13 in `docs/voice-stack/core-integration.md`): [`crate::server_vad`] is the engine.
//! A VAD engine implements [`VadEngine`]; the recorder then asks it for a [`Segmenter`] per
//! device format, handing it the energy listener it would have used, and the transcriber treats
//! what it cuts as Python's VAD path did ([`crate::phrases::Phrases::segmented`]).

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

impl Cut {
    /// Python's name of the reason (`SegmentEndReason`).
    pub fn reason(self) -> &'static str {
        match self {
            Cut::Silence => "silence",
            Cut::Limit => "max_duration",
        }
    }
}

/// One cut piece of audio: interleaved samples at the device's format.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Segment {
    pub samples: Vec<i16>,
    pub cut: Cut,
}

/// What a VAD noticed of the speech, for the diagnostics ([`crate::diagnostics`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Noted {
    /// Speech started.
    Start,
    /// A segment ended: how long it is, and how long after the end of speech the VAD knew it
    /// (the silence it waited for; nothing for a cut at the limit).
    End { cut: Cut, length: std::time::Duration, waited: std::time::Duration },
}

/// What a segmenter found in the audio it was given.
#[derive(Debug, Default, PartialEq)]
pub struct Segments {
    /// The rms of each buffer of 1024 frames, in order, for the volume meter.
    pub energies: Vec<u32>,
    pub segments: Vec<Segment>,
    /// What a VAD noticed; the energy listener notices nothing.
    pub noted: Vec<Noted>,
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
        Segments {
            energies,
            segments: phrases.into_iter().map(|samples| Segment { samples, cut: Cut::Silence }).collect(),
            noted: Vec::new(),
        }
    }

    fn reset(&mut self) {
        EnergyListener::reset(self);
    }
}

/// The longest segment a VAD cuts when speech never pauses (`_MAX_SPEECH_DURATION_MS` of
/// [`transcription_recorder.py`]). It is fixed whatever `*_RECORD_TIMEOUT` says: on the VAD path
/// the record timeout only bounded a read, and shorter cuts tried in Python called the engine so
/// often that recognition got worse.
///
/// [`transcription_recorder.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/transcription_recorder.py
pub const MAX_SPEECH_SECONDS: f64 = 7.0;

/// A voice activity detector the recorder can use in place of the energy listener.
pub trait VadEngine: Send + Sync {
    /// A segmenter for audio of `rate` and `channels`. `max_speech_seconds` is the longest
    /// segment ([`MAX_SPEECH_SECONDS`]); longer speech ends with [`Cut::Limit`]. `fallback` is
    /// the energy listener the recorder uses without VAD: an engine that cannot detect cuts
    /// with it rather than not at all, and may read the volume meter's energies from it.
    fn segmenter(&self, rate: u32, channels: usize, max_speech_seconds: f64, fallback: Box<dyn Segmenter>) -> Box<dyn Segmenter>;
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
