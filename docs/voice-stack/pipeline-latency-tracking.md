# 音声パイプラインの遅延の継続計測（Bencher）

音声パイプラインの遅延のp50とp95を、CIでBencherへ送って時系列で追います（#738）。developへのpushで履歴としきい値を積み、プルリクエストではその基点と比べた結果をコメントに出します。しきい値は、p50だけに付けた統計的な検定（t検定）によるアラートです。p95は記録してグラフで見ます。アラートでCIは失敗せず、マージも止めません。

CIで測るのは、中核が自分で足す時間です。認識、翻訳、音声合成のエンジンを、すぐに答える偽物に替えて測ります。そのため、#556の目標（話し終わりから訳した声が聞こえ始めるまで、p50で0.7秒以下、p95で1.0秒以下）と比べられる値ではありません。目標と比べる値は、実モデルで測る`pipeline_latency`の値です（[実モデルの値](#実モデルの値)）。

## CIで測るもの

`native/core/tests/pipeline_overhead.rs`が測ります。中核をアプリと同じように起動し、Linuxのリアルタイム字幕、DeepLでの翻訳、チャットボックスの送出、訳文の読み上げを有効にします。マイクから音声を流し続け、偽の認識サーバーに1回ずつ発話を確定させます。前の発話がチャットボックスと声の両方に届いてから、次の発話を確定させます。

| 部分 | 代わりに使うもの |
|---|---|
| リアルタイム字幕のサーバー | `tests/common/fake_asr.rs`。試験が頼んだときに1つの発話を確定させ、その時刻を記録します。本物のspeech.cppと同じく、接続に`TCP_NODELAY`を付けます。 |
| 翻訳 | `astarot_translation::fake`のDeepL。すぐに答えます。 |
| 読み上げのサーバー | `tests/common/fake_tts.rs`のspeech.cpp。冒頭に0.42秒の無音を付けて返します。speech.cppのQwen3-TTSの冒頭の無音（[2026-11-18の記録](pipeline-latency-2026-11-18.md)で421〜435 ms）に合わせた長さです。接続には`TCP_NODELAY`を付けます。 |
| 読み上げの出力 | 試験の中の出力。振幅64を超えるサンプルを最初に書いた時刻を記録し、デバイスと同じ速さで受け取ります（先読みは40 msまで）。 |
| チャットボックス | 127.0.0.2で待つUDPのソケットです。 |

最初の3つの発話は慣らしとして数えず、続く40の発話を数えます。値は次の2つです。

| ベンチマーク | 区間 |
|---|---|
| `core: final to chatbox` | 認識サーバーが発話の確定を送る直前から、チャットボックスのメッセージが届くまで |
| `core: final to audible speech` | 同じ時点から、訳文の読み上げが最初に聞こえる大きさで書かれるまで |

この区間には、中核のスレッドと待ち行列、127.0.0.1でのサーバーへの要求、読み上げの冒頭の無音を飛ばす処理が入ります。たとえば無音を飛ばす処理を外すと、`core: final to audible speech`のp50は約25 msから約405 msに延びます（2026-11-20、Linuxで確かめた値）。

CIでは`voice-tests.yml`の`core-integration`がこの試験を流します。ジョブはWindowsとLinuxで動き、testbedはOSごとに分けます（`ubuntu-latest`、`windows-latest`）。試験はデバッグビルドで動くので、値はリリースビルドの時間とも違います。計測が失敗しても`core-integration`は失敗しません。

手元では次のように流します。値は標準エラーにも出ます。

```sh
ASTAROT_PIPELINE_BMF=pipeline-latency.json cargo test --locked --manifest-path native/core/Cargo.toml \
    --test pipeline_overhead -- --ignored --nocapture
```

## 値の形式

結果はBencher Metric Format（BMF）のJSONです。ベンチマークごとに、次の2つのmeasureを持ちます。

