//! Play speech through the running voice conversion instead of an output
//! device (ADR-007).
//!
//! The speech worker hands over the same frames it would play. They are made
//! 48 kHz mono s16le, the conversion's input, and replace the microphone while
//! they last. The conversion's own output, mute and monitor then carry them, so
//! this router opens no device.

use std::sync::Arc;

use crate::cancel::CancelToken;
use crate::error::{SpeechError, TtsError};
use crate::events::AudioFrame;
use crate::playback::{FirstAudio, Frames, Monitor, SpeechRouter};
use crate::resample::Resampler;

/// The conversion's input rate.
pub const RATE: u32 = 48000;

/// 48 kHz mono s16le chunks for the conversion.
pub type Chunks<'a> = &'a mut (dyn Iterator<Item = Result<Vec<u8>, SpeechError>> + Send);

/// Why the conversion could not speak.
#[derive(Debug)]
pub enum SpeakError {
    /// No conversion runs (`vc_speech_unavailable`).
    Unavailable,
    Speech(SpeechError),
    /// Any other failure of the conversion's process or pipe.
    Failed,
}

/// The running voice conversion (Python's `DirectVoice`).
pub trait ConversionSpeaker: Send + Sync {
    fn speaking_available(&self) -> bool;
    /// Feed `chunks` in place of the microphone, paced to real time.
    /// `on_first_audio` is called once the first chunk was handed over.
    fn speak(&self, chunks: Chunks<'_>, token: &CancelToken, on_first_audio: FirstAudio<'_>) -> Result<(), SpeakError>;
}

/// A router the scheduler uses only while a conversion runs.
pub trait ConvertedRouter: SpeechRouter {
    fn available(&self) -> bool;
}

fn mono(frame: &AudioFrame) -> Vec<i16> {
    let samples: Vec<i16> = frame.pcm().as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect();
    if frame.channels() == 1 {
        return samples;
    }
    let channels = frame.channels() as usize;
    samples
        .chunks_exact(channels)
        .map(|block| {
            let sum: i32 = block.iter().map(|&s| s as i32).sum();
            // The mean, truncated toward zero.
            (sum / channels as i32) as i16
        })
        .collect()
}

fn bytes(samples: &[i16]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}

/// 48 kHz mono s16le bytes for each speech frame, one resampler per stream.
/// Empty chunks are skipped. A rate change mid-stream is `format_changed`.
pub fn to_conversion_rate(frames: Frames) -> impl Iterator<Item = Result<Vec<u8>, SpeechError>> + Send {
    ConversionRate { frames, rate: None, resampler: None, done: false }
}

struct ConversionRate {
    frames: Frames,
    rate: Option<u32>,
    resampler: Option<Resampler>,
    done: bool,
}

impl Iterator for ConversionRate {
    type Item = Result<Vec<u8>, SpeechError>;

    fn next(&mut self) -> Option<Self::Item> {
        while !self.done {
            let frame = match self.frames.next() {
                Some(Ok(frame)) => frame,
                Some(Err(error)) => {
                    self.done = true;
                    return Some(Err(error));
                }
                None => {
                    self.done = true;
                    let tail = self.resampler.as_mut().map(Resampler::finish).unwrap_or_default();
                    return (!tail.is_empty()).then(|| Ok(bytes(&tail)));
                }
            };
            let rate = *self.rate.get_or_insert(frame.sample_rate());
            if frame.sample_rate() != rate {
                self.done = true;
                return Some(Err(SpeechError::new("format_changed")));
            }
            let samples = mono(&frame);
            let out = if rate == RATE { samples } else { self.resampler.get_or_insert_with(|| Resampler::new(rate, RATE)).process(&samples) };
            if !out.is_empty() {
                return Some(Ok(bytes(&out)));
            }
        }
        None
    }
}

pub struct ConvertedSpeechRouter {
    voice: Arc<dyn ConversionSpeaker>,
}

impl ConvertedSpeechRouter {
    pub fn new(voice: Arc<dyn ConversionSpeaker>) -> Self {
        Self { voice }
    }
}

impl SpeechRouter for ConvertedSpeechRouter {
    /// The device is the conversion's; a speech monitor would play the
    /// unconverted voice, so both are ignored.
    fn play(&self, frames: Frames, _device: &str, token: &CancelToken, on_first_audio: FirstAudio<'_>, _monitor: Option<Arc<dyn Monitor>>) -> Result<(), TtsError> {
        let mut first = |timestamp: i64, rate: u32| -> Result<(), SpeechError> {
            token.begin_playback()?;
            on_first_audio(timestamp, rate)
        };
        let mut chunks = to_conversion_rate(frames);
        match self.voice.speak(&mut chunks, token, &mut first) {
            Ok(()) => Ok(()),
            Err(SpeakError::Unavailable) => Err(SpeechError::new("conversion_unavailable").into()),
            Err(SpeakError::Speech(error)) => Err(error.into()),
            Err(SpeakError::Failed) => Err(TtsError::Output),
        }
    }
}

