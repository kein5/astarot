//! Streaming conformance (specification sections 9.3, 12 and 13).
//!
//! The `window_*` and `stream_*` fixtures come from `reference/dump_streaming.py`, which
//! runs the reference's real-time engine block by block. Without them the tests report
//! themselves as skipped; `RVC_REQUIRE_REFERENCE=1` turns a missing fixture into a
//! failure. Measured values are printed (`--nocapture`) as `METRIC` lines, numbers only.
mod common;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use common::{case, case_json, log_spectral_distance, npy, relative_error};
use astarot_rvc_runtime::noise::Generator;
use astarot_rvc_runtime::stream::BlockTrace;
use astarot_rvc_runtime::{Converter, Device, FeatureExtractor, FeatureIndex, Layout, NoiseMode, Options, Rmvpe, Stream, StreamOptions, Synthesizer, VoiceModel};

fn serial() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn snr_db(found: &[f32], expected: &[f32]) -> f64 {
    -20.0 * relative_error(found, expected).log10()
}

fn converter(model_path: &Path, index: Option<&str>) -> Converter {
    let root = common::reference_dir();
    let model = VoiceModel::load(model_path).unwrap();
    Converter {
        features: FeatureExtractor::load(&root.join("assets/hubert_base/hubert.onnx"), Device::Cpu).unwrap(),
        pitch: Box::new(Rmvpe::load(&root.join("assets/rmvpe/rmvpe.onnx"), Device::Cpu).unwrap()),
        synthesizer: Synthesizer::new(&model, Device::Cpu).unwrap(),
        index: index.map(|path| FeatureIndex::load(Path::new(path)).unwrap()),
        version: model.version,
    }
}

const WINDOW_CASES: [&str; 8] = [
    "window_saisho_48k_10",
    "window_saisho_48k_300",
    "window_pretrained_40k_10",
    "window_pretrained_40k_300",
    "window_random_v1_f0_40k_10",
    "window_random_v1_f0_40k_300",
    "window_random_v2_nof0_48k_10",
    "window_random_v2_nof0_48k_300",
];

#[test]
fn synthesizer_window_matches_the_reference() {
    let _guard = serial();
    for name in WINDOW_CASES {
        let Some(folder) = case(name) else { continue };
        let json = case_json(&folder);
        let source = common::reference_dir().join("fixtures").join(json["source"].as_str().unwrap());
        let model = VoiceModel::load(Path::new(json["model"].as_str().unwrap())).unwrap();
        let mut synthesizer = Synthesizer::new(&model, Device::Cpu).unwrap();
        let features = npy(&source.join("synth_feats_0.npy")).f32();
        let tracks = model.f0.then(|| (npy(&source.join("synth_pitch_0.npy")).i64(), npy(&source.join("synth_pitchf_0.npy")).f32()));
        let (skip_head, return_length) = (json["skip_head"].as_u64().unwrap() as usize, json["return_length"].as_u64().unwrap() as usize);
        let found = synthesizer
            .synthesize_window(&features, tracks.as_ref().map(|(c, h)| (&c[..], &h[..])), json["sid"].as_u64().unwrap() as usize, &mut Generator::new(NoiseMode::Zero), skip_head, return_length)
            .unwrap();
        let expected = npy(&folder.join("audio.npy")).f32();
        let snr = snr_db(&found, &expected);
        println!("METRIC window {name}: {return_length} frames after {skip_head}, SNR {snr:.1} dB");
        assert!(snr > 60.0, "{name}: SNR {snr:.1} dB");
    }
}

const STREAM_CASES: [&str; 3] = ["stream_saisho_48k", "stream_pretrained_40k", "stream_random_v2_nof0_48k"];

fn stream_options(json: &serde_json::Value) -> StreamOptions {
    let layout = &json["layout"];
    let frames = |key: &str| layout[key].as_u64().unwrap() as usize;
    StreamOptions {
        transpose: json["transpose"].as_i64().unwrap() as i32,
        index_rate: json["index_rate"].as_f64().unwrap() as f32,
        speaker: 0,
        noise: NoiseMode::Zero,
        layout: Layout { block: frames("block"), crossfade: frames("crossfade"), search: frames("search"), extra: frames("extra") },
        // The reference's real-time path has no input filter.
        highpass: false,
    }
}