| measure | 内容 | 単位 |
|---|---|---|
| `latency-p50` | 50パーセンタイル（最近接順位） | ミリ秒 |
| `latency-p95` | 95パーセンタイル（最近接順位） | ミリ秒 |

パーセンタイルの求め方は`pipeline_latency`の要約と同じです。書き出しの処理は`native/core/tests/bmf/mod.rs`にあり、CIの試験と`pipeline_latency`が共有します。

```json
{
  "core: final to chatbox": {
    "latency-p50": { "value": 22.7 },
    "latency-p95": { "value": 24.6 }
  }
}
```

## Bencherへの送り方

ワークフロー`pipeline-latency.yml`が送ります。`voice-tests.yml`が終わると動き、`core-integration`が残した結果をOSごとに受け取って、Bencher CLI（`bencherdev/bencher`）の`bencher run --adapter json`で送ります。

このワークフローは`workflow_run`で動くので、プルリクエストの版ではなく、常にdevelopにある版が動きます。そのため、プルリクエストでこのファイルを変えても、Bencherの鍵を持つ処理は変わりません。変更はdevelopにマージしてから効きます。リポジトリのコードはチェックアウトせず、計測の結果のJSONだけを受け取ります。プルリクエストの番号、ブランチ、コミットは、GitHubがその実行について記録した値から読みます。リポジトリの安全の試験（`tests/voice/test_security_regressions.py`）が、このワークフローの権限と、鍵を受け取る手順を確かめます。

| きっかけ | 送り方 |
|---|---|
| developへのpush | ブランチ`develop`に送ります。しきい値を毎回この設定に合わせます（`--thresholds-reset`）。履歴は、ワークフローの`BENCHER_START_POINT_IDEMPOTENCY_KEY`の値ごとに分かれます（下記）。 |
| 同じリポジトリのブランチからのプルリクエスト | プルリクエストのブランチに送ります。基点はマージ先のブランチとそのコミットで、基点のしきい値を写します。結果とアラートはプルリクエストのコメントに出ます。 |
| フォークからのプルリクエスト、ほかのブランチへのpush、マージキュー | 送りません。 |

しきい値は `latency-p50` だけに付けます。`latency-p95` にはしきい値を付けず、値を送って記録し、グラフで見ます（2026-11-21に決定、#738の判断5）。p95は40の発話の上から2番目の値なので、ランナーの1回の引っかかりで跳ねます。しきい値を付けていた2026-11-20から21日にかけてのアラート22件のうち21件がp95で、どれも単発でした。中核が本当に遅くなればp50も上がるので、p50のアラートで気づけます。developの送信は `--thresholds-reset` を付けているので、指定しなくなったp95のしきい値は次の送信で消えます。p50のしきい値は次の設定です。

- 検定: t検定（`t_test`）
- 比べる履歴: 直近の64件まで。10件たまるまではアラートを出しません（`--threshold-min-sample-size 10`）。件数が少ないうちは境界が狭く、ランナーのぶれだけでアラートが出るためです。
- 上側の境界: 0.99。下側（速くなったとき）はアラートを出しません。

測るものが変わって値が一段変わったときは、developの履歴を空からやり直します。`pipeline-latency.yml`のdevelopの送信の`BENCHER_START_POINT_IDEMPOTENCY_KEY`を新しい値に替えると、その値で最初に送ったときに履歴が空になり（`--start-point-reset`）、同じ値の2回目からは続きに積まれます。2026-11-21に、試験の偽のサーバーに`TCP_NODELAY`を付けて（#738、#556）、Linuxの値が約20 ms下がったので、`develop-2026-11-21-fake-servers-tcp-nodelay`でやり直しました。

アラートが出ても、`bencher run`は失敗しません（`--error-on-alert`を付けていません）。送る手順は`continue-on-error`なので、Bencherに届かないときもワークフローは失敗しません。ただし`--github-actions`を付けて送ると、Bencherが「Bencher Report」というチェックを作り、アラートがあるとそのチェックが失敗になります。このチェックはdevelopのルールセットの必須のチェックに入っていないので、マージは止まりません。

