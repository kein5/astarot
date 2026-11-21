# vrct-speech-server

同梱の speech.cpp サーバ（TTS 用2つと ASR 用1つ）のプロセスを所有する Rust クレートです。起動、停止、再起動、死活監視を受け持ちます。Issue #276 の範囲で、`src-python/models/speech_server/` の置き換え先です。

speech.cpp の実行ファイルは従来どおり別プロセスです。このクレートが持つのは管理層だけで、推論はしません。

## 現在の状態

- ライブラリとして完成しており、試験も通っています。**アプリにはまだ組み込んでいません。** 動作中のアプリでサーバを所有しているのは、今も Python 側（[`models/speech_server/runtime.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py)）です。同じサーバを2か所から所有しないよう、Tauri 側の配線は、Python 側の呼び出しを置き換えるとき（#278 と協調）に行います。
- `src-tauri` はこのクレートに依存していません。

## Python 版との対応

| Python（`models/speech_server/`） | Rust |
|---|---|
| [`settings.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/settings.py)（`normalize_settings`、`start_options`） | `settings` |
| [`runtime.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py) の `bundled_binary` | `bundle::bundled_binary` |
| [`runtime.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py) の `parse_devices`、`preferred_gpu`、`resolve_device`、`list_gpus` | `devices` |
| [`runtime.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py) の `SpeechServer` | `server::SpeechServer` |
| [`runtime.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py) の `SpeechServers` | `servers::SpeechServers` |
| [`warmup.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/warmup.py) | `warmup` |
| [`low_latency.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/low_latency.py) | `standby::LowLatencyStandby` |
| （Python 版にはない） | `builds`（Linux の2つのビルドから選ぶ） |

設定ファイルの形、状態名（`stopped`、`preparing`、`ready`、`stopping`、`failed`）、エラーコードの文字列は Python 版と同じです。エラーコードは `codes` にまとめてあります。

## Python 版と違う点

- **Linux での所有の仕組み**。Python 版は補助プログラム `vrct-vc-worker` を挟み、起動したスレッドの pidfd を監視させていました。Rust 版は補助プログラムを使わず、子プロセスに `PR_SET_PDEATHSIG(SIGKILL)` を設定します。このシグナルは、子を起動したスレッド（サーバごとの監視スレッド）が終わったときに届きます。アプリが異常終了したときにサーバが残らない、という約束は同じです。
- **Windows での所有の仕組み**は同じです。子を停止状態で作り、閉じると終了するジョブに入れてから再開します。省電力による速度制限を外す指定も同じです。
- **音声出力の監視との連携**。Python 版は TTS 用サーバの待ち受けポートを `listener_monitors` に直接登録していました。Rust 版は `Hooks::on_listener` で呼び出し側に知らせます。
- **失敗の通知**。Python 版の `report_failure` に当たるものは `Hooks::on_failure` です。利用状況イベントへの送信そのものは、このクレートにはありません。
- **ウォームアップ用の雑音**。長さ（6秒）と大きさは同じですが、乱数の列は Python 版と一致しません。結果は捨てるので、動作には影響しません。
- **低遅延スタンバイ**。Python 版は、最初にモデルが `seed` を受け付けるかを問い合わせていました。Rust 版は問い合わせず、`seed` を付けた要求が 200 以外で返ったらスタンバイを失敗にします。

## 同梱のビルドの選び方

speech.cpp はアプリに同梱し、実行時には取得しません。Windows は Vulkan 版の1つだけを、Linux は CPU 版と Vulkan 版の2つを同梱します（`docs/voice-stack/core-integration.md` の「判断が要ること」の 5）。`server::Launch::bundles` に同梱のフォルダを渡すと、起動のたびに各フォルダを固定のハッシュで確かめ、`bundle.json` の variant の末尾（`-cpu`、`-vulkan`）でどちらのビルドかを決めます。フォルダの名前では決めません。

| 設定の `device` | 2つのビルドがあるとき（Linux） | 1つのビルドのとき（Windows） |
|---|---|---|
| `cpu` | CPU 版を `--device cpu` で | そのビルドを `--device cpu` で |
| `gpu` | Vulkan 版。`speech devices --json` で選んだ GPU | 同じ |
| `Vulkan0` など | Vulkan 版をその名前で | 同じ |
| `auto` | Vulkan 版の `speech devices --json` が動き、計算に使える GPU があれば Vulkan 版でその GPU。GPU がなければ CPU 版。一覧が動かなければ（`libvulkan.so.1` がないなど）CPU 版にして、状態に `notice: speech_server_cpu_fallback` を付ける | 今までどおり（GPU を選ぶか、speech.cpp に任せる） |