#[test]
fn streaming_matches_the_reference_block_by_block() {
    let _guard = serial();
    for name in STREAM_CASES {
        let Some(folder) = case(name) else { continue };
        let json = case_json(&folder);
        let array = |kind: &str, block: usize| npy(&folder.join(format!("{kind}_{block}.npy")));
        let options = stream_options(&json);
        let layout = options.layout;
        let mut stream = Stream::new(converter(Path::new(json["model"].as_str().unwrap()), json["index"].as_str()), options).unwrap();
        let input = npy(&folder.join("input_16k.npy")).f32();
        let blocks = json["blocks"].as_u64().unwrap() as usize;
        let f0 = json["f0"].as_u64().unwrap() == 1;
        let (mut feature_error, mut synth_feature_error, mut coarse_differ, mut coarse_far, mut pitch_frames) = (0.0f64, 0.0f64, 0, 0, 0);
        let (mut worst_snr, mut worst_reference_input_snr, mut cents) = (f64::INFINITY, f64::INFINITY, Vec::new());
        // A second synthesizer fed the reference's own inputs isolates the synthesizer.
        let model = VoiceModel::load(Path::new(json["model"].as_str().unwrap())).unwrap();
        let mut synthesizer = Synthesizer::new(&model, Device::Cpu).unwrap();
        for block in 0..blocks {
            let mut trace = BlockTrace::default();
            stream.process_traced(&input[block * layout.block_samples()..(block + 1) * layout.block_samples()], Some(&mut trace)).unwrap();
            assert_eq!(trace.window, array("window", block).f32(), "{name} block {block}: window");
            feature_error = feature_error.max(relative_error(&trace.features, &array("hubert", block).f32()));
            let expected_features = array("synth_feats", block).f32();
            synth_feature_error = synth_feature_error.max(relative_error(&trace.synthesizer_features, &expected_features));
            let expected_audio = array("output", block).f32();
            worst_snr = worst_snr.min(snr_db(&trace.synthesized, &expected_audio));
            let reference_tracks = f0.then(|| (array("synth_pitch", block).i64(), array("synth_pitchf", block).f32()));
            if let Some((coarse, continuous)) = &reference_tracks {
                for (frame, (&ours, &theirs)) in trace.coarse.iter().zip(coarse).enumerate() {
                    if ours != theirs {
                        coarse_differ += 1;
                        if (ours - theirs).abs() > 1 {
                            coarse_far += 1;
                        }
                    }
                    if continuous[frame] > 0.0 && trace.continuous[frame] > 0.0 {
                        cents.push((1200.0 * (trace.continuous[frame] as f64 / continuous[frame] as f64).log2()).abs());
                    }
                }
                pitch_frames += coarse.len();
            }
            let from_reference = synthesizer
                .synthesize_window(&expected_features, reference_tracks.as_ref().map(|(c, h)| (&c[..], &h[..])), 0, &mut Generator::new(NoiseMode::Zero), layout.skip_head(), layout.return_length())
                .unwrap();
            worst_reference_input_snr = worst_reference_input_snr.min(snr_db(&from_reference, &expected_audio));
        }
        println!("METRIC stream {name}: {blocks} blocks; features relative error max {feature_error:.2e}, synthesizer input features {synth_feature_error:.2e}");
        if f0 {
            let mean = cents.iter().sum::<f64>() / cents.len().max(1) as f64;
            let max = cents.iter().copied().fold(0.0, f64::max);
            println!("METRIC stream {name}: pitch history {coarse_differ} of {pitch_frames} quantised frames differ, {coarse_far} by more than one step; cents error mean {mean:.4} max {max:.3}");
            assert_eq!(coarse_far, 0, "{name}: quantised pitch differs by more than one step");
            assert!((coarse_differ as f64) < 0.01 * pitch_frames as f64, "{name}: {coarse_differ} quantised frames differ");
        }
        println!("METRIC stream {name}: synthesizer output SNR, worst block {worst_snr:.1} dB; with the reference's synthesizer inputs {worst_reference_input_snr:.1} dB");
        assert!(feature_error < 1e-4 && synth_feature_error < 1e-4, "{name}: features differ");
        assert!(worst_reference_input_snr > 60.0, "{name}: synthesizer window differs");
    }
}