### 保守担当者がする準備

リポジトリにBencherの鍵とプロジェクトがないあいだは、`pipeline-latency.yml`は何も送らず、送らなかった理由を注記に出します。送るには、次の準備が要ります。

1. Bencher Cloudで公開のプロジェクトを作ります。公開のプロジェクトは無料のプランで使えます。無料のプランの上限は1日65,535メトリクスで、CIの1回の送信は8メトリクス（ベンチマーク2つ×measure 2つ×OS 2つ）です。課金の設定はしません。
2. プロジェクトのAPIキー（`bencher_run_`で始まるプロジェクトのキー）を作り、リポジトリのシークレット`BENCHER_API_KEY`に登録します。
3. プロジェクトのスラッグを、リポジトリの変数`BENCHER_PROJECT`に登録します。
4. ワークフロー`bencher-measures.yml`をdevelopで手動で実行します（`gh workflow run bencher-measures.yml --ref develop`）。measureの`latency-p50`と`latency-p95`がなければ作り、どちらも単位をミリ秒（`milliseconds (ms)`）にします。BencherのConsoleにはmeasureを作る画面がなく、先に値が送られてBencherが自動で作ったmeasureには単位がないためです。何度実行しても同じ結果になります。

2026-11-21に、プロジェクト`astarot`で1〜3を済ませました。

## 実モデルの値

#556の目標と比べる値は、`native/core/examples/pipeline_latency.rs`で実モデルを使って測ります。手順と測る区間は[2026-11-18の記録](pipeline-latency-2026-11-18.md)にあります。`--bmf <ファイル>`を付けると、要約のp50とp95を同じ形式で書き出します。

| ベンチマーク | 区間 |
|---|---|
| `pipeline: end of speech to audible speech` | 話し終わりから、訳した声が聞こえ始めるまで（#556の目標の区間） |
| `pipeline: end of speech to chatbox` | 話し終わりから、チャットボックスの送出まで |
| `pipeline: end of speech to final` | 話し終わりから、認識の確定まで |
| `pipeline: translation` | 翻訳 |

### #556の目標の判定

2026-11-20に、目標と比べる値の定義を次のとおり決めました（#556）。

- 区間は`pipeline: end of speech to audible speech`（話し終わりから訳した声が聞こえ始めるまで）で、p50 0.7秒以下、p95 1.0秒以下を目標にします。
- 途中で2つ以上に分かれた発話は数えません。分かれた発話では、後半の声が前半の読み上げの終わりを待つので、声の遅れとは別の時間が入るためです。`pipeline_latency`の要約と`--bmf`の値は分かれなかった発話だけから求め、分かれた件数を要約の`split_utterances`に出します。
- 録音と再生のバッファ（Linuxの録音補助、PipeWire、WindowsのWASAPI）は含めません。`pipeline_latency`はこれらを通さずに測ります。実機での値は別の記録にします。
- PCが静かで、VRChatを動かしていないときの値で判定します。静かとは、Linuxでは負荷平均が1以下、負荷平均のないWindowsではCPUの使用率（すべての論理プロセッサーの平均）が10%以下のことです（Windowsの目安は2026-11-21に決定、#738）。VRChatを動かしたときの値は、別の目標として測ります。
- 要約には、計測を始めたときと終えたときのPCの様子を記録します。Linuxは`load_average`（1分、5分、15分の負荷平均）、Windowsは`cpu_usage`（5秒間の使用率、%）で、どちらも読めないOSでは`null`です。終えたときの値は、最後の発話とそのあとの無音を流し終えてから読みます。目安を超えたときは、標準エラーにその旨を出します。読み方と判定は`native/core/tests/machine_load.rs`にあります。

