# メイン画面レイアウト監査：機械検出の集計

`audit/summarize.py` が `audit/layout_audit.py` の出力から生成した表です。手で編集しません。
サイズは CSS px（`@150` は UI サイズ 150%）。メッセージ本文は記録していません。

## サイズごとの寸法（日本語、会話あり、相手の言語 3 つ）

| サイズ | ログ欄 幅×高さ | 入力欄 幅×高さ | サイドバー 表示高さ / 中身の高さ |
|---|---|---|---|
| 400x200 | 288×6 | 288×64 | 54 / 423（スクロールが必要） |
| 450x220 | 338×26 | 338×64 | 74 / 423（スクロールが必要） |
| 640x480 | 528×278 | 528×72 | 334 / 423（スクロールが必要） |
| 800x600 | 688×374 | 688×96 | 423 / 423 |
| 801x600 | 521×374 | 521×96 | 454 / 974（スクロールが必要） |
| 870x654 | 590×418 | 590×106 | 508 / 974（スクロールが必要） |
| 1280x720 | 1000×470 | 1000×120 | 574 / 974（スクロールが必要） |
| 1366x768 | 1086×509 | 1086×129 | 622 / 974（スクロールが必要） |
| 1920x1080 | 1640×758 | 1640×192 | 934 / 974（スクロールが必要） |
| 1280x720@150 | 860×418 | 860×107 | 501 / 1458（スクロールが必要） |
| 1920x1080@200 | 1360×653 | 1360×167 | 788 / 1947（スクロールが必要） |

## 検出（ja）

| 種類 | コンポーネント | 要素 | 状態: サイズ |
|---|---|---|---|
| content-spills | StopActions | 読み上げをミュート | sidebar-toggled: 400x200, 450x220 |
| content-spills | StopActions | 読み上げを停止 | sidebar-toggled: 400x200, 450x220 |
| content-spills | TranslatorBox | AI CTranslate2 デフォルト | translator-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080, 1920x1080@200, 801x600, 870x654 |
| hidden-overflow | LanguageSelector | auto/hidden | language-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080, 1920x1080@200, 801x600, 870x654 |
| overlap | LanguageSelectorOpenButton × OpenSettings | 相手の言語 1: 英語 (アメリカ合衆国) × 設定を開く | language-selector: 1920x1080@200 |
| overlap | LanguageSelectorOpenButton × OpenSettings | 相手の言語 2: 韓国語 (韓国) × 設定を開く | language-selector: 801x600 |
| overlap | MainFunctionSwitch × OpenSettings | ボイスチェンジャー（RVC）: 設定を開く × 設定を開く | empty: 1920x1080@200<br>in-use: 1920x1080@200<br>io-flow: 1920x1080@200<br>quick-settings: 1920x1080@200<br>sidebar-toggled: 1920x1080@200 |
| overlap | OpenSettings × OpenQuickSettingButton | 設定を開く × VRCマイクミュート同期 無効 | quick-settings: 400x200 |
| overlap | OpenSettings × OpenQuickSettingButton | 設定を開く × 字幕オーバーレイ 無効 | quick-settings: 400x200 |
| overlap | SidebarCompactModeButton × IoFlowButton | サイドバーを切り替える × 自分の声とチャットがどこへ出るかと、かかった時間を表示します | sidebar-toggled: 400x200 |
| overlap | StopActions × IoFlowButton | 読み上げをミュート × 自分の声とチャットがどこへ出るかと、かかった時間を表示します | sidebar-toggled: 450x220 |
| overlap | TranslatorSelectorOpenButton × OpenSettings | 翻訳エンジン: AI CTranslate2 × 設定を開く | language-selector: 1366x768 |

### サイドバー以外でスクロールが出た領域（ja）

| コンポーネント | 要素 | 状態: サイズ |
|---|---|---|
| IoFlowPanel | panel | io-flow: 400x200, 450x220 |
| LanguageSelector | language_list_scroll_wrapper | language-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080@200, 801x600, 870x654 |
| MainSection | container | io-flow: 400x200, 450x220<br>quick-settings: 400x200, 450x220 |
| TranslatorSelector | container | translator-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080, 1920x1080@200, 801x600, 870x654 |

### 操作できなかった状態（ja）

幅 800 px 以下ではサイドバーがアイコンの列になり、言語設定と翻訳エンジンのボタンを表示しないため、開けません（仕様どおり）。

- language-selector @ 400x200: Locator.click: Timeout 5000ms exceeded.
- language-selector @ 450x220: Locator.click: Timeout 5000ms exceeded.
- language-selector @ 640x480: Locator.click: Timeout 5000ms exceeded.
- language-selector @ 800x600: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 400x200: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 450x220: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 640x480: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 800x600: Locator.click: Timeout 5000ms exceeded.

## 検出（en）

