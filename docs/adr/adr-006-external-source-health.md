---
date: 2026-10-28
status: accepted
era: python-sidecar
validity: implementation_changed
validity_note: 外部入力の接続の確認を変換の成功と見なさない（conversion_verified を false に保つ）決定は変わらない。Python の source_bridge.py は Rust の native/audio-routing（graph.rs、pipewire/bridge.rs）に替わり、引き続き vrct-source-bridge を見張る。
implementation_status: implemented
implementation_checked: 2026-11-18
implementation_note: モデルの要らない基盤の部分である。原文のとおり、実際の VC エンジンの採用と P2 全体の受け入れは済んでいない。
evidence:
  - native/audio-routing/README.md
  - native/audio-routing/src/pipewire/bridge.rs
---
# ADR-006: Separate the connection check of external input from the VC conversion state

[日本語版](#adr-006-外部入力の接続確認とvc変換状態を分ける日本語版)

Status: Accepted as the P2 groundwork implementation that needs no model. Adoption of a real VC engine and acceptance of P2 as a whole are not complete.
Date: 2026-10-28
Related: [ADR004](adr-004-audio-integration-boundaries.md), [ADR005](adr-005-managed-microphone-lifetime.md)

The user asked for the validation of B, preliminary validation that needs no model and continued work up to the full feature set.
What follows is the implementer's choice within that scope; it is not consent to use a new engine or model.

## Basis and boundaries

In the old MMVCServerSIO implementation in the public VCClient master, the info status is OK even with no model selected,
and passThrough returns the input unchanged. The old code is not reused as the API contract of the current 2.x.
[Manager at a pinned commit](https://github.com/w-okada/voice-changer/blob/d8ef15799470193f7c8176ef471245753a656626/server/voice_changer/VoiceChangerManager.py#L217)

In Seed-VC Realtime, input monitor mode passes audio straight through, an inference exception gives silence and the default device is used when the selected device is not found.
So conversion success is not inferred only from the process being alive, the volume or a start flag.
[engine at a pinned commit](https://github.com/jiaheguo521/seed-vc-realtime/blob/58d0ca372cc76f60a798d9f84611f053f9029f3a/realtime_vc_engine.py#L505)

Both candidates have a path that fetches weights automatically on first run. At this stage, nothing is started, installed or fetched.
The MIT license of VCClient and the GPL-3.0 of Seed-VC for the public code do not mean permission to distribute every model, binary and dependency.
The 11 original research texts and their manifest, and the 9 queries / 87 hits of the 2 search roles, are in `tmp/voice-resume/research/p2-vc/`.
These candidates gave no definitive API for ready, bypass or conversion success of a real VC. No made-up API is added to the product.

## Decision

First, only the Linux **connection from an explicitly selected source to the managed VC sink** is built as a product component.
The external engine is assumed to output to a separate virtual source, and a later mode control switches between the connection route that selects that source and the passthrough of the physical microphone.
The two are never open at the same time, and a setup that connects the engine output straight to the final mix is not a target for acceptance.
The health of this component is an observation of the connection, the mute and the owning process, and `conversion_verified=false` is kept.
An engine-specific adapter that can check conversion quality or model readiness is a separate gate.

- At start, the PipeWire cookie plus the object.serial of the source and the sink are pinned. There is no reconnection by name alone and no fallback to the OS default.
- The PCM route of `pw-loopback` is used, and PCM is not brought into Python. At start, the playback node is muted.
- After checking both endpoints, the actual link and the owned stream on the same graph, the existing native gate that binds to the cookie/serial is extended to unmute only that stream.
- The ownership check looks up the Client from the Node's client.id and matches the pipewire.sec.pid recorded by the native protocol against the living owned child. It does not fall back to the self-reported application.process.id. It covers the same PID namespace.
- Source loss, replacement under the same name, a daemon epoch change, process exit and a failed check all close the connection, and it does not come back without an explicit start. The lifetimes of TTS and of the final virtual source do not change.
- A dedicated non-leader control thread opens its own thread pidfd before starting, and the native supervisor watches the whole lifetime.
  The connection process is a child of the supervisor, and it follows the supervisor's death too, through the parent-death signal.
  This was changed because a review reproduced that a plain exec plus getppid checks before and after it misses the creator thread exiting before prctl.
  Where PIDFD_THREAD (Linux 6.9 or later) is not available, start is refused. It does not fall back to rechecking a numeric TID.
- Calling this backend on a system other than Linux returns an explicit "not supported". It does not break Windows features at import time. Windows capture/forwarding and the UI are later, separate tasks.

WirePlumber's official documentation defines the behavior of `target.object` and dont-fallback/dont-reconnect/dont-move.
The installed `find-defined-target.lua` resolves a numeric target.object to object.serial.
A synthetic-sound trial on an independent graph confirmed: start muted → silence continues → explicit unmute → the synthetic sound arrives.
[linking spec](https://pipewire.pages.freedesktop.org/wireplumber/policies/linking.html),
[limits of the parent-death signal](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html)

## Other options and conditions for reconsidering

| Option | Judgment | Conditions for reconsidering |
|---|---|---|
| Treat the process or the device existing as conversion ready | Not adopted. It cannot be told apart from passthrough or a model that is not ready | If a formal conversion-state contract and failure tests on real hardware become available |
| Connect the engine output straight to the managed mix | It cannot own an independent stop or the exclusion of passthrough | If a gate on the engine side can show the same stop/failure conditions |
| Implement capture, mix and playback together in Python | Not needed for the first Linux connection. It adds new queues and copies | If limits of the OS route are measured for processing shared with Windows, ducking or a single capture |
| Move entirely to a dedicated audio daemon | Validate B's small connection component first | If B cannot meet the stop, lifetime and mixing requirements (option C of ADR004) |

## Acceptance and limits

Using a synthetic source on an independent PipeWire and a different frequency for the forbidden fallback, the tests cover normal operation, stop, source deletion and re-creation under the same name,
sink loss, parent exit and repeated switching. The continuity of the capture is checked, and a dead reader is not counted as silence.
These results are not evidence that voice conversion, a real microphone, VRChat or Windows are complete.
It is not claimed that the connection component alone can tell apart another app that operates the OS directly, or the original-voice output of a misconfigured external VC.
If the needed model state is unknown, acceptance of the later VC features stays unconfirmed. Real-hardware gates are not replaced with fakes.

The results of 3 trials with 42 observations on the implementation and a private OS, and the history of fixes to the ownership check, were in the acceptance report (source-bridge-report.md, deleted on 2026-11-16; it remains in the git history).

---

# ADR-006: 外部入力の接続確認とVC変換状態を分ける（日本語版）

Status: P2モデル不要の基盤実装として採用。実VCエンジン採用・P2全体受入れは未完了。
Date: 2026-10-28
Related: [ADR004](adr-004-audio-integration-boundaries.md)、[ADR005](adr-005-managed-microphone-lifetime.md)

ユーザーはBの検証、モデル不要の先行検証、全機能までの継続作業を指示した。
以下はその範囲で行う実装担当の選択であり、新しいエンジン・モデルの利用同意ではない。

## 根拠と境界

公開VCClient masterの旧MMVCServerSIO実装では、モデル未選択でもinfoのstatusはOKとなり、
passThroughでは入力をそのまま返す。現行2.xのAPI契約として旧コードを流用しない。
[固定コミットのManager](https://github.com/w-okada/voice-changer/blob/d8ef15799470193f7c8176ef471245753a656626/server/voice_changer/VoiceChangerManager.py#L217)

Seed-VC Realtimeでは入力モニターモードが素通し、推論例外は無音、選択機器が見つからない場合は既定機器を使う。
そのためプロセス生存、音量、開始フラグだけで変換成功を推定しない。
[固定コミットのengine](https://github.com/jiaheguo521/seed-vc-realtime/blob/58d0ca372cc76f60a798d9f84611f053f9029f3a/realtime_vc_engine.py#L505)

両候補に初回の自動重み取得経路がある。現段階では起動・導入・重み取得をしない。
公開コードのVCClient MITとSeed-VC GPL-3.0は、全モデル・バイナリ・依存物の配布許諾を意味しない。
調査原文11本とmanifest、2検索役の9query/87hitsは`tmp/voice-resume/research/p2-vc/`。
実VCのready/bypass/変換成功の確定APIは今回の候補で得られていない。架空のAPIを製品へ追加しない。

## 決定

最初にLinuxの**明示選択したsourceからmanaged VC sinkへの接続**だけを製品部品として作る。
外部エンジンは別の仮想sourceへ出力する想定とし、そのsourceを選ぶ接続経路と物理マイクのpassthroughを
後続のmode制御で切り替える。二つを同時に開かず、engine出力を最終mixへ直結した構成は受入対象にしない。
この部品のhealthは接続・mute・所有processの観測であり、`conversion_verified=false`を維持する。
変換品質やモデル準備状態を確認できるengine固有adapterは別ゲート。

- 開始時にPipeWire cookie＋source/sinkのobject.serialを固定する。名前だけの再接続やOS既定へのfallbackをしない。
- `pw-loopback`のPCM経路を使い、PythonへPCMを持ち込まない。開始時はplayback nodeをmuteにする。
- 同じgraph上の両endpoint・実link・所有streamを検査後、cookie/serialへbindする既存native gateを拡張してそのstreamだけunmuteする。
- 所有確認はNodeのclient.idからClientを引き、native protocolが記録するpipewire.sec.pidと生存中の所有childを照合する。自己申告application.process.idには格下げしない。同一PID namespaceを対象とする。
- source消失、同名置換、daemon epoch変更、process終了、検査失敗は閉じ、明示startなしで復帰しない。TTSと最終仮想sourceの寿命を変更しない。
- 専用の非leader制御threadが起動前に自分のthread pidfdを開き、native supervisorが全寿命を監視する。
  接続processはsupervisorの子とし、supervisor死亡にも親終了シグナルで追従する。
  単純exec＋getppid前後確認だけでは、prctl前のcreator-thread終了を取り逃すことがレビューで再現されたため変更した。
  PIDFD_THREAD（Linux 6.9以降）が利用できない環境では開始を拒否する。数値TIDの再検査には格下げしない。
- 非Linuxでこのbackendを呼ぶと明示的に未対応を返す。import段階でWindows機能を壊さない。Windows capture/forwardingとUIは後続の独立タスク。

WirePlumber公式は`target.object`とdont-fallback/dont-reconnect/dont-moveの挙動を定義する。
インストール済み`find-defined-target.lua`は数値target.objectをobject.serialへ解決する。
独立graphの合成音試行で、mute開始→無音継続→明示unmute→合成音の到達を確認した。
[linking仕様](https://pipewire.pages.freedesktop.org/wireplumber/policies/linking.html)、
[親終了シグナルの制約](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html)

## 他案と再検討条件

| 案 | 判断 | 再検討条件 |
|---|---|---|
| processやデバイス存在を変換readyと見なす | 採用しない。素通し・モデル未準備と区別できない | 正式な変換状態契約と実機の故障試験が得られた場合 |
| エンジン出力をmanaged mixへ直結 | 独立停止・passthrough排他を所有できない | エンジン側gateで同じ停止/故障条件を実証できる場合 |
| Pythonでcapture/mix/再生を一括実装 | 最初のLinux接続には不要。新しいqueueやコピーを増やす | Windows共通処理、ducking、単一captureでOS経路の限界が実測された場合 |
| 専用音声daemonへ全面移行 | Bの小さな接続部品を先に検証 | 停止・寿命・混合要件をBで満たせない場合（ADR004のC案） |

## 受入れと制限

独立PipeWireの合成sourceと禁止fallback用の別周波数を使い、通常、停止、source削除・同名再作成、
sink消失、親終了、連続切替を検査する。captureの連続性を確認し、死亡readerを無音と数えない。
この結果は音声変換・実マイク・VRChat・Windowsの完成証拠ではない。
OSを直接操作する別アプリや誤設定された外部VCの原音出力を、接続部品だけで判別できるとは主張しない。
必要なモデル状態がunknownなら後続VC機能の受入れは未確認のまま。実機ゲートをfakeで置き換えない。

実装・私有OSで3試行42観測の結果と所有確認の修正経緯は受入れ報告（source-bridge-report.md、2026-11-16に削除。git の履歴に残る）にあった。
