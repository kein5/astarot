# 設計書：オーバーレイ表示の Rust 移行

- 対象: `src-python/models/overlay/`（SteamVR のオーバーレイ、字幕の画像、VR 画面の撮影と入力）
- Issue: #282（Python sidecar を機能単位で Rust へ移す取り組みの一つ）
- 状態: 設計ドラフト。Phase 1 を実装済み。未決事項は 8 節
- 日付: 2026-11-15

## 1. 目的と前提

Python の sidecar が持っているオーバーレイ表示を、Tauri の Rust プロセス（`src-tauri`）へ移す。
移したあとも、表示のタイミング、フェード、レイアウトは今の仕様のまま変えない。

受け入れ条件（Issue #282）:

- デスクトップと VR の両方で、今と同じ表示ができる
- 表示の遅れが今より悪くならない
- `src-python/models/overlay/` を削除しても機能が欠けない

### 1.1 今の分担

| 表示 | 今の実装 | 描画 |
|---|---|---|
| デスクトップの字幕 | Rust（`src-tauri/src/caption_overlay.rs`）と React（`src-ui`） | WebView |
| VR 画面（ログ、ランチャー、一時ウィンドウ、操作バー、吹き出し） | React が `VRCT-VOX VR Panel` ウィンドウ 1 枚に並べて描く。Python が撮影して SteamVR のオーバーレイに切り出す | WebView → Python → OpenVR |
| VR の字幕（small log / large log） | Python（`overlay_image.py`、`overlay_fonts.py`） | Pillow → OpenVR |
| VR の操作（レーザー、掴む、伸ばす、ランチャーの出し入れ、呼び戻し） | Python（`overlay.py`） | OpenVR |
| VR 画面の受け渡し（Linux） | Rust（`vr_panel_surface.rs`）がフレームをファイルに書き、Python が読む | GTK オフスクリーン |
| VR 画面の受け渡し（Windows） | Python（`window_capture.py`）が画面外のウィンドウを撮る | Win32 |

デスクトップの字幕は、すでに Python のオーバーレイ部品を使っていない。この移行で
Python から外すのは VR の表示だけになる。デスクトップ側は、VR と共有できる部分
（8.2）を除いて変更しない。

### 1.2 二重実装を避ける方針

- VR 画面の並び（`computeVrLayout`）は、Rust のモジュール 1 か所で持つ。React の
  `src-ui/views/vr/vr_layout.json` と、Linux のオフスクリーンの既定サイズはこの値と
  一致することを試験で確かめる。
- VR 画面のフレームは、Linux では同じプロセスの `vr_panel_surface` から直接受け取る。
  ファイルとソケットを経由する今の受け渡しは、Python がいなくなった段階で不要になる。
- 文字の描画を Rust で新しく書くか、WebView の描画を使うかは未決（8.1）。WebView を
  使えば、デスクトップの字幕と VR の字幕が同じ描画部品になる。

## 2. 段階

| 段階 | 内容 | Python への影響 |
|---|---|---|
| Phase 1（この PR） | OpenVR に依存しない計算を `src-tauri/src/vr_overlay/` に移す。Python の実装と同じ値になることを基準値で確かめる | なし（Python がそのまま動く） |
| Phase 2 | VR の字幕の描画。方式は 8.1 で決める | なし |
| Phase 3 | OpenVR のホストを `src-tauri` に置く。VR 画面のフレームと入力、操作のループ、字幕の発行を Rust が持つ | Python の `Overlay` を使わない設定を足す（切り替えは 8.4） |
| Phase 4 | 切り替えを既定にし、`src-python/models/overlay/` と対応する試験を削除する。同梱フォントの扱いを整理する（8.5） | 削除 |

## 3. Phase 1 の範囲

`src-tauri/src/vr_overlay/` に置く。依存は増やさない（標準ライブラリと、すでに使っている
`serde_json` だけ）。

| モジュール | Python の出どころ | 内容 |
|---|---|---|
| `math.rs` | `overlay_utils.py`、`getBaseMatrix` など | 4x4 行列、オイラー角、`transform_matrix` とその逆、手首・頭の基準 |
| `layout.rs` | `computeVrLayout`、`clampPanelSize`、`regionRect`、`regionBounds`、`uvToPixel`、`regionWidthM`、`regionPixel`、`placeToolbar` | VR 画面の並びと、オーバーレイの幅・切り出し |
| `pose.rs` | `rayPlaneHit`、`laserTilt`、`popupPoseFacing`、`faceHead`、`poseOnSphere`、`sphereRadius`、`isOutOfView`、`recallPose`、`introFrontPose`、`introFlightPose`、`pushPullDistance`、`pushPull`、`launcherLooksVisible`、`updateGrabScale` の幅、`smoothGrab` | レーザーの当たり、ウィンドウの置き方、起動演出の補間 |
| `placement.rs` | `launcherOutOfReach`、`launcherNearestInReach`、`mirrorHandPosition` | 保存する位置の範囲と左右反転 |
| `timing.rs` | `evaluateOpacityFade`、`updateToolbarFade`、`updateToolbarVisibility`、`updateLauncherVisibility` の待ち時間とフェード、`panelCaptureInterval`、`mainloop` の間隔 | 表示時間とフェード、出す・消すの待ち時間 |
| `tooltip.rs` | `overlay_tooltip.py` | 吹き出しの検証、世代の印の読み取り、吹き出しの形 |

Phase 1 に含めないもの: OpenVR の呼び出し、撮影、画像の加工（角丸のマスク、クロマキー、
ポインタの絵）、字幕の描画、`model.py` / `controller.py` からの呼び出し。

### 3.1 数値の扱い

