//! Speech starts at its first sound (#556).
//!
//! A speech.cpp synthesis passes its first audio within tens of milliseconds, but that audio
//! begins with near-silence the model makes before the voice: about 0.43 s from Qwen3-TTS
//! 0.6B in every sentence, and 0 to 0.27 s from Irodori-TTS v4.1, measured on 2026-11-18
//! (`docs/voice-stack/pipeline-latency-2026-11-18.md`). Played as it comes, that silence is heard as a
//! wait. [`skip_leading_silence`] drops it, keeping the last [`KEEP_MS`] before the first
//! sample louder than [`THRESHOLD`], so the voice and its onset are the same as before, only
//! sooner.
//!
//! Only the leading part changes, and at most [`LIMIT_MS`] of it: a quiet start that never
//! reaches the threshold within that time plays from there as it is, and a stream that ends
//! before its first sound passes what was kept. The scheduler applies it to speech.cpp only;
//! the installed engines (ADR-008) keep the silence their own settings put before the voice
//! (COEIROINK's `prePhonemeLength`).

use std::collections::VecDeque;

use crate::error::SpeechError;
use crate::events::AudioFrame;
use crate::playback::Frames;

/// A sample whose magnitude is above this (about -54 dBFS) is sound.
pub const THRESHOLD: i16 = 64;
/// The near-silence kept before the first sound.
pub const KEEP_MS: u32 = 20;
/// The most leading near-silence dropped from one utterance.
pub const LIMIT_MS: u32 = 1000;

/// `frames` without the near-silence before the first sound.
pub fn skip_leading_silence(frames: Frames) -> Frames {
    Box::new(LeadingSilence { inner: frames, held: Vec::new(), format: None, dropped: 0, ready: VecDeque::new(), passing: false })
}

struct LeadingSilence {
    inner: Frames,
    /// The near-silence seen since the start, at most `KEEP_MS` of it.
    held: Vec<u8>,
    format: Option<(u32, u16)>,
    /// Bytes dropped so far.
    dropped: usize,
    ready: VecDeque<Result<AudioFrame, SpeechError>>,
    passing: bool,
}

/// The byte offset of the first sample frame with a sample louder than [`THRESHOLD`].
fn first_sound(pcm: &[u8], channels: u16) -> Option<usize> {
    let stride = 2 * channels as usize;
    pcm.chunks_exact(stride).position(|frame| frame.chunks_exact(2).any(|s| i16::from_le_bytes([s[0], s[1]]).unsigned_abs() > THRESHOLD as u16)).map(|index| index * stride)
}

fn bytes_for(ms: u32, (rate, channels): (u32, u16)) -> usize {
    rate as usize * ms as usize / 1000 * 2 * channels as usize
}

impl LeadingSilence {
    /// Stop dropping: what is held goes out before `frame`.
    fn pass(&mut self, frame: Option<AudioFrame>) {
        self.passing = true;
        if let Some((rate, channels)) = self.format.filter(|_| !self.held.is_empty()) {
            if let Ok(held) = AudioFrame::new(std::mem::take(&mut self.held), rate, channels) {
                self.ready.push_back(Ok(held));
            }
        }
        if let Some(frame) = frame {
            self.ready.push_back(Ok(frame));
        }
    }

    fn take(&mut self, frame: AudioFrame) {
        let format = (frame.sample_rate(), frame.channels());
        if self.format.is_some_and(|held| held != format) {
            // The output refuses the change of format; let it see the frames as they came.
            self.pass(Some(frame));
            return;
        }
        self.format = Some(format);
        let keep = bytes_for(KEEP_MS, format);
        match first_sound(frame.pcm(), format.1) {
            Some(at) => {
                let mut pcm = std::mem::take(&mut self.held);
                pcm.extend_from_slice(frame.pcm());
                let start = (pcm.len() - frame.pcm().len() + at).saturating_sub(keep);
                let pcm = pcm.split_off(start);
                self.pass(AudioFrame::new(pcm, format.0, format.1).ok());
            }
            None => {
                self.held.extend_from_slice(frame.pcm());
                let excess = self.held.len().saturating_sub(keep);
                let excess = excess.min(bytes_for(LIMIT_MS, format).saturating_sub(self.dropped));
                let excess = excess - excess % (2 * format.1 as usize);
                self.held.drain(..excess);
                self.dropped += excess;
                if self.dropped >= bytes_for(LIMIT_MS, format) {
                    self.pass(None);
                }
            }
        }
    }
}

