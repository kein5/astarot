# vrct-adapters

外部のツールとつなぐ部分（VRChat への OSC と OSCQuery、OBS のブラウザソース、ローカルの WebSocket サーバ、クリップボードへのコピーと自動貼り付け）を受け持つ Rust クレートです。Issue #283 の範囲で、`src-python/models/` の `osc/`、`obs/`、`websocket/`、`clipboard/` を置き換えます。

## 現在の状態

- ライブラリとして実装し、試験も通っています。**アプリにはまだ組み込んでいません。** 動作中のアプリでこれらを受け持っているのは、今も Python 側です。
- アプリ（Python と Tauri）への接続は、このクレートでは行いません。ほかの移行 Issue と同じく、#285（中核の統合と Python 同梱の終了）でまとめて組み込み、そのときに Python の実装を削除します。
- `src-tauri` はこのクレートに依存していません。配布物にも入りません。

## Python 版との対応

| Python（`src-python/models/`） | Rust |
|---|---|
| `websocket/tls.py` | `tls` |
| `websocket/websocket_server.py` の `WebSocketServer` | `websocket::WebSocketServer` |
| `obs/obs_browser_source_server.py` の `ObsBrowserSourceServer` | `obs::ObsBrowserSourceServer` |
| `obs/obs_browser_source_server.py` の `_build_overlay_html` | `obs::build_overlay_html`（テンプレートは `src/obs/page.html`） |
| `obs/settings.py` | `obs::settings` |
| `osc/osc.py` の `OSCHandler` | `osc::OscHandler` |
| python-osc（送受信の形式） | `osc::packet` |
| tinyoscquery（ツリーとホスト情報の JSON、HTTP） | `osc::query` |
| python-zeroconf（告知と探索） | `osc::mdns` |
| `clipboard/clipboard.py` の `Clipboard` | `clipboard::Clipboard` |
| `clipboard/clipboard.py` の Windows の関数 | `clipboard::windows` |
| `clipboard/x11_paste.py` と `ocr/ocr_capture_x11.py` のウィンドウ検索 | `clipboard::x11` |
| pyperclip（コピーに使う外部コマンド） | `clipboard::copy` |

## 外部のツールから見て変わらないこと

外部のツール側の設定は変えずに済むようにしています。

- **VRChat（OSC）**: 送信先の既定は `127.0.0.1:9000`。チャットボックスは `/chatbox/input` に `[本文, True, 通知]`、入力中の表示は `/chatbox/typing` に `[flag]`。バイト列は python-osc と同じです（試験で照合）。
- **VRChat（OSCQuery）**: 受信は送信先がこの PC（`127.0.0.1` か `localhost`）のときだけです。UDP の受信と HTTP のサーバはどちらも 127.0.0.1 の空きポートで待ち受け、`ASTAROT:<ナノ秒>`（0.5.x までは `VRCT:<ナノ秒>`）の名前で `_oscjson._tcp` と `_osc._udp` を mDNS で告知します。ツリーとホスト情報の JSON は tinyoscquery と同じ文字列です（試験で照合）。
- **mDNS**: python-zeroconf の既定の動きに合わせています。すべての IPv4 アドレス（ループバックを含む）で 224.0.0.251:5353 に参加し、LAN 側のインターフェースでもアドレス 127.0.0.1 で告知します。既存のライブラリ（mdns-sd）は、インターフェースのサブネットに合わないアドレスを告知から外すため使っていません。python-zeroconf との相互の発見は試験で確かめています。
- **OBS**: ブラウザソースの URL（`/` または `/obs` に `?token=`）、`/obs/connection`（`Authorization: Bearer`）、`/health`、Host ヘッダの検査、応答ヘッダ、ページの HTML は同じです。HTML は、題名（0.6.0 から `ASTAROT OBS Browser Source`）のほかは Python 版が作ったものとバイト単位で一致することを、試験で確かめています。
- **WebSocket**: `?token=` がなければハンドシェイクの前に 403。上限（受信 64 KiB、受信の速さ、送信 256 KiB、送信待ち 128 件と 4 MiB、クライアントごと 1 MiB）、1008 での切断、20 秒ごとの ping は同じです。
- **証明書**: ループバックの IPv4 だけが平文で待ち受けます。それ以外は利用者が選んだ PEM の証明書と鍵が必要で、1 MiB まで、1つのファイルに両方を入れても使えます。パスフレーズ付きの鍵は使えません。失敗の理由は `missing`、`unreadable`、`not_a_file`、`size`、`load_failed` の文字列だけで返します。

## Python 版と違う点

