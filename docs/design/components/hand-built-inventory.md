# 手作りの部品の棚卸し: 画面ごとの一覧

共通の部品があるのに、画面ごとにネイティブの要素や `div` で手作りしている箇所を、画面ごとに一覧にした文書です。shadcn/ui（new-york-v4）に寄せた部品へ置き換える作業と、スタイルの vanilla-extract への移行（#957）の順序を決めるための下調べです。棚卸しの時点では、コードを変えていません。

- 状態: 棚卸し（2026-11-23）。置き換えの進め方（H-01〜H-03）は同じ日に決まりました。置き換えはまだ始めていません。置き換えたら、その行に PR の番号を添えて「置き換えた」と書きます。
- 照合したアプリ: develop（#983 のマージ後、`7a4b684`）
- 関係する文書: [部品の棚卸し: shadcn/ui との照合](shadcn-alignment.md)（判断項目 D-xx）、[設定画面の部品の実験](README.md)（kit と残課題 K-xx）、[ADR-010](../../adr/adr-010-frontend-stack.md)

## 読み方

- **共通の部品**は、下の「共通の部品の一覧」にあるものです。shadcn/ui に寄せた kit（`src-ui/views/kit/`）、全体の `common_components`、設定の `_components` と `_templates` の 3 つの層があります。
- **手作り**は、共通の部品を使わずに、ネイティブの要素（`<button>`、`<select>`、`<input>`、`<dialog>` など）や `div role="button"` をその画面に直接書き、その画面か近くのモジュールの SCSS で描いているものです。
- **置き換え先**は、いま共通の部品にあるものを書きます。共通の部品に当たるものがない要素は「受け皿がない」とし、置き換え先を下の「受け皿がない要素」の番号（U-xx）で書きます。
- **難しさ**は 3 段階です。
  - 低: 共通の部品がそのまま入ります。見た目の差は、判断の要らない範囲です。
  - 中: 共通の部品はありますが、props の形、試験、ほかの画面と共有しているスタイルも直す必要があります。見た目が変わるので、画面の確認が要ります。
  - 高: 判断項目（D-xx、K-xx）が決まるまで、置き換え先が定まりません。または、キーボード操作、待ちの表し方、フォーカスの振る舞いが変わります。
- VR パネル、字幕のオーバーレイ、コンパニオンの取っ手は、shadcn/ui との照合の外にしています（[照合の文書](shadcn-alignment.md)の「そのほか」）。この文書では、手作りの要素の場所だけを挙げます。VR パネル、コンパニオンの取っ手、エラーの画面、起動の失敗は、置き換えの対象にもしません（H-03）。
- 置き換えは、スタイルの vanilla-extract への移行（#957）のあとに、部品ごとに進めます（H-01）。

## 共通の部品の一覧

### kit（`src-ui/views/kit/`）

shadcn/ui に寄せた部品です。いまは見本のページ（`src-ui/kit-lab.html`）だけが使い、アプリの画面で使っている箇所はありません。画面で使うかは残課題 K-01 で決めます。

| 部品 | 中身 | shadcn/ui で当たるもの |
|---|---|---|
| `Button` | `tone`（primary、plain、quiet、danger）と `size`（regular、compact、icon） | Button |
| `TextField` | ネイティブの `<input>`。`invalid` と `mono` | Input |
| `Select`、`SelectOption`、`SelectOptGroup` | ネイティブの `<select>` を包む | NativeSelect |
| `Switch` | Radix UI の Switch | Switch |
| `Dialog`、`DialogHeader`、`DialogFooter`、`DialogTitle`、`DialogDescription` | ネイティブの `<dialog>`（`showModal()`）。開閉は `open` と `onOpenChange` | Dialog |
| `SettingGroup`、`SettingRow` | 見出し付きのまとまりと、名前・説明・操作の 1 行 | Field に近い（D-34） |

### `common_components`（`src-ui/views/common_components/`）

| 部品 | 中身 | 使っている画面 |
|---|---|---|
| `Checkbox` | ネイティブの input を隠して箱を描く | 設定の `CheckboxContainer` を通して多くの設定のページ、「デバイス」 |
| `Tooltip` | 吹き出し（Radix ではない、#766） | メインのレール、上のバー、タイトルバー、入力欄、停止とミュート、再送のボタン |
| `ToggleSwitch` | フォーカスを受けない `div` のスイッチ | メインの機能のスイッチだけ |
| `Empty`、`EmptyDescription` | 「結果なし」 | 設定の検索、言語の一覧 |
| `CircularProgress` | 丸い進み具合 | 取得のボタン、更新中の表示 |
| `ResetButton`、`CloseButton` | アイコンだけのボタン | `ResetButton` はメッセージの形と「字幕とVR」、`CloseButton` は通知とエラーの画面 |
| `MarqueeText` | 流れる文字 | なし（どの画面も使っていません） |

