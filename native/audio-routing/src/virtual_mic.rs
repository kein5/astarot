//! The virtual microphone check on Windows (#321).
//!
//! Port of `src-python/models/audio_routing/virtual_mic.py`. VRChat hears TTS and the
//! converted voice only through a virtual cable: VRCT-VOX plays into the cable's playback
//! end (such as "CABLE Input") and VRChat records its other end ("CABLE Output"). This
//! module pairs such ends and checks one pair: it plays a short test tone into the
//! playback end and measures the level that comes out of the recording end.
//!
//! Only the generated tone is played. What is recorded is reduced to a level on the spot
//! and never kept, logged or sent. Nothing here changes a saved device choice.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::{Error, Result};
use crate::naming::{device_name, is_virtual_cable, same_virtual_cable};
use crate::router::{Output, PlaybackToken};
use crate::sync::{lock, Event, Worker};

/// The tone: two short notes at -12 dBFS, loud enough to read clearly through a cable
/// and quiet enough not to startle anyone who already hears the cable in VRChat.
pub const TONE_RATE: u32 = 48000;
pub const TONE_AMPLITUDE: f64 = 0.25;
pub const TONE_NOTES: [(f64, f64); 2] = [(660.0, 0.35), (880.0, 0.45)];
/// A cable passes the tone at about its own level. Anything quieter did not arrive.
pub const HEARD_DBFS: f64 = -30.0;
/// The meter's scale. Below the floor it shows nothing.
pub const METER_FLOOR_DBFS: f64 = -60.0;
pub const BLOCK_SECONDS: f64 = 0.05;
/// Keep listening a little after the tone, for the cable's own buffering.
pub const TAIL_SECONDS: f64 = 0.4;

/// Loops that count as a cable for feedback protection but are not offered as VRChat's
/// microphone: Steam's belongs to Remote Play, and almost every VRChat user has it.
const NOT_OFFERED: [&str; 1] = ["steam streaming"];

/// The two ends of one virtual cable, as device identities, with their names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CablePair {
    pub playback: String,
    pub recording: String,
    pub playback_label: String,
    pub recording_label: String,
}

/// What a check found.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckOutcome {
    pub heard: bool,
    /// The loudest block in dBFS, one decimal; `None` when nothing but silence came.
    pub peak_dbfs: Option<f64>,
    /// The user stopped or muted the voice during the check.
    pub stopped: bool,
}

/// The recording end, read in blocks of 16-bit PCM. Closed when dropped.
pub trait LevelInput: Send {
    /// About [`BLOCK_SECONDS`] of audio; may be shorter or empty.
    fn read(&mut self) -> Vec<u8>;
}

/// The devices a check uses. The real ones are WASAPI ([`crate::platform`]); tests pass
/// their own.
pub trait CableDevices: Send + Sync {
    /// The cables on this computer. `Err` when the device list cannot be read.
    fn find_cables(&self) -> Result<Vec<CablePair>>;
    /// The playback end, at [`TONE_RATE`] mono.
    fn open_output(&self, identity: &str) -> Result<Box<dyn Output>>;
    fn open_input(&self, identity: &str) -> Result<Box<dyn LevelInput>>;
}

fn offered(identity: &str) -> bool {
    is_virtual_cable(identity) && !NOT_OFFERED.iter().any(|word| device_name(identity).to_lowercase().contains(word))
}

/// Playback and recording ends of the same virtual cable. Each playback end is matched
/// with the first recording end of the same driver; ends without their other half are
/// left out.
pub fn pair_cables(outputs: &[String], inputs: &[String]) -> Vec<CablePair> {
    outputs
        .iter()
        .filter(|output| offered(output))
        .filter_map(|output| {
            let recording = inputs.iter().find(|input| is_virtual_cable(input) && same_virtual_cable(output, input))?;
            Some(CablePair { playback: output.clone(), recording: recording.clone(), playback_label: device_name(output), recording_label: device_name(recording) })
        })
        .collect()
}

