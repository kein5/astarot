# P1 Linux / CachyOS / WiVRn

このページはソースcheckoutでの開発・CLI試験の手順。配布版のLinuxアプリは
[AppImageガイド](appimage.md)と[Linuxビルド手順](linux-build-pipeline.md)を参照。

ヘッドレスCLIはWindowsのPyAudioWPatch/pycaw/windows-captureをimportしない。
Pythonは標準ライブラリだけで発声でき、`pw-cat` / `pw-dump` が必要。
検証の記載は、2026-10-27以降の各作業時点のもの。以下のCLI→仮想マイク→VRChat desktopの経路は、
ユーザーが内蔵マイクテストの再生で声を確認済み。途中停止後のメーター停止も確認。
実VRCTアプリからVRChatの音声・OSCへ同時配信する一連の動作、他ユーザーでの受信、HMDは未検証。
取得済みIrodori MF / speech.cpp 0.8.11の単発PoCと、0.9.0の専用PipeWireグラフでの
[30回測定](benchmarks.md)は確認済み。新規モデル取得は行っていない。

## ネイティブ起動の作業状況

0.5.0からアプリのバックエンドはアプリの中で動くRustの中核で、開発用のPython sidecarはなくなった（[中核の統合](core-integration.md)）。
PythonのバックエンドとそのPython環境（`.venv_linux`、`mise run setup:app`）、CLI、試験は0.6.0で消した（#285）。

### 開発環境

