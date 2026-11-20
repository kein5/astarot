# 音声パイプラインの遅延の継続計測（Bencher）

音声パイプラインの遅延のp50とp95を、CIでBencherへ送って時系列で追います（#738）。developへのpushで履歴としきい値を積み、プルリクエストではその基点と比べた結果をコメントに出します。しきい値は統計的な検定（t検定）によるアラートだけです。アラートでCIは失敗せず、マージも止めません。

CIで測るのは、中核が自分で足す時間です。認識、翻訳、音声合成のエンジンを、すぐに答える偽物に替えて測ります。そのため、#556の目標（話し終わりから訳した声が聞こえ始めるまで、p50で0.7秒以下、p95で1.0秒以下）と比べられる値ではありません。目標と比べる値は、実モデルで測る`pipeline_latency`の値です（[実モデルの値](#実モデルの値)）。

## CIで測るもの

`native/core/tests/pipeline_overhead.rs`が測ります。中核をアプリと同じように起動し、Linuxのリアルタイム字幕、DeepLでの翻訳、チャットボックスの送出、訳文の読み上げを有効にします。マイクから音声を流し続け、偽の認識サーバーに1回ずつ発話を確定させます。前の発話がチャットボックスと声の両方に届いてから、次の発話を確定させます。

| 部分 | 代わりに使うもの |
|---|---|
| リアルタイム字幕のサーバー | `tests/common/fake_asr.rs`。試験が頼んだときに1つの発話を確定させ、その時刻を記録します。 |
| 翻訳 | `vrct_translation::fake`のDeepL。すぐに答えます。 |
| 読み上げのサーバー | `tests/common/fake_tts.rs`のspeech.cpp。冒頭に0.42秒の無音を付けて返します。speech.cppのQwen3-TTSの冒頭の無音（[2026-11-18の記録](pipeline-latency-2026-11-18.md)で421〜435 ms）に合わせた長さです。 |
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
| developへのpush | ブランチ`develop`に送ります。しきい値を毎回この設定に合わせます（`--thresholds-reset`）。 |
| 同じリポジトリのブランチからのプルリクエスト | プルリクエストのブランチに送ります。基点はマージ先のブランチとそのコミットで、基点のしきい値を写します。結果とアラートはプルリクエストのコメントに出ます。 |
| フォークからのプルリクエスト、ほかのブランチへのpush、マージキュー | 送りません。 |

しきい値はmeasureごとに1つで、次の設定です。

- 検定: t検定（`t_test`）
- 比べる履歴: 直近の64件まで
- 上側の境界: 0.99。下側（速くなったとき）はアラートを出しません。

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
- 負荷平均1以下で、VRChatを動かしていないときの値で判定します。要約の`load_average`に、計測を始めたときと終えたときの負荷平均（1分、5分、15分）を記録します。1を超えたときは、標準エラーにその旨を出します。VRChatを動かしたときの値は、別の目標として測ります。

この計測はCIでは動きません。認識、翻訳、読み上げのモデル（合わせて約2.5 GB）、speech.cppの実行ファイル、ONNX Runtime、日本語の音声の素材が要ります。また、GitHubのランナーにはGPUがありません。書き出したファイルは、CIと同じ形でBencherへ送れます。testbedには、CIのtestbedと混ざらない名前を付けます。

```sh
bencher run --project <プロジェクト> --branch develop --testbed <testbed> --adapter json --file <ファイル>
```
