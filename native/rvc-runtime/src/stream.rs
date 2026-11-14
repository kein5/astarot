//! Streaming conversion (specification section 12): 16 kHz input in fixed blocks, one
//! block of output at the model's sample rate for every block in.
//!
//! Every block is converted inside a window that also holds the audio before it:
//!
//! ```text
//! |<----------- extra ----------->|<- crossfade ->|<- search ->|<--- block --->|
//!  left context, synthesized but    synthesized and returned; the newest block
//!  not returned (skip_head)         is the last part of the window
//! ```
//!
//! - Content features are taken over the whole window; their last frame is repeated
//!   before the 50 to 100 fps doubling, and the index blend only touches the frames from
//!   `skip_head / 2` on.
//! - Pitch is taken over the newest `block + 800` samples only (rounded up the way RMVPE
//!   needs) and written into a pitch history that moves by one block per call: the
//!   extractor's frames `[3, n - 1)` replace the last `n - 4` frames of the history.
//! - The synthesizer returns `block + crossfade + search` frames after `skip_head`.
//! - The returned audio is joined to the previous block by a phase-aligned crossfade
//!   (synchronised overlap-add): the start of the new audio is matched against the tail
//!   kept from the previous call within the search range, and the two are crossfaded at
//!   the best match.
//! - The input high-pass runs causally ([`filter::CausalFilter`]).
//!
//! All buffers start silent, so the first blocks fade in from silence. The pitch history
//! starts at zero (quantised and continuous) until the extractor has filled it, as in the
//! reference.

use crate::backend::MIN_FEATURE_SAMPLES;
use crate::error::{Error, Result};
use crate::f0::{self, HOP};
use crate::filter::{self, CausalFilter};
use crate::noise::{Generator, NoiseMode};
use crate::pipeline::Converter;

/// Pitch frames the extractor is given beyond the block (specification section 12).
const PITCH_MARGIN: usize = 800;
/// RMVPE takes its input in multiples of this many samples (minus one hop).
const PITCH_QUANTUM: usize = 5120;
/// Extractor frames dropped at the start and at the end of each pitch window.
const PITCH_HEAD: usize = 3;
const PITCH_TAIL: usize = 1;

/// The block layout, in 10 ms frames (160 samples at 16 kHz).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Layout {
    /// Audio per call.
    pub block: usize,
    /// Length of the crossfade between consecutive blocks.
    pub crossfade: usize,
    /// How far the crossfade position is searched.
    pub search: usize,
    /// Left context before the returned frames.
    pub extra: usize,
}

impl Default for Layout {
    /// The reference real-time defaults: 0.25 s blocks, 0.05 s crossfade, a search of one
    /// frame and 2.5 s of context.
    fn default() -> Self {
        Layout { block: 25, crossfade: 5, search: 1, extra: 250 }
    }
}

impl Layout {
    /// Frames in the window.
    pub fn window(&self) -> usize {
        self.extra + self.crossfade + self.search + self.block
    }

    /// Frames of left context given to the synthesizer.
    pub fn skip_head(&self) -> usize {
        self.extra
    }

    /// Frames the synthesizer returns per call.
    pub fn return_length(&self) -> usize {
        self.block + self.crossfade + self.search
    }

    /// Input samples per call at 16 kHz.
    pub fn block_samples(&self) -> usize {
        self.block * HOP
    }

    /// Samples given to the pitch extractor per call: the block plus 800, rounded up to
    /// the RMVPE input size, and never more than the window.
    pub fn pitch_samples(&self) -> usize {
        let wanted = self.block_samples() + PITCH_MARGIN;
        (wanted.div_ceil(PITCH_QUANTUM) * PITCH_QUANTUM - HOP).min(self.window() * HOP)
    }

    /// How long an input sample takes to come out, not counting processing time: one
    /// block of buffering, plus the crossfade and search frames that follow the returned
    /// audio in the window. In seconds.
    pub fn latency(&self) -> f64 {
        (self.block + self.crossfade + self.search) as f64 / f0::FRAME_RATE as f64
    }

    fn validate(&self) -> Result<()> {
        if self.block == 0 || self.crossfade == 0 {
            return Err(Error::invalid("the block and the crossfade need at least one frame each"));
        }
        if self.crossfade > self.block {
            return Err(Error::invalid("the crossfade cannot be longer than the block"));
        }
        if self.window() * HOP < MIN_FEATURE_SAMPLES {
            return Err(Error::invalid("the streaming window is too short for feature extraction"));
        }
        // The extractor returns one frame more than whole hops; at least one must be kept.
        if self.pitch_samples() / HOP < PITCH_HEAD + PITCH_TAIL {
            return Err(Error::invalid("the streaming window is too short for pitch extraction"));
        }
        Ok(())
    }
}