### 設定の部品（`setting_box/_components/` と `_templates/`）

設定の部品は 2 つの系統に分かれています。

- **行の部品の系統**: `_templates/Templates.tsx` の `DropdownMenuContainer`、`CheckboxContainer`、`SliderContainer`、`RadioButtonContainer`、`EntryWithSaveButtonContainer`、`ActionButtonContainer` などが、名前と説明と操作を 1 行にまとめます。中の部品は `_DropdownMenu`（自作の combobox）、`_Entry`、`Slider`、`RadioButton`、`ActionButton`、`ConnectionCheckButton`、`ColorEntryWithSaveButton`、`HotkeysEntry`、`AuthKey`、`WordFilter`、`MessageFormat` です。「デザイン」「デバイス」「字幕とVR」「ホットキー」「高度な設定」「実験的機能」「アップデート」「チャット読み取り（OCR）」「その他」と、「翻訳」「音声認識（ASR）」の一部が使います。
- **フォームの系統**: `FormRow`、`SetupSection`、`Fold`、`Lead`、`Hint` で枠と説明を組み、中の操作はネイティブの `<select>`、`<input>`、`<button>` を直接書きます。見た目は `advanced_settings/VoiceSettings.module.scss` のクラス（`primary`、`quiet`、`actions`、`card`、`badge`、`progress`、`checkLabel`、`dialog_text` など）が描きます。部品ではなく、クラスの集まりです。「テキスト読み上げ（TTS）」「ボイスチェンジャー（RVC）」「デバイス」の音声経路、「翻訳」のカタログ、「音声認識（ASR）」のリアルタイム、モデルの取得、OCR のモデルが使います。

どちらの系統も、部品の中身は kit を使わずにネイティブの要素で書いています（たとえば `ActionButton` と `ConnectionCheckButton` の中は `<button>`）。

ほかに、どちらの系統からも使う部品として、`Fold`（開閉、#820）、`FormRow`、`SetupSection`、`AdvancedSection`、`PagePointer`、`EnvReadout`、`FileDropZone`、`ThresholdComponent`（音量のメーターと一体のしきい値。D-41 で照合の外）があります。

### VR パネル（`src-ui/views/vr/`）

VR パネルだけで使う部品です。`VrWindow`（窓の枠）、`VrPickerList`（選択肢の一覧）、`VrSettingsRows`（スイッチの行、選択肢の段）、`VrTooltip`（吹き出しの文字を Python 側に渡す）があります。VR パネルは px の段で描く別の画面なので、照合の外にしています。

## 全体にかかわること

画面ごとの表に入る前に、どの画面にも共通する手作りを挙げます。画面ごとの表では、これらを繰り返し書きません。

| 要素 | 現状 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|
| ボタン | kit の `Button` を使う画面はありません。kit の外の 78 個のファイルに 198 個の `<button>` があり、フォームの `primary` と `quiet` のクラスか、モジュールごとの SCSS で描いています | kit の `Button` | 高 | 高さ（D-03）と variant の名前（D-10）が決まっていません。アイコンだけのボタン（タイトルバー、レールの開閉、`ActionButton`、`ResetButton`、`CloseButton`）は `size="icon"` に寄せますが、大きさは場所ごとに違います。押したままのボタン（`aria-pressed`）は Button ではなく Toggle（U-03） |
| ダイアログ | 14 個の `<dialog>` を画面ごとに書いています。そのうち 7 個は `LegacyModelDownloadDialog.module.scss` のクラスを共有し、取得の同意の 3 個はフォームの SCSS（`VoiceSettings.module.scss`）の `dialog` の規則で描いています | kit の `Dialog` とパーツ | 中 | #764 の決定 3 で、ダイアログは次に作り直すときにパーツの部品へ置き換えることになっています。土台（D-23）、ボタンの並び（D-24）、細部（D-43）が決まっていません。共有している SCSS は、7 個をまとめて移すまで消せません |
| フォームの選択欄 | 11 個のファイルに 33 個のネイティブの `<select>`。フォームのクラスで描いています | kit の `Select` | 中 | 行の部品の系統は自作の `_DropdownMenu` を使っていて、選択欄が 2 系統あります。どちらに寄せるかは D-14、いつ消すかは K-04。対応するエンジンで `appearance: base-select` を使う規則（`@supports` で検出）は kit の `Select` にないので、移す必要があります |
| フォームの入力欄 | 文字、数、URL、パスワードのネイティブの `<input>` | kit の `TextField` | 中 | 行の部品の系統の `_Entry` とは、左右の余白と使えない状態の見た目が違います（D-37）。`FormRow` が子を複製して `id` と `aria-describedby` を渡すので、kit の `TextField` がそれを受け取れることを確かめます |
| フォームのチェックボックス | 10 個のファイルに 13 個のネイティブのチェックボックス（`accent-color`）。フォームの系統の共通の `HintCheck` も、その 1 つです | `common_components` の `Checkbox`。設定のオンとオフはスイッチ（K-02） | 中 | K-02 の案は「オンとオフはスイッチ、チェックボックスは同意の確認だけ」です。同意の確認のチェックボックスをどちらの見た目にするかは決まっていません。土台（ネイティブか Radix か）は D-16 |
| ネイティブの `title` 属性 | 設定のレールの略称、使い方のプリセット、保存の要約、会話のログのルビと話者の名前、モデルの版、声の試聴のボタン | `common_components` の `Tooltip` | 低〜中 | ルビと版の表示はフォーカスを受けない要素です。`Tooltip` はフォーカスとホバーで開くので、フォーカスを受けない要素の扱いを決めます（D-21） |

