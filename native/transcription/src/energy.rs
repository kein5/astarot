//! The energy listener of the recorder: `Recognizer.listen_energy_and_audio` of the
//! `speech_recognition` fork that [`transcription_recorder.py`] ran in the background.
//!
//! Audio is cut into buffers of 1024 frames (`Microphone.CHUNK`) at the device's rate and
//! channels. Each buffer's [`rms`] is reported for the volume meter. A phrase starts at the
//! first buffer louder than the threshold and ends after more than 0.8 s of quieter buffers
//! (`pause_threshold`) or when it has lasted `phrase_time_limit` seconds (`MIC_RECORD_TIMEOUT`).
//! It keeps up to 0.5 s of quiet on each side (`non_speaking_duration`); a phrase of less than
//! 0.3 s of sound is dropped (`phrase_threshold`). While waiting, the automatic threshold
//! (`dynamic_energy_threshold`) follows the quiet: damping 0.15 per second, ratio 1.5. Waiting
//! starts over every second (`phrase_timeout=1` in the background listener), which forgets the
//! quiet kept before the phrase. It is the recorder's [`crate::vad::Segmenter`] unless a VAD
//! engine is in use.
//!
//! [`transcription_recorder.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/transcription_recorder.py

use crate::pcm::rms;
use std::collections::VecDeque;

pub const CHUNK: usize = 1024;
const PAUSE_THRESHOLD: f64 = 0.8;
const PHRASE_THRESHOLD: f64 = 0.3;
const NON_SPEAKING_DURATION: f64 = 0.5;
const DAMPING: f64 = 0.15;
const RATIO: f64 = 1.5;
/// `phrase_timeout=1` of `listen_energy_and_audio_in_background`: the wait for a phrase.
const WAIT_TIMEOUT: f64 = 1.0;

/// What the listener found in the audio it was given.
#[derive(Debug, Default, PartialEq)]
pub struct Heard {
    /// The rms of each buffer, in order.
    pub energies: Vec<u32>,
    /// Complete phrases: interleaved samples at the device's format.
    pub phrases: Vec<Vec<i16>>,
}

enum Phase {
    Waiting { elapsed: f64 },
    Phrase { elapsed: f64, started: f64, pause: usize, count: usize },
}

pub struct EnergyListener {
    channels: usize,
    seconds_per_buffer: f64,
    pause_buffers: usize,
    phrase_buffers: usize,
    non_speaking_buffers: usize,
    /// `energy_threshold`, which the automatic threshold moves.
    pub threshold: f64,
    pub dynamic: bool,
    phrase_time_limit: Option<f64>,
    pending: Vec<i16>,
    frames: VecDeque<Vec<i16>>,
    phase: Phase,
}

impl EnergyListener {
    /// `phrase_time_limit` 0 means none (Python's falsy limit).
    pub fn new(rate: u32, channels: usize, threshold: f64, dynamic: bool, phrase_time_limit: f64) -> Self {
        let seconds_per_buffer = CHUNK as f64 / f64::from(rate.max(1));
        let count = |seconds: f64| (seconds / seconds_per_buffer).ceil() as usize;
        EnergyListener {
            channels: channels.max(1),
            seconds_per_buffer,
            pause_buffers: count(PAUSE_THRESHOLD),
            phrase_buffers: count(PHRASE_THRESHOLD),
            non_speaking_buffers: count(NON_SPEAKING_DURATION),
            threshold,
            dynamic,
            phrase_time_limit: (phrase_time_limit > 0.0).then_some(phrase_time_limit),
            pending: Vec::new(),
            frames: VecDeque::new(),
            phase: Phase::Waiting { elapsed: 0.0 },
        }
    }

    /// Starts listening again from nothing (after a pause).
    pub fn reset(&mut self) {
        self.pending.clear();
        self.frames.clear();
        self.phase = Phase::Waiting { elapsed: 0.0 };
    }

    /// Feeds interleaved samples; whole buffers are processed, the rest waits for more.
    pub fn feed(&mut self, samples: &[i16]) -> Heard {
        self.pending.extend_from_slice(samples);
        let size = CHUNK * self.channels;
        let mut heard = Heard::default();
        while self.pending.len() >= size {
            let buffer: Vec<i16> = self.pending.drain(..size).collect();
            self.buffer(buffer, &mut heard);
        }
        heard
    }