/// The streaming parameters. Parameters of offline conversion that the reference's
/// real-time conversion does not have (protect, loudness mix, resampling, splitting) are
/// not here.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamOptions {
    pub transpose: i32,
    /// Share of the retrieved features in the blend, 0..=1. Ignored without an index.
    pub index_rate: f32,
    pub speaker: usize,
    pub noise: NoiseMode,
    pub layout: Layout,
    /// Apply the input high-pass (specification section 4) causally.
    pub highpass: bool,
}

impl Default for StreamOptions {
    fn default() -> Self {
        StreamOptions { transpose: 0, index_rate: 0.75, speaker: 0, noise: NoiseMode::Random, layout: Layout::default(), highpass: true }
    }
}

/// Intermediate values of one call, for verification. Holds audio-derived data and is
/// never logged.
#[derive(Debug, Clone, Default)]
pub struct BlockTrace {
    /// The 16 kHz window after filtering.
    pub window: Vec<f32>,
    /// Content features at 50 fps, before the repeated last frame and the blend.
    pub features: Vec<f32>,
    /// What the synthesizer received at 100 fps, the whole window.
    pub synthesizer_features: Vec<f32>,
    /// Extractor output in Hz for the pitch window, 0 where unvoiced.
    pub f0: Vec<f32>,
    /// The pitch history handed to the synthesizer, the whole window.
    pub coarse: Vec<i64>,
    pub continuous: Vec<f32>,
    /// Synthesizer output before the crossfade.
    pub synthesized: Vec<f32>,
    /// Where the crossfade was placed, in output samples from the start of `synthesized`.
    pub offset: usize,
}

/// The phase-aligned crossfade between consecutive blocks.
#[derive(Debug, Clone)]
pub struct Sola {
    fade_in: Vec<f32>,
    tail: Vec<f32>,
    search: usize,
    block: usize,
}

impl Sola {
    /// Lengths in output samples; `crossfade` must not exceed `block`.
    pub fn new(crossfade: usize, search: usize, block: usize) -> Self {
        // Squared-sine fade in, from 0 to 1 inclusive; the fade out is its complement.
        let fade_in = (0..crossfade)
            .map(|n| {
                let position = if crossfade > 1 { n as f64 / (crossfade - 1) as f64 } else { 1.0 };
                (0.5 * std::f64::consts::PI * position).sin().powi(2) as f32
            })
            .collect();
        Sola { fade_in, tail: vec![0.0; crossfade], search, block }
    }

    /// Samples the synthesizer has to return per block.
    pub fn input_len(&self) -> usize {
        self.block + self.fade_in.len() + self.search
    }

    /// Where the new audio continues the kept tail best: the offset within the search
    /// range with the highest normalised cross-correlation. Ties go to the earliest.
    fn best_offset(&self, audio: &[f32]) -> usize {
        let length = self.tail.len();
        let mut best = (0, f64::NEG_INFINITY);
        for offset in 0..=self.search {
            let candidate = &audio[offset..offset + length];
            let (mut product, mut energy) = (0.0f64, 0.0f64);
            for (&a, &b) in candidate.iter().zip(&self.tail) {
                product += a as f64 * b as f64;
                energy += a as f64 * a as f64;
            }
            let score = product / (energy + 1e-8).sqrt();
            if score > best.1 {
                best = (offset, score);
            }
        }
        best.0
    }

    /// Joins one block's synthesizer output (`input_len()` samples) to the previous one and
    /// returns `block` samples, with the offset that was chosen.
    pub fn join(&mut self, audio: &[f32]) -> (Vec<f32>, usize) {
        assert_eq!(audio.len(), self.input_len(), "synthesizer output of the wrong length");
        let offset = self.best_offset(audio);
        let aligned = &audio[offset..];
        let mut output = aligned[..self.block].to_vec();
        for (index, sample) in output.iter_mut().take(self.fade_in.len()).enumerate() {
            let fade = self.fade_in[index];
            *sample = *sample * fade + self.tail[index] * (1.0 - fade);
        }
        // The next block starts where this one ends; keep what follows for its crossfade.
        let crossfade = self.fade_in.len();
        self.tail.copy_from_slice(&aligned[self.block..self.block + crossfade]);
        (output, offset)
    }

    pub fn reset(&mut self) {
        self.tail.fill(0.0);
    }
}

