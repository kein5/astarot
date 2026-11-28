---
date: 2026-10-27
status: accepted
era: python-sidecar
validity: implementation_changed
validity_note: 外部の speech.cpp に推論を任せ、アプリに推論のライブラリと重みを足さない原則は、ADR-012 が音声 AI 全体に広げて引き継いだ。HTTP のストリームを Python の標準ライブラリで扱う実装は、0.5.0 から Rust の native/tts に替わった。
implementation_status: implemented
implementation_checked: 2026-11-18
implementation_note: native/tts の client.rs が audio/pcm と X-Sample-Rate を確かめ、受け取った PCM をサンプルの境界で渡す。リダイレクトは追わない。
evidence:
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - docs/voice-stack/core-integration.md
  - native/tts/README.md
  - native/tts/src/client.rs
---
# ADR 001: External speech.cpp and an independent voice worker

[日本語版](#adr-001-外部speechcppと独立した音声worker日本語版)

> **Migration note** (2026-11-18, Issue #587): This document is the "ADR 001" section of the former `docs/voice-stack/decisions.md`, split out into a file of its own. The original was written on 2026-10-27 (commit `ad977081`) and did not change until the split. The body is the original text; the only thing added in the split is this note. The front matter at the top holds machine-readable fields that were added after that.

Status: accepted for P1, 2026-10-27.

The HTTP stream from speech.cpp is handled with the standard library. No inference library, torch or model weights are added to VRCT. Only local HTTP is used, with no proxy and no redirects.
API basis: [speech.cpp server](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md).
`audio/pcm`, mono s16le and `X-Sample-Rate` are validated, and processing stops on an unsupported format.
Playback does not wait for the whole WAV and keeps the PCM sample boundaries.

Japanese goes to Irodori, other languages to Qwen3-TTS on a separate port. A language that is not set up or not supported gets silence and an error. Only the one explicitly chosen translation target is spoken; when the translation is missing, the original text is not spoken in its place.
Requests are not resent automatically, because a resend causes double speech from partway through.

---

# ADR 001: 外部speech.cppと独立した音声worker（日本語版）

> **移行の注記**（2026-11-18、Issue #587）：この文書は、旧 `docs/voice-stack/decisions.md` の「ADR 001」の節を、1件ずつのファイルに分けたものである。原文は 2026-10-27 に書かれ（コミット `ad977081`）、分けるまで変わっていない。本文は原文のままで、分けるときに足したのはこの注記だけである。冒頭の front matter は、その後に足した機械可読の項目である。

Status: accepted for P1, 2026-10-27.

speech.cppのHTTPストリームを標準ライブラリで扱う。VRCTへ推論ライブラリ・
torch・モデル重みは追加しない。ローカルHTTPのみ、proxy/redirectは使わない。
API根拠: [speech.cpp server](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)。
`audio/pcm`、mono s16le、`X-Sample-Rate`を検証し、未対応形式は停止する。
全WAVを待たず、PCMのサンプル境界を保って再生する。

日本語はIrodori、他言語は別ポートのQwen3-TTSへ。未設定・未対応言語は
無音とエラーにする。明示した翻訳先1つのみを読み上げ、訳文欠落時に原文へ戻さない。
要求の自動再送は途中からの二重発声を招くので行わない。
