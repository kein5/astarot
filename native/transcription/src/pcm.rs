//! 16-bit PCM: the energy, the mono mix, rate conversion and the file forms the engines take.
//!
//! - [`rms`] is `audioop.rms` over interleaved samples, as the recorder measured each buffer.
//! - [`to_mono`] averages the channels and rounds half to even (`numpy.rint`), as
//!   `processMicData` did before recognition.
//! - [`ratecv`] is `audioop.ratecv` without filtering (`AudioData.get_raw_data(convert_rate=)`),
//!   for the 16 kHz the cloud engines receive.
//! - [`Resampler`] streams the capture to 48 kHz and the realtime feed to 24 kHz (Python used
//!   soxr; this is a windowed sinc of similar band, see the README).
//! - [`wav`] writes the form the engines read.

/// `audioop.rms`: the integer square root of the mean square.
pub fn rms(samples: &[i16]) -> u32 {
    if samples.is_empty() {
        return 0;
    }
    let sum: f64 = samples.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
    (sum / samples.len() as f64).sqrt() as u32
}

/// Samples from little-endian bytes; a last odd byte is dropped.
pub fn samples(bytes: &[u8]) -> Vec<i16> {
    bytes.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect()
}

pub fn bytes(samples: &[i16]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}

/// Round half to even, as `numpy.rint`.
fn rint(value: f64) -> f64 {
    let rounded = value.round();
    if (value - value.trunc()).abs() == 0.5 && rounded % 2.0 != 0.0 { rounded - value.signum() } else { rounded }
}

fn clamp(value: f64) -> i16 {
    value.clamp(-32768.0, 32767.0) as i16
}

/// The mean of the channels of each frame; an incomplete last frame is dropped.
pub fn to_mono(samples: &[i16], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks_exact(channels)
        .map(|frame| clamp(rint(frame.iter().map(|&s| f64::from(s)).sum::<f64>() / channels as f64)))
        .collect()
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// `audioop.ratecv(data, 2, 1, from, to, None)`: linear interpolation of mono samples.
pub fn ratecv(samples: &[i16], from: u32, to: u32) -> Vec<i16> {
    if from == to || from == 0 || to == 0 {
        return samples.to_vec();
    }
    let divisor = gcd(from, to);
    let (inrate, outrate) = (i64::from(from / divisor), i64::from(to / divisor));
    let mut out = Vec::with_capacity(samples.len() * outrate as usize / inrate as usize + 1);
    let (mut previous, mut current) = (0i64, 0i64);
    let mut d = -outrate;
    let mut input = samples.iter();
    loop {
        while d < 0 {
            let Some(&next) = input.next() else { return out };
            previous = current;
            current = i64::from(next);
            d += outrate;
        }
        while d >= 0 {
            let value = (previous * d + current * (outrate - d)) as f64 / outrate as f64;
            out.push(clamp(value.trunc()));
            d -= inrate;
        }
    }
}

/// A RIFF WAVE file of 16-bit PCM.
pub fn wav(samples: &[i16], rate: u32, channels: u16) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2 * u32::from(channels)).to_le_bytes());
    out.extend_from_slice(&(2 * channels).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// A streaming windowed-sinc rate converter of mono samples. Output sample `n` is the input at
/// time `n * from / to`; it is produced once the input reaches a few samples past that time.
pub struct Resampler {
    step: f64,
    cutoff: f64,
    half: isize,
    table: Vec<f32>,
    buffer: Vec<f32>,
    position: f64,
    identity: bool,
}

const ZERO_CROSSINGS: f64 = 16.0;
const TABLE_STEPS: f64 = 256.0;

impl Resampler {
    pub fn new(from: u32, to: u32) -> Resampler {
        let identity = from == to;
        let ratio = f64::from(to) / f64::from(from.max(1));
        let cutoff = ratio.min(1.0) * 0.95;
        let half = (ZERO_CROSSINGS / cutoff).ceil() as isize;
        // The kernel sinc(x) * Blackman(x / ZERO_CROSSINGS) for x in [0, ZERO_CROSSINGS].
        let points = (ZERO_CROSSINGS * TABLE_STEPS) as usize + 2;
        let table = (0..points)
            .map(|i| {
                let x = i as f64 / TABLE_STEPS;
                if x >= ZERO_CROSSINGS {
                    return 0.0;
                }
                let sinc = if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
                let w = std::f64::consts::PI * (x / ZERO_CROSSINGS + 1.0);
                let window = 0.42 - 0.5 * w.cos() + 0.08 * (2.0 * w).cos();
                (sinc * window) as f32
            })
            .collect();
        Resampler {
            step: f64::from(from) / f64::from(to.max(1)),
            cutoff,
            half,
            table,
            buffer: Vec::new(),
            position: 0.0,
            identity,
        }
    }

    fn kernel(&self, x: f64) -> f64 {
        let at = x.abs() * TABLE_STEPS;
        let index = at as usize;
        if index + 1 >= self.table.len() {
            return 0.0;
        }
        let fraction = at - index as f64;
        f64::from(self.table[index]) * (1.0 - fraction) + f64::from(self.table[index + 1]) * fraction
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if self.identity {
            return input.to_vec();
        }
        self.buffer.extend_from_slice(input);
        let mut out = Vec::new();
        loop {
            let base = self.position.floor() as isize;
            if base + self.half >= self.buffer.len() as isize {
                break;
            }
            let mut sum = 0.0;
            for k in (base - self.half + 1)..=(base + self.half) {
                if k < 0 {
                    continue;
                }
                sum += f64::from(self.buffer[k as usize]) * self.kernel((self.position - k as f64) * self.cutoff);
            }
            out.push((sum * self.cutoff) as f32);
            self.position += self.step;
        }
        let consumed = (self.position.floor() as isize - self.half).max(0) as usize;
        let consumed = consumed.min(self.buffer.len());
        self.buffer.drain(..consumed);
        self.position -= consumed as f64;
        out
    }

    /// Samples waiting in the history (the converter's delay, in input samples).
    pub fn pending(&self) -> usize {
        self.buffer.len()
    }
}

/// Float samples in [-1, 1) to 16-bit, rounded half to even and clipped.
pub fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples.iter().map(|&s| clamp(rint(f64::from(s) * 32768.0))).collect()
}

