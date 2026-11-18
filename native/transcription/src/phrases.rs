//! Phrases into utterances: `AudioTranscriber.transcribeAudioQueue` of
//! `transcription_transcriber.py`.
//!
//! The energy path: the recorder hands over phrases of at most `MIC_RECORD_TIMEOUT` seconds.
//! They are joined into one utterance while the quiet between them stays within
//! `MIC_PHRASE_TIMEOUT` seconds. Each time the queue is drained the utterance so far is
//! recognised again ("interim send"), so text appears without waiting for the end. A gap
//! longer than the phrase timeout, 15 seconds of audio, or the phrase timeout passing with
//! nothing new ends the utterance. At most `MIC_MAX_PHRASES` results wait for delivery; the
//! oldest go first.
//!
//! The VAD path ([`Phrases::segmented`], `vad_segmented`): the VAD has already cut the speech,
//! so the phrase timeout plays no part. A segment that ended naturally ends the utterance; one
//! cut at the VAD's limit is kept and joined with what follows, up to 15 seconds. Each
//! recognition gets 0.3 s of silence before and 0.5 s after (`_padWithSilenceForVad`).

use crate::vad::Cut;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// `MAX_PHRASE_DURATION_SECONDS`.
pub const MAX_PHRASE_SECONDS: f64 = 15.0;
/// `VAD_PRE_PAD_MS`, `VAD_POST_PAD_MS`.
const VAD_PAD_MS: (u32, u32) = (300, 500);

/// Recognises interleaved samples: the text, if any.
pub type Recognize<'a, E> = dyn FnMut(&[i16]) -> Result<Option<crate::Transcript>, E> + 'a;

/// One phrase from the recorder: interleaved samples, and when it ended.
#[derive(Clone, Debug)]
pub struct Clip {
    pub samples: Vec<i16>,
    pub ended: Instant,
    /// How it ended; only the VAD path looks at it.
    pub cut: Cut,
}