impl ConvertedRouter for ConvertedSpeechRouter {
    fn available(&self) -> bool {
        self.voice.speaking_available()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn frames(items: Vec<AudioFrame>) -> Frames {
        Box::new(items.into_iter().map(Ok))
    }

    fn samples(bytes: &[u8]) -> Vec<i16> {
        bytes.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect()
    }

    #[test]
    fn speech_is_made_48_khz_mono_for_the_conversion() {
        let tone: Vec<u8> = (0..24000).flat_map(|i| (((i as f64 * 2.0 * std::f64::consts::PI * 440.0 / 24000.0).sin() * 8000.0) as i16).to_le_bytes()).collect();
        let parts = tone.chunks(9600).map(|c| AudioFrame::mono(c.to_vec(), 24000).unwrap()).collect();
        let out: Vec<u8> = to_conversion_rate(frames(parts)).flat_map(Result::unwrap).collect();
        // One second at 24 kHz is one second at 48 kHz.
        assert!((out.len() as i64 / 2 - 48000).abs() < 200);
        let stereo: Vec<u8> = (0..480).flat_map(|_| [100i16.to_le_bytes(), 300i16.to_le_bytes()].concat()).collect();
        let out: Vec<u8> = to_conversion_rate(frames(vec![AudioFrame::new(stereo, 48000, 2).unwrap()])).flat_map(Result::unwrap).collect();
        assert_eq!(samples(&out), vec![200; 480]);
        let negative: Vec<u8> = [-3i16, 0].iter().flat_map(|s| s.to_le_bytes()).collect();
        let out: Vec<u8> = to_conversion_rate(frames(vec![AudioFrame::new(negative, 48000, 2).unwrap()])).flat_map(Result::unwrap).collect();
        assert_eq!(samples(&out), vec![-1], "the mean truncates toward zero, as numpy's astype does");
        let changed = to_conversion_rate(frames(vec![AudioFrame::mono(vec![0; 20], 24000).unwrap(), AudioFrame::mono(vec![0; 20], 48000).unwrap()])).collect::<Vec<_>>();
        assert_eq!(changed.last().unwrap().as_ref().unwrap_err().code(), "format_changed");
    }

    struct FakeOwner {
        available: bool,
        chunks: Mutex<Vec<Vec<u8>>>,
    }

    impl ConversionSpeaker for FakeOwner {
        fn speaking_available(&self) -> bool {
            self.available
        }

        fn speak(&self, chunks: Chunks<'_>, _token: &CancelToken, on_first_audio: FirstAudio<'_>) -> Result<(), SpeakError> {
            if !self.available {
                return Err(SpeakError::Unavailable);
            }
            for chunk in chunks {
                let chunk = chunk.map_err(SpeakError::Speech)?;
                let mut stored = self.chunks.lock().unwrap();
                stored.push(chunk);
                if stored.len() == 1 {
                    on_first_audio(1, 48000).map_err(SpeakError::Speech)?;
                }
            }
            Ok(())
        }
    }

    #[test]
    fn the_router_speaks_through_a_running_conversion_and_opens_no_device() {
        let owner = Arc::new(FakeOwner { available: true, chunks: Mutex::new(Vec::new()) });
        let router = ConvertedSpeechRouter::new(owner.clone());
        assert!(router.available());
        let token = CancelToken::new();
        let mut first = Vec::new();
        router
            .play(
                frames(vec![AudioFrame::mono([1u8, 0].repeat(480), 48000).unwrap()]),
                "a-device",
                &token,
                &mut |t, r| {
                    first.push((t, r));
                    Ok(())
                },
                None,
            )
            .unwrap();
        assert_eq!(*owner.chunks.lock().unwrap(), vec![[1u8, 0].repeat(480)]);
        assert_eq!(first, vec![(1, 48000)]);
    }

    #[test]
    fn without_a_conversion_the_router_is_unavailable() {
        let router = ConvertedSpeechRouter::new(Arc::new(FakeOwner { available: false, chunks: Mutex::new(Vec::new()) }));
        assert!(!router.available());
        let error = router.play(frames(vec![]), "", &CancelToken::new(), &mut |_, _| Ok(()), None).unwrap_err();
        assert_eq!(error.failure_code(), "conversion_unavailable");
    }
}