## 画面ごとの一覧

### メインの画面

| 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|
| 言語の選択（`main_section/language_selector/LanguageSelector.tsx`、`LanguageSelectorTopBar.tsx`） | 絞り込みの `<input type="search">`（`data-slot="input"` だけを付けた）、言語のボタンの格子、戻るボタン | 絞り込みの欄は kit の `TextField`。絞り込みと格子の組は U-01。戻るボタンは kit の `Button` | 高 | Enter で最初の候補を選ぶ振る舞いがあります。格子は 2 次元に並ぶので、listbox の矢印キーの規則と合いません。VR パネルの言語の窓が同じ形を別に作っています |
| 言語の窓を開くボタン（`language_selector_open_button/LanguageSelectorOpenButton.tsx`） | `aria-expanded` の `<button>` | kit の `Button` | 中 | 開くのはポップオーバーではなく、会話の場所を置き換える言語の選択です。開閉の関係は今のまま残します |
| 言語の入れ替えと、訳す言語の足し引き（`LanguageSwapButton.tsx`、`AddRemoveTargetLanguageButtons.tsx`） | `div role="button"` | kit の `Button`（`size="icon"`） | 低 | `div` を `button` にするのは判断なしで寄せられます（照合の文書の「判断なしで寄せられる差」の 11 と同じ考え方） |
| 翻訳エンジンの選択（`TranslatorSelectorOpenButton.tsx`、`translator_selector/TranslatorSelector.tsx`） | 開くボタンが `div role="button"` と `aria-expanded`。開いた一覧の各エンジンが `div role="button"` と `aria-pressed` | 開くボタンは kit の `Button`。開いた一覧は U-04、エンジンの選択は U-03 | 高 | 一つだけを選ぶ選択なので、`aria-pressed` のボタンの集まりより radio の振る舞いが合います。使えないエンジンはフォーカスから外しています |
| プリセットの切り替え（`preset_tab_selector/PresetTabSelector.tsx`） | 3 つの `div role="button"` と `aria-pressed` | U-03 | 高 | 照合の文書の「判断なしで寄せられる差」の 11（`div` を `button` にする）は、まだ入っていません |
| メインの機能のスイッチ（`main_function_switch/MainFunctionSwitch.tsx`） | 行全体が `role="switch"`。中の見た目は `ToggleSwitch`。「ほかの機能」と設定のボタン | kit の `Switch`（D-19）、ボタンは kit の `Button` | 高 | 行全体を押せる形、待ちの表し方、使えない理由の吹き出し、小さいレールでの表示を保つ必要があります |
| クイック設定（`top_bar/right_side_components/RightSideComponents.tsx` の `QuickSettingsMenu`、`_buttons/OpenQuickSettingButton.tsx`） | 自作の開閉（Esc、外を押す、フォーカスが外に出ると閉じる）と `role="group"` の面。中の項目は `aria-pressed` のボタン | 面は U-04、中の項目は U-03 | 高 | 中身はトグルの集まりで、メニュー（`role="menu"`）ではありません（D-25） |
| 入出力の流れのパネル（`RightSideComponents.tsx` の開くボタン、`io_flow_panel/IoFlowPanel.tsx`） | `aria-expanded` と `aria-controls` の開くボタン、閉じるボタン | kit の `Button` | 低 | 開閉の関係は今のまま残します |
| 更新の知らせのボタン（`RightSideComponents.tsx`） | `<button>` | kit の `Button` | 低 | 吹き出しは `Tooltip` を使っています |
| レールの操作（`sidebar_section/SidebarSection.tsx`、`open_settings/OpenSettings.tsx`、`sidebar_compact_mode_button/SidebarCompactModeButton.tsx`、`language_readout/LanguageReadout.tsx`、`engine_readout/EngineReadout.tsx`） | アイコンだけの `<button>` と、読み上げの欄を兼ねるボタン | kit の `Button`（`size="icon"`）。読み上げの欄は今のまま | 中 | 吹き出しは `Tooltip` を使っています。レールの幅（DESIGN.md「Layout」）で大きさが決まっています |
| 会話のログ（`log_box/message_container/MessageContainer.tsx`、`SpeakerNames.tsx`） | 話者の名前のボタン（`aria-expanded`）と、その場で開く名前の欄（ネイティブの `<input>`、保存と取り消しの `<button>`）。ルビと話者の名前の説明はネイティブの `title` | 欄は kit の `TextField`、ボタンは kit の `Button`、説明は `Tooltip` | 中 | ルビは文の中の要素で、1 つの発言に何個も付きます。吹き出しを 1 つずつ付けると、ログが長いときの描画の量が増えます |
| 再送のボタン（`message_sub_menu_container/MessageSubMenuContainer.tsx`） | 長押しで再送する `<button>` | kit の `Button` | 中 | 長押しの判定（ポインタのイベント）を保ちます |
| ログの表示の設定（`message_log_settings_container/MessageLogSettingsContainer.tsx`） | 開くボタンが `div role="button"` と `aria-expanded`。Esc で閉じる面 | 開くボタンは kit の `Button`、面は U-04 | 高 | — |
| 入力欄（`message_input_box/MessageInputBox.tsx`） | `<textarea>`、送信の `<button>` | 入力欄は U-06、送信は kit の `Button` | 高 | 入力欄の角丸は 12px（DESIGN.md）。高さの伸び方を `field-sizing` で書くかは D-13 |
| 空の画面（`log_box/EmptyState.tsx`） | 「初期設定を開く」と機能を始める `<button>` | kit の `Button` | 低 | 画面の置き方は照合の文書で「残す」にしています |
| リアルタイムの操作（`realtime_controls/RealtimeControls.tsx`） | 止める `<button>` | kit の `Button` | 低 | — |
| 停止とミュート（`others/stop_actions/StopActions.tsx`） | 停止の `<button>`、ミュートの `aria-pressed` の `<button>`（押したときは琥珀色） | 停止は kit の `Button`（danger かは D-10）、ミュートは U-03 | 高 | 停止とミュートは独立した操作として保ちます（PRODUCT.md、DESIGN.md） |
| タイトルバー（`others/window_title_bar/WindowTitleBar.tsx`） | 最小化、最大化、閉じるの `<button>` | kit の `Button`（`size="icon"`） | 中 | ウィンドウを動かす領域と重なります。OS のタイトルバーに合わせた大きさです |