/// The utterance being built.
pub struct Phrases {
    rate: u32,
    channels: usize,
    phrase_timeout: Duration,
    max_phrases: usize,
    /// The clips are a VAD's segments.
    segmented: bool,
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
            segmented: false,
            last_sample: Vec::new(),
            last_spoken: None,
            unsent: false,
            results: VecDeque::new(),
        }
    }

    /// The VAD path: the clips are segments a VAD cut.
    pub fn segmented(mut self) -> Self {
        self.segmented = true;
        self
    }

    fn seconds(&self, samples: usize) -> f64 {
        samples as f64 / (f64::from(self.rate) * self.channels as f64)
    }

    /// How long the caller may wait for a phrase before the utterance has to end anyway
    /// (`getAudioWaitTimeout`); `None` waits for the next phrase.
    pub fn wait_timeout(&self) -> Option<Duration> {
        if self.segmented {
            return None;
        }
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
        let recognized = if self.segmented {
            // Silence around a copy; what is kept stays as heard, for the next segments.
            let frames = |ms: u32| (u64::from(self.rate) * u64::from(ms) / 1000) as usize * self.channels;
            let mut padded = vec![0; frames(VAD_PAD_MS.0)];
            padded.extend_from_slice(&self.last_sample);
            padded.resize(padded.len() + frames(VAD_PAD_MS.1), 0);
            recognize(&padded)?
        } else {
            recognize(&self.last_sample)?
        };
        if let Some(result) = recognized {
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
        if self.segmented {
            return self.drain_segments(queue, recognize);
        }
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

    /// `transcribeAudioQueue` with `vad_segmented`.
    fn drain_segments<E>(&mut self, queue: &mut VecDeque<Clip>, recognize: &mut Recognize<'_, E>) -> Result<bool, E> {
        let mut transcribed = false;
        while let Some(clip) = queue.pop_front() {
            self.unsent |= !clip.samples.is_empty();
            self.last_sample.extend_from_slice(&clip.samples);
            self.last_spoken = Some(clip.ended);
            if clip.cut == Cut::Silence || self.seconds(self.last_sample.len()) >= MAX_PHRASE_SECONDS {
                // A natural end, or the safety net: the utterance is final.
                transcribed |= self.send(recognize)?;
                self.reset();
            } else if queue.is_empty() {
                transcribed |= self.send(recognize)?;
                self.unsent = false;
            }
            // Cut at the limit with more waiting: keep gathering.
            if transcribed {
                return Ok(true);
            }
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
        let mut queue = VecDeque::from([Clip { samples: vec![1; 1000], ended: now, cut: Cut::Silence }]);
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        queue.push_back(Clip { samples: vec![1; 1000], ended: now + Duration::from_secs(1), cut: Cut::Silence });
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        // Four seconds of quiet: a new utterance.
        queue.push_back(Clip { samples: vec![1; 500], ended: now + Duration::from_secs(6), cut: Cut::Silence });
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
            (0..3).map(|i| Clip { samples: vec![0; 2000], ended: now + Duration::from_secs(i), cut: Cut::Silence }).collect();
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        assert_eq!(sent, vec![6000]);
        assert!(phrases.wait_timeout().is_some());
    }

    #[test]
    fn at_most_max_phrases_wait_and_errors_pass_through() {
        let mut phrases = Phrases::new(1000, 1, 3.0, 1);
        for i in 0..4 {
            let mut queue = VecDeque::from([Clip { samples: vec![0; 10], ended: Instant::now() + Duration::from_secs(10 * i), cut: Cut::Silence }]);
            phrases.drain(&mut queue, &mut |_| -> Result<Option<Transcript>, ()> { Ok(Some(transcript("t"))) }).unwrap();
        }
        assert_eq!(phrases.take_results().len(), 2, "Python keeps max_phrases + 1");
        let mut queue = VecDeque::from([Clip { samples: vec![0; 10], ended: Instant::now(), cut: Cut::Silence }]);
        assert_eq!(phrases.drain(&mut queue, &mut |_| -> Result<Option<Transcript>, &str> { Err("asr") }), Err("asr"));
    }

    #[test]
    fn vad_segments_end_at_a_natural_cut_and_are_padded_with_silence() {
        // 1000 frames a second, two channels: 0.3 s before is 600 samples, 0.5 s after 1000.
        let mut phrases = Phrases::new(1000, 2, 3.0, 10).segmented();
        let now = Instant::now();
        let sent: std::cell::RefCell<Vec<(usize, usize, usize)>> = Default::default();
        let mut recognize = |samples: &[i16]| -> Result<Option<Transcript>, ()> {
            let lead = samples.iter().take_while(|s| **s == 0).count();
            let tail = samples.iter().rev().take_while(|s| **s == 0).count();
            sent.borrow_mut().push((lead, samples.len() - lead - tail, tail));
            Ok(Some(transcript("x")))
        };
        // Cut at the limit with another segment waiting: gathered, not sent.
        let mut queue = VecDeque::from([
            Clip { samples: vec![1; 4000], ended: now, cut: Cut::Limit },
            Clip { samples: vec![1; 2000], ended: now, cut: Cut::Silence },
        ]);
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        // Cut at the limit with nothing waiting: sent as it is so far, and kept.
        queue.push_back(Clip { samples: vec![1; 1000], ended: now, cut: Cut::Limit });
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        queue.push_back(Clip { samples: vec![1; 1000], ended: now, cut: Cut::Silence });
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        assert_eq!(*sent.borrow(), vec![(600, 6000, 1000), (600, 1000, 1000), (600, 2000, 1000)]);
        assert_eq!(phrases.wait_timeout(), None, "the phrase timeout plays no part");
        // The 15 s safety net ends an utterance that never pauses.
        sent.borrow_mut().clear();
        queue.extend((0..3).map(|_| Clip { samples: vec![1; 16000], ended: now, cut: Cut::Limit }));
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        assert_eq!(queue.len(), 1, "8 s, then 16 s: final at the second");
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        assert_eq!(*sent.borrow(), vec![(600, 32000, 1000), (600, 16000, 1000)]);
    }

    // The phrase deadline, after `src-python/test/test_model_transcription_wait.py`.

    #[test]
    fn the_phrase_deadline_ends_the_utterance_without_sending_it_again() {
        let mut phrases = Phrases::new(1000, 1, 0.05, 10);
        let mut sent = 0;
        let mut recognize = |_: &[i16]| -> Result<Option<Transcript>, ()> {
            sent += 1;
            Ok(Some(transcript("x")))
        };
        let mut queue = VecDeque::from([Clip { samples: vec![1; 100], ended: Instant::now(), cut: Cut::Silence }]);
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(true));
        let wait = phrases.wait_timeout().expect("a deadline while the utterance is open");
        assert!(wait <= Duration::from_millis(50) + Duration::from_micros(1), "{wait:?}");
        std::thread::sleep(Duration::from_millis(60));
        // The deadline passed: the utterance ends, and what was already sent is not sent again.
        assert_eq!(phrases.drain(&mut queue, &mut recognize), Ok(false));
        assert_eq!(sent, 1);
        assert_eq!(phrases.wait_timeout(), None, "then it waits for the next phrase");
    }

    #[test]
    fn a_new_phrase_moves_the_deadline_and_its_boundary_is_strict() {
        let mut phrases = Phrases::new(1000, 1, 3.0, 10);
        let now = Instant::now();
        let mut recognize = |_: &[i16]| -> Result<Option<Transcript>, ()> { Ok(None) };
        let mut queue = VecDeque::from([Clip { samples: vec![1; 10], ended: now - Duration::from_secs(2), cut: Cut::Silence }]);
        phrases.drain(&mut queue, &mut recognize).unwrap();
        let first = phrases.wait_timeout().unwrap();
        queue.push_back(Clip { samples: vec![1; 10], ended: now, cut: Cut::Silence });
        phrases.drain(&mut queue, &mut recognize).unwrap();
        let second = phrases.wait_timeout().unwrap();
        assert!(second > first + Duration::from_millis(1900), "the deadline counts from the newest phrase: {first:?}, {second:?}");

        // Exactly at the timeout a microsecond is left; after it nothing.
        let mut phrases = Phrases::new(1000, 1, 3.0, 10);
        let mut queue = VecDeque::from([Clip { samples: vec![1; 10], ended: Instant::now() - Duration::from_secs(3), cut: Cut::Silence }]);
        phrases.drain(&mut queue, &mut recognize).unwrap();
        assert!(phrases.wait_timeout().unwrap() <= Duration::from_micros(1));
        let mut phrases = Phrases::new(1000, 1, 3.0, 10);
        let mut queue = VecDeque::from([Clip { samples: vec![1; 10], ended: Instant::now() - Duration::from_secs(4), cut: Cut::Silence }]);
        phrases.drain(&mut queue, &mut recognize).unwrap();
        assert_eq!(phrases.wait_timeout(), Some(Duration::ZERO));
    }

    #[test]
    fn a_vad_segment_the_engine_did_not_understand_counts_as_a_round_and_stores_nothing() {
        // `test_vrct_transcription_integration.py::test_audio_transcriber_reports_asr_failure_after_vad_segment`.
        let mut phrases = Phrases::new(1000, 1, 3.0, 10).segmented();
        let mut queue = VecDeque::from([Clip { samples: vec![1; 500], ended: Instant::now(), cut: Cut::Silence }]);
        assert_eq!(phrases.drain(&mut queue, &mut |_| -> Result<Option<Transcript>, ()> { Ok(None) }), Ok(true));
        assert!(phrases.take_results().is_empty());
    }
}