/// A converter run block by block.
pub struct Stream {
    converter: Converter,
    options: StreamOptions,
    /// The 16 kHz window, newest block last.
    window: Vec<f32>,
    highpass: Option<CausalFilter>,
    filtered: Vec<f64>,
    coarse: Vec<i64>,
    continuous: Vec<f32>,
    generator: Generator,
    sola: Sola,
}

impl Stream {
    pub fn new(converter: Converter, options: StreamOptions) -> Result<Self> {
        options.layout.validate()?;
        if !(0.0..=1.0).contains(&options.index_rate) {
            return Err(Error::invalid("index_rate must be within 0..=1"));
        }
        if let (Some(index), true) = (&converter.index, options.index_rate != 0.0) {
            if index.dim() != converter.version.feature_dim() {
                return Err(Error::invalid("the index was built for a different model version"));
            }
        }
        let layout = options.layout;
        let per_frame = converter.synthesizer.samples_per_frame();
        let frames = layout.window();
        Ok(Stream {
            highpass: options.highpass.then(|| CausalFilter::new(filter::input_highpass())),
            filtered: vec![0.0; layout.block_samples()],
            window: vec![0.0; frames * HOP],
            coarse: vec![0; frames],
            continuous: vec![0.0; frames],
            generator: Generator::new(options.noise),
            sola: Sola::new(layout.crossfade * per_frame, layout.search * per_frame, layout.block * per_frame),
            converter,
            options,
        })
    }

    pub fn options(&self) -> &StreamOptions {
        &self.options
    }

    /// Output sample rate (the model's).
    pub fn sample_rate(&self) -> u32 {
        self.converter.model_rate()
    }

    /// Output samples per call.
    pub fn output_block(&self) -> usize {
        self.options.layout.block * self.converter.synthesizer.samples_per_frame()
    }

    pub fn into_converter(self) -> Converter {
        self.converter
    }

    /// Forgets all audio heard so far, as if the stream had just been created. The noise
    /// generator is not rewound.
    pub fn reset(&mut self) {
        self.window.fill(0.0);
        self.coarse.fill(0);
        self.continuous.fill(0.0);
        if let Some(highpass) = self.highpass.as_mut() {
            highpass.reset();
        }
        self.sola.reset();
    }

    /// Converts one block of 16 kHz mono audio (`layout.block_samples()` samples) and
    /// returns `output_block()` samples at the model's rate.
    pub fn process(&mut self, block: &[f32]) -> Result<Vec<f32>> {
        self.process_traced(block, None)
    }