/// The test tone as mono 16-bit little-endian PCM, with short fades so it does not click
/// (numpy's float-to-int16 cast cuts toward zero, as here).
pub fn tone(rate: u32) -> Vec<u8> {
    let mut pcm = Vec::new();
    for (frequency, seconds) in TONE_NOTES {
        let count = (f64::from(rate) * seconds) as usize;
        let fade = (count / 2).min((f64::from(rate) * 0.02) as usize);
        for i in 0..count {
            let t = i as f64 / f64::from(rate);
            let note = (2.0 * std::f64::consts::PI * frequency * t).sin();
            let envelope = if i < fade {
                linspace(0.0, 1.0, fade, i)
            } else if i >= count - fade {
                linspace(1.0, 0.0, fade, i - (count - fade))
            } else {
                1.0
            };
            let sample = (note * envelope * TONE_AMPLITUDE * 32767.0) as i16;
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
    }
    pcm
}

/// `numpy.linspace(start, stop, count)[index]`.
fn linspace(start: f64, stop: f64, count: usize, index: usize) -> f64 {
    if count <= 1 {
        return start;
    }
    start + (stop - start) * index as f64 / (count - 1) as f64
}

/// The peak of 16-bit PCM in dBFS; silence is minus infinity.
pub fn peak_dbfs(pcm: &[u8]) -> f64 {
    let peak = pcm.as_chunks::<2>().0.iter().map(|b| i32::from(i16::from_le_bytes(*b)).abs()).max().unwrap_or(0);
    if peak == 0 { f64::NEG_INFINITY } else { 20.0 * (f64::from(peak) / 32768.0).log10() }
}

/// A level for the meter, from 0 (at or below the floor) to 1 (full scale), 3 decimals.
pub fn meter(dbfs: f64) -> f64 {
    if dbfs == f64::NEG_INFINITY || dbfs <= METER_FLOOR_DBFS {
        return 0.0;
    }
    round(f64::min(1.0, (dbfs - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS), 3)
}

fn round(value: f64, digits: usize) -> f64 {
    format!("{value:.digits$}").parse().unwrap_or(value)
}

/// The cancellation the output checks while it writes: the stop of the check.
struct StopToken(Arc<Event>);

impl PlaybackToken for StopToken {
    fn check(&self) -> Result<()> {
        if self.0.is_set() { Err(Error::speech("cancelled")) } else { Ok(()) }
    }
    fn is_set(&self) -> bool {
        self.0.is_set()
    }
    fn wait(&self, timeout: Duration) -> bool {
        self.0.wait(timeout)
    }
    fn begin_playback(&self) -> Result<()> {
        self.check()
    }
}

/// Play the tone into `pair.playback` and measure what comes out of `pair.recording`.
///
/// `report` gets the meter level of each block, then 0 at the end. Setting `stop` ends
/// the tone and the check at once (the user stopped or muted the voice). A device that
/// cannot be opened is `virtual_mic_recording_unavailable` or
/// `virtual_mic_playback_unavailable`.
pub fn run_check(pair: &CablePair, report: &mut dyn FnMut(f64), stop: &Arc<Event>, devices: &dyn CableDevices) -> Result<CheckOutcome> {
    let mut source = devices.open_input(&pair.recording).map_err(|_| Error::runtime("virtual_mic_recording_unavailable"))?;
    let mut sink = devices.open_output(&pair.playback).map_err(|_| Error::runtime("virtual_mic_playback_unavailable"))?;
    let pcm = tone(TONE_RATE);
    let failed = Arc::new(Mutex::new(false));
    let (player_stop, player_failed) = (stop.clone(), failed.clone());
    let player = Worker::spawn("astarot-virtual-mic-tone", move || {
        let token = StopToken(player_stop.clone());
        let step = (f64::from(TONE_RATE) * BLOCK_SECONDS) as usize * 2;
        for block in pcm.chunks(step) {
            if player_stop.is_set() {
                break;
            }
            if sink.write(block, &token).is_err() {
                // A cancel, or the device went away.
                if !player_stop.is_set() {
                    *lock(&player_failed) = true;
                }
                break;
            }
        }
        let _ = sink.close(!player_stop.is_set(), &token);
    })
    .map_err(|_| Error::runtime("virtual_mic_playback_unavailable"))?;
    let total: f64 = TONE_NOTES.iter().map(|(_, seconds)| seconds).sum::<f64>() + TAIL_SECONDS;
    let blocks = (total / BLOCK_SECONDS) as usize;
    let mut loudest = f64::NEG_INFINITY;
    for _ in 0..blocks {
        if stop.is_set() {
            break;
        }
        let level = peak_dbfs(&source.read());
        loudest = loudest.max(level);
        report(meter(level));
    }
    player.join(Duration::from_secs(2));
    report(0.0);
    drop(source);
    if *lock(&failed) {
        return Err(Error::runtime("virtual_mic_playback_unavailable"));
    }
    let stopped = stop.is_set();
    Ok(CheckOutcome { heard: !stopped && loudest >= HEARD_DBFS, peak_dbfs: (loudest != f64::NEG_INFINITY).then(|| round(loudest, 1)), stopped })
}

/// One check at a time, stoppable from the stop and mute requests.
#[derive(Default)]
pub struct VirtualMicCheck {
    stop: Mutex<Option<Arc<Event>>>,
}

impl VirtualMicCheck {
    pub fn new() -> Self {
        Self::default()
    }

    /// End a running check at once. Nothing happens when none runs.
    pub fn stop(&self) {
        if let Some(stop) = lock(&self.stop).as_ref() {
            stop.set();
        }
    }

    /// `virtual_mic_check_busy` while another check runs.
    pub fn run(&self, pair: &CablePair, report: &mut dyn FnMut(f64), devices: &dyn CableDevices) -> Result<CheckOutcome> {
        let stop = {
            let mut current = lock(&self.stop);
            if current.is_some() {
                return Err(Error::runtime("virtual_mic_check_busy"));
            }
            let stop = Arc::new(Event::new());
            *current = Some(stop.clone());
            stop
        };
        struct Clear<'a>(&'a Mutex<Option<Arc<Event>>>);
        impl Drop for Clear<'_> {
            fn drop(&mut self) {
                *lock(self.0) = None;
            }
        }
        let _clear = Clear(&self.stop);
        run_check(pair, report, &stop, devices)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::naming::output_identity;

    fn id(name: &str) -> String {
        output_identity("Windows WASAPI", name)
    }

    #[test]
    fn pairs_the_two_ends_of_each_cable_and_leaves_out_steam() {
        let outputs = [id("Speakers (Realtek Audio)"), id("CABLE Input (VB-Audio Virtual Cable)"), id("Speakers (Steam Streaming Speakers)")];
        let inputs = [id("Microphone (Realtek Audio)"), id("CABLE Output (VB-Audio Virtual Cable)"), id("Microphone (Steam Streaming Microphone)")];
        let pairs = pair_cables(&outputs, &inputs);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].playback_label, "CABLE Input (VB-Audio Virtual Cable)");
        assert_eq!(pairs[0].recording, inputs[1]);
    }

    #[test]
    fn the_tone_matches_the_python_samples() {
        let pcm = tone(TONE_RATE);
        assert_eq!(pcm.len(), (16800 + 21600) * 2);
        let sample = |i: usize| i16::from_le_bytes([pcm[2 * i], pcm[2 * i + 1]]);
        assert_eq!(sample(0), 0, "faded in");
        // numpy: int16(sin(2*pi*660*1000/48000) * 0.25 * 32767) in the middle of the note.
        let expected = ((2.0 * std::f64::consts::PI * 660.0 * 1000.0 / 48000.0).sin() * 0.25 * 32767.0) as i16;
        assert_eq!(sample(1000), expected);
        assert_eq!(sample(16799), 0, "faded out");
    }

    #[test]
    fn levels_and_meter() {
        assert_eq!(peak_dbfs(&[]), f64::NEG_INFINITY);
        assert_eq!(peak_dbfs(&[0, 0, 0, 0]), f64::NEG_INFINITY);
        let full = i16::MIN.to_le_bytes();
        assert_eq!(peak_dbfs(&full), 0.0);
        assert_eq!(meter(f64::NEG_INFINITY), 0.0);
        assert_eq!(meter(-60.0), 0.0);
        assert_eq!(meter(-12.0), 0.8);
        assert_eq!(meter(0.0), 1.0);
    }
}