### 設定の画面（どのページにもある部分）

| 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|
| 上のバー（`config_page/topbar/Topbar.tsx`） | 保存、取り消し、戻るの `<button>`。離れるときの確認の `<dialog>`。保存の要約のネイティブの `title`（変更の一覧を改行でつなぐ） | kit の `Button`、kit の `Dialog`、`Tooltip` | 中 | 要約の吹き出しは複数行なので、`Tooltip` で改行を保てるかを確かめます |
| 設定のレール（`config_page/sidebar_section/SidebarSection.tsx`） | ページを切り替える `<button>`（`aria-current="page"`）。略称のときのネイティブの `title` | ボタンは今のまま（ナビゲーションなので Tabs にしない、D-35）。略称の説明は `Tooltip` | 低 | レールはホバーとフォーカスで広がり、略称は狭いときだけ出ます |
| 使い方のプリセット（`sidebar_section/usage_presets/UsagePresetSelector.tsx`） | `aria-expanded` の開閉のボタン、小さいレールでのネイティブの `title`、ネイティブのチェックボックス | 開閉は `Fold` か Collapsible（D-26）、説明は `Tooltip`、チェックボックスは `Checkbox` | 中 | 最後の 1 つは外せない規則（`last`）と待ちの表し方を保ちます |
| 設定の検索（`config_page/search_bar/SearchBar.tsx`） | 自作の `role="combobox"` と結果の一覧（`role="option"`）、消すボタン | U-02 | 高 | D-36、D-40 |

### 設定のページ

ページの名前は、アプリに出る名前（日本語）です。

