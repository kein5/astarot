# vrct-ops

バックエンドの運用基盤を受け持つ Rust クレートです。Issue #284 の範囲で、次の Python モジュールの置き換え先です。

| Python | Rust |
|---|---|
| `src-python/models/model_downloads/`（モデルの取得、サイズと SHA-256 の検証、進捗、中断と後片付け） | `downloads` |
| `src-python/models/telemetry/`（利用状況イベント `app_started` と `error`） | `telemetry` |
| `src-python/models/watchdog/`（UI からの feed が途絶えたときにバックエンドを止める） | `watchdog` |

## 現在の状態

- ライブラリとして完成しており、試験も通っています。**アプリにはまだ組み込んでいません。** 動作中のアプリでダウンロード、テレメトリ、watchdog を受け持っているのは、今も Python 側です。`src-tauri` はこのクレートに依存しておらず、利用者から見た動作は変わりません。
- 組み込みには、Python 側の呼び出し元（設定への適用、OCR・翻訳・声質変換のランタイム取得が共有している部品、watchdog の主体）を誰が持つかの決定が要ります。PR の残課題を見てください。

## 守っている約束

### ダウンロード

- 取得できるのはカタログ（`downloads::catalog`）の固定のファイルだけです。版、サイズ、SHA-256 は `catalog.py` と同じで、`tests/catalog_reference.rs` が Python の出力（`tests/data/python_reference.json`）と1項目ずつ照合します。音声認識のエントリは `data/speechcpp_models.json`（speech.cpp のカタログの写し）と `data/speechcpp_asr.json`（出す名前とライセンスの審査）から作ります（`downloads/speechcpp.rs`。欄の説明は `data/README.md`）。Python の `catalog.py` も同じファイルを読みます。`catalog.py` を変えたら `python native/ops/reference/dump_reference.py` で基準を作り直し、`catalog.rs` を同じに直します（`tests/voice/test_native_ops_reference.py` が基準の古さを検出します）。
- 要求は `{id, consent, catalog_version}` の3項目だけで、`consent` が `true`、版が現在のカタログと一致しなければ、ファイルにもネットワークにも触れません。
- 取得は `.partial-<32桁の16進>` の作業フォルダに書き、全ファイルのサイズと SHA-256 が合ってから `<root>/<id>/<revision>/` に名前を変えて公開します。失敗、取り消し、終了のときは何も公開せず、作業フォルダを消してから結果を報告します。
- 根元のフォルダには所有の印（`.download.lock`）を取ります。Python 版と同じロック（Linux は `flock`、Windows は先頭1バイトのロック）なので、移行中に両方が動いても互いを排除します。中断されたプロセスが残した作業フォルダは、印（`owner.json`）がカタログの項目と完全に一致し、その項目のファイルだけを含む場合に限り、次の所有者が片付けます。リンクはたどらず、見覚えのないものは消しません。
- 取得済みのものは、使う前と設定に適用する前に再検証します。壊れていたら消さずに失敗として報告します。
- 通信は HTTPS で、決まったホスト（`downloads::transport::HOSTS`）の 443 番だけです。プロキシは使わず、リダイレクトは1回ごとに同じ検査をしてから従い、5回までです。取り消しはソケットを閉じて、止まった受信も即座に終わらせます。
- エラーコードは Python 版と同じ文字列です（`consent_required`、`catalog_changed`、`download_busy`、`size_mismatch`、`hash_mismatch`、`insufficient_space`、`partial_cleanup_failed` など）。

### テレメトリ

- 送るイベントは `app_started`（1日1回）と `error`（エラーコードごとに1日1回）だけです。日付は UTC で、イベントの時刻と同じ日です。
- 中身は時刻、アプリの版、OS と版、表示言語、PC の構成（CPU、メモリ、GPU とドライバの版）だけです。文章、音声、音声デバイス名、ユーザー名、パス、識別子は送りません。HTTP ヘッダも Python 版（`http.client`）と同じ6つだけです。
- 利用者に見せる「送る内容」（`Telemetry::preview`）と送る内容は同じ関数（`client::build_event`）で作り、違うのは時刻だけです。送った内容は直近20件を `telemetry_state.json` に残し、ファイルの形とキーの順序は Python 版と同じです。
- 送信は呼び出し元を待たせず、失敗しても呼び出し元に影響しません。止めたあとの `error` は送らず、送ったとも記録しません。

### watchdog

- 既定はタイムアウト60秒、確認間隔20秒です。feed が途絶えたら確認のたびにコールバックを呼びます。経過時間は Python 版と同じく壁時計で測ります。

## Python 版と違う点

- **HTTP の実装**。Python の `urllib` と `http.client` の代わりに、TCP/TLS の上に最小限の HTTP/1.1 クライアント（`net.rs`）を持ちます。取り消し時のソケットの切断、リダイレクトごとの検査、送るヘッダを Python 版と同じにするためです。
- **証明書の信頼先**。Python 版は OS の証明書ストアを使っていました。このクレートは `webpki-roots`（Mozilla のルート証明書）を使います。アプリの `tauri-plugin-http` と同じです。Hugging Face と受け側（Cloudflare Workers）はどちらでも検証できますが、社内の独自ルート証明書だけを信頼する環境では結果が変わります。
- **speech.cpp の場所と子プロセスの環境**。Python 版は `bundled_binary()` で同梱の speech.cpp を探し、PyInstaller 固有の環境変数を外して起動していました。このクレートは場所を呼び出し元から受け取り（`HardwareProbe::new`、`telemetry::hardware::collect`）、環境はそのまま引き継ぎます。
- **Windows のコンソール**。`speech devices --json` を起動するとき、ハードウェアの問い合わせでもテレメトリでも `CREATE_NO_WINDOW` を付けます（Python 版はテレメトリ側だけでした）。
- **watchdog の停止**。Python 版は確認の間の待ち（既定20秒）を中断できませんでした。Rust 版は `stop` で待ちを打ち切ります。コールバックの例外の内容はログに書きません。
- **テレメトリの並行処理**。Python 版は専用のイベントループで送っていました。Rust 版は送信ごとにスレッドを使います。`error` が起動時の準備（ハードウェアの問い合わせと `app_started`）を最大30秒待つこと、止めたら送信中のものも記録しないこと、止めるのを最大5秒待つことは同じです。
- **壊れた状態ファイル**。`errors_sent` がオブジェクトでなかったり、日付ごとの値が配列でなかったりしたときは、空として扱います（Python 版は例外になる場合がありました）。

## ログとデータ

このクレートはログを書きません。エラーの文字列は固定の説明だけで、パス、URL の中身、送受信した本文、利用者のデータは入りません。

## 試験

```sh
cargo test --locked --manifest-path native/ops/Cargo.toml
# または
python tools/dev.py check --scope rust
```

試験はネットワークに出ません。HTTP はすべてこの PC のループバックに立てた代わりのサーバで確かめ、speech.cpp の代わりに小さな実行ファイル（`tests/fixture/fake_speech_devices.rs`）を起動します。この実行ファイルはアプリのビルドには含まれません。