Python、uv、Rustの版は`mise.toml`で固定している（[開発ガイド](../development.md#用意するツール)）。

```sh
mise install
mise run setup:headless   # モデルなしの試験の依存（build/dev/headless-venv）
mise run setup:resources  # tauri dev と cargo check が読む src-tauri/bin/_internal
```

`setup:resources`については[開発ガイド](../development.md#tauriが読む資源を用意する)を参照。

### 同梱サーバーと音声ヘルパーを用意する

開発起動のバックエンドは、同梱speech.cppサーバーと音声経路のヘルパーをソースツリーの`build/`から読む。
新しいcheckoutやworktreeには`build/`がないので、用意しないと設定の「TTS」や「音声認識」で「サーバーを起動」を押しても失敗する。

```sh
mise run build:voice-gate
python tools/speechcpp_bundle.py --variant linux-x64-vulkan --archive /path/to/speech-0.11.0-linux-x64-vulkan.zip --output build/speechcpp
python tools/speechcpp_bundle.py --variant linux-x64-cpu --archive /path/to/speech-0.11.0-linux-x64-cpu.zip --output build/speechcpp-cpu
```

`build_voice_gate.py`は、`build/astarot-voice-gate`、`astarot-source-bridge`、`astarot-screen-capture`をビルドする。`libpipewire-0.3-dev`が必要。
`astarot-screen-capture`がないと、チャット読み取りの「ウィンドウを共有…」は`screencast_helper_missing`で止まる（`src-tauri/src/portal_screencast.rs`）。
0.5.xまでは`vrct-vc-worker`と`vrct-asr-capture`もビルドして同梱していた。`vrct-vc-worker`は0.4までのPythonバックエンドが同梱サーバーと声質変換の起動に使ったヘルパー、`vrct-asr-capture`はLinuxの音声認識の録音のヘルパーで、中核はどちらも起動しなくなったので、0.6.0でソースごと消した（ADR-014、#809）。

`speechcpp_bundle.py`は、版とSHA-256を固定した書庫から、`speech`本体と同梱のライセンス文書を出力先に置く。配布物と同じく、Vulkan版は`build/speechcpp`、CPU版は`build/speechcpp-cpu`に置く。どちらのビルドかは`bundle.json`で決まり、フォルダの名前では決まらない。
書庫が手元になければ、`--archive`の代わりに`--download`を指定すると取得する。通信するのは`--download`を指定したときだけ。
片方だけでも動く。CPU版だけなら推論はCPUだけになる。Vulkan版だけでも「CPU」を選べるが、Vulkanローダー（`libvulkan.so.1`）が要る。出力先がすでにあると、上書きせずに止まる。`--replace`を付けると、同じ版はそのまま残し、別の版の部品だけを置き換える。
Linux候補をビルド済みなら、`build/linux/build/speechcpp`と`build/linux/build/speechcpp-cpu`を`cp -a`でコピーしてもよい。
アプリは起動のたびに版とハッシュを検査し、シンボリックリンクは受け付けないので、リンクではなくコピーにする。
2つとも見つからないか検査に合わないと、同梱サーバーの起動は`speech_bundle_missing_or_invalid`で止まる。

開発起動で取得したモデルは、`config.json`と同じフォルダの`downloaded_models/`に保存される。開発用のビルドでは、`VRCT_CONFIG_DIR`を指定しなければ実行ファイルのあるフォルダ（`src-tauri/target/debug/`など。gitの対象外）になる（`src-tauri/src/backend_host.rs`の`folders`）。0.4までのPythonバックエンドは`src-python/downloaded_models/`に保存していた。

Windows専用の3依存（PyAudioWPatch、windows-capture、pycaw）は`pyproject.toml`のOS markerで選択する。チャット読み取りのRapidOCRはLinuxにも入る。
`opencv-python`は`tool.uv.exclude-dependencies`で除き、同じ`cv2`を提供する2種類のOpenCVの同時導入を避ける。
Linuxのチャット読み取りは、VRChatのウィンドウをX11/XWayland経由で取り込む。SteamVRが動いている間は、ヘッドセットの映像をOpenGLで読む（偽のSteamVRでだけ確認）。Waylandネイティブのウィンドウは、利用者が設定の「チャット読み取り」で共有すると読み取れる（XDG ScreenCast portal。開発ビルドは`build/astarot-screen-capture`を使う）。従来ASRの録音は未対応。
2026-11-11に、Protonで動く実際のVRChat（ローカルの試験インスタンスにクライアントを2つ）と、実際のPP-OCRのモデルで確認した（CachyOS、KDE Plasma 6.8、Wayland）。X11/XWaylandの経路は、もう一方のクライアントが送ったチャットを読めた。共有の経路は、入れ子のXwayland（KWinから見るとWaylandネイティブのウィンドウ）の中で動かしたVRChatを共有して読めた。このとき「6文のうち5文（開発ビルド）、4文（AppImage）」と記録したが、読めなかったのではなく、確認の手順の誤りだった（2026-11-12に訂正）。会話ログは画面に見えている行だけを描くので、ログが画面を埋めたあとの行を数えられていなかった。gamescopeの中のVRChatと、WineのWaylandドライバーで動くVRChatでは確認できていない（gamescope 3.17はウィンドウが落ち、使ったProton-GEはWaylandドライバーの指定を受け付けなかった）。音声タイピングモードの貼り付けは、実際のVRChatのチャット欄に文字が入ることを確認した。GNOMEなど、KDE以外のデスクトップでは確認できていない。
2026-11-12に、同じ構成で12文（日本語と英語、2行に折り返す長さの文を含む）を10秒おきに送って測り直した（開発ビルド、develop `5d4b1a16`に#196の変更を足したもの）。X11/XWaylandの経路、共有の経路とも12文すべてを読み、送ってからログに出るまでは0.6〜1.5秒だった（X11の1文だけ4.2秒）。吹き出しの検出モデルは入れていないので、看板の文字も結果に混じる。試験用のワールドは数秒ごとに話し手とカメラの位置を変えるため、距離や背景は文ごとに違う。確認のときは、名前の検索が話し手側のウィンドウを拾わないよう、話し手側のウィンドウのタイトルを変えた（2つのクライアントがどちらも`VRChat`という名前になるため）。
この手順はPython依存のみを取得し、ASR/TTS/VC重みの取得スクリプトは実行しない。
Pythonの取得・package通信にはネットワークが必要。システムのGTK/WebKitGTK依存は
[Tauri公式の準備手順](https://v2.tauri.app/start/prerequisites/)を参照。

0.4までは、アプリの起動時に`VRCT_DEV_VENV=.venv_linux`でこの環境を選択できた。0.5.0のアプリはPythonを起動しないので、この変数を読まない。
`VRCT_CONFIG_DIR=/absolute/path/to/state`は、`config.json`、ログ、`downloaded_models/`、`vc_runtimes/`の保存先を変える。指定しなければ従来の保存先を使う。
同梱資源（`build/`）とUI資源の場所は変えない。既存設定を試験用ディレクトリへコピーする必要はない。
0.4までは「その他」のモデル自動取得をONにすると、次回起動時に内蔵翻訳のモデルを取得した。0.5.0では起動時の自動取得をやめ、スイッチも設定画面から外した（設定のキーは互換のために残る）。モデルの取得は、同意の画面からの明示の操作だけで行う。

Pythonバックエンドの起動の自動試験（`tests/platform/test_native_backend.py`）は、バックエンドと一緒に0.6.0で消した。中核の起動、設定の引き継ぎ、再起動は`native/core/tests/lifecycle.rs`などが確かめる。

## RVCの実行環境

Linux（x86-64）でも、RVCの実行環境をアプリから取得できます。画面と流れはWindowsと同じです。Seed-VCの実行環境は0.4までのPythonバックエンドのもので、0.5.0では一覧に出ません（`native/voice-conversion/src/runtime.rs`）。この節のSeed-VCの記述は0.4までの記録です。0.5.0の中核はLinuxで声質変換の経路（管理された VC の入力）をまだつないでいません（[中核の統合](core-integration.md)の「判断が要ること」の11）。「設定」→「RVC」、または「高度な設定」の「入力音声の転送」に、「RVCの実行環境」の欄があります。「取得内容を確認」を押し、ライセンス、サイズ、保存先を確認して同意すると始まります。同意するまで、何も取得しません。

必要なものは次のとおりです。

- x86-64のPC。それ以外では、取得の欄を表示しません。
- GPUで変換するには、NVIDIAのGPUとNVIDIAのドライバー。アプリは`/proc/driver/nvidia/version`があるかどうかで、ドライバーが動いているかを確かめます。nouveauなど、このファイルがない環境ではCPU用の実行環境を出します。

RVCの変換は、配布物に入っている`astarot-rvc-worker`（`native/rvc-runtime`）が行います（2026-11-15から）。RVCはドライバーがなくても取得できます。ドライバーがあるPCにはGPU用、ないPCにはCPU用の実行環境を出します。同意すると、次を順に行います。

1. GPU用は、ONNX Runtime 1.31.0（CUDA 13版。NuGetにあるMicrosoftの公式パッケージ`Microsoft.ML.OnnxRuntime.Gpu.Linux`）と、NVIDIAのCUDA 13.4とcuDNN 9.26のライブラリ（PyPIの`nvidia-cuda-runtime`、`nvidia-cublas`、`nvidia-curand`、`nvidia-cuda-nvrtc`、`nvidia-cudnn-cu13`のwheel）を取得します。CPU用は、ONNX Runtime 1.31.0のCPU版（`Microsoft.ML.OnnxRuntime`）だけです。アーカイブごとにサイズとSHA-256を照合し、ワーカーが読み込む`.so`だけを`lib/`に取り出して、アーカイブは消します。2026-11-18まではONNX RuntimeをGitHubのリリースから取得していました。そのときに準備した実行環境は、`lib/`のファイルが同じ名前なので、準備し直さずにそのまま使えます。
2. 基礎モデル（HuBERTの`config.json`と`pytorch_model.bin`、`rmvpe.onnx`）を取得して、ハッシュを検証します。
3. ワーカーの`--probe`で、取得したライブラリが読み込めて計算できることを確かめます。GPU用でGPUを使えないとき（ドライバーが580より古い、GPUがTuring＝GTX 16・RTX 20シリーズより前）は、CPUで変換すると表示して完了します。
4. 同じフォルダーに以前のPyTorch形式の実行環境があれば、そのファイル（`venv`、`python`、`engine`、`engine.zip`、固定の`rmvpe.pt`と`preprocessor_config.json`）を削除します。`engine`の中のモデルや音声のファイル（`.pth`、`.index`、`.wav`など）は残します。

0.4までのSeed-VCでは、同意すると次を順に行いました。Gitも開発環境もいりませんでした。

1. 固定版の`uv`を取得します。公式リリースの`uv-x86_64-unknown-linux-gnu.tar.gz`で、サイズとSHA-256を照合します。
2. Pythonと、ハッシュを固定した依存（`integrations/seed_vc/requirements.lock`）を入れます。
3. エンジン本体（GitHubのアーカイブ）を取得して、内容を検証します。展開する前に、項目の数と展開後の容量、圧縮率、パス、種類（通常のファイルとフォルダーだけ）を確かめます。展開して、Seed-VCには同梱のパッチを当てたあと、全ファイルの名前と中身から作ったダイジェストを固定値と照合します。合わなければ、展開したものを消してインストールしません（セキュリティ監査 SEC-04）。
4. 基礎モデルを取得して、ハッシュを検証します。
5. 実行環境のPythonで`torch.cuda.is_available()`を確かめます。

| | RVC | Seed-VC（0.4まで） |
|---|---|---|
| 通信量の目安 | GPU用 約1.9 GB、CPU用 約0.6 GB | 約6.4 GB |
| 必要な空き容量 | GPU用 約3.3 GB、CPU用 約0.7 GB | 約18 GB |
| 完了後の大きさ | GPU用 約2.5 GB、CPU用 約0.55 GB | 約9.5 GB |
| 依存のPython | なし | 3.11 |

RVCの列は、2026-11-15に下と同じPCで1回ずつ取得した値です。通信量はカタログの値（固定したファイルの合計、GPU用1.87 GB、CPU用0.56 GB）で、完了後の大きさは`du -sh`、かかった時間はGPU用260秒、CPU用10秒でした。必要な空き容量は、取り出したファイルと基礎モデルに、いちばん大きいアーカイブ（GPU用はcuDNN、0.52 GB）を足して切り上げた目安で、取得中の最大値は測っていません。

Seed-VCの列は、2026-11-11に1台のPCで1回ずつ取得して測った値です（CachyOS、RTX 4080 SUPER、NVIDIAドライバー620.70.06、btrfs、有線の回線）。通信量は、取得中にネットワーク機器が受信したバイト数です（RVCは4.83 GB、Seed-VCは6.28 GB）。必要な空き容量は、取得中のフォルダーの大きさ（`du -sb`）の最大値を切り上げた値で、RVCは15.6 GB、Seed-VCは17.5 GBでした。`uv`のキャッシュと導入先を別々に数えています。`uv`は、ファイルシステムが対応していれば両者でデータを共有するので（reflinkまたはハードリンク）、その場合に実際に使う容量はこれより小さくなります。かかった時間はRVCが62秒、Seed-VCが139秒ですが、回線の速さで大きく変わります。

保存先は、`config.json`と同じフォルダーの`vc_runtimes`です。配布版では`~/.config/astarot/vc_runtimes`（0.5.xまでは`~/.config/vrct-vox/vc_runtimes`）、ソースからの開発起動では、`VRCT_CONFIG_DIR`を指定しなければ実行ファイルのあるフォルダーの`vc_runtimes`になります（`src-tauri/target/debug/`など。gitの対象外です。0.4までのPythonバックエンドでは`src-python/vc_runtimes`）。途中で失敗したり中止したりしても、終わった手順は次回に飛ばします。0.4までのSeed-VCでは、中止すると`uv`と`uv`が起動したプロセスをまとめて止め、アプリが異常終了したときも`uv`は一緒に終わりました。終わったら「この実行環境を使う」を押して保存します。消したいときは、このフォルダーを削除します。

声のモデルは別です。RVCの設定画面の取得欄から取得するか、権利を確認したものを指定します。0.4までのSeed-VCには、利用が許可された参照音声（1〜30秒のWAV）を指定しました。

確認できたのは、上のPCでの取得と、取得した実行環境でRVCとSeed-VCのワーカーを起動して、合成した音声を変換するところまでです。音質、ほかのディストリビューション、配布版（AppImage）からの取得は確かめていません。

手動で用意する場合、RVCは`lib/`と`assets/`の構成（[Windowsの手順](local-setup-windows.md#手動で用意する場合)と同じで、`.so`の名前は`native/voice-conversion/src/runtime.rs`の`gpu_libraries`と`cpu_libraries`のとおり）を使います。0.4までのSeed-VCは[Seed-VCのREADME](https://github.com/kein5/astarot/blob/v0.5.2/integrations/seed_vc/README.md)の手順でした。以前のPyTorchを使うRVCの実行環境は使えなくなりました。

## 一時的な仮想マイク

最初にイヤホンまたはWiVRnの音声デバイスを接続し、`wpctl status`で
VRChat出力がそのデバイスへ流れていることを確認する。
`Dummy Output`しかない場合は、通常セッションにloopbackを作る前に音声出力を接続する。
今回、出力未接続で作った仮想sinkへゲーム出力が移動したため、発声せず削除した。
`priority.session=-100`やsmart filterの指定だけでは、他の出力がない状態の混線を防げなかった。

準備後、既存の音声設定を置換せず、端末で一時loopbackを起動する。
[PipeWire loopback原典](https://docs.pipewire.org/page_module_loopback.html)のsink/source構成を使う。

```sh
pw-loopback --capture-props='media.class=Audio/Sink node.name=vrct.voice.sink node.description="VRCT Voice Input" audio.position=[MONO]' --playback-props='media.class=Audio/Source node.name=vrct.voice.source node.description="VRCT Virtual Microphone" audio.position=[MONO] node.passive=true'
```

`pw-dump` / `pw-link -l` / `wpctl status` でsink/sourceが作られたことを確認。
**VRChat出力→イヤホン、VRCT出力→専用sink、専用source→VRChat入力**に分離する。
ゲーム出力が専用sinkにつながった場合は発声せずloopbackを終了し、出力先を修正する。
物理音声デバイスが切断中だと、WirePlumberがこの仮想ノードを有効な既定出力/入力に
選ぶ場合がある（今回も観測）。他アプリの出力とASR入力は明示指定し、作成前後の
`wpctl status`を確認する。VRCT自身は既定デバイスへのfallbackを行わない。
VRChatのマイクを **VRCT Virtual Microphone** に指定する。
物理マイク、ゲーム出力、WiVRn音声をこのsinkへ直接リンクしない。
終了時はloopback端末でCtrl-C。一時ノードだけが消える。
自動試験だけなら[専用PipeWire環境のCLI](benchmarks.md#反復cli)を使用する。

## speech.cpp→仮想マイク

ユーザーが許諾確認して用意済みのローカルモデルで起動（以下はパス例）。
参照音声を使わない場合は `none`。使う場合は本人同意済みのvoice.ggufを登録。

0.5まではPythonのバックエンドのCLI（`tools/voice_cli.py`）で読み上げを仮想マイクへ流した。0.6.0でバックエンドと一緒に消した（#285）。
中核の読み上げを本物のspeech.cppと出力で流して測るには、`native/core/examples/live_speech.rs`を使う。
Linuxでは`--route managed --private-pipewire`で、私用のPipeWireの管理された経路に流し、仮想マイクで聞こえ始める時刻を測る（使い方はファイルの先頭）。

## 手動受入とP2入口

- VRChatの[マイクテスト](https://wiki.vrchat.com/wiki/Settings#Microphone)は短い録音の後に再生する。
  テスト開始してから送信を長く待つと、録音区間から音声が外れる可能性がある。
  入力メーターが動いている間に`New Test`を押すなどしてタイミングを合わせる。
  音声送信は各要求1回。録音の`Play Again`による再生回数とは区別する。
- 停止/Ctrl-C後に入力メーターが止まるか。VRChatがすでに録音したclipの再生はVRCTの停止対象外。
- loopbackを削除→エラー、物理スピーカーへのfallbackなし。復元→明示再選択後に新しい文で再試行。
- WiVRn入力/出力を図示し、ゲーム音声・TTS monitorを将来のASR入力から除外する。
- P2外部VC: 別ソフトの入力を物理マイク、出力を**変換専用sink**へ設定して単体確認。
  生マイクの自動fallbackがない設定を確認するまでVRChatへつながない。
  VC停止時の無音、モデル/OS/版、遅延、VRAM、利用条件を記録して採用判断する。
  P1のTTS sinkへ直接混ぜる操作はP2 routerの検証後に行う。

## 常駐する管理対象の仮想マイク（B検証後の追加）

これはソースcheckout向けの任意機能。上の一時マイクとは名前が異なる。
後続のホスト・VRChat自動受入で一時配置と再起動を実施し、
試験後に元の設定へ戻した。初期画面の準備と復元はエージェントが確認し、受入シーケンスを自動実行した。
VRCT全GUIのLinux対応完了を意味しない。後続のUI部品・stdio統合試験では本番入力欄・
音声設定UIと本番Main/Controllerを実TTS・独立PipeWireへ接続した。Tauri接続と周辺サービスは差し替えており、
アプリ全体の起動・設定永続化・実Model初期化は未検証。

1. systemのC compiler、pkg-config、PipeWire開発headersを用意し、repo rootでビルドする。
   CachyOSの今回の環境には既に揃っていた。Pythonパッケージや音声モデルは追加しない。

   ```sh
   uv run --no-project python tools/build_voice_gate.py
   ```

2. 実音声が中断してよいタイミングで、設定をユーザーのPipeWire設定へ配置する。
   この再起動はVRChat/WiVRnを含む音声接続を中断する。
   他の設定は置換しない。既に同名ファイルがある場合は内容を確認してから置換する。

   ```sh
   mkdir -p ~/.config/pipewire/pipewire.conf.d
   cp config/pipewire/90-vrct-managed.conf ~/.config/pipewire/pipewire.conf.d/90-vrct-managed.conf
   systemctl --user restart pipewire pipewire-pulse wireplumber
   ```

3. イヤホンなどの実出力を接続した状態で `wpctl status` / `pw-link -l` を確認する。
   ゲーム音声はイヤホンへ、TTS出力は `vrct.managed.tts`、VC出力は `vrct.managed.vc` へ、
   VRChatの入力は **VRCT Managed Virtual Microphone** (`vrct.managed.source`) へ明示指定する。
   `priority.session=-100` はOS全体のdefault選択を禁止する設定ではない。実出力が消えた場合などの
   自動選択は別途確認が必要で、既定出力にこのsinkを選ばない。
4. VRCTの読み上げ設定で「管理対象の仮想マイク（Linux）」を保存する。
   初期状態はミュート。「音声を再開」で確認済みになるまで出力しない。
   「再開するまでミュート」はこの経路に入ったTTS/VCを止める。
   既存の「停止」はTTSだけを取り消す。外部ケーブルモードの保持ミュートもTTSだけに適用する。
   外部ケーブルの選択値はmanagedへ切り替えても保存される。
5. `voice_mute_state.json` はアプリの `config.json` と同じディレクトリに作られる。
   破損や書込み失敗はエラーとミュート要求として扱い、成功表示しない。
   書込み可能な状態へ修復後にミュートを要求し、確認されてから再開する。

0.5までは、VRCTの停止中に同じstate fileを明示して状態を見たり変えたりするCLI（`tools/voice_route.py`）があった。
PythonのバックエンドのPipeWireの部品を使っていたので、0.6.0でバックエンドと一緒に消した（#285）。
起動中のVRCTは外部からの状態変更を検出するとミュートへ戻すため、通常操作にはUIを使う。

戻すには、まずミュート確認後にVRCTを外部ケーブル設定へ戻し、VRChatで安全な入力を選び直す。
配置した `~/.config/pipewire/pipewire.conf.d/90-vrct-managed.conf` **だけ**を削除し、
音声を中断してよいタイミングで上記userサービスを再起動する。アプリ側の保持ミュートは
残るため、必要なら明示再開する。任意のPipeWire設定ディレクトリ全体は削除しない。

通常のVRCT終了ではgateをミュートしてendpointを残す。SIGKILLや電源断で終了処理が走らない
場合はgateの直前の状態が残る。解除中のVRCT強制終了だけでは外部VCの音は止まらない。
VRCT再起動時は再度ミュートする。PipeWire daemon停止では仮想マイクも消えるため、
その際のVRChat入力fallbackは引き続き実機確認が必要。