この計測はCIでは動きません。認識、翻訳、読み上げのモデル（合わせて約2.5 GB）、speech.cppの実行ファイル、ONNX Runtime、日本語の音声の素材が要ります。また、GitHubのランナーにはGPUがありません。そのため、保守担当者のPCで手で測り、書き出したファイルをCIと同じ形でBencherへ送ります。段取りは2026-11-21に決めました（#738）。

### 測るPCとテストベッド

保守担当者の3台で測ります。テストベッドの名前は`<OS>-<CPU>-<GPU>`の形にそろえます。翻訳はCPUで動くので、GPUだけでなくCPUも名前に入れます。Bencherのプロジェクトは公開なので、ホスト名は入れません。

| PC | テストベッド | 認識と読み上げのGPU |
|---|---|---|
| CachyOS（Linux 6.18）、Ryzen 9 9950X3D、RTX 4080 SUPER 16 GB | `cachyos-9950x3d-rtx4080super` | `Vulkan0`（RTX 4080 SUPER） |
| Windows 11、Core i7-1255UのノートPC、ThunderboltでつないだRTX 3060 Ti | `win11-i7-1255u-rtx3060ti` | `speech devices --json`で確かめる（2026-11-18の記録では`Vulkan1`） |
| RTX 3060 12 GBのPC | 未定（ASTAROTを入れたあとに決めて、この表に足す） | 未定 |

CIのテストベッド（`ubuntu-latest`、`windows-latest`）とは名前が違うので、値は混ざりません。

### Bencherでの置き場所と測る時期

- 専用の枝`real-models`に送ります。developのCIの送信は、履歴をやり直すとき（`--start-point-reset`）にdevelopの枝の履歴を空にします。手測りを`develop`の枝に送ると、手測りの系列も一緒に切れるためです。測ったコミットは`--hash`で結び付けます。
- しきい値は付けないので、アラートは出ません。テストベッドごとに10回分たまったら、付けるかどうかを見直します。
- 測るのは、#556の変更がdevelopに入ったとき、版を出す前、それ以外は2週間に1回です。複数のPCで測るときは、同じコミットで測ります。
- 1回の計測は`--runs 10`です。6つの入力を10巡し、2つに分かれなかった発話を数えます。2026-11-21の通し確認では6つのうち4〜5つを数えたので、1回に40〜50件になります。p95は最近接順位なので、数えた件数が20件以上あれば、最も遅い1件だけで決まりません。所要時間は15〜20分です。

### 入力とモデル

どのPCでも同じ入力と同じモデルを使い、写したあとにSHA-256で確かめます。

- 入力は、日本語の7つのWAVE（`clip0.wav`〜`clip6.wav`。Irodori-TTS v4.1で作った合成音声、48 kHz、16 bit）と、正解の文の`texts.txt`です。最初の1つは慣らしで、数えません。リポジトリには入れず、保守担当者が各PCに写します。`pipeline_latency`が出すのは時間、件数、文字誤り率だけで、文と音声は出しません。
- モデルは、アプリのモデルの取得の画面から、ライセンスと容量を確かめて取得します。保存先は設定のフォルダーの`downloaded_models/<ID>/<revision>/`です。SHA-256は、アプリのカタログ（`native/ops/data/speechcpp_models.json`、`native/ops/src/downloads/catalog.rs`、`native/ops/data/translation_models.json`）の値と比べます。

  | 用途 | アプリでの名前 | ファイル |
  |---|---|---|
  | 認識 | Qwen3-ASR 0.6B（Q8_0） | `Qwen3-ASR-0.6B-Q8_0.gguf` |
  | 発話の検出 | Silero VAD v6.2 · F32 | `silero-vad-309K-v6.2-F32.gguf` |
  | 読み上げ | Qwen3-TTS 12Hz 0.6B CustomVoice · Q8_0（声は`ryan`） | `Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf` |
  | 翻訳 | M2M100 418M · int8（`m2m100-418m-onnx-int8`） | フォルダー（6つのファイル） |