- **TLS の実装**。OpenSSL ではなく rustls（ring）です。TLS 1.2 以上という条件は同じですが、使える暗号スイートと鍵の形式が違います。鍵は PKCS#8、PKCS#1（RSA）、SEC1（EC）を読めます。OpenSSL なら読めた珍しい形式の証明書や鍵は、`load_failed` になることがあります。
- **mDNS の名前の確認**。python-zeroconf は告知の前に、同じ名前がないかを問い合わせていました（probing）。Rust 版はこれを省き、すぐ3回告知します。名前にナノ秒を含むため、衝突は実際には起きない前提です。
- **mDNS を PC の外へ出さない**（#559）。python-zeroconf は IP の TTL を 255 にして LAN にも告知し、LAN からの問い合わせにも答えていました。告知のアドレスは 127.0.0.1 なので、ほかの機器には使い道がなく、アプリが動いていることだけが伝わっていました。Rust 版は送るパケットの TTL を 0 にします。OS はこれを同じ PC のグループの参加者にだけ渡し、ネットワークには送りません。送り元が同じ PC（ループバックか PC 自身のアドレス）でないパケットは無視します。ループバックのインターフェースだけで参加して送る形では、VRChat（Windows のデスクトップモードで確認）と互いに見つけられませんでした。
- **OSCQuery の HTTP**。GET 以外は 501 を返します。Python 版の土台（`SimpleHTTPRequestHandler`）は HEAD に対して作業フォルダのファイルを返す作りでした。
- **HTTP の応答ヘッダ**。OBS と OSCQuery の応答に `Server` と `Date` を付けません。
- **OBS のポートの再利用**。`SO_REUSEADDR` は Unix だけで設定します。Python の `HTTPServer` は Windows でも設定していましたが、Windows では使用中のポートにも bind できてしまう設定のため、付けていません。
- **WebSocket の停止**。停止するとき、各クライアントに 1001 を送り、0.5 秒待ってから切ります。64 KiB を超えて受信したときは 1009 で閉じます。
- **ログ**。行は固定の文字列だけです（`log::set_sink` で受け取る）。Python 版がログに入れていた OSCQuery のアドレス、貼り付け先のウィンドウ名、ウィンドウのハンドルの一覧は入れません。
- **クリップボード（Linux）**。外部コマンドがないときの最後の手段だった tkinter は使いません。外部コマンドの標準出力と標準エラーは捨てます（Python 版は sidecar の標準出力を引き継いでおり、IPC の経路に混ざるおそれがありました）。
- **クリップボード（Windows）**。`clip.exe` を起動できないときは、pyperclip と同じく Win32 のクリップボード API で書きます。`clip.exe` はコンソールの窓を出さずに起動します。プロセス名は psutil ではなく `QueryFullProcessImageNameW` で読みます。
- **SteamVR のアプリ名**。Python 版は SteamVR の起動を 10 秒ごとに待ち、起動したときに一度だけ、登録済みのアプリから最初の `steam.app.*` の名前を読んでいました。この時点ではゲームがまだ動いていないことが多く、別のゲームや SteamVR 自身の名前を拾うこともありました。このクレートは待つスレッドを持たず、ウィンドウ名のない貼り付けのたびに `clipboard::VrAppName` に聞きます。アプリ名を OpenVR から読む部分は、OpenVR の接続を持つ側が渡します（core は SteamVR のシーンのアプリを、オーバーレイと共有する接続で読みます）。

## ログとデータ

送受信する文章、翻訳、トークン、証明書のパスと中身は、ログにも戻り値のエラーにも入れません。ログの行は `&'static str` に限っているため、型の上で入りようがありません。

## 試験

```sh
cargo test --locked --manifest-path native/adapters/Cargo.toml
# または
python tools/dev.py check --scope rust
```

試験は 127.0.0.1 の実際のソケットを使います。mDNS の試験は 5353 番ポートとマルチキャストを使い、ポートを開けない環境では何もせずに通ります。OBS ページの再接続の試験は Node があれば実行します（`tests/fixtures/obs_reconnect.mjs` を使う）。

次の2つは、指定したときだけ動きます。

```sh
# python-zeroconf との相互の発見（zeroconf の入った Python を指定）
VRCT_ZEROCONF_PYTHON=build/dev/backend-venv/bin/python \
cargo test --manifest-path native/adapters/Cargo.toml --test zeroconf_interop

# Linux の実際の X11 ディスプレイでのウィンドウ検索（前面に出したりキーを送ったりはしない）
VRCT_X11_WINDOW=<表示中のウィンドウの題名> \
cargo test --manifest-path native/adapters/Cargo.toml --lib -- --ignored finds_a_window
```

クリップボードの試験は、本物のクリップボードやキー入力には触れません。偽のデスクトップで、前面に出す、コピーする、貼り付けるの順序と失敗時の扱いを確かめます。Windows のウィンドウ操作とキー送出、`clip.exe`、VRChat 本体との接続は、実機では確かめていません。
