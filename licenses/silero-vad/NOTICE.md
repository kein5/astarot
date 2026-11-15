# Silero VAD model component

VRCT-VOX ships the Silero VAD v5 voice activity detection model, split into an
encoder and a decoder ONNX graph, so that the microphone and speaker
transcription can find speech without a model download. The two files are the
ones faster-whisper 1.1.1 ships, taken unmodified:

| File | Size | SHA-256 |
|---|---|---|
| `silero_encoder_v5.onnx` | 713,415 bytes | `0e9fc8f56407693d283f99045fb95c2b90fdca3433ce5f83e2c121fb4e615075` |
| `silero_decoder_v5.onnx` | 532,505 bytes | `8c20344f509846a07ccd85827e8857017fae67fabd58689bec1af79e1d488307` |

In a build they are in `_internal/models/transcription/silero_vad/`; in the
repository, in `src-python/models/transcription/silero_vad/`.

- The model: [Silero VAD](https://github.com/snakers4/silero-vad), MIT,
  Copyright (c) 2020-present Silero Team; `silero-vad-LICENSE` (from tag
  v5.1.2, commit 6478567951ae5c9979ad7b234185b5515f4be7a1).
- The split into two graphs: [faster-whisper](https://github.com/SYSTRAN/faster-whisper),
  MIT, Copyright (c) 2023 SYSTRAN; `faster-whisper-LICENSE`. The files came in
  with commit 2dbca5e559a8a36143987e38492cef927a71efd1 and are those of tag
  v1.1.1 (commit 9e657b47cb71ed7aa32ce115ef0dca953ca39ae5), checked against the
  `faster_whisper-1.1.1-py3-none-any.whl` on PyPI (SHA-256
  `5808dc334fb64fb4336921450abccfe5e313a859b31ba61def0ac7f639383d90`).
