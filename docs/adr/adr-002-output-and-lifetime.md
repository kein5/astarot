---
date: 2026-10-27
status: accepted
era: python-sidecar
validity: implementation_changed
validity_note: 取り消し、キューの破棄、別のデバイスへ流さないという決まりは、ADR-012 の 1.3 で変えないとした。worker の実装は Python から Rust の native/audio-routing に替わり、Windows は PortAudio の host API の代わりに WASAPI を使う。
implementation_status: implemented
implementation_checked: 2026-11-18
implementation_note: native/audio-routing が同じ規則を引き継いだ（README の対応表）。WASAPI の出力は実際の rate を OS の変換か soxr で変換し、Linux の出力は target と node.dont-fallback、node.dont-reconnect を指定する。
evidence:
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - native/audio-routing/README.md
  - native/audio-routing/src/wasapi/output.rs
  - native/audio-routing/src/pipewire/output.rs
---
# ADR 002: Output and lifetime

[日本語版](#adr-002-出力と寿命日本語版)

> **Migration note** (2026-11-18, Issue #587): This document is the "ADR 002" section of the former `docs/voice-stack/decisions.md`, split out into a file of its own. The original was written on 2026-10-27 (commit `ad977081`) and did not change until the split. The body is the original text; the only changes made in the split were the heading level (from `##` to `#`) and adding the note. The front matter at the top holds machine-readable fields that were added after that.
>
> The original has no status line of this ADR's own. The only status line in the former file was "Status: accepted for P1, 2026-10-27." in the ADR 001 section. [ADR 004](adr-004-audio-integration-boundaries.md) treats ADR 001 to 003 together as accepted ADRs.

HTTP and device open/write/close run on the worker. A settings change or a stop sends a cancel signal and discards the queue.
Output is split into short PCM blocks, and the actual rate is passed to the OS resampler.
There is no fake resampling that only rewrites the header. On Windows, the device name and the host API are matched,
so that an index reused after a reconnect does not send audio to a different device. On Linux, the target and
`node.dont-fallback` / `node.dont-reconnect` are specified.

---

# ADR 002: 出力と寿命（日本語版）

> **移行の注記**（2026-11-18、Issue #587）：この文書は、旧 `docs/voice-stack/decisions.md` の「ADR 002」の節を、1件ずつのファイルに分けたものである。原文は 2026-10-27 に書かれ（コミット `ad977081`）、分けるまで変わっていない。本文は原文のままで、分けるときに変えたのは見出しの階層（`##` から `#`）と、注記を足したことだけである。冒頭の front matter は、その後に足した機械可読の項目である。
>
> 原文には、この ADR だけの採用状態の行はない。旧ファイルにあった採用状態の行は、ADR 001 の節の「Status: accepted for P1, 2026-10-27.」だけである。[ADR 004](adr-004-audio-integration-boundaries.md) は ADR 001〜003 をまとめて、採用済み（accepted）の ADR として扱っている。

HTTP、デバイスopen/write/closeはworker上。設定変更と停止はcancel信号を送り、
キューを破棄。出力は短いPCMブロックに分割し、OSのresamplerに実際のrateを渡す。
ヘッダだけ書き換える疑似resamplingは行わない。Windowsはデバイス名とhost APIを
照合し、再接続後のindex再利用で別デバイスへ流さない。Linuxはtargetと
`node.dont-fallback` / `node.dont-reconnect` を指定する。
