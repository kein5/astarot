//! Audio in and out of the pipeline: WAV files, sample rate conversion and the output
//! post-processing of specification section 10.

use std::path::Path;

use crate::error::{Error, Result};

/// Reads a WAV file as mono float samples (channels averaged) and its sample rate.
pub fn read_wav(path: &Path) -> Result<(Vec<f32>, u32)> {
    let wav = |error: hound::Error| Error::format("audio file", error);
    let mut reader = hound::WavReader::open(path).map_err(wav)?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<std::result::Result<_, _>>().map_err(wav)?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>().map(|sample| sample.map(|value| value as f32 * scale)).collect::<std::result::Result<_, _>>().map_err(wav)?
        }
    };
    let mono = interleaved.chunks_exact(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32).collect();
    Ok((mono, spec.sample_rate))
}

/// Writes mono samples as 16-bit PCM. `gain` is the factor from float to integer range
/// (see [`peak_gain`]); values are truncated toward zero like the reference file output.
pub fn write_wav(path: &Path, samples: &[f32], sample_rate: u32, gain: f32) -> Result<()> {
    let wav = |error: hound::Error| Error::format("audio file", error);
    let spec = hound::WavSpec { channels: 1, sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut writer = hound::WavWriter::create(path, spec).map_err(wav)?;
    for &sample in samples {
        writer.write_sample((sample * gain).clamp(-32768.0, 32767.0) as i16).map_err(wav)?;
    }
    writer.finalize().map_err(wav)
}

fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term, mut k) = (1.0, 1.0, 1.0);
    while term > sum * 1e-16 {
        term *= (x / (2.0 * k)) * (x / (2.0 * k));
        sum += term;
        k += 1.0;
    }
    sum
}

/// Band-limited sample rate conversion with a Kaiser-windowed sinc (32 zero crossings
/// either side, about 100 dB stop band). The output has `round(len * to / from)` samples.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    const ZERO_CROSSINGS: f64 = 32.0;
    const BETA: f64 = 10.0;
    let ratio = to as f64 / from as f64;
    // Below the lower of the two Nyquist rates, with a little room for the transition band.
    let cutoff = ratio.min(1.0) * 0.97;
    let half_width = ZERO_CROSSINGS / cutoff;
    let window_norm = bessel_i0(BETA);
    let count = (input.len() as f64 * ratio).round() as usize;
    let mut output = Vec::with_capacity(count);
    for n in 0..count {
        let centre = n as f64 / ratio;
        let first = (centre - half_width).ceil().max(0.0) as usize;
        let last = ((centre + half_width).floor() as usize).min(input.len() - 1);
        let mut sum = 0.0f64;
        for (k, &sample) in input.iter().enumerate().take(last + 1).skip(first) {
            let offset = centre - k as f64;
            let x = offset * cutoff;
            let sinc = if x.abs() < 1e-12 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
            let position = offset / half_width;
            let window = bessel_i0(BETA * (1.0 - position * position).max(0.0).sqrt()) / window_norm;
            sum += sample as f64 * sinc * window;
        }
        output.push((sum * cutoff) as f32);
    }
    output
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// The interpolation kernel of [`resample`] at `offset` input samples from the centre.
fn kernel(offset: f64, cutoff: f64, half_width: f64, beta: f64, window_norm: f64) -> f64 {
    if offset.abs() > half_width {
        return 0.0;
    }
    let x = offset * cutoff;
    let sinc = if x.abs() < 1e-12 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
    let position = offset / half_width;
    sinc * bessel_i0(beta * (1.0 - position * position).max(0.0).sqrt()) / window_norm * cutoff
}

/// [`resample`] for a stream that arrives in blocks: the same Kaiser-windowed sinc, made
/// causal by a fixed delay of [`StreamResampler::delay`] input samples, with its history
/// kept between calls. The output does not depend on how the input is split into blocks.
///
/// Output sample `n` is produced once input sample `floor(n * from / to)` has arrived, so a
/// block of `len` samples gives exactly `len * to / from` samples whenever that is whole
/// (for example 3840 at 48 kHz to 1280 at 16 kHz, or 3200 at 40 kHz to 3840 at 48 kHz).
#[derive(Debug, Clone)]
pub struct StreamResampler {
    /// Rates reduced by their common divisor: output `n` sits at input `n * down / up`.
    up: u64,
    down: u64,
    delay: usize,
    /// Per phase `n * down % up`, the weights of input samples `base - reach ..= base + reach`
    /// where `base = n * down / up - delay`.
    weights: Vec<Vec<f32>>,
    reach: usize,
    /// Input received so far, from absolute index `start` on.
    buffer: Vec<f32>,
    start: u64,
    received: u64,
    produced: u64,
}

