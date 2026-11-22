# astarot-talk-ai

The talk AI's connection to a realtime conversation service (#388, [ADR-018](../../docs/adr/adr-018-talk-ai-through-external-services.md)).
The user's voice and pictures go to the service, and its spoken answers come back, as the
OpenAI Realtime events on a WebSocket. OpenAI speaks them, and so does vLLM-Omni's
`/v1/realtime` on the user's own machine. The app runs no conversation model.

This is stage 1 of #388: the crate alone, not connected to the core. The core connects it in
stage 3 (settings, keys, consent); audio and pictures come in stages 4 and 5.

## What it does

| File | What |
|---|---|
| `src/protocol.rs` | The events sent (`session.update`, `input_audio_buffer.append`, `input_audio_buffer.commit`, `response.create`, `response.cancel`, `conversation.item.create` with a JPEG, `conversation.item.delete`, `conversation.item.truncate`) and the events read, by their GA names |
| `src/conversation.rs` | What the conversation is doing, without I/O: opening, listening, answering; how far the app played an answer; where an answer the user cut into is cut |
| `src/connection.rs` | Opening the WebSocket: `wss://` over TLS with the Mozilla roots, through the system proxy; `ws://` only to this PC and the LAN; the key only in `Authorization` |
| `src/talk.rs` | One conversation on a thread of its own: what the app sends, what it hears, and the right to stop it |

Audio is 16-bit PCM, mono, little-endian, at 24 kHz, both ways. Pictures are JPEG; only the
newest stays in the conversation by default (`Options::keep_images`).

## The two services

| | OpenAI | vLLM-Omni (v0.34.0, turn-based) |
|---|---|---|
| URL | `wss://api.openai.com/v1/realtime` | `ws://<host>:<port>/v1/realtime` |
| Model | `?model=` (required) | `?model=` may be left out; a name that is not the served one is refused |
| Key | `Authorization: Bearer` | Optional |
| Turns | Server VAD by default: the service answers and cancels an answer the user cuts into by itself | The app ends each turn (`Talk::end_turn`) |
| Instructions | In the session | Read only from `response.create`, so they go there too |

What was checked of each service's protocol, and where, is in the pull request of stage 1.

## Interrupting an answer

The service makes an answer's audio faster than it plays. When the user cuts in, the app stops
playing it (`Event::StopPlayback`) and the answer's item is cut where the user stopped hearing
it (`conversation.item.truncate` with the milliseconds the app reported through
`Talk::played`), so that the model knows what was said. The cut is never past the audio that
came.

## Privacy

Nothing is logged. Audio, pictures, what was said and the key never go into errors or
updates; failures are fixed codes (`talk_*`), and a service's error keeps only its code. The
key's `Debug` shows `Key(..)`.

## Tests

`cargo test --manifest-path native/talk-ai/Cargo.toml`: the events and the conversation as pure
functions (with proptest for the reading of events), and a conversation through the real
WebSocket with a stand-in for the service on this PC (`tests/fake_service.rs`). No test reaches
a real service: `Network::LoopbackOnly` refuses any other host.
