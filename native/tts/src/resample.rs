//! A streaming windowed-sinc resampler for 16-bit mono PCM.
//!
//! Output sample `n` is centred on input time `n * from / to`, so there is no
//! delay to trim. A Kaiser-windowed sinc low-pass at 95% of the lower Nyquist
//! frequency removes images and aliases. Python used soxr's `HQ` here; this is
//! not bit-identical to it, but has the same length, timing and band.

const ZERO_CROSSINGS: f64 = 16.0;
const ROLLOFF: f64 = 0.95;
const KAISER_BETA: f64 = 8.6;
/// Precompute coefficient tables up to this many phases.
const MAX_TABLE_PHASES: u64 = 4096;

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let half = x / 2.0;
    for k in 1..64 {
        term *= half / k as f64;
        let square = term * term;
        sum += square;
        if square < sum * 1e-17 {
            break;
        }
    }
    sum
}

pub(crate) struct Resampler {
    up: u64,
    down: u64,
    cutoff: f64,
    half_width: f64,
    taps: i64,
    window_norm: f64,
    table: Option<Vec<f64>>,
    /// Input samples from absolute index `base`.
    input: Vec<f64>,
    base: u64,
    received: u64,
    produced: u64,
}

impl Resampler {
    pub(crate) fn new(from: u32, to: u32) -> Self {
        let g = gcd(from as u64, to as u64);
        let (up, down) = (to as u64 / g, from as u64 / g);
        // Cycles per input sample.
        let cutoff = 0.5 * (to as f64 / from as f64).min(1.0) * ROLLOFF;
        let half_width = ZERO_CROSSINGS / (2.0 * cutoff);
        let taps = half_width.ceil() as i64;
        let mut resampler = Self { up, down, cutoff, half_width, taps, window_norm: bessel_i0(KAISER_BETA), table: None, input: Vec::new(), base: 0, received: 0, produced: 0 };
        if up <= MAX_TABLE_PHASES {
            let width = (2 * taps + 2) as usize;
            let mut table = vec![0.0; up as usize * width];
            for phase in 0..up {
                let fraction = phase as f64 / up as f64;
                for (slot, k) in (-taps..=taps + 1).enumerate() {
                    table[phase as usize * width + slot] = resampler.kernel(fraction - k as f64);
                }
            }
            resampler.table = Some(table);
        }
        resampler
    }

    fn kernel(&self, offset: f64) -> f64 {
        if offset.abs() >= self.half_width {
            return 0.0;
        }
        let x = 2.0 * self.cutoff * offset;
        let sinc = if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
        let ratio = offset / self.half_width;
        let window = bessel_i0(KAISER_BETA * (1.0 - ratio * ratio).max(0.0).sqrt()) / self.window_norm;
        2.0 * self.cutoff * sinc * window
    }

    fn sample(&self, index: i64) -> f64 {
        if index < self.base as i64 {
            return 0.0;
        }
        self.input.get((index - self.base as i64) as usize).copied().unwrap_or(0.0)
    }

    fn output(&self, n: u64) -> f64 {
        let position = n * self.down;
        let whole = (position / self.up) as i64;
        let phase = position % self.up;
        let mut sum = 0.0;
        match &self.table {
            Some(table) => {
                let width = (2 * self.taps + 2) as usize;
                let row = &table[phase as usize * width..(phase as usize + 1) * width];
                for (slot, k) in (-self.taps..=self.taps + 1).enumerate() {
                    sum += self.sample(whole + k) * row[slot];
                }
            }
            None => {
                let fraction = phase as f64 / self.up as f64;
                for k in -self.taps..=self.taps + 1 {
                    sum += self.sample(whole + k) * self.kernel(fraction - k as f64);
                }
            }
        }
        sum
    }

    /// How many output samples `count` input samples make in all.
    fn total_for(&self, count: u64) -> u64 {
        (count * self.up).div_ceil(self.down)
    }

    fn emit(&mut self, flushing: bool) -> Vec<i16> {
        let mut out = Vec::new();
        let limit = self.total_for(self.received);
        while self.produced < limit {
            let position = self.produced * self.down;
            let needed = (position / self.up) as i64 + self.taps + 1;
            if !flushing && needed >= self.received as i64 {
                break;
            }
            out.push(self.output(self.produced).round().clamp(i16::MIN as f64, i16::MAX as f64) as i16);
            self.produced += 1;
        }
        // Keep only what later outputs can still reach.
        let next_whole = (self.produced * self.down / self.up) as i64;
        let keep_from = (next_whole - self.taps - 1).max(0) as u64;
        if keep_from > self.base {
            let drop = ((keep_from - self.base) as usize).min(self.input.len());
            self.input.drain(..drop);
            self.base += drop as u64;
        }
        out
    }

    pub(crate) fn process(&mut self, samples: &[i16]) -> Vec<i16> {
        self.input.extend(samples.iter().map(|&s| s as f64));
        self.received += samples.len() as u64;
        self.emit(false)
    }

    pub(crate) fn finish(&mut self) -> Vec<i16> {
        self.emit(true)
    }
}

#[cfg(test)]
mod tests {
    use super::Resampler;

    fn tone(rate: u32, frequency: f64, seconds: f64) -> Vec<i16> {
        (0..(rate as f64 * seconds) as usize).map(|i| ((i as f64 * 2.0 * std::f64::consts::PI * frequency / rate as f64).sin() * 8000.0) as i16).collect()
    }

    fn run(from: u32, to: u32, input: &[i16], block: usize) -> Vec<i16> {
        let mut resampler = Resampler::new(from, to);
        let mut out = Vec::new();
        for chunk in input.chunks(block) {
            out.extend(resampler.process(chunk));
        }
        out.extend(resampler.finish());
        out
    }

    #[test]
    fn length_is_exact_and_independent_of_block_size() {
        for (from, to) in [(24000, 48000), (44100, 48000), (16000, 48000), (96000, 48000), (22050, 48000), (191_999, 48000)] {
            let input = tone(from, 440.0, 0.25);
            let whole = run(from, to, &input, input.len());
            let blocks = run(from, to, &input, 97);
            assert_eq!(whole.len() as u64, (input.len() as u64 * to as u64).div_ceil(from as u64), "{from}");
            assert_eq!(whole, blocks, "{from}");
        }
    }

    #[test]
    fn a_tone_keeps_its_pitch_and_level() {
        let input = tone(24000, 440.0, 1.0);
        let out = run(24000, 48000, &input, 480);
        // Compare against the ideal 48 kHz tone away from the edges.
        let ideal = tone(48000, 440.0, 1.0);
        let error: f64 = out[1000..47000].iter().zip(&ideal[1000..47000]).map(|(a, b)| (*a as f64 - *b as f64).powi(2)).sum::<f64>() / 46000.0;
        let power: f64 = ideal[1000..47000].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / 46000.0;
        assert!(10.0 * (power / error).log10() > 50.0, "SNR too low");
    }

    #[test]
    fn content_above_the_new_nyquist_is_removed() {
        let input = tone(96000, 30000.0, 0.5);
        let out = run(96000, 48000, &input, 960);
        let peak = out[200..out.len() - 200].iter().map(|v| v.unsigned_abs()).max().unwrap();
        assert!(peak < 80, "alias peak {peak}");
    }
}
