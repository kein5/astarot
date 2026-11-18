# Windowsで音声機能を使う

Windowsでは、TTS、同梱のspeech.cppサーバー、リアルタイム字幕、RVCを使えます。Seed-VCは0.4までのPythonバックエンドで動いていたもので、0.5.0では使えません（[中核の統合](core-integration.md)の「判断が要ること」の10）。Linuxと違い、アプリは仮想マイクを作れません。VRChatへ声を届けるには、別途インストールした仮想ケーブルを使います。

この手順の実機確認の記録は[Windows音声の検証記録](windows-voice-report.md)にあります。実マイクはSurfaceの内蔵マイクでだけ確かめました。VRChatの画面、実物のケーブル製品での確認はまだ終わっていません。

## 必要なもの

- GPUドライバー。同梱のspeech.cppはVulkan版で、ドライバーが入れる`vulkan-1.dll`を使います。ないとサーバーは起動しません。speech.cppのWindows版にCPU専用の配布はありません。`vulkan-1.dll`があってGPUが見つからないPCでは、「自動」はCPUを選びます。字幕だけならCPUでも動きました（[GPUの構成の模擬](windows-voice-report.md#gpuの構成の模擬2026-11-13)。Core i7-1255Uで遅れの中央値は2.7秒）。GPUが計算に失敗するとき（メーカーのドライバーがなく、Direct3D 12への変換層だけがあるPCなど）は、ドライバーの更新か別の推論デバイスを勧める案内が出ます。
- 仮想ケーブル。VB-CABLEなど、再生側と録音側の組になった製品を手動で入れます。アプリは入れません。
- モデル。音声モデルは設定画面の取得欄から、ライセンスとサイズを確認して取得します。
- RVCをGPUで変換するには、NVIDIAのGPU。ないPCではCPUで変換します（下の「RVC」）。

## 音声の経路

1. 設定の「TTS」で、出力デバイスにケーブルの**再生側**（例: CABLE Input）を選びます。
2. VRChatのマイクに、ケーブルの**録音側**（例: CABLE Output）を選びます。

出力デバイスの一覧はWASAPIの機器だけを表示します。以前の版で保存したMMEやDirectSoundの選択は、その機器がある間は一覧に残り、そのまま動きます。

TTSとRVCは、どちらもこの出力デバイスに書き込みます。Windowsの音声エンジンが2つの音を混ぜます。物理マイクをケーブルへ直接つながないでください。入力にケーブルの録音側を選ぶと、声が自分に戻るので開始を拒否します（`vc_feedback_blocked`）。字幕も、声の出力先のケーブルを読もうとすると拒否します（`realtime_endpoint_feedback`）。別の用途のケーブルは字幕に使えます。

ミュートは、TTSと、出力デバイスへ送る声の両方に効きます。OS側に遮断の仕組みがないので、アプリが無音に置き換えて書き込みます。ストリームは動き続けます。マイクの訳文読み上げで「直接音声を止める」を選ぶと、同じ方法で声を無音にします。

## TTS

設定の「TTS」でモデルを取得し、サーバーに「同梱」を選びます。メイン画面のTTSスイッチをオンにすると、サーバーが起動します。外部で動かすspeech.cppサーバーのURLを指定することもできます。

同梱のサーバーの推論デバイスは、「自動」「CPU」「GPU」のほかに、PCのGPUを名前で選べます。内蔵GPUと独立GPUの両方があるPCでは、「自動」と「GPU」で独立GPUが使われるとは限りません。[検証したPC](windows-voice-report.md)では、どちらも内蔵GPUを選びました。保存したGPUが見つからないときは「見つかりません」と表示します。

GPUドライバーのキャッシュが空のとき（ドライバーを更新した直後など）は、最初の起動に時間がかかります。検証したPCのRTX 3060 Tiでは、TTSのスイッチをオンにするまで41秒かかりました（VRChatを同時に動かしていない場合）。アプリは同梱のサーバーの起動中に短い文を1回合成して音を捨て、ドライバーの準備を済ませます。キャッシュが残っていれば、この処理はほとんど時間がかかりません。

## リアルタイム字幕

設定の「音声認識」→「リアルタイム字幕」で、サーバーに「同梱」を選び、ASRとVADのモデルを設定します。すると、メイン画面のマイクと聞き取りのスイッチがこの経路を使います。「外部」のままなら、スイッチは従来の録音（クラウドの音声認識API）を使います。リアルタイム字幕の設定画面の開始ボタンは、どちらの選択でも使えます。

聞き取りはWASAPIのループバックで、選んだスピーカーに流れる音を読みます。何も再生していない間は、無音として扱います。

同梱のサーバーの起動中に、ノイズを1回認識して結果を捨て、GPUドライバーの準備を済ませます。それでも接続の最初の結果は120秒まで待ちます。2件目からは15秒を超えると止まり、自動では再接続しません。

## RVC

RVCの設定画面、または「高度な設定」の入力の転送にある「実行環境」の欄から、実行環境を取得できます。ライセンス、サイズ、保存先を確認して同意すると、次を自動で行います。Gitも開発環境もいりません。

RVCの変換は、配布物に入っている`vrct-rvc-worker.exe`（`native/rvc-runtime`）が行います（2026-11-15から）。RVCの実行環境の準備は、次のとおりです。NVIDIAのドライバー（`nvcuda.dll`）があるPCにはGPU用、ないPCにはCPU用を出します。

1. GPU用は、ONNX Runtime 1.31.0（CUDA 13版。NuGetにあるMicrosoftの公式パッケージ`Microsoft.ML.OnnxRuntime.Gpu.Windows`）と、NVIDIAのCUDA 13.4とcuDNN 9.26のライブラリ（PyPIの`nvidia-cuda-runtime`、`nvidia-cublas`、`nvidia-curand`、`nvidia-cuda-nvrtc`、`nvidia-cudnn-cu13`のwheel）。CPU用は、ONNX Runtime 1.31.0のCPU版（`Microsoft.ML.OnnxRuntime`）だけです。アーカイブごとにサイズとSHA-256を照合し、ワーカーが読み込むDLLだけを`lib\`に取り出します。アーカイブは取り出したあとに消します。2026-11-18まではONNX RuntimeをGitHubのリリースから取得していました。そのときに準備した実行環境は、`lib\`のファイルが同じ名前なので、準備し直さずにそのまま使えます。
2. 基礎モデル（HuBERTの`config.json`と`pytorch_model.bin`、`rmvpe.onnx`）を取得して、ハッシュを検証します。
3. ワーカーの`--probe`で、取得したライブラリが読み込めて計算できることを確かめます。GPU用でGPUを使えないとき（ドライバーが580より古い、GPUがTuring＝GTX 16・RTX 20シリーズより前）は、CPUで変換すると表示して完了します。
4. 同じフォルダーに以前のPyTorch形式の実行環境があれば、そのファイル（`venv`、`python`、`engine`、`engine.zip`、固定の`rmvpe.pt`と`preprocessor_config.json`）を削除します。`engine`の中のモデルや音声のファイル（`.pth`、`.index`、`.wav`など）は残します。

Seed-VCの実行環境（uvで作るPythonの環境）は、0.5.0では取得の一覧に出ません（`native/voice-conversion/src/runtime.rs`）。以前の版でSeed-VCを選んでいた設定は、読み込むときにRVCへ移します。

| | RVC |
|---|---|
| 通信量の目安 | GPU用 約1.8 GB、CPU用 約0.6 GB |
| 必要な空き容量 | GPU用 約2.7 GB、CPU用 約0.8 GB |
| 完了後の大きさ | 未計測（取り出すファイルの合計はGPU用 約2.1 GB、CPU用 約0.6 GB） |
| 依存のPython | なし |

表はWindowsでの値です。RVCの値は、固定したファイルの大きさから計算した目安で、Windowsで取得して測ってはいません。Linuxでの値は[Linuxの手順](local-setup-linux.md#rvcの実行環境)にあります。

保存先はアプリのデータフォルダーの`vc_runtimes`です。途中で失敗したり中止したりしても、終わった手順は次回に飛ばします。終わったら「この実行環境を使う」を押して保存します。消したいときはこのフォルダーを削除します。アンインストーラーの「データを削除」でも消えます。

声のモデルは別です。RVCの設定画面の取得欄から取得するか、権利を確認したものを指定します。

RVCの開始は、Linuxの検証PCでGPUなら2〜9秒（PCの混み具合で変わります）、CPUなら9〜11秒でした。CPUで変換するときは、0.5秒ずつまとめて別のスレッドで変換し、変換した声は約1.3秒遅れて届きます。CPUが追いつかないと`vc_capture_overrun`で停止します。

RVCを止めている間も声を届けたいときは、入力の転送を使います。マイクの音をそのまま出力デバイスへ送ります。0.5.0ではアプリ（Rustの中核）が音声を運びます。0.4まではPythonが運んでいたので、PCが一瞬詰まると短く途切れることがありました。0.5.0での途切れ方は確かめていません。出力デバイスが2秒以上音声を受け取らないときは、外れたものとして止めます。

変換の速さはGPUとCPUの空きに左右されます。1ブロックは、その長さ（「高度な設定」の`RVC_BLOCK_MS`。既定は40 msで、以前は80 msに固定）のうちに変換し終える必要があります。一時的に遅れたブロックは捨てて続け、声が短く途切れます。直近の半分以上が遅れると、`vc_capture_overrun`で停止します。声の代わりに原音を流すことはありません。0.4までのSeed-VCは、開始時に処理時間を測り、間に合わないときは参照音声の長さと拡散ステップを段階的に減らしていました。TTSや字幕を同じGPUで動かすと、余裕はさらに小さくなります。検証したPCでVRChat、TTS、字幕、RVCをすべてRTX 3060 Tiに載せた試験では、30分の4回のうち1回、RVCが約12分で止まりました。2時間の1回では止まっていません。Seed-VCを同じ構成で30分動かした1回では止まりませんでしたが、遅れて捨てたブロックは増えました。測定は[検証記録](windows-voice-report.md)にあります。

### 手動で用意する場合

開発者向けです。RVCは次の構成のフォルダーを用意して、設定で指定します。中身は`native/voice-conversion/src/runtime.rs`の`gpu_libraries`、`cpu_libraries`、`rvc_assets`に固定したファイルです（0.4までのPythonでは`src-python/models/voice_conversion/runtime_setup.py`の`RVC_LIBRARIES`と`RVC_ASSETS`）。ワーカーは`build\vrct-rvc-worker.exe`で、`python tools/build_rvc_worker.py`でビルドします（Rustが必要です）。

```text
runtime\
  lib\        onnxruntime.dll、onnxruntime_providers_cuda.dll、onnxruntime_providers_shared.dll、
              cudart64_13.dll、cublas64_13.dll、cublasLt64_13.dll、curand64_10.dll、
              nvrtc64_130_0.dll、nvrtc-builtins64_134.dll、cudnn*64_9.dll
              （CPU用はonnxruntime.dllだけ）
  assets\     hubert_base\config.json、hubert_base\pytorch_model.bin、rmvpe\rmvpe.onnx
```

以前のPyTorchを使う実行環境（`venv`、`engine`）は、RVCでは使えなくなりました。

## マイクが開けないとき

`asr_capture_stream_create_failed`は、マイクを開けなかったことを示します。ほかのアプリの占有と、Windowsの設定の「プライバシーとセキュリティ」→「マイク」を確かめます。

一部のWindows（確認したのはInsider Beta build 26220）は、デスクトップアプリごとにマイクの許可を確認します。初めて開くときに確認の画面が出て、答えるまで開く処理が止まります。ASTAROTは120秒待ち、それでも答えがなければ`asr_capture_start_timeout`で止まります。確認の画面はデスクトップに出るので、VRのヘッドセットの中からは見えません。

答えないままプロセスが終わると、同じ場所のexeは次から確認なしで拒否され、`asr_capture_stream_create_failed`になります。MME、DirectSound、WASAPIのどれでも同じです。別の場所のexeには、改めて確認が出ます。開発用のビルド（`src-tauri\target\debug\vrct-vox.exe`など）から試すときも同じ扱いです。

ファイアウォールの確認など、別のシステムの確認が開いている間も、確認なしで拒否されます。こちらは記録に残らないので、その確認に答えてから開始し直せば確認が出ます。0.4までは、新しい場所のサイドカーが起動時にファイアウォールの確認を出したので、最初の開始で重なることがありました。0.5.0では中核がアプリのプロセスの中で待ち受けるので、確認の対象はアプリの実行ファイルです。

ファイアウォールの確認は、OSCQueryの公開に使うmDNSが全インターフェースのUDP 5353番で待ち受けるために出ます（0.5.0は`native/adapters/src/osc/mdns.rs`、0.4まではPythonのzeroconf）。VRChatから見つけてもらう仕組みなので、待ち受けの場所は変えていません。Microsoftの説明では、確認をキャンセルしたり閉じたりすると、そのプログラムの受信をブロックする規則がTCPとUDPに1つずつできます（[Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)）。試験では許可を選びます。VRChatを`--no-vr`で起動して、許可の規則があるexeとブロックの規則があるexeを比べたところ（2026-11-09）、どちらもOSCQueryの公開は有効になり、別のプロセスからサービスが見えました。同じPCで公開した疑似の`_oscjson._tcp`サービスを、ブロックの規則があるパスのプログラムから検索すると、許可の規則があるプログラムと同じように見つかりました（2回）。実物のVRChatをブロックの規則があるexeから見つけられるかは、確かめていません。

## モデル不要のテスト

開発に使うツールの版は`mise.toml`で固定しています（[開発ガイド](../development.md#用意するツール)）。先に`mise install`で入れておきます。

```powershell
mise install
mise run setup:headless
mise run check:voice
```

Windowsの実デバイスへ接続する場合はPyAudioWPatchが必要です。`mise run setup:app`（`npm run setup-python`と同じ`uv sync`）で作る`.venv`には入りますが、`headless`のvenvには入りません。