- speech.cppとONNX Runtimeは、測るコミットが固定する版を、リポジトリの道具で`build/`に取ります。インストールしたアプリの中のものは使いません。アプリと測るコミットで、固定の版がずれることがあるためです。
- [2026-11-18の記録](pipeline-latency-2026-11-18.md)（p50 972 ms、p95 1,149 ms）は、自分で書き出した翻訳のモデルで測りました。このモデルは、公開した`m2m100-418m-onnx-int8`とエンコーダーとデコーダーのハッシュが違います。手測りの系列は公開した版で測るので、その記録の値とはそのままでは比べられません。

入力のSHA-256は次のとおりです。

```
311b8c48cc5a1879e17483e8e528105c4a48a274c288d3bdda79dbed6e026f81  clip0.wav
0c854d1dfa74d4683bb1707d6a6ab501016782aaee68ccc097a39fd1e0852cbf  clip1.wav
8e73a92dbe19b63e7655b69ba3658ff07f15f56ffbc7c1f6bc5dc7da1063b01d  clip2.wav
1edb5214b04a7491b43c1c548e081618e2cb6cf80271ee5fb5952ef7fd487aae  clip3.wav
bd7e8d909097e43e53ac0f5f3e87dcf33fcd6ada82f077a21e0e66b5e7ab9912  clip4.wav
34822f755f988456461ffa722664daffdd8229307eac7a50c2cd166846899821  clip5.wav
e64d770924f2fad354e114032977abd3ef0204e20f276d2e52ff8e80986c300e  clip6.wav
dc39540143ace64b680bdaa0331b7706c487f5226bffcf41396dc71ff88331eb  texts.txt
```

### 送る鍵

Bencherに送る鍵は、保守担当者が各PCで自分で入れます。CIの鍵（リポジトリのシークレット`BENCHER_API_KEY`）はGitHubから読み出せないので、手測りには使いません。

- 鍵は、BencherのConsoleで、プロジェクト`astarot`のAPIキー（`bencher_run_`で始まるプロジェクトのキー）としてPCごとに1つ作ります。キーの名前はテストベッドの名前にします。PCを使わなくなったら、そのPCのキーだけを失効させます。
- キーはパスワードの管理の道具など、PCの外に保管します。送るときだけその端末に入れ、送ったらすぐ消します。
- コマンドの引数（`--key`）には書きません。シェルの履歴とプロセスの一覧に残るためです。ファイル、シェルの設定、Issue、チャットにも書きません。

### 各PCで1回だけする準備