impl StreamResampler {
    pub fn new(from: u32, to: u32) -> Self {
        const ZERO_CROSSINGS: f64 = 32.0;
        const BETA: f64 = 10.0;
        let divisor = gcd(from as u64, to as u64).max(1);
        let (up, down) = (to as u64 / divisor, from as u64 / divisor);
        let ratio = to as f64 / from as f64;
        let cutoff = ratio.min(1.0) * 0.97;
        let half_width = ZERO_CROSSINGS / cutoff;
        let window_norm = bessel_i0(BETA);
        let reach = half_width.ceil() as usize + 1;
        let delay = if from == to { 0 } else { reach };
        let weights = (0..up)
            .map(|phase| {
                let fraction = phase as f64 / up as f64;
                (0..=2 * reach).map(|j| kernel(fraction + reach as f64 - j as f64, cutoff, half_width, BETA, window_norm) as f32).collect()
            })
            .collect();
        StreamResampler { up, down, delay, weights, reach, buffer: Vec::new(), start: 0, received: 0, produced: 0 }
    }

    /// How many input samples the output lags behind (0 when the rates are equal).
    pub fn delay(&self) -> usize {
        self.delay
    }

    /// Feeds `input` and returns the output samples it completes.
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if self.up == self.down {
            return input.to_vec();
        }
        self.buffer.extend_from_slice(input);
        self.received += input.len() as u64;
        let mut output = Vec::new();
        let reach = self.reach as i64;
        loop {
            let n = self.produced;
            let nominal = n * self.down / self.up;
            if nominal >= self.received {
                break;
            }
            let base = nominal as i64 - self.delay as i64;
            let weights = &self.weights[(n * self.down % self.up) as usize];
            let mut sum = 0.0f32;
            for (j, &weight) in weights.iter().enumerate() {
                let index = base - reach + j as i64;
                // Before the first sample the stream is silent.
                if index >= self.start as i64 {
                    sum += weight * self.buffer[(index - self.start as i64) as usize];
                }
            }
            output.push(sum);
            self.produced += 1;
        }
        // Keep what the next output still reaches back to.
        let next = (self.produced * self.down / self.up) as i64 - self.delay as i64 - reach;
        if next > self.start as i64 {
            let drop = ((next - self.start as i64) as usize).min(self.buffer.len());
            self.buffer.drain(..drop);
            self.start += drop as u64;
        }
        output
    }

    /// Forgets all input, as if newly created.
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.start = 0;
        self.received = 0;
        self.produced = 0;
    }
}

/// Root-mean-square level per half-second frame, frames centred on multiples of the hop
/// with zero padding at the ends: `len / hop + 1` values.
fn rms_envelope(signal: &[f64], sample_rate: u32) -> Vec<f64> {
    let hop = (sample_rate / 2) as usize;
    let frame = hop * 2;
    (0..signal.len() / hop + 1)
        .map(|index| {
            let centre = index * hop;
            let (start, end) = (centre.saturating_sub(hop), (centre + hop).min(signal.len()));
            (signal[start..end].iter().map(|x| x * x).sum::<f64>() / frame as f64).sqrt()
        })
        .collect()
}

/// Stretches an envelope to `count` samples by linear interpolation between frame
/// centres (each output sample sits at the middle of its share of the input).
fn stretch(envelope: &[f64], count: usize) -> Vec<f64> {
    let scale = envelope.len() as f64 / count as f64;
    (0..count)
        .map(|index| {
            let position = ((index as f64 + 0.5) * scale - 0.5).max(0.0);
            let left = (position.floor() as usize).min(envelope.len() - 1);
            let right = (left + 1).min(envelope.len() - 1);
            let fraction = position - left as f64;
            envelope[left] * (1.0 - fraction) + envelope[right] * fraction
        })
        .collect()
}

/// Moves the loudness contour of `output` toward that of `input`:
/// `output *= rms_in^(1 - rate) * rms_out^(rate - 1)`; `rate = 1` leaves it alone.
pub fn rms_mix(input: &[f64], input_rate: u32, output: &mut [f32], output_rate: u32, rate: f32) {
    if output.is_empty() || input.is_empty() {
        return;
    }
    let rms_in = stretch(&rms_envelope(input, input_rate), output.len());
    let as_f64: Vec<f64> = output.iter().map(|&x| x as f64).collect();
    let rms_out = stretch(&rms_envelope(&as_f64, output_rate), output.len());
    let rate = rate as f64;
    for ((sample, level_in), level_out) in output.iter_mut().zip(rms_in).zip(rms_out) {
        let gain = level_in.powf(1.0 - rate) * level_out.max(1e-6).powf(rate - 1.0);
        *sample = (*sample as f64 * gain) as f32;
    }
}