/// The streaming output against offline conversion of the same input: how much the block
/// processing, the causal input filter and the crossfade change (specification 12, 13).
///
/// Log-spectral distance between two renderings is dominated by the quiet parts of the
/// spectrum, so the number is read against the reference's own real-time output (its
/// per-block synthesizer output, joined with the same crossfade) compared the same way.
#[test]
fn streaming_stays_close_to_offline_conversion() {
    let _guard = serial();
    let Some(folder) = case("stream_saisho_48k") else { return };
    let json = case_json(&folder);
    let input = npy(&folder.join("input_16k.npy")).f32();
    let model_path = Path::new(json["model"].as_str().unwrap());
    let mut offline = converter(model_path, json["index"].as_str());
    // The real-time reference has no protect; switch it off offline too.
    let reference = offline.convert(&input, &Options { noise: NoiseMode::Zero, protect: 0.5, ..Options::default() }).unwrap().samples;
    let per_frame = offline.synthesizer.samples_per_frame();
    let recorded = stream_options(&json).layout;
    let blocks = json["blocks"].as_u64().unwrap() as usize;
    // Compare over what the recorded reference stream covers, leaving out the first second
    // (every stream starts from silence) and the delay.
    let delay = |layout: &Layout| (layout.crossfade + layout.search) * per_frame;
    let end = blocks * recorded.block * per_frame - delay(&recorded);
    let start = 100 * per_frame;
    let distance = |output: &[f32], layout: &Layout| log_spectral_distance(&output[delay(layout) + start..delay(layout) + end], &reference[start..end]);

    let mut sola = astarot_rvc_runtime::stream::Sola::new(recorded.crossfade * per_frame, recorded.search * per_frame, recorded.block * per_frame);
    let joined: Vec<f32> = (0..blocks).flat_map(|block| sola.join(&npy(&folder.join(format!("output_{block}.npy"))).f32()).0).collect();
    let baseline = distance(&joined, &recorded);
    println!("METRIC stream vs offline: reference real-time output (block {} ms, extra {} ms, no input filter): log-spectral distance {baseline:.2} dB", recorded.block * 10, recorded.extra * 10);

    let mut converter = Some(offline);
    for layout in [recorded, Layout::default(), Layout { block: 50, ..Layout::default() }] {
        for highpass in [false, true] {
            let options = StreamOptions { noise: NoiseMode::Zero, layout, highpass, ..StreamOptions::default() };
            let mut stream = Stream::new(converter.take().unwrap(), options).unwrap();
            // Input, then enough silence to bring out the delayed end.
            let count = (end + delay(&layout)).div_ceil(layout.block * per_frame);
            let mut padded = input.clone();
            padded.resize(padded.len().max(count * layout.block_samples()), 0.0);
            let mut output = Vec::new();
            for block in padded.chunks_exact(layout.block_samples()).take(count) {
                output.extend(stream.process(block).unwrap());
            }
            let found = distance(&output, &layout);
            println!(
                "METRIC stream vs offline: runtime (block {} ms, extra {} ms, input filter {}): log-spectral distance {found:.2} dB",
                layout.block * 10,
                layout.extra * 10,
                if highpass { "causal" } else { "none" }
            );
            assert!(found < baseline + 1.0, "log-spectral distance {found:.2} dB against the reference's {baseline:.2} dB");
            converter = Some(stream.into_converter());
        }
    }
}

/// The causal input filter against the zero-phase one on speech (specification 12: the
/// difference is part of what section 13 verifies). The magnitude responses are the same,
/// but the phase is not: two forward passes of a fifth-order filter at 48 Hz still turn
/// the phase by about a radian at 500 Hz, so the waveforms do not line up (an SNR near
/// 0 dB) while the spectra stay close.
#[test]
fn causal_input_filter_is_close_to_the_zero_phase_one() {
    let _guard = serial();
    let Some(folder) = case("stream_saisho_48k") else { return };
    let input: Vec<f64> = npy(&folder.join("input_16k.npy")).f64();
    let zero_phase: Vec<f32> = astarot_rvc_runtime::filter::filtfilt(&astarot_rvc_runtime::filter::input_highpass(), &input).iter().map(|&x| x as f32).collect();
    let mut causal = input.clone();
    astarot_rvc_runtime::filter::CausalFilter::new(astarot_rvc_runtime::filter::input_highpass()).process(&mut causal);
    let causal: Vec<f32> = causal.iter().map(|&x| x as f32).collect();
    // Past the first 0.1 s, where the causal filter starts from rest.
    let start = 1_600;
    let snr = snr_db(&causal[start..], &zero_phase[start..]);
    let distance = log_spectral_distance(&causal[start..], &zero_phase[start..]);
    println!("METRIC input filter, causal against zero phase: SNR {snr:.1} dB, log-spectral distance {distance:.3} dB");
    assert!(distance < 1.0, "log-spectral distance {distance:.3} dB");
}
