//! Measured examples, not minimum requirements or cross-vendor guarantees (`guidance.py`).
//!
//! Memory: speech.cpp v0.9.0 model docs, RTX 2080/Vulkan, 20 Japanese sentences, seed 1.
//! Values are decimal GB. Validation is recorded separately per fixed artifact; no model is
//! executed here. Summary: docs/voice-stack/model-downloads.md.

use crate::json::{Json, Object};

const RTX_4080_SUPER: &str = "NVIDIA GeForce RTX 4080 SUPER";

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
        _ => guidance("unknown", None, validation("pending", None, None, None)),
    }
}