| ページ | 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|---|
| テキスト読み上げ（TTS） | `advanced_settings/VoiceSettings.tsx` | 10 個の `<select>`、文字の欄（`<input>`）、モニターの音量の `<input type="range">`、再読み込みのボタン | kit の `Select`、kit の `TextField`、設定の `Slider`、kit の `Button` | 中 | 下書きを保存バーで保存する形です。`<label>` で包んだ選択欄にも `aria-label` を付けているので、kit の `Select` に移すときに名前の付け方をそろえます |
|  | `tts/TtsEngine.tsx` | 数の `<input type="number">`、3 個の `<select>`、URL の欄、既定に戻すボタンと確かめ直すボタン | kit の `TextField`、kit の `Select`、kit の `Button` | 中 | 数の欄の `min`、`max`、`step` をそのまま渡せることを確かめます |
|  | `tts/GenerationOptions.tsx` | `<select>`、シードの `<input>`、`<textarea>`、選べる値を確かめるボタン | kit の `Select`、kit の `TextField`、U-06、kit の `Button` | 中 | — |
|  | `tts/VirtualMicEntry.tsx`、`advanced_settings/StopVoiceButton.tsx` | 案内を開くボタン、止めるボタン | kit の `Button` | 中 | 止めるボタンは、止めている途中と止めた後の見た目を持ちます |
|  | `advanced_settings/SpeechServers.tsx` | パスの `<input>`、`<select>`、起動と停止と再読み込みのボタン | kit の `TextField`、kit の `Select`、kit の `Button` | 中 | 「音声認識（ASR）」のページも同じ部品を使います |
|  | `advanced_settings/ModelDownloads.tsx`、`EngineCatalog.tsx`、`UserModels.tsx`、`VoiceAudition.tsx`、`catalogLayout.tsx` | 余裕の `<select>`、版の `<select>`、`<progress>`、同意の `<dialog>` とチェックボックス、名前とパスの `<input>`、行の中の削除の確認、試聴のボタンのネイティブの `title`、グリッドとリストの切り替え（`aria-pressed`） | kit の `Select`、kit の `TextField`、kit の `Dialog`、kit の `Button`、`Tooltip`。進み具合は U-05、切り替えは U-03、カードは U-09、行の中の確認は U-10 | 高 | 「ボイスチェンジャー（RVC）」と OCR のモデル、翻訳のカタログと同じカードの形です。カードと印（Badge）はフォームのクラスで描いています |
| ボイスチェンジャー（RVC） | `advanced_settings/DirectVoiceSettings.tsx` | 3 個の `<select>`、数と文字の `<input>`、高域の除去のチェックボックス、選ぶ・始める・止める・保存のボタン | kit の `Select`、kit の `TextField`、スイッチ（K-02）、kit の `Button` | 中 | 始めるボタンは使えない理由を `aria-describedby` で示しています |
|  | `advanced_settings/VcRuntimeSetup.tsx` | `<progress>`、同意の `<dialog>` とチェックボックス、取得と使うボタン | kit の `Dialog`、kit の `Button`、U-05 | 中 | 「翻訳」の GPU の実行環境も同じ部品を使います |
| デバイス | `device/VoiceRouteSettings.tsx` | 音声経路の `<select>`、ミュートと再開の `<button>` | kit の `Select`、kit の `Button` | 中 | ほかの行は行の部品の系統と `Checkbox` を使っています |
| デザイン | `appearance/ThemePicker.tsx` | テーマのタイル（ネイティブの `<input type="radio">` をカードの形に描く） | U-07 | 高 | 色の欄は `ColorEntryWithSaveButton` を使っています |
| 翻訳 | `translation/Translation.tsx` | ライセンスの確認の `<dialog>`（独自のクラス）とチェックボックス、追加の欄を開くボタン | kit の `Dialog`、kit の `Button` | 中 | — |
|  | `translation/TranslationCatalog.tsx` | 名前、フォルダー、言語、URL、モデル、鍵の `<input>`、3 個の `<select>`、行の中の削除の確認、追加と使うボタン | kit の `TextField`、kit の `Select`、kit の `Button`。カードは U-09、行の中の確認は U-10 | 中 | 鍵の欄は `type="password"` と `autoComplete="off"` を保ちます |
| 音声認識（ASR） | `transcription/RealtimeASRSettings.tsx` | 6 個の `<select>`、URL の欄、組み込みの語彙のチェックボックス、更新・始める・止める・保存のボタン（`<form>` の送信） | kit の `Select`、kit の `TextField`、スイッチ（K-02）、kit の `Button` | 中 | 保存は `<form>` の送信で、ほかのページの保存バーとは別の形です |
|  | `transcription/VocabularyList.tsx`、`VocabularyFiles.tsx` | 書き方と読みの `<input>` が並ぶ行の一覧、行ごとの quiet のボタン、隠したファイルの `<input>` と読み込み・書き出しのボタン | kit の `TextField`、kit の `Button`。行の一覧は U-11 | 中 | ファイルを選ぶ形は、共通の `FileDropZone`（落とす形）とは違います |
| 字幕とVR | `vr/Vr.tsx` | 表示する設定の切り替え（「1 行」と「複数行」、「位置」と「回転」。それぞれ 2 つの `div role="button"` と `aria-pressed`）、既定に戻すボタン、試しに送るボタン | 切り替えは U-03、ボタンは kit の `Button` | 高 | 試しに送るボタンは、押しても幅が変わらないように長い方の文言の幅を保っています（#912） |
| ホットキー | `hotkeys/Hotkeys.tsx`、`_components/hotkeys_entry/HotkeysEntry.tsx` | クイックチャットを開くボタン、ショートカットを消すボタン | kit の `Button` | 低 | ほかは行の部品の系統です |
| 高度な設定 | `advanced_settings/AdvancedSettings.tsx`、`GpuCheck.tsx` | 作り直しの確認の `<dialog>`、GPU の確認の始める・止める・写す・報告するボタン | kit の `Dialog`、kit の `Button` | 中 | GPU の確認の表は Table に当たります（照合の文書の「そのほか」） |
| 実験的機能 | `experimental_features/ExperimentalFeatures.tsx` | なし（行の部品の系統だけ） | — | — | — |
| アップデート | `updater/Updater.tsx` | インストールと確認の `<button>`（独自のクラス） | kit の `Button` | 低 | — |
| チャット読み取り（OCR） | `ocr/OcrModels.tsx` | `<progress>`、同意の `<dialog>` とチェックボックス、取得と取り消しのボタン | kit の `Dialog`、kit の `Button`、U-05 | 中 | — |
|  | `ocr/OcrSharedWindow.tsx`、`OcrRegions.tsx`、`OcrStatus.tsx` | 共有と解除と戻すの `<button>`（`resetButton` のクラス、`aria-disabled`） | kit の `Button` | 中 | 共有のボタンは `disabled` ではなく `aria-disabled` です。デスクトップの共有の確認が開いている間も、フォーカスをボタンに残すためです（D-07 と関係します） |
| その他（VRChat） | `vrchat/Vrchat.tsx`、`_components/word_filter/WordFilter.tsx`、`_components/message_format/MessageFormat.tsx` | ワードフィルターの追加と削除の `<button>`、メッセージの形の入れ替えの `div role="button"` | kit の `Button` | 低 | どちらも共通の部品の中にあり、使うページが複数あります |
| ASTAROTについて | `about_vrct/AboutVrct.tsx` | 画像とリンクだけ | — | — | 照合の外 |

