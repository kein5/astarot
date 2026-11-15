"""Measured examples, not minimum requirements or cross-vendor guarantees.

Memory: speech.cpp v0.9.0 model docs, RTX 2080/Vulkan, 20 Japanese sentences,
seed 1 (Irodori reference voice; Qwen ono_anna). Values are decimal GB.
Validation is recorded separately per fixed artifact; no model is executed here.
Summary: docs/voice-stack/model-downloads.md.
Native comparisons use model-native rates (Qwen 24 kHz, Irodori 48 kHz);
physical listening and resampling to the host rate are not covered.
"""
from copy import deepcopy

_GUIDANCE = {
    'irodori-v41-f16': dict(tier='standard', reference_memory_bytes=2300000000,
        validation=dict(state='passed', scope='tts_native_vulkan', device='NVIDIA GeForce RTX 4080 SUPER')),
    'irodori-v41-q8': dict(tier='compact', reference_memory_bytes=1590000000,
        validation=dict(state='passed', scope='tts_native_vulkan', device='NVIDIA GeForce RTX 4080 SUPER', sampled_peak_bytes=1571815424)),
    'qwen3-06b-q8': dict(tier='standard', reference_memory_bytes=1330000000,
        validation=dict(state='passed', scope='tts_native_vulkan', device='NVIDIA GeForce RTX 4080 SUPER', sampled_peak_bytes=1396703232)),
    'qwen3-06b-q5': dict(tier='compact', reference_memory_bytes=990000000,
        validation=dict(state='passed', scope='tts_native_vulkan', device='NVIDIA GeForce RTX 4080 SUPER', sampled_peak_bytes=1048576000)),
    # speech.cpp 0.10.0 model cards (RTX 2080, Vulkan): Irodori Small F16 2.2 GB, Large Q8_0
    # 4.14 GiB. Pending: VRCT-VOX measured them on Windows only, without the memory peak.
    # Qwen3-TTS 1.7B has no RTX 2080 memory figure, so it shows none.
    'irodori-v41-small-f16': dict(tier='standard', reference_memory_bytes=2200000000,
        validation=dict(state='pending', scope=None, device=None)),
    'irodori-v4-large-q8': dict(tier='large', reference_memory_bytes=4445291151,
        validation=dict(state='pending', scope=None, device=None)),
    'rvc-saisho': dict(tier='voice', reference_memory_bytes=None,
        validation=dict(state='passed', scope='rvc_runtime', device=None)),
}


def model_guidance(id):
    return deepcopy(_GUIDANCE.get(id, dict(tier='unknown', reference_memory_bytes=None,
        validation=dict(state='pending', scope=None, device=None))))
