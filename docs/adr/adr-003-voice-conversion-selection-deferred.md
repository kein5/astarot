# ADR 003: VCは選定保留

> **状態の注記**（2026-11-18 追記、Issue #587）：VC の選定は、その後、ここに挙げた候補（VCClient、Seed-VC Realtime）ではなく、自前の実装に決まった。いまの声質変換（RVC）は `native/rvc-runtime` の Rust の実装で、別プロセスの `vrct-rvc-worker` が ONNX Runtime で推論する。この実装は [ADR-012](adr-012-audio-ai-runtime-consolidation.md) の 6.1 で、管理対象の例外として登録してある。VC の本体やモデルを同梱せず、同意を得てから取得するという線引きは、いまも守っている。Seed-VC は 0.5.0 から配布物に入っていない。以下の本文は書き換えていない。

> **移行の注記**（2026-11-18、Issue #587）：この文書は、旧 `docs/voice-stack/decisions.md` の「ADR 003」の節を、1件ずつのファイルに分けたものである。原文は 2026-10-27 に書かれ（コミット `ad977081`）、分けるまで変わっていない。本文は原文のままで、変えたのは見出しの階層（`##` から `#`）と、注記を足したことだけである。
>
> 原文には、この ADR だけの採用状態の行はない。旧ファイルにあった採用状態の行は、ADR 001 の節の「Status: accepted for P1, 2026-10-27.」だけである。[ADR 004](adr-004-audio-integration-boundaries.md) は ADR 001〜003 をまとめて、採用済み（accepted）の ADR として扱っている。

speech.cppには生音声VC機能はない。P2は外部プロセス/仮想デバイス契約から始める。
[VCClient](https://github.com/w-okada/voice-changer)のWindows CUDA/ONNX RVCと
[Seed-VC Realtime](https://github.com/jiaheguo521/seed-vc-realtime)を候補にする。
Linux標準VCClientのRVC対応は確約しない。Seedの作者測定は自環境の達成値ではない。
GPU/VRChat環境でp50/p95、ドロップ、品質、VRAM、OS、モデル許諾を比較してから選定する。
VC本体やモデルは同梱しない。P1終了前にVC/ASRの大改造を行わない。
