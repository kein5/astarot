//! Phrases into utterances: `AudioTranscriber.transcribeAudioQueue` of
//! `transcription_transcriber.py` (the energy path; see the README for the VAD path).
//!
//! The recorder hands over phrases of at most `MIC_RECORD_TIMEOUT` seconds. They are joined
//! into one utterance while the quiet between them stays within `MIC_PHRASE_TIMEOUT` seconds.
//! Each time the queue is drained the utterance so far is recognised again ("interim send"), so
//! text appears without waiting for the end. A gap longer than the phrase timeout, 15 seconds
//! of audio, or the phrase timeout passing with nothing new ends the utterance. At most
//! `MIC_MAX_PHRASES` results wait for delivery; the oldest go first.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// `MAX_PHRASE_DURATION_SECONDS`.
pub const MAX_PHRASE_SECONDS: f64 = 15.0;

/// Recognises interleaved samples: the text, if any.
pub type Recognize<'a, E> = dyn FnMut(&[i16]) -> Result<Option<crate::Transcript>, E> + 'a;

/// One phrase from the recorder: interleaved samples, and when it ended.
#[derive(Clone, Debug)]
pub struct Clip {
    pub samples: Vec<i16>,
    pub ended: Instant,
}

/// The utterance being built.
pub struct Phrases {
    rate: u32,
    channels: usize,
    phrase_timeout: Duration,
    max_phrases: usize,
    last_sample: Vec<i16>,
    last_spoken: Option<Instant>,
    unsent: bool,
    results: VecDeque<crate::Transcript>,
}

impl Phrases {
    pub fn new(rate: u32, channels: usize, phrase_timeout_seconds: f64, max_phrases: usize) -> Self {
        Phrases {
            rate,
            channels: channels.max(1),
            phrase_timeout: Duration::from_secs_f64(phrase_timeout_seconds.max(0.0)),
            max_phrases,
            last_sample: Vec::new(),
            last_spoken: None,
            unsent: false,
            results: VecDeque::new(),
        }
    }

    fn seconds(&self, samples: usize) -> f64 {
        samples as f64 / (f64::from(self.rate) * self.channels as f64)
    }

    /// How long the caller may wait for a phrase before the utterance has to end anyway
    /// (`getAudioWaitTimeout`); `None` waits for the next phrase.
    pub fn wait_timeout(&self) -> Option<Duration> {
        let spoken = self.last_spoken?;
        if self.last_sample.is_empty() {
            return None;
        }
        let deadline = spoken + self.phrase_timeout + Duration::from_micros(1);
        Some(deadline.saturating_duration_since(Instant::now()))
    }

    fn reset(&mut self) {
        self.last_sample.clear();
        self.unsent = false;
    }

    fn send<E>(
        &mut self,
        recognize: &mut Recognize<'_, E>,
    ) -> Result<bool, E> {
        if self.last_sample.is_empty() {
            return Ok(false);
        }
        if let Some(result) = recognize(&self.last_sample)? {
            if self.results.len() > self.max_phrases {
                self.results.pop_front();
            }
            self.results.push_back(result);
        }
        // `_finalizeAndTranscribe` counts every attempt as a transcription.
        Ok(true)
    }

    /// Drains `queue` and recognises what is due. Returns after the first recognition, with
    /// the rest left in the queue for the next call, as Python did so that results go out at
    /// once. `recognize` gets interleaved samples and returns the text, if any.
    pub fn drain<E>(
        &mut self,
        queue: &mut VecDeque<Clip>,
        recognize: &mut Recognize<'_, E>,
    ) -> Result<bool, E> {
        let mut transcribed = false;
        while let Some(clip) = queue.pop_front() {
            let started = clip.ended.checked_sub(Duration::from_secs_f64(self.seconds(clip.samples.len()))).unwrap_or(clip.ended);
            if let Some(spoken) = self.last_spoken
                && started.saturating_duration_since(spoken) > self.phrase_timeout
            {
                if self.unsent {
                    transcribed |= self.send(recognize)?;
                }
                self.reset();
            }
            self.last_sample.extend_from_slice(&clip.samples);
            self.last_spoken = Some(clip.ended);
            self.unsent = true;
            if self.seconds(self.last_sample.len()) >= MAX_PHRASE_SECONDS {
                transcribed |= self.send(recognize)?;
                self.reset();
            } else if queue.is_empty() {
                transcribed |= self.send(recognize)?;
                self.unsent = false;
            }
            if transcribed {
                return Ok(true);
            }
        }
        if !self.last_sample.is_empty()
            && self.last_spoken.is_some_and(|spoken| spoken.elapsed() > self.phrase_timeout)
        {
            if self.unsent {
                transcribed |= self.send(recognize)?;
            }
            self.reset();
        }
        Ok(transcribed)
    }

    /// The results waiting for delivery, oldest first.
    pub fn take_results(&mut self) -> Vec<crate::Transcript> {
        self.results.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Transcript;

    fn transcript(text: &str) -> Transcript {
        Transcript { text: text.into(), language: None, asr_ms: 1 }
    }

    #[test]
    fn phrases_close_together_are_sent_again_as_one_growing_utterance() {
        let mut phrases = Phrases::new(1000, 1, 3.0, 10);
        let now = Instant::now();
        let mut sent: Vec<usize> = Vec::new();
        let mut recognize = |samples: &[i16]| -> Result<Option<Transcript>, ()> {
            sent.push(samples.len());
            Ok(Some(transcript("x")))
        };
        let mut queue = VecDeque::from([Clip { samples: vec![1; 1000], ended: now }]);
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        queue.push_back(Clip { samples: vec![1; 1000], ended: now + Duration::from_secs(1) });
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        // Four seconds of quiet: a new utterance.
        queue.push_back(Clip { samples: vec![1; 500], ended: now + Duration::from_secs(6) });
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        assert_eq!(sent, vec![1000, 2000, 500]);
        assert_eq!(phrases.take_results().len(), 3);
    }

    #[test]
    fn queued_phrases_are_folded_into_one_recognition() {
        let mut phrases = Phrases::new(1000, 2, 3.0, 10);
        let now = Instant::now();
        let mut sent = Vec::new();
        let mut recognize = |samples: &[i16]| -> Result<Option<Transcript>, ()> {
            sent.push(samples.len());
            Ok(None)
        };
        let mut queue: VecDeque<Clip> =
            (0..3).map(|i| Clip { samples: vec![0; 2000], ended: now + Duration::from_secs(i) }).collect();
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        assert_eq!(sent, vec![6000]);
        assert!(phrases.wait_timeout().is_some());
    }

    #[test]
    fn at_most_max_phrases_wait_and_errors_pass_through() {
        let mut phrases = Phrases::new(1000, 1, 3.0, 1);
        for i in 0..4 {
            let mut queue = VecDeque::from([Clip { samples: vec![0; 10], ended: Instant::now() + Duration::from_secs(10 * i) }]);
            phrases.drain(&mut queue, &mut |_| -> Result<Option<Transcript>, ()> { Ok(Some(transcript("t"))) }).unwrap();
        }
        assert_eq!(phrases.take_results().len(), 2, "Python keeps max_phrases + 1");
        let mut queue = VecDeque::from([Clip { samples: vec![0; 10], ended: Instant::now() }]);
        assert_eq!(phrases.drain(&mut queue, &mut |_| -> Result<Option<Transcript>, &str> { Err("asr") }), Err("asr"));
    }
}