| 種類 | コンポーネント | 要素 | 状態: サイズ |
|---|---|---|---|
| content-spills | StopActions | Mute speech | empty: 801x600<br>in-use: 801x600<br>io-flow: 801x600<br>language-selector: 801x600<br>quick-settings: 801x600<br>sidebar-toggled: 400x200, 450x220, 801x600<br>translator-selector: 801x600 |
| content-spills | StopActions | Stop speech | empty: 801x600<br>in-use: 801x600<br>io-flow: 801x600<br>language-selector: 801x600<br>quick-settings: 801x600<br>sidebar-toggled: 400x200, 450x220, 801x600<br>translator-selector: 801x600 |
| content-spills | TranslatorBox | AI CTranslate2 Default | translator-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080, 1920x1080@200, 801x600, 870x654 |
| hidden-overflow | LanguageReadout | hidden/hidden | empty: 400x200, 450x220, 640x480, 800x600<br>in-use: 400x200, 450x220, 640x480, 800x600<br>io-flow: 400x200, 450x220, 640x480, 800x600<br>quick-settings: 400x200, 450x220, 640x480, 800x600 |
| hidden-overflow | LanguageSelector | auto/hidden | language-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080, 1920x1080@200, 801x600, 870x654 |
| overlap | LanguageSelectorOpenButton × OpenSettings | Target Language 1: English (United State × Open settings | language-selector: 1280x720@150 |
| overlap | LanguageSelectorOpenButton × OpenSettings | Target Language 3: Simplified Chinese (C × Open settings | language-selector: 1280x720 |
| overlap | LanguageSwapButton × OpenSettings | Switch Languages × Open settings | empty: 1366x768<br>in-use: 1366x768<br>io-flow: 1366x768<br>quick-settings: 1366x768<br>sidebar-toggled: 1366x768 |
| overlap | MainFunctionSwitch × OpenSettings | Voice changer (RVC): Open settings × Open settings | empty: 1920x1080@200<br>in-use: 1920x1080@200<br>io-flow: 1920x1080@200<br>quick-settings: 1920x1080@200<br>sidebar-toggled: 1920x1080@200 |
| overlap | OpenSettings × OpenQuickSettingButton | Open settings × Subtitle Overlay Disabled | quick-settings: 400x200 |
| overlap | OpenSettings × OpenQuickSettingButton | Open settings × VRC Mic Mute Sync Disabled | quick-settings: 400x200 |
| overlap | SidebarCompactModeButton × IoFlowButton | Toggle sidebar × Show where your voice and chat go, and h | sidebar-toggled: 400x200 |
| overlap | StopActions × IoFlowButton | Mute speech × Show where your voice and chat go, and h | sidebar-toggled: 450x220 |
| text-cut | LanguageReadout | Japanese | empty: 400x200, 450x220, 640x480, 800x600<br>in-use: 400x200, 450x220, 640x480, 800x600<br>io-flow: 400x200, 450x220, 640x480, 800x600<br>quick-settings: 400x200, 450x220, 640x480, 800x600 |

### サイドバー以外でスクロールが出た領域（en）

| コンポーネント | 要素 | 状態: サイズ |
|---|---|---|
| IoFlowPanel | panel | io-flow: 400x200, 450x220 |
| LanguageSelector | language_list_scroll_wrapper | language-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080@200, 801x600, 870x654 |
| MainSection | container | io-flow: 400x200, 450x220<br>quick-settings: 400x200, 450x220 |
| TranslatorSelector | container | translator-selector: 1280x720, 1280x720@150, 1366x768, 1920x1080, 1920x1080@200, 801x600, 870x654 |

### 操作できなかった状態（en）

幅 800 px 以下ではサイドバーがアイコンの列になり、言語設定と翻訳エンジンのボタンを表示しないため、開けません（仕様どおり）。

- language-selector @ 400x200: Locator.click: Timeout 5000ms exceeded.
- language-selector @ 450x220: Locator.click: Timeout 5000ms exceeded.
- language-selector @ 640x480: Locator.click: Timeout 5000ms exceeded.
- language-selector @ 800x600: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 400x200: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 450x220: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 640x480: Locator.click: Timeout 5000ms exceeded.
- translator-selector @ 800x600: Locator.click: Timeout 5000ms exceeded.

## 種類の意味

- content-spills: ボタンなどの中身が自分の枠からはみ出している（overflow: visible のため、隣と重なって見える）
- overlap: 操作できる要素どうしが重なり、どちらもクリックできる位置に見えている（オーバーレイで完全に覆われたものは除外）
- clipped / outside-viewport: 祖先の overflow: hidden またはビューポートで切れ、スクロールでも届かない
- text-cut: テキストが自分の枠に収まらず省略・切り捨てされている
- hidden-overflow: overflow: hidden の領域で、中身が枠より大きい
