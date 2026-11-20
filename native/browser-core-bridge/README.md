# vrct-browser-core-bridge

ブラウザに出したアプリの画面と、中核（`native/core`）をつなぐ試験の道具です。結合テスト（`tests/integration/`、[ADR-017](../../docs/adr/adr-017-integration-tests-through-the-core.md)）が、試験ごとに 1 つ起動します。アプリにも配布物にも入りません。

```sh
cargo build --locked --manifest-path native/browser-core-bridge/Cargo.toml
native/browser-core-bridge/target/debug/vrct-browser-core-bridge --state <設定のフォルダー> [--port <ポート>]
```

- `127.0.0.1` で待ち受け、準備ができたら `ws://127.0.0.1:<ポート>` を 1 行出します。
- 画面の側の Tauri の偽物（`tests/integration/app/coreConnection.ts`）が、アプリの `backend_start`、`backend_write`、`backend_kill`（`src-tauri/src/backend_host.rs`）と同じことを WebSocket で送ります。形は `src/main.rs` の冒頭にあります。
- 中核は、中核の試験と同じ偽物の `Services` で動きます（`src/services.rs`。偽物は `native/core/tests/common` から読み込み、写しを持ちません）。音声の機器、VR、OCR は使わず、鍵の保存先はメモリー、翻訳と認識の通信はこの PC の中だけです。
- 画面が閉じたとき、または標準入力が閉じたときは、中核を止めて設定を保存してから終わります。試験はこれで「アプリを終えて起動し直す」を確かめます。

`build.rs` は、読み込んだ偽物が参照する中核の試験用の実行ファイルの名前（`CARGO_BIN_EXE_fake-rvc-worker`）を空にします。結合テストは声質変換を起動しません。
