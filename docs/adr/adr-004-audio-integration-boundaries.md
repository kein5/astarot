---
date: 2026-10-27
status: proposed
era: python-sidecar
validity: unknown
validity_note: 製品として採用するかが決まっていない（原文の Status）。いまの構成（別プロセスの speech.cpp と、Rust と OS の音声経路）は案 B の形に近いが、本文の確認表の項目を Rust の中核で確かめた記録はない。
implementation_status: unknown
implementation_note: 限定の PoC と局所の修正は Python の実装で行った（本文の追記）。採用の範囲が決まっていないので、実装済みとする基準も決まっていない。
evidence:
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
---
# ADR 004: Choose the boundaries of external inference and audio routes conditionally

[日本語版](#adr-004-外部推論と音声経路の境界を条件付きで選ぶ日本語版)

Status: **proposed for product adoption / B validation authorized**, 2026-10-27. The requester approved validating B and running model-free tests ahead of the rest. A limited PoC has been run; product adoption is not settled.

Decision authority: the repository maintainer / the requester. Building and running the model-free PoC: Codex. Checking with a real VC and on Windows: not assigned.

Scope: the P1 review and the audio integration of P2 to P5. It does not include a full redesign of the existing text features, developing our own virtual driver or turning the app into a cloud service.

Related: [the evaluation report](../voice-stack/architecture-evaluation-2026-10-27.md), the PoCs and fitness functions for checking, [ADR 001 to 003](README.md). This proposal alone does not change the existing accepted ADRs to superseded.

## Background

VRCT is built from React, Tauri and Python, and P1 added an external speech.cpp and a dedicated TTS thread. There are records of a partial route on Linux and of VRChat's built-in microphone test, but performance when started from the UI, on Windows, with VC and ASR mixed and on an HMD is not established. At the time of the evaluation, TTS of the original text was found to wait for translation, and a stop was found to wait in the general dispatch. The B validation fixed these two points and the generation expiry of chat messages already accepted, and added regression tests. Blocking writes on Windows and the consumer-side fallback when a virtual endpoint disappears remain open issues.

speech.cpp serializes requests per model. The VC candidates differ in OS, edition, API and model conditions. Moving to an external process does not resolve GPU contention or the distribution conditions by itself. So the choice is made on responsibilities, behavior on failure and measurements, rather than by taking the current plan as given.

## Proposed decision

1. **B: choose external inference plus the OS audio route as the first target to validate.** A small owner of control sits in Python, and the existing OSC, translation and history contracts are kept. Inference and HTTP are not placed in audio callbacks or the UI.
2. Direct VC is independent of ASR, translation and TTS. TTS of the original text branches off after input validation and after the ID is fixed; TTS of the translation is generated only from the selected final translation. Partial recognition results and received audio are not spoken by default.
3. Stop and mode changes are kept apart from saturation of the general processing queue. The existing `stop_voice` cancels only TTS, and direct VC and ASR continue. The next new TTS can be accepted. A global mute is a separate explicit action: it stops every route and holds until it is explicitly released. The TTS-specific gate/generation is kept distinct from the global gate/mode generation, so that a failure of TTS alone or a settings change does not stop VC. Stopping generation and stopping the actual output of the target signal are observed separately.
4. The lifetime of the virtual endpoint is independent of inference. On failure the output goes silent, past utterances are not resent and there is no fallback to the raw voice. The reconnect behavior of the OS and VRChat is checked on real hardware.
5. **C: a dedicated audio process is the first alternative if B cannot meet the contracts.** Its responsibilities are limited to capture, mix, gate, buffer and lifecycle. No general service bus or common engine SDK is built in advance.
6. Until the capabilities of the models and the OS have been shown, it is not decided that every VC can be handled through a common `feed(PCM)`. The first, device-owned method is kept distinct from a future PCM method.

This decision does not settle product adoption of B. The scope of adoption is recorded after B has shown every mode, or after the parts that need it have moved to C and been tested again.

Addendum, 2026-10-27: Acceptance with real TTS reproduced that even when speech.cpp is killed with SIGKILL,
data waiting in HTTP/TCP delays the communication error and the switch to silence: about 5.1 seconds on the host,
and about 15.8 seconds on another, independent route. This is a different boundary from the about 80 ms of an explicit cancel or mute, and the contract of silence on failure stays an unmet issue.
The responsibilities for receiving and playing, the buffer limit and liveness monitoring are re-evaluated with a minimal PoC. A full move to a dedicated audio process is not decided yet.

Addendum, same day: In the fix and validation of connection-acceptance monitoring, a small TCP monitor that belongs to
each speech request detects an explicit connection refusal and cancels only that TTS. No PCM queue is added,
and no ownership of starting the external server is added either. A bounded receive queue alone cannot guarantee that a disconnect is detected, so it is not adopted this time.
Telling a stop that leaves the listener in place apart from an immediate restart, and stopping output on Windows, are out of scope; if needed, a heartbeat, identity or
process-ownership contract is reconsidered. This local fix is not made into a product adoption decision for B as a whole.

Addendum, same day: After the fix, the host and VRChat retest passed 11 cases.
The 3 normal runs and the 3 recovery runs each played once in the VRChat microphone test, and the 3 failure runs went silent on the virtual microphone after 79 to 84 ms.
No p95 is claimed from n=3 failures, and runs started from the UI or API, Windows, a real VC and so on remain unchecked. The adoption state of B does not change.

Addendum, same day: In the UI component and stdio integration tests, from the production input field and settings UI and the production Main/Controller
through to the virtual microphone, 16 cases passed both with real TTS and without models. The wiring of text delivery and of cancel, mute and failure recovery was confirmed.
The Tauri connection, initialization of every Model, config persistence, real translation and so on were replaced or not run, so the results are not evidence of a product E2E.
No new product abstraction is added, and the adoption state of B and the conditions that would reverse the decision stay as they are.

## Options and reasons for rejection

| Option | Judgment at this point | Conditions for reconsidering |
|---|---|---|
| A: build the speech C API and VC into the same process | Against the cost of spreading native failures, ABI and distribution dependencies into the existing sidecar, the value of removing HTTP has not been measured | A trace under the same conditions shows that IPC/serialization is the main cause of missed performance, and A improves on it beyond measurement error. A also meets the old features, both OSes and the license conditions |
| B: external inference plus the OS route | First PoC candidate, with conditions | If silencing, stopping, mixing and coexisting captures do not hold on every route, narrow the scope of adoption and move to C |
| C: dedicated audio process plus external inference | Not introduced in full now. There is a concrete need to isolate responsibilities, so it stays as the first alternative | If B cannot meet the stop deadline, driver isolation, mix/duck and single capture, and a minimal PoC of C shows an improvement |
| WebSocket companion only | Simple for P1 alone, but it does not settle who owns direct VC, ASR of the original audio and stopping every mode | If the requirements shrink to a standalone TTS companion only, and the stop and utterance ID contracts can be met outside the app |

## Effects

Changes to existing features stay limited, and the choice of engine and model can be changed later. In return, the support burden of per-OS routes, engine versions and external virtual drivers is accepted. B does not become safe and fast automatically by leaving the work to the OS. If Windows mix/duck or Linux consumer reconnection does not work, more development is needed.

Contention on a shared GPU, model block/lookahead and leading silence remain even if the process boundary changes. If missed performance is dominated by the model, a move to C is not counted as solving it; the model, the load and the targets are reconsidered.

At first, engines and weights are assumed to be managed by the user, and extra fetching or bundling is not automated. This is not a decision that waives distribution obligations. Code, weights, vocoders and drivers are each checked, and the existing exclusion of the prohibited OCR weights is kept.

## Checks and conditions for reversal

| Property to preserve | Check | Conditions / on failure |
|---|---|---|
| Compatibility | PoC-2/6, the old contracts when off, full regression | If an old payload breaks or a feature regresses, fix the design |
| Preventing wrong output | PoC-1/5, prohibited signals and the consumer target | A single wrong output rejects that setup. C is held to the same standard |
| Cancel | PoC-1/2, started from the UI, the target signal gone at the endpoint | p95 ≤ 100 ms / worst ≤ 250 ms are proposed values. A TTS cancel requires VC to continue; a global mute requires silence on every output. If not met, isolate the cause, and reconsider C or the basis of the thresholds. The target staying silent is required |
| Conversation quality and resources | PoC-3/4/5 | Evaluate the VC/TTS/ASR targets of the spec, and backlog, drops, FPS and VRAM over 30 minutes. Authors' figures are not evidence of a pass |
| Cost of complexity | PoC-7 | Do not add C if C does not solve B's problems, or if B meets every condition |
| Distribution conditions | The artifact ledger of PoC-6 | Hold back distribution of unchecked artifacts. Being an external process alone does not settle the license question |

Details of the checks, sample sizes, missing data, measures against misjudgment and assigned roles go in the PoC design. The next review points are when PoC-1/3 finish, when an engine, driver or model is updated, before mixing is adopted in P4 and before a release. When the status changes to accepted, add the person in charge, the setups that passed, the remaining limits and links to the raw records.

## Evidence so far and open items

The limited P1 route is in the [existing benchmarks](../voice-stack/benchmarks.md); this round's validation with an independent PipeWire and synthetic sound is kept separately in the B validation report. In 30 repetitions with the fixed version, per-route cancel and global mute held, and the endpoint stayed after the producer ended. Continuous synthetic sound for 30 minutes was confirmed in a separate group. On the other hand, when the endpoint itself was deleted, a pw-cat consumer with normal settings switched to another synthetic input in 30 of 30 runs. A consumer with a fixed input exited, and that is not the same as a capture that keeps receiving silence.

So the conditions for continuing with B are "an endpoint lifetime independent of the engine" and "the consumer does not switch to unconverted input even when the endpoint fails". Pinning on the writer side alone does not count as a pass. C does not solve the consumer's fallback automatically either, so it needs the same failure tests.

The full counts and the measurement boundaries of the repeated and continuous tests are recorded in the report. Still not settled: the product's global mute control, stop and mixing on Windows, VRChat's behavior when the endpoint disappears, adoption of a real VC, mixed GPU load, the physical clock, the Linux GUI and the full set of release artifacts.

---

# ADR 004: 外部推論と音声経路の境界を条件付きで選ぶ（日本語版）

Status: **proposed for product adoption / B validation authorized**, 2026-10-27。依頼者がBの検証とモデル不要の先行試験を承認。限定PoCを実行済みで、製品採用は未確定。

Decision authority: リポジトリ保守者／依頼者。モデル不要PoCの作成・実行担当: Codex。実VC・Windowsの確認担当は未割当。

Scope: P1見直しとP2〜P5の音声統合。既存テキスト機能の全面再設計、独自virtual driver開発、クラウドサービス化は含めない。

Related: [評価書](../voice-stack/architecture-evaluation-2026-10-27.md)、確認用PoC・fitness functions、[ADR 001〜003](README.md)。本提案だけで既存accepted ADRをsupersededに変更しない。

## Context

VRCTはReact/Tauri/Python構成で、P1は外部speech.cppと専用TTS threadを追加した。Linuxの部分経路とVRChat内蔵マイクテストは記録があるが、UI起点・Windows・VC/ASR混在・HMDの性能は未確定。評価時には原文TTSの翻訳待ちと一般dispatchでの停止待ちを確認した。Bの検証でこの2点と受付済みchatの世代失効を修正し、回帰試験を追加した。Windowsのblocking writeと仮想endpoint消失時のconsumer側fallbackは課題として残る。

speech.cppはモデルごとに要求を直列化する。VC候補はOS/edition/API/モデル条件が異なる。外部processにしてもGPU競合と配布条件は自動解決しない。このため、現計画を前提にするのではなく責務・失敗時動作・実測で選定する。

## Decision proposal

1. **B: 外部推論＋OS音声経路を最初の検証対象として選ぶ。** Pythonに小さな制御の所有者を置き、既存OSC/翻訳/historyの契約は保持する。推論・HTTPを音声callbackやUIに置かない。
2. 直接VCはASR/翻訳/TTSから独立させる。原文TTSは入力検証とID確定後に分岐し、訳文TTSは選択した確定訳のみから生成する。部分認識・受信音声を既定で発声させない。
3. 停止とmode変更は一般処理キューの飽和から分離する。既存`stop_voice`はTTSのみを取り消し、直接VCとASRを継続する。次の新TTSは受付可能。全体muteは別の明示操作とし、全経路を止めて明示解除まで保持する。TTS別gate/generationと全体gate/mode世代を区別し、TTS単独故障や設定変更でVCを止めない。生成停止と対象信号の実出力停止を別に観測する。
4. 仮想endpointの寿命を推論から独立させる。故障時は無音、過去発話を再送せず、生声fallbackを行わない。OS/VRChatの再接続挙動を実機で確かめる。
5. **C: 専用音声processはBが契約を満たせない場合の第一代替。** capture/mix/gate/buffer/lifecycleに責務を限定する。汎用service busや共通engine SDKを先に作らない。
6. モデル・OSのcapabilityを実証する前に、すべてのVCを共通`feed(PCM)`で扱えるとは決めない。最初のdevice-owned方式と将来のPCM方式を区別する。

この決定はBの製品採用を確定しない。Bで全モードを実証するか、必要な範囲をCに移して再試験した後に、採用範囲を記録する。

2026-10-27追記: 実TTSの受入で、speech.cppをSIGKILLしても
HTTP/TCPの待機データにより通信エラーと無音化が遅れることを再現した。ホストでは約5.1秒、
別の独立経路では約15.8秒。明示cancel/muteの約80msとは異なる境界であり、故障時無音の契約は未達課題として残す。
受信と再生の責務・buffer上限・生存監視を最小PoCで再評価する。専用音声processへの全面移行はまだ決定しない。

同日追記: 接続受付監視の修正・検証では、発声要求に属する
小さなTCP監視で明示的な接続拒否を検出し、そのTTSだけを取消す。PCM queueは増やさず、
外部serverの起動所有権も追加しない。有界受信queueのみでは切断検出を保証できないため今回は採用しない。
listenerが残る停止・即時再起動の識別やWindows出力停止は対象外であり、必要ならheartbeat/identity/
process所有契約を再検討する。この局所修正をB全体の製品採用決定にはしない。

同日追記: 修正後ホスト・VRChat再試験は11ケースPASS。
通常3回・復旧3回はVRChatマイクテスト再生で各1回、故障3回は仮想マイクで79〜84ms後に無音になった。
故障n=3からp95を主張せず、UI/API起点・Windows・実VC等は未確認のまま。Bの採用状態は変更しない。

同日追記: UI部品・stdio統合試験では、本番入力欄・設定UIと本番Main/Controllerから
仮想マイクまで実TTS・モデル不要とも16ケースPASS。テキスト配信と取消・mute・故障復旧の接続を確認した。
Tauri接続、全Model初期化、config永続化、実翻訳等は差し替えまたは未実行であり、製品E2Eの証拠にはしない。
新たな製品抽象化は追加せず、Bの採用状態・判断を覆す条件は維持する。

## Alternatives and rejection reasons

| 案 | 現時点の判断 | 再検討条件 |
|---|---|---|
| A: 同一processへspeech C APIとVCを組込む | native障害・ABI・配布依存を既存sidecarへ広げる費用に対し、HTTP削減の価値が未測定 | 同条件traceでIPC/serializationが性能未達の主因と判明し、Aが誤差を超えて改善。旧機能・両OS・license条件も満たす |
| B: 外部推論＋OS経路 | 条件付きの第一PoC候補 | 全経路の無音化・停止・混合・capture共存が成立しなければ採用範囲を縮め、Cへ |
| C: 専用audio process＋外部推論 | いま全面導入はしない。責務隔離の必要性は具体的にあり、第一代替として残す | Bで停止期限・driver隔離・mix/duck・single captureを満たせず、Cの最小PoCで改善を示した場合 |
| WebSocket companionのみ | P1単体には簡単だが、直接VC・原音ASR・全mode停止の所有を解決しない | 要求が独立TTS companionだけへ縮小し、停止・発話ID契約を外部で満たせる場合 |

## Consequences

既存機能への変更を限定し、engineとモデルの選定を後から変更できる。一方で、OS別経路・engine版・外部virtual driverのサポート負担を受け入れる。BはOS任せで自動的に安全・高速になるわけではない。Windows mix/duckやLinux consumer再接続が成立しなければ追加開発が必要となる。

共有GPUの競合、モデルのblock/lookahead、先頭無音はprocess境界を変えても残る。性能未達がモデルに支配される場合は、Cへの移行で解決したことにせず、モデル・負荷・目標を再検討する。

engineと重みは初期にはユーザー管理を前提とし、追加取得・同梱を自動化しない。これは配布上の義務を免除する判断ではない。code/weight/vocoder/driverを個別に確認し、禁止OCR重みの既存除外を維持する。

## Confirmation and reversal

| 保全する性質 | 確認 | 条件・失敗時 |
|---|---|---|
| 互換性 | PoC-2/6、OFF時の旧契約・全回帰 | 旧payload破壊や機能退行なら設計を修正 |
| 誤出力防止 | PoC-1/5、禁止信号とconsumer target | 誤出力1件でもその構成を不採用。Cも同じ基準 |
| 取消 | PoC-1/2、UI起点→endpointで対象信号消失 | p95≤100ms/最悪≤250msは提案値。TTS取消はVC継続、全体muteは全出力無音を要求。未達なら原因を切り分け、Cまたは閾値の根拠を再審議。対象の無音継続は必須 |
| 会話品質・資源 | PoC-3/4/5 | 仕様のVC/TTS/ASR目標、30分の滞留・drop・FPS・VRAMを評価。作者値は合格証拠にしない |
| 複雑さの費用 | PoC-7 | CがBの問題を解かない、またはBが全条件を満たすならCを追加しない |
| 配布条件 | PoC-6のartifact台帳 | 未確認artifactの配布を保留。外部processだけで許諾を断定しない |

確認の詳細、測定母数・欠測・誤判定対策・担当役割はPoC設計に置く。次のレビュー時点はPoC-1/3完了時、engine/driver/model更新時、P4の混合採用前、release前。状態をacceptedへ変える際は、担当者・合格した構成・残る制限・生記録へのリンクを追記する。

## Current evidence and open items

P1の限定経路は[既存benchmarks](../voice-stack/benchmarks.md)、今回の独立PipeWireと合成音による検証はB検証レポートに分ける。修正版の30反復で経路別取消・全体muteが成立し、producer終了後もendpointを維持できた。合成音の30分継続は別群で確認した。一方、endpoint自体を削除すると通常設定のpw-cat consumerが30/30回で別の合成入力へ切り替わった。入力固定consumerは終了し、これは無音captureの継続ではない。

したがって、Bを続ける条件は「engineから独立したendpoint寿命」と「endpoint故障時にもconsumerが未変換入力へ切り替わらないこと」。writer側の固定だけで合格にはしない。Cもconsumerのfallbackを自動的には解決しないため、同じ故障試験を要する。

反復・継続試験の全件数と測定境界はレポートに記録した。製品の全体mute制御、Windowsの停止・混合、VRChatのendpoint消失時動作、実VC採用、GPU混在負荷、物理clock、Linux GUI、配布物全件は未確定。
