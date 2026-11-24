---
date: 2026-10-27
status: accepted
era: python-sidecar
validity: replaced
validity_note: VC の選定は自前の実装（native/rvc-runtime と別プロセスの vrct-rvc-worker、ONNX Runtime）に決まり、ADR-012 の 6.1 が管理対象の例外として引き継いだ。VC の本体とモデルを同梱しない線引きも 6.1 に残っている。
superseded_by:
  - ADR-012
implementation_status: not_applicable
implementation_note: 選定を保留する判断なので、それ自体の実装はない。いまの VC の実装の状態は ADR-012 の 6.1 と native/voice-conversion/README.md にある。
evidence:
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - native/voice-conversion/README.md
---
# ADR 003: VC selection deferred

[日本語版](#adr-003-vcは選定保留日本語版)

> **Status note** (added 2026-11-18, Issue #587): The VC choice was later settled on an in-house implementation, not on the candidates listed here (VCClient, Seed-VC Realtime). Voice conversion (RVC) today is the Rust implementation in `native/rvc-runtime`, and the separate process `vrct-rvc-worker` runs inference with ONNX Runtime. This implementation is registered as a managed exception in section 6.1 of [ADR-012](adr-012-audio-ai-runtime-consolidation.md). The line that the VC engine and models are not bundled and are fetched only after consent still holds. Seed-VC has not been in the release since 0.5.0. The body below has not been rewritten.

> **Migration note** (2026-11-18, Issue #587): This document is the "ADR 003" section of the former `docs/voice-stack/decisions.md`, split out into a file of its own. The original was written on 2026-10-27 (commit `ad977081`) and did not change until the split. The body is the original text; the only changes made in the split were the heading level (from `##` to `#`) and adding notes. The front matter at the top holds machine-readable fields that were added after that.
>
> The original has no status line of this ADR's own. The only status line in the former file was "Status: accepted for P1, 2026-10-27." in the ADR 001 section. [ADR 004](adr-004-audio-integration-boundaries.md) treats ADR 001 to 003 together as accepted ADRs.

speech.cpp has no VC feature for live audio. P2 starts from a contract with an external process or virtual device.
The candidates are the Windows CUDA/ONNX RVC of [VCClient](https://github.com/w-okada/voice-changer) and
[Seed-VC Realtime](https://github.com/jiaheguo521/seed-vc-realtime).
RVC support in the standard Linux VCClient is not promised. The Seed author's measurements are not values reached in our own environment.
The choice is made after comparing p50/p95, drops, quality, VRAM, OS and model licenses in a GPU/VRChat environment.
The VC engine and models are not bundled. There is no major rework of VC or ASR before P1 ends.

---

# ADR 003: VCは選定保留（日本語版）

> **状態の注記**（2026-11-18 追記、Issue #587）：VC の選定は、その後、ここに挙げた候補（VCClient、Seed-VC Realtime）ではなく、自前の実装に決まった。いまの声質変換（RVC）は `native/rvc-runtime` の Rust の実装で、別プロセスの `vrct-rvc-worker` が ONNX Runtime で推論する。この実装は [ADR-012](adr-012-audio-ai-runtime-consolidation.md) の 6.1 で、管理対象の例外として登録してある。VC の本体やモデルを同梱せず、同意を得てから取得するという線引きは、いまも守っている。Seed-VC は 0.5.0 から配布物に入っていない。以下の本文は書き換えていない。

> **移行の注記**（2026-11-18、Issue #587）：この文書は、旧 `docs/voice-stack/decisions.md` の「ADR 003」の節を、1件ずつのファイルに分けたものである。原文は 2026-10-27 に書かれ（コミット `ad977081`）、分けるまで変わっていない。本文は原文のままで、分けるときに変えたのは見出しの階層（`##` から `#`）と、注記を足したことだけである。冒頭の front matter は、その後に足した機械可読の項目である。
>
> 原文には、この ADR だけの採用状態の行はない。旧ファイルにあった採用状態の行は、ADR 001 の節の「Status: accepted for P1, 2026-10-27.」だけである。[ADR 004](adr-004-audio-integration-boundaries.md) は ADR 001〜003 をまとめて、採用済み（accepted）の ADR として扱っている。

speech.cppには生音声VC機能はない。P2は外部プロセス/仮想デバイス契約から始める。
[VCClient](https://github.com/w-okada/voice-changer)のWindows CUDA/ONNX RVCと
[Seed-VC Realtime](https://github.com/jiaheguo521/seed-vc-realtime)を候補にする。
Linux標準VCClientのRVC対応は確約しない。Seedの作者測定は自環境の達成値ではない。
GPU/VRChat環境でp50/p95、ドロップ、品質、VRAM、OS、モデル許諾を比較してから選定する。
VC本体やモデルは同梱しない。P1終了前にVC/ASRの大改造を行わない。
