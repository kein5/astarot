# vrct-voice-conversion

Direct voice and voice conversion for VRCT-VOX in Rust: one direct producer at a time
(the microphone passed through or converted), the owner of the RVC worker process
(`astarot-rvc-worker`, built from `native/rvc-runtime`), and the consent-gated setup of the
runtime that worker loads.

The backend core (`native/core`, `controller/voice`) uses it for `/run/start_direct_voice`,
`/run/stop_direct_voice`, `/get/data/direct_voice_state`, the speech that goes through a
running conversion (ADR-007) and `/get/data/vc_runtime_*`, `/run/*_vc_runtime_setup`. The
Python modules stay until the sidecar is retired.

## What replaces what

| Python | Rust | Notes |
|---|---|---|
| `voice_conversion/direct_voice.py` | `src/direct.rs` | Same rules: one producer, generations that refuse a late start, a failed backend stops the request, never a fallback to the original voice. |
| `voice_conversion/protocol.py` | `src/protocol.rs` | The "VVC1" pipe contract, the same checks of the `ready`, `failed`, `input` and `output` packets. |
| `voice_conversion/process.py`, `rvc_process.py` | `src/process.rs`, `src/worker.rs` | Capture in blocks of the start's `block_ms` (from the Advanced setting `RVC_BLOCK_MS`; by default the RVC worker chooses and says so in `ready`; Python's were 80 ms), the worker's checked answer to the output, late blocks dropped on a device route, speech in place of the microphone, the monitor. |
| `voice_conversion/isolated.py`, `router_worker.py`, `router_protocol.py` | — | Python ran the owner in a router process of its own, away from its garbage collector and global lock. Here it runs on a thread of the app; the worker is still a process. |
| `voice_conversion/runtime_setup.py` (the `native` kind) | `src/runtime.rs`, `src/archive.rs` | The same pinned files, sizes, hashes, steps, resume and version text (a runtime the Python setup installed stays installed). |
| `voice_conversion/runtime_setup.py` (Seed-VC), `seed_process.py` | — | Seed-VC needs Python and ends with it. |
| `models/owned_child.py`, the `rvc-native` mode of `vrct-vc-worker` | `src/child.rs` | Windows: a kill-on-close job. Linux: the kernel ends the worker when the owning thread ends (`PR_SET_PDEATHSIG`), which the helper did before. |

## Differences from the Python implementation

- **No router process.** Mute, the direct-voice suppression and speech reach the owner by
  direct calls instead of control frames on a pipe.
- **Linux capture.** The managed route of a conversion captures through PipeWire, which
  `vrct-audio-routing` does not have yet. Until it does, the core offers the conversion on
  the device route only (Windows); a Linux start fails with `vc_start_failed`.
- **Archives.** Zip files are read with a small reader of their own (stored and deflate,
  ZIP64 sizes), gzip tars with the `tar` crate. Only the named regular files are taken.

## Tests

```sh
cargo test --locked
cargo clippy --locked --all-targets
```

The unit tests cover the pipe contract, the archive reader and the setup's pinned versions.
The core's `tests/voice.rs` drives the owner, direct voice and the setup through the UI's
connection, with a stand-in worker (`fake-rvc-worker`) and devices in memory.