- 浮動小数は `f64`。Python（NumPy 1.26.4）と同じ順で計算する。
- Python の `round()` は偶数丸め。Rust では `round_ties_even` を使う。`round(x, 4)` は
  `x * 1e4` を偶数丸めして戻す。10 進表現で境目にある値は Python と 1 桁目でずれうるが、
  保存値の丸めにしか使わない。
- `int(x)` は 0 方向への切り捨て（`as i64`）。

### 3.2 基準値との突き合わせ

`src-tauri/tests/vr_overlay_reference/dump_reference.py` が、Python の実装を固定した入力で
呼び、結果を `reference.json` に書く。Rust の単体試験はこの JSON を読み、同じ入力で
同じ結果になることを確かめる（許容誤差 1e-9。整数と真偽値は完全一致）。

`src-python/test/test_overlay_rust_reference.py` は、Python の実装からその場で作った値と
`reference.json` を比べる。Python 側を直したのに基準値を作り直していないと、ここで落ちる。
Python 実装が残っている間（Phase 3 まで）、両者がずれないようにするためのもの。

## 4. 表示時間とフェード（踏襲する仕様）

| 対象 | 振る舞い |
|---|---|
| small / large log | 最後に更新してから `display_duration` 秒は `opacity` のまま。その後 `fadeout_duration` 秒で直線的に 0 まで下げる。`fadeout_duration` が 0 なら消さない |
| ランチャー | 手首を見たら（面の向き 45° 以内、視線から 40° 以内）0.05 秒後に出す。面の向きが 55° を超えるか視線から 45° 外れたら 0.3 秒後に消す。濃さは 0.1 秒で変える。出始めの 0.2 秒は押せない |
| 操作バー | ログか操作バーを 0.3 秒指し続けたら出す。外れて 2 秒で消す。濃さは 0.25 秒で変え、0 になったら隠す |
| 撮影の間隔 | 操作中か変化から 1 秒以内は 1/20 秒、それ以外は 1/4 秒 |
| ループの間隔 | 掴む・伸ばす間は 1/60 秒、VR 画面を指している間は 1/30 秒、それ以外は 1/16 秒 |

デスクトップの字幕の表示時間は、メインウィンドウが行ごとに決める `until`（`caption_overlay.rs`）
で、VR の字幕とは別の仕組みのまま。

## 5. Phase 3 の構成（予定）

```
Python controller ──(字幕の内容・設定)──▶ Tauri (Rust)
                                          ├─ vr_overlay::host   OpenVR のオーバーレイ、入力、ループ
                                          ├─ vr_overlay::*      Phase 1 の計算
                                          ├─ vr_panel_surface   VR 画面のフレーム (Linux)
                                          └─ (Windows の撮影)   8.3
```

- ループは専用のスレッドで回し、Tauri のメインスレッドを止めない。
- 位置や大きさを変えたときの保存は、今と同じく controller の設定を通す。
- ログに字幕の文字や音声を出さない。時間や件数などの数値だけを出す（今の `overlay.py` と同じ）。

## 6. 試験

- Phase 1: 基準値の突き合わせ（3.2）と、Rust 単体の性質試験（行列の往復、並びと
  `vr_layout.json` の一致、フェードの境目）。
- Phase 3 以降: 偽の OpenVR（`src-python/test/fake_openvr.py` に当たるもの）を Rust 側に用意し、
  今の `test_overlay_*.py` の観点（起動と停止、SteamVR の終了、掴んで動かす、伸ばす、
  ランチャーの出し入れ、吹き出し）を移す。

## 7. ログとデータ

字幕の文字、翻訳、音声は、Rust 側でもログに出さない。Phase 1 のモジュールはログを出さない。

## 8. 未決事項

### 8.1 VR の字幕をどう描くか

- A: Rust で文字を描く（`overlay-subtitle-rendering.md` の折り返し、ルビ、上限、フォントの
  代わりを移す）。見た目は今と同じにできるが、文字の組版と絵文字の扱いを自前で持つ。
  依存の追加（シェーピングとラスタライズ）と、そのライセンス確認が要る。
- B: VR 画面（WebView）に字幕の領域を足し、デスクトップの字幕と同じ部品で描いて撮影する。
  二重実装は最も少ないが、見た目（行の高さ、ルビの位置、省略の出し方）が変わる。
  字幕を出すたびに撮影が要り、表示の遅れが今より増えないかを測る必要がある。

どちらも、仕様（今の見た目を保つか、デスクトップとそろえるか）の判断が要る。

### 8.2 デスクトップと VR の字幕の表示時間をそろえるか

今はデスクトップが行ごとの `until`、VR が最後の更新からの `display_duration` と
`fadeout_duration`。そろえると設定の意味が変わる。

### 8.3 Windows の VR 画面の受け渡し

今は Python が画面外のウィンドウを Win32 で撮っている。Rust では WebView2 の
`CapturePreview`、Windows.Graphics.Capture、今と同じ Win32 の方法が候補になる。
表示の遅れと、GPU のテクスチャを直接渡せるかで選ぶ。

### 8.4 OpenVR の結びつけと配布

Rust から OpenVR を呼ぶ方法（既存のクレートか、`openvr_api` を直接読むか）と、
`openvr_api` の DLL / .so の同梱とライセンス表記（今は Python の `openvr` パッケージが
持っている）。OCR の SteamVR 撮影（#281）も同じセッションを使うので、そちらと合わせて決める。

### 8.5 同梱フォント

`src-python/models/overlay/fonts/` の Noto Sans（JP、KR、SC、TC）は字幕の描画にだけ使う。
8.1 で B を選べば不要になる。A なら置き場所を `src-tauri` の資源へ移す。
