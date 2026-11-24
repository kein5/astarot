# Reading Japanese text aloud from the GUI

[日本語版](#guiから日本語テキストを読み上げる日本語版)

The AppImage bundles the speech.cpp executable. Download the voice model from the settings screen, or specify an existing file.
You can check the speech with output to your earphones first, then switch to the virtual microphone for VRChat.
The item names below are those of the current English GUI.

1. Open **TTS** from the gear on the main screen. RVC has its own page next to it, and the shared audio route is under **Device**.
2. Open **Models and servers** near the bottom of the page, and in **Model GGUF path** under **Japanese TTS**, enter
   the full path of an existing Irodori GGUF model. `~` also works.
   Leave **Voice GGUF path (optional)** empty and set **Inference device** to **Automatic**.
3. Press **Save changes** at the top of the screen, then press **Start server** for Japanese TTS.
   Wait until it shows **Ready**. Saving alone does not start the model.
4. Set the speech settings in the upper part of the page to the values below and press **Save changes**.

| Item | Value for a test with earphones |
|---|---|
| Chat voice | Original text |
| Japanese server | Bundled server |
| Japanese voice name | none (Irodori's standard voice) |
| Audio route (Device page) | Existing external cable |
| Output device | The earphones or speakers you are using |

On Linux you can also choose an ordinary playback device.
If the output is not listed, update the list with **Refresh devices**.

To hear the speech yourself while it goes to the virtual microphone, turn on **Hear it on my speakers** on the TTS page
and choose **Monitor output** and **Monitor volume** (off by default). The audio that VRChat receives does not change.
Use headphones so that the microphone does not pick the sound up. Even if the monitor output cannot be used, speech to the virtual microphone continues.

5. If audio is muted, press **Device → Unmute** and check **Voice enabled (confirmed)**.
6. Go back to the main screen, choose **Your language = Japanese (Japan)** and turn **TTS** on.
   When you type Japanese in the input field at the bottom and send it, it is read aloud.

Turning **TTS** off on the main screen stops accepting text for speech and stops playback and the queue. Direct input, RVC, translation and OSC keep running.
**Stop playback and clear queue** on the TTS page stops only the current utterance and the queue. **Stop speech** at the top of the main screen does the same.
**Mute now** on the Device page mutes the whole shared route, so its purpose differs from turning TTS off. **Mute** at the top of the main screen is the same.
After the app restarts, TTS input and the bundled servers go back to off. Start the slots you need, then turn TTS on.

**Seed mode** in each language slot is random by default. With **Specify a value** you can specify an integer, including 0.
**Instruction** is a direction for how to voice the speech, and it is sent separately from the text to be read. Check whether the model supports it,
and if it does not, leave the value empty and use ordinary TTS. Saving alone does not start the model, the microphone or speech.

## If you do not have a model

Default models are available: Irodori for the Japanese slot on the TTS page, Qwen for the multilingual slot and Saisho Utane on the RVC page.
Under "Download a default model" → "Review download", check the provider, terms of use, size and save location.
Check the consent box and press "Agree and download". When the download and verification are complete, press "Apply model path".
You can cancel while it downloads. Apply only after stopping the server or input concerned. Applying saves only the path of the downloaded model,
and other fields you are editing in the form stay unsaved. If you are editing the path that will be replaced, save or discard it first.
Settings other than the model path are kept, and downloading or applying alone does not start a server, speech or the microphone.

Irodori is about 1.92 GB and Qwen about 1.21 GB. The RVC model and index come to about 336 MB together.
As lighter variants, you can also choose Irodori Q8 (about 1.21 GB) and Qwen Q5 (about 874 MB).
The TTS download section shows the GPU name, its total memory and the VRAM free at the moment, and suggests candidates using each model's estimated usage plus a margin.
You can switch between standard and lightweight by hand under "Model variant". The default margin is 2 GiB, for use alongside VRChat and similar apps.
You can change it to 0.5 GiB for TTS alone, but this neither reserves memory nor guarantees that it works.
You can also choose by hand when GPU information cannot be obtained. Shared memory and the CPU are kept apart from recommendations based on dedicated VRAM.
The memory of multiple GPUs is not added together; the guidance is for the first GPU, which the engine uses by default. This is not a UI for choosing which GPU runs the model.
Besides the model, RVC needs a runtime: ONNX Runtime (plus the CUDA and cuDNN libraries for GPU use), HuBERT and RMVPE. It does not need a Python environment (since 2026-11-15). The runtime is not part of this download section: you download it from the "RVC runtime" section on the RVC page, after a separate consent ([Windows](local-setup-windows.md#rvc), [Linux](local-setup-linux.md#rvcの実行環境)).
Public use of the Saisho model requires a CC BY 4.0 credit. For details, see [the download feature's specification and terms of use](model-downloads.md).

## Low-latency standby for Japanese TTS

Stop the Japanese server, set the inference device to GPU, select "Low-latency standby (Irodori GPU)",
then press "Save server settings" → "Start server". Check that it shows "Ready" and "Low-latency standby active".
It is off by default. While it is on, the GPU keeps repeating short warm-up computations, so power use rises and it may compete with games.
The audio from the standby computations is discarded and is not sent to the output. Standby continues even if you turn TTS off on the main screen.
To stop standby, stop the Japanese server or quit ASTAROT.

With an RTX 4080 SUPER, a fixed short sentence and Irodori F16 already loaded, the final AppImage had a p95 of 50.1 ms over 30 runs,
measured from sending in the GUI to the first PCM write. This does not guarantee the result for arbitrary text, other devices or use alongside a game, nor 100 ms until the sound reaches the ear.

For RVC, save the model and runtime on the **RVC** page and press **Prepare and use virtual microphone**.
On Linux where PipeWire and systemd user services are available, the needed virtual microphone is created automatically.
An existing managed route that is working correctly is reused. The prepare action does not restart the audio service, download models or record.
When preparation is complete, press **Unmute**, choose the physical microphone you speak into under **Input to forward** and turn on **RVC** on the main screen.
**Input to forward** starts out as the microphone chosen in **Mic device** on the Device page.
The input list on the RVC page is for the input before conversion, and it does not show ASTAROT's own virtual microphone, to avoid a loop.
In VRChat, choose **ASTAROT Managed Virtual Microphone** as the input.
This can also be set with **Audio route** at the top of the Device page. On Linux, **Mic device** on the Device page lists PipeWire inputs.
Until you choose another input on the RVC page, it follows changes made on the Device page. An input that is running is not switched.
The microphone for realtime speech recognition is chosen in the speech recognition settings.
Turning it off also cancels a start that is still waiting. If the original voice (input forwarding) is running, stop it first on its settings page. Seed-VC stopped being usable in 0.5.0 (item 10 in the list of decisions needed in [Core integration](core-integration.md)).
From 0.6.0, the converted voice on Linux is also written to the managed route (item 11 in the list of decisions needed in [Core integration](core-integration.md)).
The input chosen on the RVC page is kept when you move between pages. After a restart, the microphone from the Device page is the initial value again, so if you use a different input, choose it again.
Check the input selection after a device reconnects, too.

## Sending to VRChat

Set **Device → Audio route** to **Managed virtual microphone (Linux)** and save, and automatic preparation starts.
Check the preparation state and press **Unmute** when it is complete. The same preparation can also be started from the RVC page.
Preparation creates and enables 3 user services. The virtual microphone stays after ASTAROT quits and is created muted at the next login.
No administrator rights are needed. Where there is no systemd, use [the earlier manual setup](local-setup-linux.md#常駐する管理対象の仮想マイクb検証後の追加).

- In ASTAROT, set **Device → Audio route** to **Managed virtual microphone (Linux)**, save and press **Unmute**.
- Set VRChat's input to **ASTAROT Managed Virtual Microphone**.

The services created automatically are saved as `~/.config/systemd/user/astarot-managed-{source,tts,vc}.service`
(under XDG_CONFIG_HOME if it is set). They do not depend on the AppImage's temporary mount.
The `vrct-managed-*.service` units made by versions up to 0.6.0 are stopped and deleted by the core when it prepares the managed route, and created again under the new names.
Units whose content differs from what the core wrote are left in place, and `managed_setup_conflict` is reported (section 2.8 of ADR-014).
To remove them, first stop ASTAROT and switch the input of VRChat and other apps to another safe input, then stop and disable only these 3 services.
If the virtual microphone is removed suddenly from an app that is using it, the app may switch to another microphone, so ASTAROT does not delete it automatically when it quits.

To have translations read aloud, choose **Chat voice = Translated text** and the **Translation slot** to read.
You also need a server that supports the language being spoken; for languages other than Japanese, use the multilingual slot (for example, Qwen3-TTS).
The TTS engine and the translation engine are set separately.

## Quick Chat

Assign a key to "Open quick chat" under "Hotkeys" in the settings.
No key is assigned at first. The "Open input window" button also opens it.
Even while the main window is minimized, you can type in Quick Chat without bringing the main window back.
Quick Chat stays on top while it is shown. When you have finished typing, you can close it with Esc.
The hotkey opens it when you release the key.

Enter sends, Shift+Enter starts a new line and Esc closes. Closing with Esc or the close button keeps the draft.
It takes over the main window's settings for turning off sending with Enter and for clearing automatically, and translation, OSC and TTS use the same sending path.
While it waits for a send to be confirmed, you cannot send repeatedly. If the send is not confirmed, it keeps the draft and shows the reason.

On native Wayland, the shortcut is registered through the desktop's GlobalShortcuts portal.
The first time, the desktop shows a confirmation dialog when you close the settings screen. On KDE, the key set here is also applied on the desktop side.
On desktops that do not support the portal, open it with the button. Bringing Quick Chat to the front with the shortcut when it is behind a game works only on KDE (KWin).
On XWayland, keys and focus while you are using another Wayland app may be limited by the desktop.
It does not include a feature that suppresses key input to VRChat, nor a panel in VR space.
The technical scope and how it was verified are written in [the Quick Chat design record](quick-chat-design.md).

## Old candidates where RVC stops right away in the AppImage

A hardware test on 2026-10-30 found that the lightweight protocol file read by the external RVC/Seed-VC worker had been left out of the bundle.
Local candidates from before that may end with `vc_worker_eof`, and changing the virtual microphone or the model path does not fix it.
Release files from 0.1.0-beta.1 on contain this file. The models themselves are still not bundled.

---

# GUIから日本語テキストを読み上げる（日本語版）

AppImageにはspeech.cppの実行ファイルを同梱している。音声モデルは設定画面から取得するか、既存ファイルを指定する。
まずイヤホンへの出力で確認し、その後VRChat用の仮想マイクへ切り替えられる。
以下は現在の英語GUIの項目名。

1. メイン画面の歯車から **TTS** を開く。RVCは隣の専用ページ、共通の音声経路は **Device** にある。
2. ページの下のほうにある **Models and servers** を開き、**Japanese TTS** の **Model GGUF path** に
   既存のIrodori GGUFモデルのフルパスを入力する。`~`も利用できる。
   **Voice GGUF path (optional)** は空欄、**Inference device** は **Automatic** にする。
3. 画面の上の **Save changes** を押した後、Japanese TTSの **Start server** を押す。
   **Ready** になるまで待つ。保存だけではモデルを起動しない。
4. 上側の読み上げ設定を次の値にして **Save changes** を押す。

| 項目 | イヤホンで試すときの値 |
|---|---|
| Chat voice | Original text |
| Japanese server | Bundled server |
| Japanese voice name | none（Irodoriの標準音声） |
| Audio route（Deviceページ） | Existing external cable |
| Output device | 使用中のイヤホン／スピーカー |

Linuxでは通常の再生デバイスも選べる。
出力先がなければ **Refresh devices** で更新する。

仮想マイクへ送りながら自分でも聞きたい場合は、TTSページの **Hear it on my speakers** をOnにし、
**Monitor output** と **Monitor volume** を選ぶ（既定はOff）。VRChatが受け取る音声は変わらない。
マイクが拾わないようにヘッドホンを使う。モニター先が使えなくても、仮想マイクへの読み上げは続く。

5. ミュート中なら **Device → Unmute** を押し、**Voice enabled (confirmed)** を確認する。
6. メイン画面に戻り、**Your language = Japanese (Japan)** を選んで **TTS** をONにする。
   下部の入力欄へ日本語を入れて送信すると読み上げる。

メイン画面の **TTS** をOFFにすると読み上げ受付・再生・待ち行列を止める。直接入力・RVC・翻訳・OSCは継続する。
TTSページの **Stop playback and clear queue** は現在の発声と待ち行列だけを止める。メイン画面の上の **Stop speech** も同じ。
Deviceページの **Mute now** は共通経路全体のミュートなので、TTSのOFFとは用途が異なる。メイン画面の上の **Mute** も同じ。
アプリ再起動後はTTS受付と同梱サーバーがOFFに戻る。必要な枠を起動してからTTSをONにする。

各言語枠の **Seed mode** は既定でランダム。**Specify a value** では0を含む整数を指定できる。
**Instruction** は声の出し方の指示で、読み上げ本文とは別に送信する。モデルの対応状況を確認し、
非対応の場合は値を空にして通常のTTSを使う。保存だけではモデル・マイク・発声を開始しない。

## モデルを持っていない場合

TTSページの日本語枠にはIrodori、多言語枠にはQwen、RVCページにはSaisho Utaneの既定モデルを用意した。
「既定モデルのダウンロード」→「取得内容を確認」で、提供元・利用条件・容量・保存先を確認する。
同意にチェックして「同意してダウンロード」を押し、取得と検証が完了したら「モデルパスを適用」を押す。
取得中は取消可能。適用は対象のサーバー／入力を停止してから行う。適用で保存するのは取得したモデルのパスだけで、
フォームで編集中のほかの項目は未保存のまま残る。置き換えるパス自体を編集中の場合は、先に保存または破棄する。
モデルパス以外の設定は維持し、取得・適用だけではサーバー・発声・マイクを開始しない。

Irodoriは約1.92 GB、Qwenは約1.21 GB、RVCのモデルとindexは合計約336 MB。
軽量版としてIrodori Q8（約1.21 GB）、Qwen Q5（約874 MB）も選べる。
TTSの取得欄ではGPU名・総容量・現在の空きVRAMを表示し、モデルの使用量目安と余裕を含めて候補を案内する。
「モデルの種類」で標準／軽量を手動で変更できる。VRChat等と併用する2 GiBの余裕が既定で、
TTS単独用の0.5 GiBへ変更できるが、これはメモリの予約や動作保証ではない。
GPU情報を取得できない場合も手動で選択できる。共有メモリやCPUは専用VRAMの推奨とは区別する。
複数GPUの容量は合算せず、案内はエンジンが既定で使う先頭GPUに対するもの。実行GPUを選択するUIではない。
RVCはモデル以外に実行環境（ONNX Runtime、GPU用はCUDAとcuDNNのライブラリも、HuBERT、RMVPE）が必要。Python環境は要らない（2026-11-15から）。実行環境はこの取得欄には含まず、RVCページの「RVCの実行環境」の欄から別の同意を経て取得する（[Windows](local-setup-windows.md#rvc)、[Linux](local-setup-linux.md#rvcの実行環境)）。
Saishoモデルの公開利用時はCC BY 4.0のクレジット表示が必要。詳細は[取得機能の仕様と利用条件](model-downloads.md)を参照。

## 日本語TTSの低遅延待機

日本語サーバーを停止してから、推論デバイスをGPUにし、「低遅延待機（Irodori・GPU）」を選んで
「サーバー設定を保存」→「サーバーを起動」。準備完了と低遅延待機中の表示を確認する。
既定はOFF。ONの間はGPUで短い準備計算を繰り返すため、消費電力が増え、ゲームと競合する場合がある。
待機計算の音声は破棄し、出力へは流さない。トップのTTSをOFFにしても待機は続く。
待機を止めるには日本語サーバーを停止するかASTAROTを終了する。

RTX 4080 SUPER／固定短文／読込済みIrodori F16で、GUI送信から最初のPCM書込みまでの
最終AppImageで30回のp95は50.1 msだった。任意の文章・機器・ゲーム併用や、耳に届くまで100 msを保証するものではない。

RVCは **RVC** ページでモデルとランタイムを保存し、**仮想マイクを準備して使用** を押す。
PipeWireとsystemdのユーザーサービスを利用できるLinuxでは、必要な仮想マイクを自動で作成する。
既存の正常な管理対象経路は再利用する。音声サービスの再起動、モデル取得、録音は準備操作では行わない。
準備完了後に **ミュートを解除** を押し、**転送する入力** で自分が話す実マイクを選び、トップの **RVC** をONにする。
**転送する入力** の初期値は、デバイスページの **マイク（デバイス）** で選んだマイク。
RVCページの入力一覧は変換前の入力用で、ASTAROT自身の仮想マイクは循環を避けるため表示しない。
VRChatの入力には **ASTAROT Managed Virtual Microphone** を選ぶ。
デバイスページ先頭の **音声経路** でも設定できる。Linuxではデバイスページの **マイク（デバイス）** にPipeWireの入力が並ぶ。
RVCページで別の入力を選ぶまでは、デバイスページでの変更に追従する。動作中の入力は切り替えない。
リアルタイム音声認識のマイクは音声認識の設定で選ぶ。
開始待ちもOFFで取り消せる。原音（入力の転送）が動作中なら、その設定ページで先に停止する。Seed-VCは0.5.0で使えなくなった（[中核の統合](core-integration.md)の「判断が要ること」の10）。
0.6.0からは、Linuxで変換した声も管理対象の経路へ書く（[中核の統合](core-integration.md)の「判断が要ること」の11）。
RVCページで選んだ入力はページ移動では保持する。再起動後はデバイスページのマイクが初期値になるため、別の入力を使う場合は選び直す。
デバイスの再接続後も入力の選択を確認する。

## VRChatへ送る場合

**Device → Audio route** を **Managed virtual microphone (Linux)** にして保存すると自動準備が始まる。
準備状態を確認し、完了後に **Unmute** を押す。RVCページからも同じ準備を開始できる。
準備はユーザーサービス3件を作成・有効化する。ASTAROT終了後も仮想マイクを残し、次回ログイン時はミュートで生成する。
管理者権限は不要。systemdのない環境では[従来の手動導入](local-setup-linux.md#常駐する管理対象の仮想マイクb検証後の追加)を使う。

- ASTAROTの **Device → Audio route** を **Managed virtual microphone (Linux)** にして保存し、**Unmute**。
- VRChatの入力を **ASTAROT Managed Virtual Microphone** にする。

自動作成のサービスは `~/.config/systemd/user/astarot-managed-{source,tts,vc}.service`
（XDG_CONFIG_HOME指定時はその下）に保存される。AppImageの一時マウントには依存しない。
0.6.0までの版が作った `vrct-managed-*.service` は、管理対象の経路を準備するときに中核が止めて消し、新しい名前で作り直す。
中身が中核の書いたものと違うユニットは残し、`managed_setup_conflict` を出す（ADR-014の2.8）。
削除時は先にASTAROTを停止し、VRChat等の入力を安全な別入力へ切り替えた上で、この3サービスだけを停止・無効化する。
実行中の利用アプリから仮想マイクを突然削除すると、別マイクへ切り替わる可能性があるため、ASTAROT終了時には自動削除しない。

翻訳結果を読む場合は **Chat voice = Translated text** と対象の **Translation slot** を選ぶ。
発声する言語に対応するサーバーも必要で、日本語以外は多言語枠（Qwen3-TTS等）を使用する。
TTSエンジンと翻訳エンジンの設定は別。

## チャット入力の小窓

設定の「ホットキー」から「チャット入力の小窓を開く」にキーを割り当てます。
初期状態では未割り当てです。「入力の小窓を開く」ボタンでも開けます。
本体が最小化されていても、本体を戻さずに小窓へ入力できます。
小窓は表示中、最前面に保たれます。入力を終えたらEscで閉じられます。
ホットキーはキーを離すと開きます。

Enterで送信、Shift+Enterで改行、Escで閉じます。Escや閉じるボタンでは下書きが残ります。
本体のEnter送信無効・自動クリア設定を引き継ぎ、翻訳・OSC・TTSも同じ送信経路を使います。
送信の確認を待っている間は連打できません。未確認時は下書きを保持して理由を表示します。

ネイティブWaylandでは、デスクトップのGlobalShortcuts portalでショートカットを登録します。
初回は設定画面を閉じたときにデスクトップの確認画面が出ます。KDEでは、ここで設定したキーがデスクトップ側にも反映されます。
portalに対応していないデスクトップでは、ボタンから開いてください。ゲームの背面にある小窓をショートカットで前面に出す処理はKDE（KWin）のみ対応です。
XWaylandでは、別のWaylandアプリを操作中のキーとフォーカスはデスクトップの制限を受ける場合があります。
VRChatのキー入力を抑止する機能やVR空間のパネルは含みません。
技術上の範囲と検証方法は[小窓の設計記録](quick-chat-design.md)に記載しています。

## AppImageでRVCがすぐ停止する旧候補について

2026-10-30の実機試験で、外部RVC/Seed-VC workerが読む軽量プロトコルファイルの同梱漏れを確認した。
それより前のローカル候補では `vc_worker_eof` になる場合があり、仮想マイクやモデルパスの変更では直らない。
0.1.0-beta.1以降の配布物にはこのファイルが入っている。モデル自体は引き続き同梱しない。
