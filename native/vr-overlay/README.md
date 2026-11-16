# vrct-vr-overlay

SteamVR のオーバーレイを受け持つ Rust クレートです。字幕の一行ログ（小）と複数行ログ（大）、VR パネル（ログウィンドウ、ランチャー、一時ウィンドウ）を表示します。Issue #282 の範囲で、`src-python/models/overlay/` を置き換えます。中核（`native/core`）がこのクレートを使い、アプリのプロセスの中で動きます。

## Python 版との対応

| Python（`src-python/models/overlay/`） | Rust |
|---|---|
| `overlay.py` の `Overlay`（起動と停止、SteamVR を待つこと、位置、フェード、VR パネル） | `engine::Overlay` |
| `overlay.py` の `computeVrLayout` などの並びと姿勢の計算 | `layout`、`math`、`placement`、`pose`、`timing` |
| `overlay_tooltip.py` | `tooltip` |
| `overlay_image.py` | `subtitle` |
| `overlay_fonts.py` | `fonts` |
| pyopenvr | `openvr`（`openvr_api` を実行時に読み込む） |
| `window_capture.py`、`window_capture_linux.py` | `surface` |
| `models/process_check.py`（`vrmonitor` の確認） | `process` |
| `models/openvr_session.py`（OpenVR の接続を参照数で共有する） | `shared::SharedVr` |

`layout` から `tooltip` までは、以前は `src-tauri/src/vr_overlay/` にありました。Python の値と照らし合わせる試験（`src/reference_tests.rs` と `tests/vr_overlay_reference/`）もここへ移しました。

## SteamVR とのつなぎ方

- OpenVR の C API（`openvr_api`）を、SteamVR が動いているときだけ読み込みます。ビルドに OpenVR SDK は要りません。関数表は OpenVR 2.12 のもの（`IVRSystem_023`、`IVROverlay_028`、`IVRApplications_007`）で、Python が使っていた pyopenvr 2.12.1401 と同じ版です。`IVRApplications` は音声タイピングの貼り付け先（SteamVR のシーンのアプリ）を読むためだけに使い、取れなくてもオーバーレイは動きます。
- OpenVR の接続はプロセスに 1 つです。`shared::SharedVr` は最初の利用者のときに接続し、後の利用者には同じ接続を渡し、最後の利用者が手放したときに閉じます。中核はオーバーレイと音声タイピングのクリップボードでこれを共有します。
- ライブラリは次の順に探します。環境変数 `VRCT_OPENVR_API`、中核が渡すフォルダ、実行ファイルの隣、Python の同梱物の中（`_internal/openvr`）、システムの検索パス。見つからないときは、SteamVR が動いているのにつなげなかったものとして `OVERLAY_RUNTIME_FAILED` を知らせます。配布物に入れるかどうかは未決です（`docs/voice-stack/core-integration.md` の「判断が要ること」）。
- 字幕の画像は Python と同じく `SetOverlayRaw` で渡します。VR パネルの画面は、Windows では Direct3D 11 のテクスチャ 1 枚を各領域のオーバーレイで共有します（Python は OpenGL でした）。Linux ではまだ GPU のテクスチャを使わず、`SetOverlayRaw` で渡します。

## 字幕の書体

Python は Noto Sans の日本語・韓国語・簡体字・繁体字の 4 書体（29.6 MB）を同梱していました。このクレートは書体を同梱しません。渡されたフォルダ（アプリの `fonts`、Python の同梱物の `_internal/fonts`）を先に、次にシステムの書体のフォルダを探し、言語ごとに決めた書体（Noto Sans CJK、游ゴシック、メイリオ、Malgun Gothic、Microsoft YaHei、Microsoft JhengHei など）を使います。足りない文字は、その文字を持つ書体をシステムの中から探します。どれにも無い文字は描きません。

## まだ移していないもの

コントローラで VR パネルを操作する部分です。レーザーで指すこと、掴んで動かすこと、拡大縮小、角を掴んで大きさを変えること、操作バー、ホバーで出る吹き出し、VR 画面へのマウスの入力がこれに当たります。これらがないあいだ、VR パネルは表示と、UI からの固定先の変更・呼び戻し・ランチャーを戻す操作だけができます。

## 試験

```sh
cargo test --locked --manifest-path native/vr-overlay/Cargo.toml
```

SteamVR の代わりに `runtime::fake::FakeVr` を使います。実機の SteamVR、ヘッドセット、GPU は使いません。書体はシステムのものを使い、描いた字の画素の値までは比べません（OS で書体が違うため）。中核から見た振る舞いは `native/core/tests/vr_overlay.rs` が確かめます。