    /// As [`Stream::process`], also recording the intermediate values.
    pub fn process_traced(&mut self, block: &[f32], mut trace: Option<&mut BlockTrace>) -> Result<Vec<f32>> {
        let layout = self.options.layout;
        let samples = layout.block_samples();
        if block.len() != samples {
            return Err(Error::invalid(format!("a streaming block must be {samples} samples")));
        }
        if block.iter().any(|sample| !sample.is_finite()) {
            return Err(Error::invalid("input contains non-finite samples"));
        }
        let length = self.window.len();
        self.window.copy_within(samples.., 0);
        match self.highpass.as_mut() {
            Some(highpass) => {
                for (slot, &sample) in self.filtered.iter_mut().zip(block) {
                    *slot = sample as f64;
                }
                highpass.process(&mut self.filtered);
                for (slot, &sample) in self.window[length - samples..].iter_mut().zip(&self.filtered) {
                    *slot = sample as f32;
                }
            }
            None => self.window[length - samples..].copy_from_slice(block),
        }

        let converter = &mut self.converter;
        let dim = converter.version.feature_dim();
        let mut features = converter.features.extract(&self.window, converter.version)?;
        if let Some(trace) = trace.as_deref_mut() {
            trace.window = self.window.clone();
            trace.features = features.clone();
        }
        let last = features[features.len() - dim..].to_vec();
        features.extend_from_slice(&last);
        if let (Some(index), true) = (&converter.index, self.options.index_rate != 0.0) {
            let first = (layout.skip_head() / 2 * dim).min(features.len());
            index.blend(&mut features[first..], self.options.index_rate)?;
        }

        // 50 fps to 100 fps by repeating every frame, cut to the window.
        let frames = layout.window();
        if features.len() / dim * 2 < frames {
            return Err(Error::Backend("the feature extractor returned too few frames".into()));
        }
        let features: Vec<f32> = (0..frames).flat_map(|frame| features[frame / 2 * dim..(frame / 2 + 1) * dim].iter().copied()).collect();

        let tracks = if converter.synthesizer.uses_pitch() {
            let raw = converter.pitch.estimate(&self.window[length - layout.pitch_samples()..])?;
            let pitch = f0::prepare_pitch(raw.clone(), self.options.transpose as f64);
            let fresh = pitch.coarse.len().saturating_sub(PITCH_HEAD + PITCH_TAIL).min(frames);
            let shift = layout.block.min(frames);
            self.coarse.copy_within(shift.., 0);
            self.continuous.copy_within(shift.., 0);
            let range = PITCH_HEAD..PITCH_HEAD + fresh;
            self.coarse[frames - fresh..].copy_from_slice(&pitch.coarse[range.clone()]);
            self.continuous[frames - fresh..].copy_from_slice(&pitch.continuous[range]);
            if let Some(trace) = trace.as_deref_mut() {
                trace.f0 = raw;
                trace.coarse = self.coarse.clone();
                trace.continuous = self.continuous.clone();
            }
            Some((&self.coarse[..], &self.continuous[..]))
        } else {
            None
        };

        let synthesized = converter.synthesizer.synthesize_window(&features, tracks, self.options.speaker, &mut self.generator, layout.skip_head(), layout.return_length())?;
        let (output, offset) = self.sola.join(&synthesized);
        if let Some(trace) = trace {
            trace.synthesizer_features = features;
            trace.synthesized = synthesized;
            trace.offset = offset;
        }
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_layout_matches_the_reference_window() {
        let layout = Layout::default();
        assert_eq!(layout.window() * HOP, 44_960);
        assert_eq!(layout.skip_head(), 250);
        assert_eq!(layout.return_length(), 31);
        // 4000 + 800 rounded up to 5120, minus one hop.
        assert_eq!(layout.pitch_samples(), 4_960);
        assert!((layout.latency() - 0.31).abs() < 1e-12);
        let long = Layout { block: 50, ..layout };
        assert_eq!(long.pitch_samples(), 10_080);
        // Never more than the window.
        let short = Layout { block: 4, crossfade: 1, search: 0, extra: 2 };
        assert!(Layout { crossfade: 30, ..layout }.validate().is_err());
        assert_eq!(short.pitch_samples(), 7 * HOP);
        assert!(short.validate().is_ok());
        assert!(Layout { block: 0, ..layout }.validate().is_err());
        assert!(Layout { block: 1, crossfade: 1, search: 0, extra: 0 }.validate().is_err());
    }

    #[test]
    fn fade_curves_are_complementary_and_end_at_the_extremes() {
        let sola = Sola::new(5, 0, 10);
        assert_eq!(sola.fade_in[0], 0.0);
        assert!((sola.fade_in[4] - 1.0).abs() < 1e-7);
        assert!((sola.fade_in[2] - 0.5).abs() < 1e-7);
    }

    #[test]
    fn crossfade_finds_the_shift_that_continues_the_tail() {
        // A 0.05-cycle-per-sample sine split into blocks whose synthesizer output starts a
        // little early: the join has to skip those samples to stay in phase.
        let (crossfade, search, block) = (40, 20, 100);
        let wave = |n: usize| (2.0 * std::f32::consts::PI * 0.05 * n as f32).sin();
        let mut sola = Sola::new(crossfade, search, block);
        let mut joined = Vec::new();
        let mut position = 0;
        for (number, early) in [0usize, 7, 3, 11, 0].into_iter().enumerate() {
            let start = position - early.min(position);
            let audio: Vec<f32> = (start..start + sola.input_len()).map(wave).collect();
            let (output, offset) = sola.join(&audio);
            if number > 0 {
                // The phase repeats every 20 samples, so the search can also land one period on.
                assert_eq!((offset as isize - early as isize).rem_euclid(20), 0, "block {number}");
            }
            joined.extend(output);
            position += block;
        }
        // After the first block the joined signal is the continuous sine (up to one period).
        let largest_step = joined[block..].windows(2).map(|pair| (pair[1] - pair[0]).abs()).fold(0.0, f32::max);
        assert!(largest_step < 0.32, "{largest_step}");
    }

    #[test]
    fn crossfade_mixes_the_tail_into_the_start_of_the_block() {
        let mut sola = Sola::new(4, 0, 6);
        sola.join(&[0.0; 10]);
        sola.tail.fill(1.0);
        let (output, offset) = sola.join(&[0.0; 10]);
        assert_eq!(offset, 0);
        let expected: Vec<f32> = sola.fade_in.iter().map(|fade| 1.0 - fade).chain([0.0, 0.0]).collect();
        assert_eq!(output, expected);
    }
}
