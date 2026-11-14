# vrct-tts

Speech synthesis for VRCT-VOX in Rust (issue #279): requests to a local speech.cpp
server, one bounded speech worker, and the hand-off of streamed PCM to an output.
It is the Rust counterpart of `src-python/models/tts/` and keeps its settings format,
error codes, and queueing, interruption and expiry rules.

This crate stands alone. The application does not use it yet: nothing under
`src-tauri` or `src-python` refers to it, and the Python speech path is unchanged.
Wiring it in needs the output devices (#280) and the speech.cpp server owner (#276)
on the Rust side first; see "Not in this crate" below.

## What it does

| Python | Rust | What |
|---|---|---|
| `settings.py` | `src/settings.rs` | `VoiceSettings` (same keys, all strings, unknown keys refused), `local_url`, language tags, `options_for`, `request_for` |
| `model_options.py` | `src/model_options.rs` | `/v1/models` capabilities: exactly one synthesis model, seed range, instructions |
| `speechcpp_tts.py` | `src/client.rs`, `src/cancel.rs`, `src/http.rs` | Health check, model options, `POST /v1/audio/speech` with PCM streaming; `CancelToken` with the start deadline |
| `listener_monitor.py`, `listener_table.py` | `src/listener.rs` | Notices a speech server that went away while its PCM is still being played: process exit for servers this app started, a shared 20 ms probe otherwise (Windows TCP table, then a refused connect) |
| `tts_scheduler.py` | `src/scheduler.rs` | `VoiceEventBus`: capacity, chat before microphone, expiry, generations, stop/mute/enable, speech monitors, request timeout |
| `AudioRouter.play` (in `audio_routing/`) | `src/playback.rs` | The device-independent part: 10 ms blocks, first audible write, monitor copy, drain or discard |
| `converted_router.py` | `src/converted.rs`, `src/resample.rs` | Speech through the running voice conversion (ADR-007): 48 kHz mono, one resampler per stream |
| `message_hook.py` | `src/message_hook.rs` | Chat and microphone speech events from pipeline values |
| `voice_trace.py` | `src/trace.rs` | Opt-in `VRCT_VOICE_TRACE` timing records |

Nothing is logged. Text, instructions, audio, server bodies and device names never go
into errors, status or the trace; failures are short fixed codes.

## Not in this crate

These stay where they are and plug in through traits:

| Need | Trait | Implemented by |
|---|---|---|
| Opening an output device | `playback::OutputFactory`, `playback::OutputSink` | Audio routing (#280): PipeWire, WASAPI, the managed route |
| Speech monitor (a local copy) | `playback::Monitor`, `scheduler::MonitorFactory` | Audio routing (#280): `MonitorTee` |
| The running voice conversion | `converted::ConversionSpeaker` | Voice conversion (`DirectVoice`) |
| A started speech.cpp process | `listener::ProcessExit`, `ListenerMonitors::own`/`forget` | The speech.cpp server owner (#276) |
| Bundled server URL | `scheduler::ResolveServer` | The speech.cpp server owner (#276) |
| Failure reports, flow panel | `BusOptions::on_failure`, `on_first_audio`, `on_monitor_error` | The application core |

External speech engines (VOICEVOX-family, COEIROINK; ADR-008) are a separate Python
path and are not part of this crate.

## Differences from the Python version

- **Resampling for the conversion.** Python used soxr's `HQ` resampler. This crate has
  its own streaming windowed-sinc resampler (Kaiser window, pass band to 95% of the
  lower Nyquist frequency). The output length and timing are the same; the samples are
  not bit-identical.
- **Garbage-collector diagnostics.** Python could record interpreter GC pauses in the
  trace (`VRCT_VOICE_GC_DIAGNOSTICS=1`). Rust has no collector; the `gc_pauses` field is
  written empty so the record keeps its shape.
- **Clock.** Event timestamps use the OS monotonic clock (`CLOCK_MONOTONIC` on Linux, the
  performance counter on Windows). On Linux this is the clock Python's
  `time.monotonic_ns()` reads; on Windows it may differ from the Python version in use, so
  timestamps must not be mixed across the two runtimes there.
- **HTTP.** A small HTTP/1.1 client replaces `http.client`. Each receive waits at most
  20 ms before checking for cancellation, as Python's `InterruptibleSocket` did.
  The request body is UTF-8 JSON (Python escaped non-ASCII as `\uXXXX`); the parsed
  values are the same.
- **Typing.** Inputs that Python checked at run time (`set_enabled(True)`, integer
  generations) are typed in Rust, so those checks belong to the IPC layer that parses
  requests.

## Tests

```sh
cargo test --locked
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

The tests port the Python tests that exercise this module: `tests/voice/test_tts.py`,
`test_scheduler.py`, `test_spoken_scheduler.py`, `test_tts_toggle.py` (the bus and the
health check), `test_tts_model_options.py` (the client and the bus),
`test_tts_listener_failure.py`, `test_tts_playback_ownership.py`,
`test_voice_trace.py`, `test_listener_table_probe.py`, `test_speech_through_conversion.py`
(the router and the bus) and `src-python/test/test_tts_listener_monitor.py`. They run a
fake speech.cpp server on localhost; no model, GPU or audio device is needed.
Controller, IPC and UI tests stay in Python until the speech path is wired in.