### ダイアログ

画面の上に開くダイアログです。どれもネイティブの `<dialog>` を画面ごとに書いています。置き換え先は kit の `Dialog` とパーツで、#764 の決定 3 のとおり、次に作り直すときにまとめて置き換えます。難しさは、どれも「全体にかかわること」のダイアログの行と同じ「中」です。起動の失敗は置き換えの対象にしません（H-03）。

| ダイアログ | 場所 | ダイアログの中の手作り | 引っかかり |
|---|---|---|---|
| 初期設定 | `_app_controllers/FirstRunSetupController.tsx` | `<select>`、3 個のチェックボックス、2 個の `<progress>`、12 個の `<button>`。「いまの状態」の行（Item の形、`data-slot` だけ） | 行の形は U-08。共有のダイアログのクラスに、独自の `FirstRunSetupController.css.ts` を足しています。対応が要る行を配置と形で分ける規則（DESIGN.md「Components」、#759）を保ちます |
| チャット読み取りの準備 | `_app_controllers/OcrSetupController.tsx` | 2 個の `<button>` | 共有のダイアログのクラス |
| 利用状況の送信の知らせ | `_app_controllers/TelemetryNoticeController.tsx` | 3 個の `<button>` | 共有のダイアログのクラスに、独自の SCSS を足しています |
| 音声認識の同意 | `_app_controllers/TranscriptionConsentController.tsx` | 3 個の `<button>` | 共有のダイアログのクラス |
| 仮想マイクの案内 | `_app_controllers/VirtualMicGuideController.tsx` | `<select>`、5 個の `<button>` | 共有のダイアログのクラス |
| 旧モデルの取得 | `_components/download_models/LegacyModelDownloadDialog.tsx` | チェックボックス、モデルの版のネイティブの `title` | このファイルの SCSS が、ほかの 6 個のダイアログの見た目（`dialogStyles`）になっています |
| モデルの取得の確認 | `advanced_settings/ModelDownloads.tsx` | 同意と制限の確認のチェックボックス | フォームの SCSS の `dialog` の規則。制限のあるライセンスは、種類ごとに確認を取ります |
| 実行環境の取得の確認 | `advanced_settings/VcRuntimeSetup.tsx` | 同意のチェックボックス | フォームの SCSS の `dialog` の規則 |
| OCR のモデルの取得の確認 | `ocr/OcrModels.tsx` | 同意のチェックボックス | フォームの SCSS の `dialog` の規則 |
| 翻訳のライセンスの確認 | `translation/Translation.tsx` | 同意のチェックボックス | 独自のクラス（`license_dialog`） |
| 設定の作り直しの確認 | `advanced_settings/AdvancedSettings.tsx` | 2 個の `<button>` | 共有のダイアログのクラス |
| 設定から離れるときの確認 | `config_page/topbar/Topbar.tsx` | 2 個の `<button>` | 独自のクラス（`leave_dialog`） |
| アップデートのモーダル | `others/modal_controller/ModalController.tsx` | 閉じるボタン、外を押すと閉じる領域 | 上のバーの更新のボタンから開き、「アップデート」のページを中に出します。背景を 50% の黒にしていない例外です（#764 の判断 2） |
| 起動の失敗 | `others/startup/StartupFailedDialog.tsx` | `<dialog open>`（モーダルでない）と `role="alertdialog"`、再試行と終了のボタン | 置き換えの対象にしません（H-03）。ほかの部分が描けないときにも出すので、依存を増やさない方が安全です。kit に AlertDialog もありません（U-12） |