/// The factor that takes float samples to the 16-bit range: 32768, reduced only when the
/// peak would exceed 0.99 of full scale. Divide by 32768 to stay in float.
pub fn peak_gain(samples: &[f32]) -> f32 {
    let peak = samples.iter().fold(0.0f32, |peak, sample| peak.max(sample.abs())) / 0.99;
    if peak > 1.0 {
        32768.0 / peak
    } else {
        32768.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f64, rate: u32, count: usize) -> Vec<f32> {
        (0..count).map(|n| ((2.0 * std::f64::consts::PI * hz * n as f64 / rate as f64).sin() * 0.5) as f32).collect()
    }

    #[test]
    fn resampling_keeps_a_tone_and_its_level() {
        let output = resample(&tone(440.0, 48_000, 48_000), 48_000, 16_000);
        assert_eq!(output.len(), 16_000);
        let expected = tone(440.0, 16_000, 16_000);
        for n in 1000..15_000 {
            assert!((output[n] - expected[n]).abs() < 1e-5, "sample {n}: {} vs {}", output[n], expected[n]);
        }
    }

    #[test]
    fn resampling_removes_what_the_new_rate_cannot_hold() {
        for hz in [8_500.0, 12_000.0, 20_000.0] {
            let output = resample(&tone(hz, 48_000, 48_000), 48_000, 16_000);
            let peak = output[1000..15_000].iter().fold(0.0f32, |peak, sample| peak.max(sample.abs()));
            assert!(peak < 1e-4, "{hz} Hz leaks at {peak}");
        }
    }

    #[test]
    fn stream_resampling_follows_the_tone_after_its_delay() {
        for (from, to, hz) in [(48_000u32, 16_000u32, 440.0), (40_000, 48_000, 1_234.0), (32_000, 48_000, 3_000.0), (48_000, 48_000, 440.0)] {
            let input = tone(hz, from, from as usize);
            let mut resampler = StreamResampler::new(from, to);
            let block = from as usize / 25; // 40 ms
            let output: Vec<f32> = input.chunks(block).flat_map(|chunk| resampler.process(chunk)).collect();
            assert_eq!(output.len(), to as usize, "{from} -> {to}");
            let delay = resampler.delay() as f64 / from as f64;
            for (n, &sample) in output.iter().enumerate().skip(to as usize / 10) {
                let time = n as f64 / to as f64 - delay;
                let expected = ((2.0 * std::f64::consts::PI * hz * time).sin() * 0.5) as f32;
                assert!((sample - expected).abs() < 1e-4, "{from} -> {to}, sample {n}: {sample} vs {expected}");
            }
        }
    }

    #[test]
    fn stream_resampling_does_not_depend_on_the_blocks() {
        let input: Vec<f32> = (0..12_000).map(|n| ((n * 7919 % 1000) as f32 / 1000.0 - 0.5) * 0.3).collect();
        let whole = StreamResampler::new(40_000, 48_000).process(&input);
        let mut resampler = StreamResampler::new(40_000, 48_000);
        let mut pieces = Vec::new();
        let mut rest = &input[..];
        for size in [1usize, 17, 3200, 999, 5].iter().cycle() {
            if rest.is_empty() {
                break;
            }
            let (head, tail) = rest.split_at((*size).min(rest.len()));
            pieces.extend(resampler.process(head));
            rest = tail;
        }
        assert_eq!(whole, pieces);
        // Whole blocks give whole outputs.
        let mut resampler = StreamResampler::new(48_000, 16_000);
        assert_eq!(resampler.process(&[0.0; 3840]).len(), 1280);
        assert_eq!(resampler.process(&[0.0; 3840]).len(), 1280);
    }

    #[test]
    fn peak_gain_only_reduces() {
        assert_eq!(peak_gain(&[0.5, -0.9]), 32768.0);
        let gain = peak_gain(&[0.5, -1.98]);
        assert!((gain - 32768.0 / 2.0).abs() < 1e-2);
    }

    #[test]
    fn full_rate_rms_mix_changes_nothing() {
        let input = vec![0.1f64; 16_000];
        let mut output = vec![0.3f32; 40_000];
        rms_mix(&input, 16_000, &mut output, 40_000, 1.0);
        assert!(output.iter().all(|&x| (x - 0.3).abs() < 1e-7));
    }
}
