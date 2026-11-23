# audio-routing

Audio device enumeration, device identity, following the OS default devices, and
voice routing, in Rust (issue #280). Windows uses WASAPI and the MMDevice API; Linux
uses PipeWire through its native client API.

The Rust backend core (`native/core`, #285) uses it for the device lists, the choice
of microphone and speaker, Auto Select and the virtual microphone guide
(`controller/audio_devices.rs`). The table below maps the former Python modules to their Rust equivalents.

## What replaces what

| Python | Rust | Notes |
|---|---|---|
| [`audio_device_identity.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/audio_device_identity.py) | `src/identity.rs` | Same rules: the placeholder has no identity, a saved ID matches only itself, a legacy name migrates only when unique. |
| [`device_manager.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/device_manager.py) | `src/manager.rs`, `src/snapshot.rs` | One snapshot swapped as a whole; the same change flags and callbacks; the same monitor timing (below); Auto Speaker Select through the peak tracker, Auto Microphone Select through the OS default only. |
| [`active_endpoint_tracker.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/active_endpoint_tracker.py) | `src/tracker.rs` | Same 250 ms poll, 3 s window, ×2 ratio held 1 s, silence keeps the choice, meters activated once per endpoint, 2 s stop limit with the restart deferred until cleanup ends. |
| [`audio_routing/audio_router.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/audio_router.py) | `src/router.rs` | Includes the cancellation token with the start deadline (`CancelToken` of [`speechcpp_tts.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/tts/speechcpp_tts.py)). |
| [`audio_routing/monitor_output.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/monitor_output.py) | `src/monitor.rs` | |
| [`audio_routing/mute_state.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/mute_state.py) | `src/mute_state.rs` | Same file and format. |
| [`audio_routing/managed_route.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/managed_route.py) | `src/voice_route.rs` | |
| [`audio_routing/windows_route.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/windows_route.py) | `src/windows_route.rs` | Device access behind a trait, so the queue, stall and mute rules are tested on every OS. |
| [`audio_routing/devices_windows.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/devices_windows.py) | `src/naming.rs` (rules), `src/wasapi/` (devices) | |
| [`audio_routing/devices_pipewire.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/devices_pipewire.py) | `src/pipewire/output.rs`, `src/graph.rs` | A native playback stream instead of `pw-cat`. |
| [`audio_routing/pipewire_graph.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/pipewire_graph.py) | `src/graph_source.rs`, `src/pipewire/observer.rs` | A registry connection with server round trips instead of running `pw-dump`. |
| [`audio_routing/pipewire_graph_pipe.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/pipewire_graph_pipe.py) | `src/pipewire/feed.rs` | Same wire format. |
| [`audio_routing/pipewire_gate.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/pipewire_gate.py) | `src/graph.rs` (`parse_managed`), `src/pipewire/gate.rs` | Still changes mute through `astarot-voice-gate`. |
| [`audio_routing/managed_microphone.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/managed_microphone.py) | `src/pipewire/managed.rs` | The units Python and the core of 0.6.0 wrote are still made byte for byte (`tests/data/managed_units_vrct.json`, Python's output), to tell them apart from the user's. The core now writes them under the ASTAROT names (`tests/data/managed_units_astarot.json`) and retires its old ones (ADR-014, 2.8). |
| [`audio_routing/source_bridge.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/source_bridge.py) | `src/graph.rs` (selection, links), `src/pipewire/bridge.rs` | Still supervises `astarot-source-bridge`. |
| [`audio_routing/gc_guard.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/gc_guard.py) | — | Python's cyclic garbage collector paused playback; Rust has none. |
| [`audio_routing/virtual_mic.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/virtual_mic.py) | `src/virtual_mic.rs`, `src/platform.rs` | The recording end is read as 48 kHz mono converted by WASAPI, not in its own format through PortAudio. |
| The device choice in [`controller.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/controller.py) (`_selectedAudioDevice`, `_audioTarget`, the host of `_publishAudioDeviceLocked`) | `src/selection.rs` | Plus moving choices saved under other Windows hosts (`migrate_mic`, `migrate_speaker`). |

Timing kept from Python: the monitoring thread waits for an OS notification for at
most 2 s; without notifications (Linux, or a failed registration) every 2 s timeout
refreshes; with them, a notification refreshes at once and one idle refresh a minute
covers a missed event. A stop wakes the thread at once.

## Differences from the Python implementation

These follow from using the native APIs. The ones marked **needs a decision** are not
settled and are listed again under "Open questions".

- **Windows microphone hosts (needs a decision).** PortAudio listed every microphone
  under each of its hosts (MME, DirectSound, WASAPI, WDM-KS), and the default
  microphone came from MME. WASAPI lists each endpoint once, so the list has only the
  `Windows WASAPI` host. IDs of WASAPI rows are unchanged
  (`mic:Windows WASAPI:<endpoint id>`); a saved selection from another host no longer
  resolves.
- **Windows speaker IDs (needs a decision).** Python's loopback rows carried
  PortAudio's host index, so their IDs read `speaker:<index>:<endpoint id>`. The
  index is fixed at 2 (`PORTAUDIO_WASAPI_INDEX`, MME, DirectSound, WASAPI, WDM-KS
  in PyAudioWPatch builds) so saved IDs keep matching; this has not been checked
  against settings saved on a real PC.
- **Windows outputs saved under another host (needs a decision).** Python kept them
  listed while PortAudio showed them, and opened that host. Here such an entry stays
  listed while one WASAPI output has the same name (allowing for MME's 31-character
  cut), and opens that WASAPI output.
- **Windows rate and channel conversion.** WASAPI converts (`AUTOCONVERTPCM`) instead
  of PortAudio plus soxr and the mono-to-stereo widening.
- **Windows underflow.** The virtual microphone path reports a render buffer that ran
  dry after playback started (`output_underflow`), as PortAudio's
  `exception_on_underflow` did. The stream holds 100 ms and starts only once it is
  full (or at the end, for shorter audio). Starting after the first 10 ms write with a
  60 ms buffer made every message fail on the Steam Streaming devices, whose engine
  takes 30 ms at a time and two blocks right after the start (0.5.0-beta.5; measured
  with `tests/wasapi_live.rs`).
- **Windows direct bridge capture.** The Python bridge borrowed the transcription
  capture ([`capture_windows.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/capture_windows.py), outside this issue); here a small WASAPI capture of
  its own delivers 48 kHz mono.
- **Rows without native IDs on Windows.** Every WASAPI row now has its endpoint ID, so
  rows that Python could only identify by slot get stable IDs.
- **`getOpenedDevice`** (resolving a PortAudio slot for the transcription recorder) is
  not ported: it belongs to the PortAudio recorder, which the speech recognition
  migration (#278) replaces.
- **Linux first list.** Python's manager listed Linux inputs only after the first
  monitoring pass; here the constructor enumerates once on every OS.
- **Linux output buffering.** About 85 ms per stream at any format (the pipe to
  `pw-cat` held 4 KiB, which is 85 ms only at 24 kHz mono). The stream requires
  PipeWire 0.3.49 or later for per-cycle sizing; supported distributions ship 1.0+.
- **Diagnostics.** Messages and codes go to a `Reporter` the host supplies; no device
  payload, text or audio is passed to it.

## Open questions

The questions about the Windows hosts, saved selections, the speaker ID prefix and
the PipeWire dependency are item 4 of "判断が要ること" in
`docs/voice-stack/core-integration.md`, with what the core does meanwhile (WASAPI
only, saved choices from other hosts moved to the same WASAPI device). Still open
here:

1. Whether the C helpers `astarot-voice-gate` and `astarot-source-bridge` should move to Rust
   too. They are outside #280 and already use libpipewire directly.

## Build

Linux needs the `libpipewire-0.3` development files and libclang (for the bindings);
Windows needs nothing beyond the MSVC toolchain. The PipeWire client is the
`pipewire` feature, on by default. Without it (`default-features = false`, as the
core's tests build) Linux lists no devices and plays nothing, and nothing PipeWire is
needed to build.

## Verification

`cargo test` runs the ports of the Python tests (identity, reconciliation and monitor
timing with a substitute clock, tracker hysteresis and meter cache, router and
monitor, managed route, managed microphone provisioning with real files, source bridge
failure cases, graph feed over a real pipe). OS access is behind traits, so these run
on every OS.

On a Linux desktop, `cargo test --test pipewire_live -- --ignored --test-threads=1`
compares the native graph with `pw-dump`, plays silence to a temporary null sink and
checks that its removal is reported, compares the device manager's list with the
graph, and keeps the observation fresh while short-lived streams come and go, as the
gate helper's own do.

The Windows code type-checks with `cargo check --target x86_64-pc-windows-msvc`; it
has not been run on Windows yet.