### ほかの窓

| 窓 | 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|---|
| クイックチャット | `quick_chat/QuickChat.tsx`（`quick-chat.html`） | `<textarea>`、送信の `<button>` | 入力欄は U-06、送信は kit の `Button` | 中 | メインの入力欄と同じ受け皿（U-06）を待ちます |
| トレイのコンパニオン | `companion_panel/CompanionPanel.tsx` | 機能の `<button role="switch">`、メインを開くと隠すのボタン | kit の `Switch`、kit の `Button` | 中 | 待ち（`aria-busy`）の表し方を保ちます |
| コンパニオンの取っ手 | `companion_handle/CompanionHandle.tsx` | 機能のボタン（`aria-pressed`）、置く辺の選択（`aria-pressed`）、メニューの項目、六角形の `polygon role="button"` | 対象にしない（H-03） | — | 照合の外のまま。U-03 と U-04 を kit に足しても、置き換えません |
| エラーの画面 | `others/error_boundary/AppErrorBoundary.tsx` | エラーを写すボタンと更新のボタン（閉じるボタンは `CloseButton`） | 対象にしない（H-03） | — | 描画が壊れたときに出す画面なので、依存を増やさない方が安全です |
| 字幕のオーバーレイ | `caption_overlay/` | 操作なし | — | — | 照合の外 |

### VR パネル

VR パネルは照合の外で、置き換えの対象にもしません（H-03）。VR パネルの中で、VR パネルの部品を使わずに書いている箇所を、記録のために挙げます。

| 場所 | 手作りしている要素 | VR パネルの部品で当たるもの | 引っかかり |
|---|---|---|---|
| 言語の窓（`vr/VrLanguageWindow.tsx`） | 絞り込みの `<input type="search">`、使えない言語を畳む `<details>`、プリセットの `aria-pressed` のボタン、言語の選択のボタン | 一覧は `VrPickerList` を使っています。絞り込みと畳みに当たる部品はありません | メインの言語の選択（U-01）と同じ形を別に作っています |
| 設定の窓（`vr/VrSettingsWindow.tsx`、`VrSettingsRows.tsx`） | 分類の `aria-pressed` のボタン、`role="switch"` の行、選択肢の段の `aria-pressed` | `VrSettingsRows` の部品そのもの | — |
| 起動のボタンと道具のバー（`vr/VrLauncher.tsx`、`VrToolbar.tsx`） | `aria-pressed` のボタン | — | VR のポインタで押すので、押せる範囲と見た目は VR の規則で決めます |

## 受け皿がない要素

共通の部品の側に、置き換え先に当たる部品がない要素です。shadcn/ui に当たる部品があるものは、その名前と、照合の文書の判断項目を添えます。

H-02 の決定で、使う場所が 3 か所以上の U-03、U-04、U-05、U-06、U-09 は、関係する判断項目が決まったものから kit に足します。ほかは画面の部品のままにし、見た目だけを寄せます。表の「kit に足すか」の列がその区別です。

