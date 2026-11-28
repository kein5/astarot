---
date: 2026-10-27
status: accepted
era: python-sidecar
validity: implementation_changed
validity_note: 仮想マイクの寿命を推論から切り離し、ミュートで作って明示の再開を求める決定は変わらない。Python の managed_microphone.py などは Rust の native/audio-routing に替わり、状態の観測は pw-dump の実行から PipeWire のレジストリへの接続に変わった。
implementation_status: implemented
implementation_checked: 2026-11-18
implementation_note: native/audio-routing の pipewire/managed.rs と pipewire/gate.rs が受け持つ。原文のとおり、全 GUI や daemon が消えたときの再接続の受け入れは保留のまま。
evidence:
  - native/audio-routing/README.md
  - native/audio-routing/src/pipewire/managed.rs
  - native/audio-routing/src/pipewire/gate.rs
---
# ADR-005: Virtual microphone lifetime and persistent mute

[日本語版](#adr-005-仮想マイクの寿命と保持ミュート日本語版)

Status: The Linux implementation for source checkouts is accepted. Temporary installation on the host and VRChat acceptance: conditional PASS.
Acceptance of reconnection when every GUI or the daemon disappears is on hold.
Date: 2026-10-27
Related: [ADR-004](adr-004-audio-integration-boundaries.md)

Addendum, 2026-10-30: With automatic creation,
the same v1 route is kept by `pw-loopback` in 3 systemd user services. They are not owned as children of the GUI or the inference worker, so
the decision not to delete the endpoint when the app exits stays. A manual daemon configuration is reused as well.
Creation on selection is asynchronous and keeps the initial mute and the explicit resume. Re-creation at login also starts muted.
The limits from disappearance and consumer fallback caused by an OS service failure or a daemon restart still remain.

## Problem and decision

With B's external inference plus OS route, tying the lifetime of the virtual microphone to the voice engine makes
the input endpoint disappear when the engine exits. The previous synthetic-sound test confirmed that some consumers then fall back to another input.
A TTS-only cancel also does not keep later utterances or an external VC suppressed.

The PipeWire daemon configuration owns the final sink/source and the TTS/VC inputs. The source is always created muted.
VoiceEventBus advances the generation on both mute and resume, so old utterances accepted during mute do not pass after resume either.
VoiceRoute saves the held state with an atomic replace plus fsync, and keeps the observed value of the OS gate distinct from the requested value.
Selecting managed, restarting the app, changing the endpoint or a control failure requires a new explicit resume.

A short-lived C helper changes the OS gate using the system libpipewire. It binds, on the same connection, the proxy that matches the cookie/serial,
checks the marker/class in node.info and only then runs set-param.
State is observed from `pw-dump` snapshots that a shared worker fetches at intervals of no less than 0.1 seconds.
VoiceRoute, passthrough and the Linux input device list refer to the same observation, and it is also passed to the isolated conversion process
over a dedicated pipe, together with the observation number and the time the fetch started. The conversion audio loop does not wait for a subprocess.
An observation is not used after a failed fetch or a worker exit, or when 1 second or more has passed since its fetch started; the existing mute/stop and error path is taken instead.
Confirming a gate operation needs an observation whose fetch started after the operation completed. An observation update wakes the control worker,
so a stale state is not used beyond the existing 0.1-second cycle plus up to 1 second of waiting for a fetch. The fetch process is reaped when the last user
stops and when the sidecar exits. No custom daemon that takes in voice PCM is built.
The usual external cable setting stays the default. On Windows, a new selection of managed is refused.

## Other options and conditions that reverse the decision

- Keep `pw-loopback` as a child process of TTS: simple, but rejected because the endpoint disappears when the parent or child exits.
- Check with `pw-dump`, then run `pw-cli set-param name`: rejected because a node with the same name may be replaced between the check and the change.
  If the CLI becomes able to operate on the same connection with identity as a condition, the native helper can be removed.
- Handle all PCM in a custom audio daemon: not needed for this round's requirements. If a DSP shared by Linux and Windows, or a lease/watchdog that mutes automatically
  even when the control process is killed, becomes a product requirement, this is re-evaluated together with the cost of an extra process.

## Limits and verification

When the daemon itself exits, the endpoint disappears. A VRCT killed with SIGKILL cannot run its mute handling, and the last
gate state remains. Automatic stopping of an external VC is not guaranteed. The next start returns to mute.
If an external app changes the gate directly, detection is not immediate, and silence cannot be guaranteed when the OS cannot be controlled.
So a status 200 means the request was accepted; pending=false/ready=true and a check of the observed value are needed.
The UI rejects stale status responses by a monotonic observation ID. A normal shutdown handles the final mute even after a late resume completes,
and if the mute is not confirmed within at most 10 seconds, it records that. A worker exit alone is not treated as confirmation of the mute.

The CLI is only for a one-off diagnostic operation while VRCT is stopped; it offers no resident monitoring.
The only extra SDKs are the Linux system PipeWire headers and a compiler. No models or pip dependencies are added.
The record of the measurement boundaries, the 30-run test and the unverified items (managed-route-report.md) was deleted on 2026-11-16. It remains in the git history.

A later host test confirmed that VRChat's input stayed the same after the engine exited and after the real audio control process
restarted during mute. This was one sequence with noise suppression off and a stand-in for the model; it does not resolve the SIGKILL limit above or the fallback when the daemon stops.

---

# ADR-005: 仮想マイクの寿命と保持ミュート（日本語版）

Status: ソースcheckout向けLinux実装を採用。host一時導入とVRChat受入は条件付きPASS。
全GUI・daemon消失時の再接続受入は保留。
Date: 2026-10-27
Related: [ADR-004](adr-004-audio-integration-boundaries.md)

2026-10-30追記: 自動作成では、
同じv1経路をsystemdユーザーサービス3件の`pw-loopback`で保持する。GUI/推論workerの子として所有しないため、
アプリ終了時にendpointを削除しないという決定は維持する。手動のdaemon設定も再利用する。
選択時の作成は非同期で、初期muteと明示再開を維持する。ログイン時の再生成もmuteから始める。
OSサービス故障/daemon再起動による消失・consumer fallbackの制約は引き続き残る。

## 問題と決定

Bの外部推論＋OS経路では、音声engineと仮想マイクの寿命を結び付けるとengine終了時に
入力endpointが消える。consumerによっては別入力へfallbackすることを前回の合成音試験で確認した。
またTTS単独cancelは後続発話や外部VCを継続的には抑止しない。

PipeWire daemon設定で最終sink/sourceとTTS/VC入力を所有する。sourceは常にmuteで生成する。
VoiceEventBusはmute/再開の両方で世代を進め、mute中に受け付けた古い発話も再開後に通さない。
VoiceRouteは保持状態をatomic replace＋fsyncで保存し、OS gateの観測値と要求値を区別する。
managed選択・アプリ再起動・endpoint変更・制御失敗は新たな明示再開を必要とする。

OS gate変更は短命のC helperがsystem libpipewireを使って行う。cookie/serialに一致するproxyを
同一接続でbindし、node.infoのmarker/classを確認してからset-paramする。
状態の観測は、共通workerが最短0.1秒間隔で取得する`pw-dump`のsnapshotを使う。
VoiceRoute、passthrough、Linuxの入力デバイス一覧は同じ観測を参照し、隔離した変換processにも
専用pipeで観測番号・取得開始時刻とともに渡す。変換の音声loopはsubprocessを待たない。
取得失敗・worker終了・取得開始から1秒以上経過した観測は使わず、従来のmute/stopとerrorへ進む。
gate操作の確認には、操作完了後に取得を開始した観測が必要。観測更新は制御workerを起こし、
従来の0.1秒周期＋最大1秒の取得待ちを超えて古い状態を使わない。最後の利用者の停止と
sidecar終了時に取得processを回収する。音声PCMを取り込む独自daemonは作らない。
通常の外部ケーブル設定は既定のまま。Windowsでmanagedの新規選択を拒否する。

## 他案と判断を覆す条件

- `pw-loopback`をTTSの子processとして保持: 簡単だが親/子終了でendpointが消えるため不採用。
- `pw-dump`で確認後に`pw-cli set-param name`: 確認と変更の間で同名nodeが置換され得るため不採用。
  CLIが同一接続でidentityを条件に操作できるようになればnative helperを除去できる。
- 全PCMを独自audio daemonで扱う: 今回の要件には不要。Linux/Windows共通DSPや、制御process
  の強制終了でも自動muteするlease/watchdogが製品要件になれば、追加processの費用とともに再評価する。

## 制限と検証

daemon自体の終了ではendpointが消える。SIGKILLされたVRCTはmute処理を実行できず、直前の
gate状態が残る。外部VCの自動停止を保証しない。次の起動時にmuteへ戻る。
外部アプリが直接gateを変更する場合の検出は即時ではなく、OS制御不能時は無音を保証できない。
このためstatus200は要求受付であり、pending=false/ready=trueと観測値の確認が必要。
UIはmonotonicな観測IDで古いstatus応答を拒否する。通常shutdownは遅れたresume完了後も最終muteを
処理し、最大10秒で未確認ならその旨を記録する。worker終了だけをmute確認とはしない。

CLIはVRCT停止中の一回の診断操作専用で、常駐監視は提供しない。
追加SDKはLinuxのsystem PipeWire headers/compilerのみ。モデルとpip依存は追加しない。
実測境界・30回試験・未検証事項の記録（managed-route-report.md）は2026-11-16に削除した。git の履歴に残る。

後続のホスト試験では、engine終了とmute中の実音声制御process再起動後も
VRChatの入力先が同じであることを確認した。ノイズ抑制OFF・モデル代替の1シーケンスであり、
上のSIGKILL制限やdaemon停止時のfallbackを解消する結果ではない。