`gpu` や GPU の名前を選んでいて Vulkan 版が起動しないときは、CPU 版に移さず失敗にします。Linux の動的ローダーが `libvulkan.so.1` を見つけられなかったときのエラーコードは、Windows で `vulkan-1.dll` がないときと同じ `speech_server_vulkan_missing` です。CPU 版だけがあるとき（開発の checkout など）は、CPU だけの配布物と同じに動きます。

`builds::survey` は設定の画面に出すものを返します。GPU の一覧は Vulkan 版から取り、CPU を何で動かすか（`separate`、`shared`、`missing`）と Vulkan 版が動くか（`ready`、`unavailable`、`missing`）を添えます。

## llama.cpp のサーバー（翻訳の LLM）

`llama` は、TranslateGemma のような翻訳の LLM を動かす llama.cpp の `llama-server` を、speech.cpp のサーバーと同じ形で所有します（ADR-015）。実行ファイルは同梱せず、利用者が同意したあとで固定のリリースを取得します（`native/voice-conversion` の `runtime.rs`）。

- 起動は `--host 127.0.0.1 --port 0` で、サーバーが出す `listening on http://127.0.0.1:<port>` の行からポートを読みます。`/health` が `{"status":"ok"}` を返すまで待ちます。読み込み中の 503 は待ちます。
- 起動ごとに API キーを作り、環境変数 `LLAMA_API_KEY` で渡します。コマンドラインには出しません。`/health` 以外はこのキーがないと答えません。Web の画面は `--no-webui` で止めます。
- 翻訳は1文ずつ独立しているので、プロンプトのキャッシュは `--cache-ram 0` で切ります。llama.cpp の既定では RAM を最大 8 GiB まで使い、計測では 800 文でプロセスのメモリーが約 11 GB まで増えました。
- 機器の指定は speech.cpp のサーバーと同じ言葉です（`cpu`、`auto`、`gpu`、`Vulkan1` など）。`auto` と `gpu` は speech.cpp が選ぶ GPU（独立した GPU のうちメモリーが最も多いもの）を、llama.cpp の `--list-devices` の一覧で名前と説明から探します。2つの番号が違っても同じ GPU になります。
- 失敗はモデルを読めない（`llama_server_model_invalid`）、メモリー不足、起動の時間切れ、終了などの固定のコードだけで知らせます。サーバーが出した行、モデルのパス、キー、文章はログにも戻り値にも入れません。

試験は `tests/llama.rs` が、llama.cpp の代わりをする `tests/fixture/fake_llama.rs` を実際に起動して確かめます。モデルも GPU も使いません。

## ログとデータ

サーバが出力した行、モデルのパス、文章、音声は、ログにも戻り値にも入れません。サーバの標準エラー出力から読み取るのは、待ち受けポートの行と、`out_of_memory`・`device` の2種類の失敗分類と、Linux の動的ローダーが `libvulkan.so.1` を見つけられなかったことだけです。

## 試験

```sh
cargo test --locked --manifest-path native/speech-server/Cargo.toml
# または
python tools/dev.py check --scope rust
```

試験は、speech.cpp の代わりをする小さな実行ファイル（`tests/fixture/fake_speech.rs`）を実際に起動して、プロセスの起動から終了までを確かめます。モデルも GPU も使いません。この実行ファイルはアプリのビルドには含まれません。`tests/builds.rs` は、この実行ファイルの写しを Linux と同じ2つの同梱フォルダと Windows と同じ1つのフォルダに置き、写しのハッシュで固定して、ビルドの選び方と CPU 版への切り替えを確かめます。

実物の speech.cpp とモデルで確かめるときは、環境変数を指定します。指定がなければ、この試験は何もせずに通ります。

```sh
ASTAROT_SPEECHCPP_BUNDLE=<build/speechcpp のフォルダ> \
ASTAROT_SPEECH_MODEL=<TTS モデルの .gguf> \
ASTAROT_SPEECH_DEVICE=cpu \
cargo test --manifest-path native/speech-server/Cargo.toml --test real --test devices -- --nocapture
```