    fn buffer(&mut self, buffer: Vec<i16>, heard: &mut Heard) {
        let spb = self.seconds_per_buffer;
        // A phrase that reached its limit ends before this buffer is read; the buffer opens
        // the next wait, as the next call of `listen_energy_and_audio` reads it.
        if let Phase::Phrase { elapsed, started, pause, count } = &mut self.phase {
            *elapsed += spb;
            if self.phrase_time_limit.is_some_and(|limit| *elapsed - *started > limit) {
                let (pause, count) = (*pause, *count);
                self.end_phrase(pause, count, heard);
                self.wait_with(buffer, heard);
                return;
            }
            let energy = rms(&buffer);
            heard.energies.push(energy);
            self.frames.push_back(buffer);
            *count += 1;
            if f64::from(energy) > self.threshold {
                *pause = 0;
            } else {
                *pause += 1;
            }
            if *pause > self.pause_buffers {
                let (pause, count) = (*pause, *count);
                self.end_phrase(pause, count, heard);
            }
            return;
        }
        self.wait_with(buffer, heard);
    }

    fn wait_with(&mut self, buffer: Vec<i16>, heard: &mut Heard) {
        let spb = self.seconds_per_buffer;
        let Phase::Waiting { elapsed } = &mut self.phase else {
            self.phase = Phase::Waiting { elapsed: 0.0 };
            return self.wait_with(buffer, heard);
        };
        *elapsed += spb;
        if *elapsed > WAIT_TIMEOUT {
            // `WaitTimeoutError`: the listener starts over; this buffer opens the new wait.
            self.frames.clear();
            *elapsed = spb;
        }
        let energy = rms(&buffer);
        heard.energies.push(energy);
        self.frames.push_back(buffer);
        if self.frames.len() > self.non_speaking_buffers {
            self.frames.pop_front();
        }
        if f64::from(energy) > self.threshold {
            let started = *elapsed;
            self.phase = Phase::Phrase { elapsed: started, started, pause: 0, count: 0 };
            return;
        }
        if self.dynamic {
            let damping = DAMPING.powf(spb);
            let target = f64::from(energy) * RATIO;
            self.threshold = self.threshold * damping + target * (1.0 - damping);
        }
    }

    fn end_phrase(&mut self, pause: usize, count: usize, heard: &mut Heard) {
        let sound = count.saturating_sub(pause);
        if sound >= self.phrase_buffers {
            for _ in 0..pause.saturating_sub(self.non_speaking_buffers) {
                self.frames.pop_back();
            }
            let phrase: Vec<i16> = self.frames.drain(..).flatten().collect();
            heard.phrases.push(phrase);
        } else {
            self.frames.clear();
        }
        self.phase = Phase::Waiting { elapsed: 0.0 };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(buffers: usize, level: i16) -> Vec<i16> {
        (0..buffers * CHUNK).map(|i| if i % 2 == 0 { level } else { -level }).collect()
    }

    #[test]
    fn a_phrase_ends_after_the_pause_and_keeps_half_a_second_of_quiet() {
        let rate = 48000;
        let mut listener = EnergyListener::new(rate, 1, 300.0, false, 0.0);
        let mut heard = listener.feed(&tone(10, 0));
        heard.phrases.extend(listener.feed(&tone(40, 2000)).phrases);
        heard.phrases.extend(listener.feed(&tone(60, 0)).phrases);
        assert_eq!(heard.phrases.len(), 1);
        let buffers = heard.phrases[0].len() / CHUNK;
        let quiet = (0.5f64 / (CHUNK as f64 / 48000.0)).ceil() as usize; // 24
        // Quiet kept before (up to 24, here the 10 fed) + 40 loud + 24 quiet after.
        assert_eq!(buffers, 10 + 40 + quiet);
    }

    #[test]
    fn a_click_is_not_a_phrase_and_the_limit_cuts_a_long_one() {
        let mut listener = EnergyListener::new(44100, 1, 300.0, false, 3.0);
        let heard = listener.feed(&[tone(2, 5000), tone(80, 0)].concat());
        assert!(heard.phrases.is_empty(), "too short");
        let heard = listener.feed(&tone(200, 5000));
        // 200 buffers of 23.2 ms is 4.6 s: one cut at 3 s, the rest still open.
        assert_eq!(heard.phrases.len(), 1);
        let seconds = heard.phrases[0].len() as f64 / 44100.0;
        assert!((2.9..=3.1).contains(&seconds), "{seconds}");
    }

    #[test]
    fn the_automatic_threshold_follows_the_quiet() {
        let mut listener = EnergyListener::new(48000, 2, 3000.0, true, 3.0);
        let heard = listener.feed(&tone(200, 100));
        assert_eq!(heard.energies.len(), 100, "two channels: a buffer is 2048 samples");
        assert!(listener.threshold < 300.0 && listener.threshold > 150.0, "{}", listener.threshold);
    }
}
