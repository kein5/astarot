//! Speech to a real WASAPI output. Ignored by default; run on Windows with
//! `VRCT_WASAPI_LIVE_OUTPUT="<output name>" cargo test --test wasapi_live -- --ignored`.
//! A silent virtual device, such as "Speakers (Steam Streaming Microphone)", keeps the
//! test quiet.
#![cfg(windows)]

use vrct_audio_routing::naming::{output_identity, WASAPI_HOST};
use vrct_audio_routing::router::{AudioRouter, CancelToken, Frame};

fn device() -> String {
    let name = std::env::var("VRCT_WASAPI_LIVE_OUTPUT").expect("set VRCT_WASAPI_LIVE_OUTPUT to an output's name");
    output_identity(WASAPI_HOST, &name)
}

/// A quiet 440 Hz tone, mono s16le.
fn tone(seconds: f64, rate: u32) -> Vec<u8> {
    (0..(seconds * rate as f64) as usize)
        .flat_map(|i| (((i as f64 * 440.0 * std::f64::consts::TAU / rate as f64).sin() * 800.0) as i16).to_le_bytes())
        .collect()
}

/// Speech that arrives at once, as a whole synthesis does, plays to the end: the output
/// keeps its buffer ahead of the device instead of failing on its first short write.
#[test]
#[ignore = "needs a Windows output device"]
fn whole_speech_plays_to_the_end() {
    let device = device();
    for rate in [48_000, 24_000] {
        for run in 0..3 {
            let frames = [Ok(Frame { pcm: tone(1.5, rate), sample_rate: rate, channels: 1 })];
            let result = AudioRouter::default().play(frames, &device, &CancelToken::default(), |_, _| {}, None);
            assert!(result.is_ok(), "{rate} Hz, run {run}: {result:?}");
        }
    }
}

/// Speech that arrives in parts with pauses shorter than what is already buffered plays too.
#[test]
#[ignore = "needs a Windows output device"]
fn streamed_speech_with_short_pauses_plays_to_the_end() {
    let device = device();
    let rate = 48_000;
    let parts = (0..6).map(move |i| {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        Ok(Frame { pcm: tone(0.25, rate), sample_rate: rate, channels: 1 })
    });
    let result = AudioRouter::default().play(parts, &device, &CancelToken::default(), |_, _| {}, None);
    assert!(result.is_ok(), "{result:?}");
}

/// Decision 62 (c): speech whose next part comes after the buffer ran dry plays silence there
/// and goes on to the end, instead of ending with `output_underflow`.
#[test]
#[ignore = "needs a Windows output device"]
fn speech_that_runs_dry_goes_on_after_silence() {
    let device = device();
    let rate = 48_000;
    let parts = (0..4).map(move |i| {
        if i > 0 {
            // Longer than the 0.1 s part and the output's buffer: the device runs dry.
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        Ok(Frame { pcm: tone(0.1, rate), sample_rate: rate, channels: 1 })
    });
    let result = AudioRouter::default().play(parts, &device, &CancelToken::default(), |_, _| {}, None);
    assert!(result.is_ok(), "{result:?}");
}