pub fn to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| f32::from(s) / 32768.0).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_is_audioops() {
        assert_eq!(rms(&[]), 0);
        assert_eq!(rms(&[3, -4]), 3); // sqrt(12.5) = 3.53 truncated
        assert_eq!(rms(&[1000; 10]), 1000);
    }

    #[test]
    fn the_mono_mix_rounds_half_to_even() {
        assert_eq!(to_mono(&[1, 2, 3, 4, -1, -2], 2), vec![2, 4, -2]);
        assert_eq!(to_mono(&[1, 0, 5], 2), vec![0]);
    }

    #[test]
    fn ratecv_halves_and_keeps_length_ratios() {
        let input: Vec<i16> = (0..48).map(|i| i * 10).collect();
        let out = ratecv(&input, 48000, 16000);
        assert_eq!(out.len(), 16);
        assert_eq!(ratecv(&input, 16000, 16000), input);
    }

    #[test]
    fn a_wav_has_its_header() {
        let file = wav(&[1, 2, 3], 16000, 1);
        assert_eq!(&file[..4], b"RIFF");
        assert_eq!(file.len(), 44 + 6);
        assert_eq!(u32::from_le_bytes(file[24..28].try_into().unwrap()), 16000);
    }

    #[test]
    fn the_resampler_keeps_a_tone_and_its_length() {
        let tone: Vec<f32> = (0..48000).map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48000.0).sin() * 0.5).collect();
        let mut resampler = Resampler::new(48000, 24000);
        let mut out = Vec::new();
        for chunk in tone.chunks(480) {
            out.extend(resampler.process(chunk));
        }
        assert!((out.len() as i64 - 24000).abs() < 40, "{}", out.len());
        let peak = out[2000..20000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.5).abs() < 0.02, "{peak}");
        let mut up = Resampler::new(44100, 48000);
        let produced: usize = (0..100).map(|_| up.process(&[0.0; 441]).len()).sum();
        assert!((produced as i64 - 48000).abs() < 40, "{produced}");
    }
}
