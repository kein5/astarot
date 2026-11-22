# vrct-vr-overlay

SteamVR のオーバーレイを受け持つ Rust クレートです。字幕の一行ログ（小）と複数行ログ（大）、VR パネル（ログウィンドウ、ランチャー、一時ウィンドウ）を表示します。Issue #282 の範囲で、`src-python/models/overlay/` を置き換えます。中核（`native/core`）がこのクレートを使い、アプリのプロセスの中で動きます。

## Python 版との対応

| Python（`src-python/models/overlay/`） | Rust |
|---|---|
| [`overlay.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay.py) の `Overlay`（起動と停止、SteamVR を待つこと、位置、フェード、VR パネル） | `engine::Overlay` |
| [`overlay.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay.py) の `updateGrab` とその周り（レーザー、VR 画面への入力、掴む、拡大縮小、角での大きさの変更、操作バー） | `engine/input.rs` |
| [`overlay.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay.py) の `computeVrLayout` などの並びと姿勢の計算 | `layout`、`math`、`placement`、`pose`、`timing` |
| [`overlay_tooltip.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_tooltip.py) | `tooltip` |
| [`overlay_image.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_image.py) | `subtitle` |
| [`overlay_fonts.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_fonts.py) | `fonts` |
| pyopenvr | `openvr`（`openvr_api` を実行時に読み込む） |
| [`window_capture.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/window_capture.py)、[`window_capture_linux.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/window_capture_linux.py) | `surface` |
| [`models/process_check.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/process_check.py)（`vrmonitor` の確認。今は `vrserver` も見る。Steam Frame の SteamVR は `vrmonitor` を開かないため、#944） | `process` |
| [`models/openvr_session.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/openvr_session.py)（OpenVR の接続を参照数で共有する） | `shared::SharedVr` |

`layout` から `tooltip` までは、以前は `src-tauri/src/vr_overlay/` にありました。Python の値と照らし合わせる試験（`src/reference_tests.rs` と `tests/vr_overlay_reference/`）もここへ移しました。

## SteamVR とのつなぎ方

- OpenVR の C API（`openvr_api`）を、SteamVR が動いているときだけ読み込みます。ビルドに OpenVR SDK は要りません。関数表は OpenVR 2.12 のもの（`IVRSystem_023`、`IVROverlay_028`、`IVRApplications_007`、`IVRRenderModels_006`）で、Python が使っていた pyopenvr 2.12.1401 と同じ版です。関数は表の中の位置で呼びます。位置は関数の名前と一緒に宣言し（`vrct_openvr_client::fn_table!`）、試験で pyopenvr の関数表（`native/openvr-client/tests/data/pyopenvr_fn_tables.json`）と照らし合わせます。位置を間違えると、別の関数がエラーなしで呼ばれます（#610）。`IVRApplications` は音声タイピングの貼り付け先（SteamVR のシーンのアプリ）を読むためだけに使い、取れなくてもオーバーレイは動きます。
- OpenVR の接続はプロセスに 1 つです。`shared::SharedVr` は最初の利用者のときに接続し、後の利用者には同じ接続を渡し、最後の利用者が手放したときに閉じます。中核はオーバーレイと音声タイピングのクリップボードでこれを共有します。
- ライブラリは次の順に探します。環境変数 `ASTAROT_OPENVR_API`（旧名は `VRCT_OPENVR_API`）、中核が渡すフォルダ、実行ファイルの隣、アプリに同梱したライブラリ（`_internal/openvr`）、システムの検索パス。見つからないときは、SteamVR が動いているのにつなげなかったものとして `OVERLAY_RUNTIME_FAILED` を知らせます。Windows版とLinux版のどちらにもOpenVRクライアントライブラリを同梱します（`tools/runtime_libraries.py`）。
- 字幕の画像とポインタの印は Python と同じく `SetOverlayRaw` で渡します。VR パネルの画面は、Windows では Direct3D 11 のテクスチャ 1 枚を各領域のオーバーレイ（操作バーと吹き出しを含む）で共有します（Python は OpenGL でした）。角で大きさを変えるときの枠は、別のテクスチャ 1 枚です。Linux ではまだ GPU のテクスチャを使わず、どちらも `SetOverlayRaw` で渡します（実機での確認は `docs/voice-stack/core-integration.md` の「判断が要ること」の 8）。

## 字幕の書体

Python は Noto Sans の日本語・韓国語・簡体字・繁体字の 4 書体（29.6 MB）を同梱していました。このクレートは書体を同梱せず、利用者の PC の書体を使います。Windows は `Fonts` とユーザーの書体のフォルダ、Linux は fontconfig が既定で読むフォルダ（`/usr/share/fonts`、`~/.local/share/fonts` など）を探し、書体のファイルの `name` 表から書体名の一覧を作ります（fontconfig そのものは呼びません）。

1. 設定で選んだ書体（`FontLibrary::set_family`、中核の `OVERLAY_FONT_FAMILY`）。
2. 言語ごとの標準の書体。日本語は Yu Gothic UI、Meiryo、Noto Sans CJK JP など、韓国語は Malgun Gothic、Noto Sans CJK KR など、簡体字は Microsoft YaHei、Noto Sans CJK SC など、繁体字は Microsoft JhengHei、Noto Sans CJK TC など、ほかの言語（ラテン文字）は Segoe UI、Noto Sans、DejaVu Sans など。
3. 1 と 2 にない文字は、その文字を持つ書体をシステムの中から探します。どれにも無い文字は描きません。

`FontLibrary::missing_languages` は、日本語・韓国語・中国語（簡体字・繁体字）のうち、この PC のどの書体でも描けない言語を返します（CJK の書体がない Linux など）。

## コントローラ

`engine/input.rs` が Python の `updateGrab` とその周りにあたります。レーザーは各コントローラの先端から 12 度上に出し、SteamVR の `ComputeOverlayIntersection` で当たりを調べます。

- VR 画面ではトリガーが左クリック、スティックの上下がスクロールです。入力は `PanelSurface::pointer` で VR 画面に送ります（Windows は WebView2 の `Chrome_RenderWidgetHostHWND` への `PostMessageW`、Linux は `input.sock`）。指している位置は `Event::Pointer` で知らせ、中核が `/run/vr_panel_pointer` で UI に送ります。
- グリップで掴んで動かし、離すと `Event::Position` で保存を頼みます。掴んだままトリガーで拡大縮小、スティックで遠ざける・近づける、ログの角で大きさを変える（新しい大きさで描くまで枠を出す）ことができます。ロックしたログは掴めません。
- ログを少し指していると、下に操作バーを出します。ホバーの吹き出しは、指している位置がボタンの上にあるときだけ出します。

## 試験

```sh
cargo test --locked --manifest-path native/vr-overlay/Cargo.toml
```

SteamVR の代わりに `runtime::fake::FakeVr` を使います。偽物はコントローラの姿勢とボタンを持ち、置いたオーバーレイの位置からレーザーの当たりを答えます。`tests/interaction.rs` は、指す・押す・スクロールする、掴んで動かして保存する、ロック、拡大縮小の限度、角での大きさの変更と枠、操作バーとホバーの吹き出し、コントローラを見失ったとき、を確かめます。実機の SteamVR、ヘッドセット、GPU は使いません。書体はシステムのものを使い、描いた字の画素の値までは比べません（OS で書体が違うため）。中核から見た振る舞いは `native/core/tests/vr_overlay.rs` が確かめます。実機での確認が残っていることは `docs/voice-stack/core-integration.md` の「判断が要ること」の 8 にあります。