impl Iterator for LeadingSilence {
    type Item = Result<AudioFrame, SpeechError>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(ready) = self.ready.pop_front() {
                return Some(ready);
            }
            let next = self.inner.next();
            if self.passing {
                return next;
            }
            match next {
                Some(Ok(frame)) => self.take(frame),
                Some(Err(error)) => {
                    self.pass(None);
                    self.ready.push_back(Err(error));
                }
                None => {
                    self.pass(None);
                    return self.ready.pop_front();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 24_000;

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    fn frames(chunks: Vec<Vec<i16>>) -> Frames {
        Box::new(chunks.into_iter().map(|samples| Ok(AudioFrame::mono(pcm(&samples), RATE).unwrap())))
    }

    fn samples(frames: Frames) -> Vec<i16> {
        frames.flat_map(|frame| frame.unwrap().into_pcm()).collect::<Vec<u8>>().chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
    }

    fn ms(n: u32) -> usize {
        (RATE * n / 1000) as usize
    }

    #[test]
    fn the_silence_before_the_voice_is_dropped_but_for_the_last_20_ms() {
        // 430 ms of near-silence in 80 ms chunks, as Qwen3-TTS passes it, then the voice.
        let mut chunks: Vec<Vec<i16>> = (0..5).map(|_| vec![3; ms(80)]).collect();
        chunks.push([vec![-12; ms(30)], vec![1000; ms(50)]].concat());
        chunks.push(vec![2000; ms(80)]);
        let out = samples(skip_leading_silence(frames(chunks)));
        assert_eq!(out.len(), ms(20) + ms(50) + ms(80));
        assert!(out[..ms(20)].iter().all(|&s| s == -12), "the kept lead is the near-silence just before the voice");
        assert!(out[ms(20)..].iter().all(|&s| s >= 1000), "the voice is whole");
    }

    #[test]
    fn audio_that_starts_with_its_voice_is_unchanged() {
        let chunks = vec![vec![500; ms(10)], vec![0; ms(30)], vec![700; ms(10)]];
        let expected: Vec<i16> = chunks.concat();
        assert_eq!(samples(skip_leading_silence(frames(chunks))), expected);
    }

    #[test]
    fn a_voice_starting_inside_the_first_20_ms_keeps_everything_before_it() {
        let chunks = vec![[vec![0; ms(5)], vec![900; ms(20)]].concat()];
        let expected = chunks[0].clone();
        assert_eq!(samples(skip_leading_silence(frames(chunks))), expected);
    }

    #[test]
    fn at_most_one_second_is_dropped() {
        // 1.5 s of near-silence, then the voice: 1 s goes, the rest plays as it came.
        let mut chunks: Vec<Vec<i16>> = (0..15).map(|_| vec![10; ms(100)]).collect();
        chunks.push(vec![1500; ms(100)]);
        let out = samples(skip_leading_silence(frames(chunks)));
        assert_eq!(out.len(), ms(500) + ms(100));
        assert_eq!(out[ms(500)..].iter().filter(|&&s| s == 1500).count(), ms(100));
    }

    #[test]
    fn a_stream_without_sound_passes_what_was_kept() {
        let out = samples(skip_leading_silence(frames(vec![vec![5; ms(200)], vec![-5; ms(200)]])));
        assert_eq!(out, vec![-5; ms(20)]);
    }

    #[test]
    fn an_error_comes_through_after_what_was_kept() {
        let items: Vec<Result<AudioFrame, SpeechError>> = vec![Ok(AudioFrame::mono(pcm(&vec![1; ms(100)]), RATE).unwrap()), Err(SpeechError::new("transport_error"))];
        let mut stream = skip_leading_silence(Box::new(items.into_iter()));
        assert_eq!(stream.next().unwrap().unwrap().pcm().len(), ms(20) * 2);
        assert_eq!(stream.next().unwrap().unwrap_err().code(), "transport_error");
        assert!(stream.next().is_none());
    }

    #[test]
    fn stereo_keeps_whole_sample_frames() {
        let lead: Vec<i16> = vec![0; ms(100) * 2];
        let voice: Vec<i16> = (0..ms(10) * 2).map(|i| if i % 2 == 0 { 0 } else { 800 }).collect();
        let frames: Frames = Box::new(vec![Ok(AudioFrame::new(pcm(&[lead, voice.clone()].concat()), RATE, 2).unwrap())].into_iter());
        let out = samples(skip_leading_silence(frames));
        assert_eq!(out.len(), ms(20) * 2 + voice.len());
        assert_eq!(&out[ms(20) * 2..], &voice[..]);
    }

    #[test]
    fn a_change_of_format_is_left_to_the_output() {
        let items: Vec<Result<AudioFrame, SpeechError>> = vec![Ok(AudioFrame::mono(pcm(&vec![0; ms(100)]), RATE).unwrap()), Ok(AudioFrame::mono(pcm(&vec![900; 480]), 48_000).unwrap())];
        let rates: Vec<u32> = skip_leading_silence(Box::new(items.into_iter())).map(|f| f.unwrap().sample_rate()).collect();
        assert_eq!(rates, vec![RATE, 48_000]);
    }
}