| ID | 要素 | 使っている場所 | shadcn/ui で当たるもの | 関係する判断 | kit に足すか |
|---|---|---|---|---|---|
| U-01 | 言語の選択（絞り込みの欄と、言語のボタンの格子の組） | メインの言語の選択、VR パネルの言語の窓 | Command（cmdk）。Radix で書いたものはありません | D-36 | 足さない（H-02） |
| U-02 | 結果の一覧を出す検索（combobox） | 設定の検索 | Combobox（Base UI）、Command（cmdk）、InputGroup | D-36、D-40 | 足さない（H-02） |
| U-03 | 押したままのボタンと、一つだけを選ぶボタンの集まり | プリセットの切り替え、翻訳エンジンの選択、ミュート、クイック設定の項目、カタログのグリッドとリスト、「字幕とVR」の表示する設定の切り替え、音量の確認（`VolumeCheckButton`）、コンパニオンの取っ手の辺（置き換えの対象外、H-03） | Toggle、ToggleGroup（Radix）。「字幕とVR」の切り替えは、同じページの中のパネルを切り替えるので Tabs（Radix）にも当たります | D-27 | 足す（H-02） |
| U-04 | ボタンから開く小さな面 | クイック設定、ログの表示の設定、翻訳エンジンの一覧、色のポップオーバー、コンパニオンの取っ手のメニュー（置き換えの対象外、H-03） | Popover、DropdownMenu（Radix） | D-25 | 足す（H-02） |
| U-05 | 横に伸びる進み具合 | 初期設定、モデルの取得、実行環境の取得、OCR のモデルの取得 | Progress（Radix） | D-32。丸い進み具合は `CircularProgress` があります | 足す（H-02） |
| U-06 | 複数行の入力欄 | メインの入力欄、クイックチャット、読み上げの生成の設定 | Textarea | D-13 | 足す（H-02） |
| U-07 | カードの形をした選択肢（radio） | テーマの選択 | 部品はありません。Field の例に、FieldLabel で RadioGroupItem を包む選択肢のカードがあります | D-16 | 足さない（H-02） |
| U-08 | 状態の行（印、名前、説明、操作） | 初期設定の「いまの状態」 | Item | 照合の文書の「そのほか」。部品にはまだ分けていません | 足さない（H-02） |
| U-09 | カードと印 | モデルの取得、翻訳のカタログ、OCR のモデル、エンジンのカタログ | Card、Badge | D-28、D-29 | 足す（H-02） |
| U-10 | 行の中で出す削除の確認 | 自分で足したモデル、翻訳のカタログ | AlertDialog か Popover が近い | 決まった形はありません | 足さない（H-02） |
| U-11 | 欄と操作が並ぶ、その場で直せる行の一覧（`<ul>`） | 用語辞書の一覧 | Table（Radix を使わない）か Item | 照合の文書の「そのほか」 | 足さない（H-02） |
| U-12 | モーダルでない警告のダイアログ | 起動の失敗 | AlertDialog（Radix） | D-23 | 足さない。使う場所が置き換えの対象外（H-03） |

## 決まった判断

この棚卸しから出た、置き換えの進め方の判断です。3 件とも、2026-11-23 に下のとおり決まりました。照合の文書の判断項目（D-xx）と、設定画面の部品の実験の残課題（K-xx）は、それぞれの文書で決めます。

| ID | 問い | 決定 | 決めた日 | 理由 |
|---|---|---|---|---|
| H-01 | 手作りの要素を共通の部品に置き換える作業と、スタイルの vanilla-extract への移行（#957）を、どの順で進めるか | #957 は見た目を変えずに移し、置き換えはそのあとに部品ごとに進める | 2026-11-23 | #957 は、移す前と後の画面を画素で比べて見た目が変わらないことを確かめます。置き換えを混ぜると、この確かめ方が使えません。置き換えの多くは判断項目（D-03、D-10、D-14、D-23 など）を待っているので、混ぜると #957 も止まります。置き換える要素のスタイルも一度は移すことになり、その分の手間は増えます |
| H-02 | 受け皿がない要素のうち、どれに共通の部品を作るか | 使う場所が 3 か所以上のもの（U-03、U-04、U-05、U-06、U-09）を、関係する判断項目が決まったものから kit に足す。1〜2 か所のものは画面の部品のままにし、見た目だけを寄せる | 2026-11-23 | 同じものを何か所も書いているものは、部品にすると直す場所が 1 つになります。1〜2 か所のもの（言語の選択、設定の検索、テーマのタイルなど）は、部品にしても使う場所が増えません |
| H-03 | VR パネル、コンパニオンの取っ手、エラーの画面、起動の失敗を、置き換えの対象に含めるか | 照合の外のままにし、置き換えの対象にしない | 2026-11-23 | VR パネルは px の段と VR のポインタで決まる別の画面です。エラーの画面と起動の失敗は、ほかの部分が壊れたときに出すので、依存を増やさない方が安全です |
