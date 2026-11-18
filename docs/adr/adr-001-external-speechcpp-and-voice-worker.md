# ADR 001: 外部speech.cppと独立した音声worker

> **移行の注記**（2026-11-18、Issue #587）：この文書は、旧 `docs/voice-stack/decisions.md` の「ADR 001」の節を、1件ずつのファイルに分けたものである。原文は 2026-10-27 に書かれ（コミット `ad977081`）、分けるまで変わっていない。本文は原文のままで、足したのはこの注記だけである。

Status: accepted for P1, 2026-10-27.

speech.cppのHTTPストリームを標準ライブラリで扱う。VRCTへ推論ライブラリ・
torch・モデル重みは追加しない。ローカルHTTPのみ、proxy/redirectは使わない。
API根拠: [speech.cpp server](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)。
`audio/pcm`、mono s16le、`X-Sample-Rate`を検証し、未対応形式は停止する。
全WAVを待たず、PCMのサンプル境界を保って再生する。

日本語はIrodori、他言語は別ポートのQwen3-TTSへ。未設定・未対応言語は
無音とエラーにする。明示した翻訳先1つのみを読み上げ、訳文欠落時に原文へ戻さない。
要求の自動再送は途中からの二重発声を招くので行わない。
