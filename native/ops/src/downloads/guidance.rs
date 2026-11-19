//! Measured examples, not minimum requirements or cross-vendor guarantees (`guidance.py`).
//!
//! Memory: speech.cpp v0.9.0 model docs, RTX 2080/Vulkan, 20 Japanese sentences, seed 1.
//! Values are decimal GB. Validation is recorded separately per fixed artifact; no model is
//! executed here. Summary: docs/voice-stack/model-downloads.md.
//!
//! Local translation (core only; Python has no translation entries): the peak working set of
//! `vrct-translate` while translating 30 English→Japanese and 30 Japanese→English sentences on
//! the CPU (Windows 11, ONNX Runtime 1.32.0, 4 threads), the figure of the download notice
//! `translation_nllb_600m`. A model not measured that way stays `unknown`.

use crate::json::{Json, Object};

const RTX_4080_SUPER: &str = "NVIDIA GeForce RTX 4080 SUPER";
const I7_1255U: &str = "Intel Core i7-1255U";
/// NLLB-200 distilled 600M, int8 (PR #687): 1,490,300,928 bytes, about 1.39 GiB.
const NLLB_600M_PEAK: u64 = 1_490_300_928;
/// M2M100 418M, int8 (PR #687), measured the same way: 1,044,295,680 bytes, about 0.97 GiB.
const M2M100_418M_PEAK: u64 = 1_044_295_680;

fn validation(state: &str, scope: Option<&str>, device: Option<&str>, sampled_peak_bytes: Option<u64>) -> Object {
    let mut object = Object::new().with("state", state).with("scope", scope).with("device", device);
    if let Some(peak) = sampled_peak_bytes {
        object.insert("sampled_peak_bytes", peak);
    }
    object
}

fn guidance(tier: &str, reference_memory_bytes: Option<u64>, validation: Object) -> Json {
    Object::new().with("tier", tier).with("reference_memory_bytes", reference_memory_bytes).with("validation", validation).into()
}

/// `{tier, reference_memory_bytes, validation: {state, scope, device[, sampled_peak_bytes]}}`.
pub fn model_guidance(id: &str) -> Json {
    match id {
        "irodori-v41-f16" => guidance("standard", Some(2_300_000_000), validation("passed", Some("tts_native_vulkan"), Some(RTX_4080_SUPER), None)),
        "irodori-v41-q8" => guidance("compact", Some(1_590_000_000), validation("passed", Some("tts_native_vulkan"), Some(RTX_4080_SUPER), Some(1_571_815_424))),
        "qwen3-06b-q8" => guidance("standard", Some(1_330_000_000), validation("passed", Some("tts_native_vulkan"), Some(RTX_4080_SUPER), Some(1_396_703_232))),
        "qwen3-06b-q5" => guidance("compact", Some(990_000_000), validation("passed", Some("tts_native_vulkan"), Some(RTX_4080_SUPER), Some(1_048_576_000))),
        // speech.cpp 0.10.0 model cards (RTX 2080, Vulkan); not yet checked here.
        "irodori-v41-small-f16" => guidance("standard", Some(2_200_000_000), validation("pending", None, None, None)),
        "irodori-v4-large-q8" => guidance("large", Some(4_445_291_151), validation("pending", None, None, None)),
        "rvc-saisho" => guidance("voice", None, validation("passed", Some("rvc_runtime"), None, None)),
        // The translation's catalog id (publish.py), not the CTranslate2 weight's name.
        "nllb-200-distilled-600m-onnx-int8" => {
            guidance("translation", Some(NLLB_600M_PEAK), validation("passed", Some("translation_onnx_cpu"), Some(I7_1255U), Some(NLLB_600M_PEAK)))
        }
        "m2m100-418m-onnx-int8" => {
            guidance("translation", Some(M2M100_418M_PEAK), validation("passed", Some("translation_onnx_cpu"), Some(I7_1255U), Some(M2M100_418M_PEAK)))
        }
        _ => guidance("unknown", None, validation("pending", None, None, None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_published_translation_models_carry_their_measured_cpu_memory() {
        for (id, peak) in [("nllb-200-distilled-600m-onnx-int8", NLLB_600M_PEAK), ("m2m100-418m-onnx-int8", M2M100_418M_PEAK)] {
            let found = model_guidance(id);
            assert_eq!(found.get("tier").and_then(Json::as_str), Some("translation"), "{id}");
            assert_eq!(found.get("reference_memory_bytes").cloned(), Some(Json::from(peak)), "{id}");
            let validation = found.get("validation").unwrap();
            assert_eq!(validation.get("state").and_then(Json::as_str), Some("passed"), "{id}");
            assert_eq!(validation.get("scope").and_then(Json::as_str), Some("translation_onnx_cpu"), "{id}");
            assert_eq!(validation.get("sampled_peak_bytes").cloned(), Some(Json::from(peak)), "{id}");
        }
    }

    #[test]
    fn translation_models_not_measured_have_no_figure() {
        for id in ["nllb-200-distilled-1-3b-onnx-int8", "nllb-200-distilled-600M-ct2-int8"] {
            let found = model_guidance(id);
            assert_eq!(found.get("tier").and_then(Json::as_str), Some("unknown"), "{id}");
            assert_eq!(found.get("reference_memory_bytes"), Some(&Json::Null), "{id}");
        }
    }
}
