//! The HuBERT graph built from the checkpoint (src/hubert.rs) against the graph exported
//! with the stock Transformers model (reference/export_hubert_onnx.py). Skipped until
//! the reference assets exist (see the README).

mod common;

use astarot_rvc_runtime::{Device, FeatureExtractor, Version};

fn relative_error(found: &[f32], wanted: &[f32]) -> f64 {
    let difference: f64 = found.iter().zip(wanted).map(|(a, b)| (*a as f64 - *b as f64).powi(2)).sum();
    let energy: f64 = wanted.iter().map(|b| (*b as f64).powi(2)).sum();
    (difference / energy).sqrt()
}

#[test]
fn graph_built_from_the_checkpoint_matches_the_exported_graph() {
    let folder = common::reference_dir().join("assets").join("hubert_base");
    if !folder.join("hubert.onnx").is_file() || !folder.join("pytorch_model.bin").is_file() {
        if std::env::var_os("RVC_REQUIRE_REFERENCE").is_some() {
            panic!("reference HuBERT assets are missing");
        }
        eprintln!("SKIPPED: reference HuBERT assets are missing (see native/rvc-runtime/README.md)");
        return;
    }
    let mut built = FeatureExtractor::from_checkpoint(&folder, Device::Cpu).unwrap();
    let mut exported = FeatureExtractor::load(&folder.join("hubert.onnx"), Device::Cpu).unwrap();
    // A length the export was not traced with, and one that is not a whole number of frames.
    let mut state = 0x2545_f491_4f6c_dd1du64;
    let audio: Vec<f32> = (0..23_456)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            ((state >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 0.2
        })
        .collect();
    for version in [Version::V2, Version::V1] {
        let found = built.extract(&audio, version).unwrap();
        let wanted = exported.extract(&audio, version).unwrap();
        assert_eq!(found.len(), wanted.len());
        let error = relative_error(&found, &wanted);
        println!("METRIC hubert_from_checkpoint {version:?} relative_error={error:.3e}");
        assert!(error < 1e-4, "{version:?}: {error}");
    }
}

#[test]
fn tiny_checkpoint_matches_the_transformers_model() {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/tiny_hubert");
    let audio = common::npy(&folder.join("audio.npy")).f32();
    let mut built = FeatureExtractor::from_checkpoint(&folder, Device::Cpu).unwrap();
    // The tiny model is 16 wide with a 4-wide projection; the version only picks the output.
    for (name, version) in [("features_v2", Version::V2), ("features_v1", Version::V1)] {
        let wanted = common::npy(&folder.join(format!("{name}.npy")));
        let (_, found) = built.extract_any_width(&audio, version).unwrap();
        assert_eq!(found.len(), wanted.f32().len(), "{name}");
        let error = relative_error(&found, &wanted.f32());
        assert!(error < 1e-5, "{name}: {error}");
    }
}