1. developをcheckoutし、`mise install`で道具をそろえる。Windowsでは、RustのMSVCのためにVisual StudioのC++のビルドツールも要る。
2. 上の入力とモデルをそろえ、SHA-256を確かめる（Linuxは`sha256sum`、Windowsは`Get-FileHash`）。
3. BencherのCLIをCIと同じ版（`pipeline-latency.yml`の`bencherdev/bencher`、いまはv0.6.16）で[公式のリリース](https://github.com/bencherdev/bencher/releases)から取り、リリースにある`.sha256`の値と比べてから、`bencher`の名前でPATHの通った場所に置く。Linuxは`bencher-v<版>-linux-x86-64`、Windowsは`bencher-v<版>-windows-x86-64.exe`です。
4. 保守担当者が、上の「送る鍵」のとおりにPCのキーを作る。

### 毎回の計測

1. checkoutを最新のdevelopにし、speech.cppとONNX Runtimeを取り直して、`pipeline_latency`をビルドする（下のコマンド）。
2. VRChat、SteamVR、ほかの重い処理を止める。Linuxでは、負荷平均（1分）が1以下になるまで待つ。Windowsでは、タスクマネージャーなどでCPUの使用率が落ち着いたことを見てから始める。
3. `--runs 10`で測る。
4. 標準エラーに出る要約で、数えた件数（`n`）、分かれた発話の数（`split_utterances`）、PCの様子（Linuxは`load_average`、Windowsは`cpu_usage`）を確かめる。目安を超えた回は標準エラーに注意が出るので、送らずに測り直す。
5. `bencher run --dry-run`で、送る中身（枝、コミット、テストベッド、8つの値）を確かめる。dry runは鍵が要らず、Bencherに何も保存しない。
6. 保守担当者が鍵を入れて送り、すぐ消す。

Linux（bash）では次のとおりです。

```sh
# 測るコミットが固定するspeech.cpp（Vulkan版）とONNX Runtimeをbuild/に取り、pipeline_latencyをビルドする
python tools/speechcpp_bundle.py --variant linux-x64-vulkan --download --output build/speechcpp --replace
python tools/runtime_libraries.py --platform linux --download --output build
cargo build --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency
build/speechcpp/speech devices --json   # 使うGPUの名前を確かめる

T=cachyos-9950x3d-rtx4080super
C=$(git rev-parse --short=9 HEAD)
ORT_DYLIB_PATH="$PWD/build/onnxruntime/libonnxruntime.so" \
native/core/target/release/examples/pipeline_latency \
  --app-dir . --clips <入力のフォルダー> \
  --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> \
  --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100-418m-onnx-int8のフォルダー> \
  --device Vulkan0 --runs 10 --label "$T-$C" --out "results-$T-$C.jsonl" --bmf "pipeline-$T-$C.json"

# 送る中身を確かめる（鍵は要らない。何も保存しない）
bencher run --project astarot --branch real-models --hash "$(git rev-parse HEAD)" --testbed "$T" \
  --adapter json --file "pipeline-$T-$C.json" --dry-run

# 保守担当者が送る。鍵は画面に出さずに入れ、送ったら消す
read -rs -p 'Bencher key: ' BENCHER_API_KEY; echo; export BENCHER_API_KEY
bencher run --project astarot --branch real-models --hash "$(git rev-parse HEAD)" --testbed "$T" \
  --adapter json --file "pipeline-$T-$C.json"
unset BENCHER_API_KEY
```

Windows（PowerShell）では次のとおりです。

```powershell
# 測るコミットが固定するspeech.cpp（Vulkan版）とONNX Runtimeをbuildに取り、pipeline_latencyをビルドする
python tools/speechcpp_bundle.py --variant windows-x64-vulkan --download --output build/speechcpp --replace
python tools/runtime_libraries.py --platform windows --download --output build
cargo build --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency
build\speechcpp\speech.exe devices --json   # RTX 3060 Tiの名前（Vulkan0、Vulkan1など）を確かめる

$T = 'win11-i7-1255u-rtx3060ti'
$C = git rev-parse --short=9 HEAD
$env:ORT_DYLIB_PATH = "$PWD\build\onnxruntime\onnxruntime.dll"
native\core\target\release\examples\pipeline_latency.exe `
  --app-dir . --clips <入力のフォルダー> `
  --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> `
  --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100-418m-onnx-int8のフォルダー> `
  --device <上で確かめた名前> --runs 10 --label "$T-$C" --out "results-$T-$C.jsonl" --bmf "pipeline-$T-$C.json"

# 送る中身を確かめる（鍵は要らない。何も保存しない）
bencher run --project astarot --branch real-models --hash (git rev-parse HEAD) --testbed $T `
  --adapter json --file "pipeline-$T-$C.json" --dry-run

# 保守担当者が送る。鍵は画面に出さずに入れ、送ったら消す
$env:BENCHER_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Bencher key' -AsSecureString)).Password
bencher run --project astarot --branch real-models --hash (git rev-parse HEAD) --testbed $T `
  --adapter json --file "pipeline-$T-$C.json"
Remove-Item Env:BENCHER_API_KEY
```
