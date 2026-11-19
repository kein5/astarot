# 画面側の TypeScript 移行計画

画面側（`src-ui`）の JavaScript を TypeScript へ移す順序と切り分けです。目的と進め方の正本は Issue #544、採用の判断は [ADR-010](adr/adr-010-frontend-stack.md) です。混在期の書き方（拡張子つきの import、消去できる構文だけを使うことなど）は [development.md](development.md) の「UIのTypeScriptとスタイル」にあります。

## 方針

- 振る舞いを変えない移行に徹します。機能の変更や修正は別の PR にします。
- 依存の少ない範囲から移します。移すファイルが未移行の JavaScript を import していると、そこから受け取る値の型が推論頼みになり、厳密に型を付けられないためです。
- 移したファイルには、実際の型を付けます。`any`、`unknown` を経由した二重のキャスト、`@ts-ignore` などで検査を止めることはしません。`tests/devtools/test_typescript_strictness.py` がこれを数えます（下の「型の厳しさ」）。
- 1 回の PR はレビューできる量にします。目安は数百行です。大きなファイルは 1 本で 1 回の PR にします。
- どの段階でも、ビルド、型検査、試験が通る状態を保ちます。

## 現状の量

第 6 段の設定の音声のページを終えた時点で、`src-ui` の中のファイルは次のとおりです。`.jsx` は JavaScript に含めます。

| 範囲 | JavaScript | TypeScript |
|---|---|---|
| `src-ui/logics`（試験を除く） | 2 本、87KB | 153 本、643KB（うち `.css.ts` が 1 本） |
| `src-ui/views`（試験を除く） | 28 本、238KB | 189 本、877KB（うち vanilla-extract の `.css.ts` が 19 本） |
| 試験（`*.test.js` と `src-ui/logics/test/`） | 205 本、1.3MB | 0 本 |

残りの JavaScript の一覧は、次のコマンドで出せます。

```sh
git ls-files src-ui | grep -E '\.(js|jsx|mjs)$' | grep -v -E '\.test\.|/logics/test/'
```

## 段階

| 段 | 対象 | 状態 |
|---|---|---|
| 1 | 未移行の JavaScript を import しない `logics` の葉のモジュール | 済み |
| 2 | データ層の根（ストアと IPC） | 済み |
| 3 | ストアと IPC だけに依存する小さなフック | 済み。設定のフックを読む 5 本は第 4 段で移した |
| 4 | `logics` の大きなモジュール（1 本ずつ） | 設定の一覧（`ui_config_setter`）と `useSettingsLogics`、`useConfigSearch`、`useHotkeys` は済み。`useReceiveRoutes`、`_useBackendErrorHandling` が残り |
| 5 | `logics` の中の JSX（`.jsx` から `.tsx` へ） | 済み |
| 6 | `views` | `common_components`、`quick_chat`、`caption_overlay`、`vr`（`VrApp` を除く）、`app` の入口と `app/others`、`app/_app_controllers`（`StartPythonController` を除く）、`app/io_flow`、`app/main_page`、設定画面の部品とテンプレート、設定のページの一部は済み。`app` の残りの区画が残り |
| 7 | 試験とテスト用のハーネス | 未着手（#550 の Vitest 移行は済み） |
| 8 | 仕上げ（`allowJs` を外し、検査を強める） | 未着手 |

### 第 1 段：`logics` の葉のモジュール

プロジェクトの中の未移行の JavaScript を import しないモジュールです。React、Jotai、Tauri の API だけを使います。

- `common/fileDrop`、`common/fontLanguages`、`voice/saveBar`、`voice/rvcStartOptions`、`captionOverlay/bridge`
- `common/useConsentDialog`、`common/useLegacyDownloadStatus`、`ocr/useOcrSetup`、`translation/useTranslationSetup`、`transcription/useTranscriptionConsent`

ドラッグの状態、保存バーの項目、RVC の設定と起動オプション、翻訳モデルの確認の要求、文字起こしの同意の要求とその 2 つのモードに、名前の付いた型ができました。

### 第 2 段：データ層の根

- `store`（Jotai の atom の定義。134 本のファイルが参照しています）
- `common/useStdoutToPython`（バックエンドへの送信。53 本が参照しています）
- 再輸出だけのファイル（`common/index`、`configs/index`、`main/index`）

ここを先に型付けしたので、第 3 段以降のフックは推論ではなく実際の型を受け取れます。

- atom ごとに、持つ値の型を決めました。`null` や空の配列で始まる atom は、後で入る値の型で宣言しています。値の形は、すでにある TypeScript の型（`SwitchBlocks`、`StartupFailure`、`MessageLogRow`、`IoFlow` など）と `docs/spec/` に合わせました。
- ストアのフックが返すフィールドは、atom の名前から作る名前（`currentX`、`updateX`、`pendingX`、`errorX`）のまま型が付きます。`useStore_SwitchBlocks()` の `currentSwitchBlocks.data` は `SwitchBlocks` です。
- `CompanionController.tsx` の 2 つのキャストを外し、型の厳しさの検査の `ALLOWED` を空にしました。
- `useStdoutToPython` の結果は `false`、`true`、設定の書き込みへの応答のどれかで、型は `StdoutResult` です。
- 設定から実行時に作る atom（`ui_config_setter`）は、ストアから見ると値の型が `unknown` です。名前で引くフック（`getStoreHook`）は、フィールドの名前も値の型も分からない形で返します。設定の値の型は第 4 段で `ui_config_setter` の側に付けました。

### 第 3 段：小さなフック

ストアと IPC だけに依存する、数十行ほどのフックです。機能ごとにまとめて移しました（42 本）。

- `transcription/`（`useRealtimeASR`、`useLocalAsrMigration`）、`flow/`（`useIoFlow`、`useGpuMemory`）、`translation/`（`useOpenTranslatorList`、`useTranslationCatalog`）、`configs/useOcrSharedWindow`、`configs/config_page_setter/_aux/useSettingBoxScrollPosition`
- `voice/` のフック（`useVoice`、`useModelDownloads`、`useSpeechServers`、`useVirtualMic`、`useVcRuntimes`）
- `main/`（`languageMutations`、`useLanguageSettings`、`useMainFunction`、`useIsMainPageCompactMode`、`useMessageInputBoxRatio`、`useMessageLogScroll`）、`setup/useFirstRunSetup`
- `common/` のフック 19 本（`useMessage`、`useNotificationStatus`、`useVolume`、`useHandleOscQuery` など）。`useNotificationStatus` と `useHandleOscQuery` が使う `TranslatedNotice`、`useMessage` を包む `MessageActions`、JSX を含まない `useIsVrctAvailable` も、第 5 段から前倒しして移しました。

バックエンドの応答を受け取るフックは、フックが読むフィールドを並べた型を持ちます。読まないフィールドは開いたままにし（`[key: string]: unknown`）、設定画面などのビューが読みます。型は中核（`native/core`）が送る形と `docs/spec/` に合わせた宣言で、実行時には確かめません。前からフックが値を確かめていた所（流れの図、音声サーバーの状態の行、モデルの取得のハードウェアの一覧、登録したモデル、翻訳のカタログ）は、その確認を型ガードにしています。受け取る値を実行時に確かめるのは、受け取る側（第 4 段の `useReceiveRoutes`）を移すときに扱います。

次の 5 本は設定のフック（`useTranslation`、`useTranscription`、`useOcr`、`useAppearance`）のフィールドを読みます。設定のフックは `ui_config_setter` が実行時に作るので、移す前は型が `{}` と推論され、キャストなしではフィールドを読めませんでした。そのため、第 4 段で `ui_config_setter` を移してから、この 5 本を移しました。

- `main/useSetupNeeds`、`main/useSwitchBlocks`、`setup/useRecognitionState`、`common/useStartupProgress`、`common/useWindow`

### 第 4 段：大きなモジュール

1 本で 1 回の PR にするのが基本です。行数は移行計画を書いた時点のものです。

| ファイル | 行数 | 状態 |
|---|---|---|
| `configs/config_page_setter/ui_config_setter` | 約 1,470 | 済み |
| `useReceiveRoutes.js` | 約 750 | 残り |
| `_useBackendErrorHandling.js` | 約 690 | 残り |
| `configs/config_page_setter/useSettingsLogics` | 約 470 | 済み |
| `configs/config_page_setter/hotkeys/useHotkeys` | 約 470 | 済み |
| `configs/config_page_setter/_aux/useConfigSearch` | 約 280 | 済み |

`ui_config_setter` は `useSettingsLogics` が作るフィールドに型を付けるので、2 本を 1 回の PR で移しました。設定のフックを読む `useConfigSearch` と、第 3 段で後に回した 5 本も同じ PR で移しています。

- 設定ごとの値の型は `configs/config_page_setter/settingTypes.ts` の `SettingValues` にあります。`SETTINGS_ARRAY` は `satisfies` でこの型と照らし合わせるので、既定値の型が違えば型の誤りになります。
- 設定を足すときは、`SETTINGS_ARRAY` の項目と `SettingValues` の型の両方を書きます。`SettingValues` にない名前の項目は型の誤りになります。
- 設定のフック（`createCategoryHook`）が返すフィールドの型（`CategoryApi`）は、`SETTINGS_ARRAY` の `Category`、`Base_Name`、`logics_template_id`、`response_transform` から組み立てます。
- 試験と `tools/spec_catalog.py` は `SETTINGS_ARRAY` の項目を文字列として読みます。型の定義を `settingTypes.ts` に分けたのはそのためです。項目のキーの並びも変えないでください。

`useReceiveRoutes.js` と `_useBackendErrorHandling.js` は、バックエンドからの応答とエラーの形を扱います。どちらも受け取った値をそのまま設定の atom などに書き込みます。そのため型を付けるには、受け取る値を実行時にどこまで確かめるかを先に決める必要があります。IPC の契約を型にする作業なので、`docs/spec/` と食い違いがあれば、型で隠さずに報告します。第 3 段で移したフックと設定のフックは、受け取る値の型を引数に宣言しています。`useReceiveRoutes` を移すときは、その型に合うことを確かめてから渡します。

`useHotkeys` は設定の一覧に依存しないので、ほかとは別に移しました。

- ネイティブのコマンドとイベントが返す値に、Rust と同じ形の型を宣言しました。`quick_chat_shortcut_platform` の答え（`ShortcutPlatform`）、ポータルから届くキーの押下（`PortalActivation`）、デスクトップが割り当てたキー（`PortalAssigned`）です。宣言だけで、実行時には確かめません。
- メインウィンドウ（`store.appWindow`）は小さな関数を通して読みます。設定されていないときは名前の付いた `TypeError` で止まります（`CornerRadiusController` と同じ扱い）。

### 第 5 段：`logics` の中の JSX

`common/MessageActions`、`common/TranslatedNotice`、`common/useIsVrctAvailable` は、第 3 段で移しました（`useIsVrctAvailable` は JSX を含まないので `.ts`）。

`voice/useSettingsDraft` は第 6 段の 1 回目と同じ PR で移しました。設定画面のフォームが使う汎用のフックで、下書きの型を引数（`T`）に取ります。下書き、`canSave`、`pending`、`savedFromResponse` が同じ型を使います。書き込みが送る値は下書きか、`patch` のときは変わったフィールドだけです（`DraftWriteValue<T>`）。

### 第 6 段：`views`

ADR-010 のとおり、画面を触る作業に合わせて移すのが基本です。まとめて移すときは、小さな窓から始めます。

1. `common_components`、`theme`
2. `quick_chat`、`caption_overlay`、`companion_handle`、`companion_panel`
3. `vr`
4. `app`。最も大きい範囲なので、設定画面の `setting_box` は区画ごとに分けて移します。

1 から 3 は済みました（`theme`、`companion_handle`、`companion_panel` は前から TypeScript でした）。

- 部品ごとに props の型を置きました。
- `caption_overlay` はネイティブのコマンドから受け取る字幕（`CaptionSnapshot`、`captionOverlay/lines.ts`）の形を確かめてから描きます。形の合わない字幕は描かず、中身を含まない警告だけを出します。
- VR の設定の窓は AI の翻訳のモデルのフィールドを、名前の文字列で引く代わりに小さな関数で読みます。VR パネルが送る操作を確かめる試験がソースの名前を拾うので、名前は組み立てずに書いたままにしています。
- 型がなかったころに `views` の TypeScript（`CompanionController.tsx`、`ExperimentalFeatures.tsx`、`UsagePresetSelector.tsx`）が書いていた `as { ... }` は外しました。

`vr` の次の 1 本は JavaScript のままです（`VrLogWindow` は `main_page` と一緒に移しました）。

- `VrApp.jsx`: メインウィンドウから届く状態をそのまま atom に書き込む受け取り口（`VrStateReceiver`）を含みます。`useReceiveRoutes` と同じく、受け取る値をどこまで実行時に確かめるかが決まってから移します。

`app` は次の順に区画ごとの PR で移します。

1. `app/others` と `app` の入口
2. `app/_app_controllers`（2 回に分けます）
3. `app/main_page`（`VrLogWindow` も）
4. `app/io_flow`（`VrIoFlowWindow` と、`FlowNode` の型の分割も）
5. `app/config_page`。`setting_box` は区画ごとに分けます。

1 は済みました。

- `app/others` の `VrchatPresence` が使う設定画面の部品 `EnvReadout`（`setting_box/_components/env_readout`）も、前倒しして移しました。`tone` と `progress` はページが渡す値のユニオン型（`EnvReadoutTone`、`EnvReadoutProgress`）です。
- `app/others/index.ts` は拡張子なしで再輸出します（`common_components/index.ts` と同じ）。移す前と後のどちらのファイルも指せます。
- 停止とミュートのボタン（`StopActions`）は、音声の状態（`VoiceStatus`、`RouteSnapshot`）の開いたフィールド（`[key: string]: unknown`）を読みます。待ちの数は数値のときだけ、ミュートの要求は `true` か `false` のときだけ使います。
- 通知（`SnackbarController`）は、通知ごとのクラスを渡すのをやめました。react-toastify 11 は `toastClassName` をコンテナーからしか読まないので、そのクラスは前から画面に付いていませんでした。見た目は変わりません。付けるかどうかは見た目を確かめてから決めます。

2 の 1 回目で、`app/_app_controllers` の 16 本と `index` を移しました。

- 設定画面を開く前のメイン機能の状態（`MainFunctionsStateMemory`）に、ストアで型を付けました。設定画面を開くと、コントローラーが `translation` も書き込むので、型にはそれも含めます。初めの値にはないので、省略できるフィールドです。
- 角の丸みは、Windows のバージョンを User-Agent Client Hints（`navigator.userAgentData`）から読みます。TypeScript の DOM の型にはまだないので、`src-ui/navigatorUAData.d.ts` で読む所だけを宣言しています。WebKitGTK にはないプロパティなので、省略できるものとして宣言しています。
- Quick Chat から受け取るメッセージは、ネイティブのコマンドが返す型（`QuickChatRequest`）として受け取ります。`quickChat/bridge.ts` と同じく宣言だけで、実行時には確かめません。

次の 6 本は、型を付ける作業が大きいので 2 回目に回しました。2 回目で、`StartPythonController` を除く 5 本を、設定画面の部品の後に移しました。`StartPythonController` は `useReceiveRoutes` と一緒に移します。

- `FirstRunSetupController`、`VirtualMicGuideController`、`TranslationSetupController`: 設定画面の部品（`LegacyModelDownloadDialog` など、JavaScript）に props を渡します。部品の推論された型では渡せないものがあるので、部品にも型を付けます。
- `StartPythonController`: 受け取った応答を `useReceiveRoutes`（JavaScript）に渡します。
- `VrPanelSyncController`: VR パネルから届く送信の要求を、確かめてからバックエンドへ渡します。届く値を確かめる型ガードが要ります。
- `CaptionOverlayController`: 設定の値から、字幕の窓に渡す値（`CaptionSnapshot`）を組み立てます。

2 回目で書き方を変えた所は次のとおりです。

- VR パネルから届く送信の要求は `VrPanelStdoutRequest` として受け取ります。パスは前と同じく中継の一覧（`isRelayAllowed`、型ガード）で確かめてから送ります。値と言語の要求は、パネルが送るとおりに宣言だけで渡します。
- 会話ログの差分は、値が `{ data: 行の配列 }` の形のときに送ります（型ガード `isLogState`）。
- 字幕の窓へ送る値は、窓が確かめる型（`CaptionSnapshot`）として組み立てます。
- 取得のフック（`useModelDownloads.ts`）の `ModelDownloadJob` に、初回セットアップが読むフィールド（`job_id`、`phase`、`error_code`、`received_bytes`、`total_bytes`）を宣言しました。宣言だけで、実行時には確かめません。

4（`app/io_flow`）は 3 より先に移しました。`VrIoFlowWindow` と、メイン画面の `IoFlowPanel` も同じ PR で移しています。

- フローの図の節点（`FlowNode`、`flow/flowGraph.ts`）を、種類ごとの型（`InputNode`、`RecognitionNode`、`TranslateNode`、`SpeechNode`、`ConversionNode`、`LiveVoiceNode`、`OutputNode`）のユニオンに分けました。作る節点のフィールドと並びは前と同じです。
- 流れの図の型（`ioFlow.ts`）は、中核が必ず送る形に合わせ、レーンの `translation` と `targets` を省略できないものにしました。宣言だけで、実行時に確かめるのは前と同じく `useIoFlow` の型ガード（2 つのレーンがあること）だけです。

3（`app/main_page`）は 2 回に分けます。1 回目で、サイドバー（言語の設定、メインのスイッチ）、上のバー（クイック設定のメニュー）、言語の一覧、`RealtimeControls` を移しました。

- メニューや一覧の外を押したかどうかの判定は、共有の型 `TargetHolder`（`logics/common/targetHolder.ts`）で尋ねます（下の「型の厳しさ」）。
- 言語の欄がどちら側かは、ユニオン型（`LanguageSelectorKey`）で受け取ります。
- `useVoice.ts` の型を中核が送る形に直しました。直接音声の入力の一覧の行は識別子とラベルの組（`VoiceSourceRow`）で、直接音声の状態には `output_route` と、保存した設定の RVC のフィールド（`DirectVoiceSettings`）を宣言しています。宣言だけで、実行時には確かめません。

2 回目で、会話の列（ログ、入力欄、文字数の警告、ログの大きさ）、`MainSection`、`MainPage`、`startupContext` と `VrLogWindow` を移しました。

- ログの行が表示する文の型を宣言しました（`docs/spec` の「メッセージ」に合わせた形）。`realtimeCaptionState.ts` の `MessageLogText`、`MessageLogContent`、`TransliterationToken` と `MessageLogRow` のフィールド、`useMessage.ts` の新しいメッセージの型（`NewBackendMessage`）です。宣言だけで、実行時には確かめません。
- 消えた行の空行（`GoneRow<Id>`、`messageLogView.ts`）は元の行の `id` の型を引き継ぎ、ログはそのまま key に使います。
- VR のログの窓が閉じている間に保っておく表示の状態は `SavedLogView` です。
- 入力欄は、メッセージの操作の提供元（`MessageActionsProvider`）の外で描かれたときに名前の付いた `TypeError` で止まります。前も同じ所で止まっていました。
- React 18 の型にない `inert` 属性は、`src-ui/inertAttribute.d.ts` で `inert?: "" | undefined` として宣言しています。ページは隠すときに `inert=""` を書き、それ以外は書きません。

5（`app/config_page`）は、ページが使う部品（`setting_box/_components`）とテンプレート（`_templates`）から移します。ページはその props の型の上に移します。1 回目で、`_atoms`（入力欄、プルダウン、ダウンロードのボタン、ページを開くボタン）と、ほかの部品に依存しない小さな部品（ラベル、見出し、説明、ヒント、行、折りたたみ、ページへの案内、保存ボタン付きの入力欄、認証キー、色、操作のボタン、接続の確認、ファイルの置き場、テレメトリーの中身、計算機器の名前）を移しました。

- 部品ごとに props の型を輸出しています（`LabelComponentProps` など）。ページから渡される props を漏らさないように、呼ぶ側をすべて見て決めました。
- 行（`FormRow`）は子の要素から `id` と `aria-describedby` だけを読みます（`RowControlProps`）。
- 入力欄の `focus` と `blur` は、要素がないときは何もしません。描く前には呼ばれないので、前と同じに動きます。

2 回目で、残りの部品（スライダー、しきい値の行、ショートカットの欄、プルダウン、選択肢、言葉のフィルター、書式、組み込みモデルの取得の確認、計算機器、認証情報の組）と、行のテンプレート（`_templates/Templates`）、`_components/index` を移しました。

- 行のテンプレートの props は、行の props（`TemplateRowProps`）と描く部品の props の組み合わせです（`SliderContainerProps` など）。共通の行（`CommonContainer`）は渡された props 全体の型を引数に取り、描く部品をその props から行自身の props を除いたものと照らし合わせます。部品の取り違えは型の誤りになります。
- プルダウンの一覧は `DropdownList`（届くまでは `[]`）、選択肢は `RadioOption` です。選択肢の型を引数に取るので、モデルの選択では各モデルの下の部品がそのモデルの選択肢を受け取ります。
- 組み込みモデルの取得の確認（`LegacyModelDownloadDialog`）は、カタログをこの窓が読むフィールドだけの型（`ReviewCatalog`）として読みます。フックのカタログと同じく、宣言だけで実行時には確かめません。
- 認証情報の組（`CredentialPair`）は、提供元の名前から `current${B}URL` と `current${B}AuthKey` のキーを組み立てて型にしています。

設定のページは区画ごとに移します。1 回目で「機器」（`device/`）と「音声認識」（`transcription/`）を移しました。

- `useRealtimeASR.ts` の型を、フックが読むフィールドだけを並べた形から、中核が送る形の宣言に変えました（`RealtimeAsrSettings` など）。宣言だけで、実行時には確かめません。
- cloud の音声認識のエンジンの `base` は、4 つの値のユニオン型 `CloudTranscriptionBase`（`configs/cloudTranscription.ts`）です。
- 保存のロジック（`useSaveButtonLogic`）が返す欄の値は `unknown` です。ページは、欄が表示するのと同じ文字列にしてから入力欄に渡します（`entryText`）。

2 回目で、音声のページ（「読み上げ」の `tts/`、`rvc/`）と、詳細設定のうち音声とモデルのもの（`VoiceSettings`、`DirectVoiceSettings`、`VoiceAudition`、`SpeechServers`、`StatusLine`、`EngineCatalog`、`VcRuntimeSetup`、`ModelDownloads`、`UserModels`）を移しました。

- フックが中核から受け取る値に宣言の型を付けました。`useModelDownloads` のカタログの行（`ModelCatalogRow`）とジョブ、`useVoice` の音声の設定（値はすべて文字列）、出力機器、モデルが受け付けるシード値の範囲と指示、エンジンの声、`useSpeechServers` のプロファイルと機器、`useVcRuntimes` のカタログとジョブです。宣言だけで、実行時には確かめません。
- `ModelDownloads` の `reserve` と `only` は省略できる props です。組み込みモデルの取得の確認が渡していた `reserve={undefined}` は外しました。
- 設定がないときは、名前の付いた `TypeError` で止まる関数を通して読みます（`SpeechServers` と `DirectVoiceSettings`）。前も同じ所で止まっていました。

### 第 7 段：試験とハーネス

試験のファイル（`*.test.js`）と `src-ui/logics/test/` のハーネスを TypeScript にします。Issue #550 で決まった Vitest への移行は済んだので、着手できます。試験は Vitest で動きます（[development.md](development.md) の「UIの試験（Vitest）」）。試験を TypeScript にするまでは、次のように扱います。

- ソースを移す PR では、試験のうち移したファイルを名指しする行だけを書き換えます（`./saveBar.js` を `./saveBar.ts` にするなど）。試験の書き方、実行の方法、ハーネスの API は変えません。
- ソースを文字列として読んで書き換えてから読み込む試験（`useStdoutToPython.test.js`、`languageMutations.test.js`）は、`node:module` の `stripTypeScriptTypes` で型を消してから import の行を書き換えます。型だけの import は消えるので、書き換えるのは値の import です。
- ハーネスの `loadModule` は `.ts` と `.tsx` を Babel で変換して読み込みます。型だけの import は消えるので、モックは要りません。依存の指定に拡張子がなくても、対応するモックを見つけます。

### 第 8 段：仕上げ

- `tsconfig.json` から `allowJs` を外します。
- 型の検査を段階的に強めます。候補は `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters` です。1 つずつ有効にし、出たエラーを直してから次に進みます。
- `.eslintrc.json` を TypeScript の構文に対応させるかどうかを決めます。

## 型の厳しさ

- `tsconfig.json` は `strict` です。TypeScript のファイルだけを検査し、JavaScript のファイルは型を推論して読むだけです。
- `tests/devtools/test_typescript_strictness.py` は、`src-ui` の TypeScript のファイルにある `any`、`as unknown as`、`@ts-ignore`、`@ts-nocheck`、`@ts-expect-error` を数えます。まだ外せないものは、ファイルごとの数を `ALLOWED` に書きます。数が増えても減っても失敗するので、外したら一覧も減らします。
- DOM の要素を扱うところでは、型を決めつけるキャストの代わりに型ガードで確かめます。たとえば `Element` には `focus()` がないので、`useConsentDialog` は `focus` を持つ要素だけを `Focusable` として扱います。
- TypeScript は計算したキーを `string` として扱うので、`{ [key]: value }` が名前 `K` のキーを持つことを確かめられません。ストアでは `field()` のオーバーロードで 1 か所だけそう宣言しています。名前を 1 つずつ渡すので成り立ちます。
- 同じ理由で、設定の一覧（`ui_config_setter.ts`）に 2 か所の宣言があります。どちらも `SETTINGS_ARRAY` の項目からループで作るフィールドや atom の型で、TypeScript はその名前を追えません。
  - `buildCategoryApiFromSettings` のオーバーロードは、設定のフックが返すフィールドが `CategoryApi` のとおりであることを宣言します。フィールドを作る `useSettingsLogics` と、型を組み立てる `CategoryApi` は同じ項目から名前を作ります。
  - `useSettingValue` のオーバーロードは、設定の atom の値が `SettingValues` の型であることを宣言します。atom は `satisfies` で確かめた既定値から始まり、その設定のフックだけが書き込みます。
- 計算したキーについては、これ以外の場所で宣言を増やしません。同じ形が要るときは `field()` か、この 2 つの型（`CategoryApi` と `SettingValues`）を使います。
- メニューや一覧の外を押したかどうかの判定は、`logics/common/targetHolder.ts` の `TargetHolder`（`contains(target: EventTarget | null)`）で尋ねます。DOM の型ではイベントの対象が `EventTarget` で、`Element.contains` は `Node` しか受け取りません。メソッドの引数は両方向で照らし合わされるので、要素はそのまま `TargetHolder` に代入でき、対象を絞らずに尋ねられます。押されるのはページの要素なので成り立ちます。同じ判定にはこの型を使い、同じ形の宣言を増やしません。
- 下書きのフック（`useSettingsDraft.tsx`）の `answeredValue` も確かめられない宣言です。書き込みにバックエンドが答えた値を、保存した値と同じ型（`T`）として受け取ります（`savedFromResponse` があればその戻り値）。atom の値と同じく、宣言だけで確かめません。
- `src-ui/cssProperties.d.ts` は、React の `CSSProperties` に `--` で始まる名前を足しています。インラインの style で CSS のカスタムプロパティ（`--checkbox-size` など）を渡すときに、`as CSSProperties` は要りません。
- バックエンドの応答を受け取るフックの引数の型は、中核が送る形の宣言です。値を確かめるのは、応答を受け取ってフックに渡す側（`useReceiveRoutes`）です。そこが JavaScript のうちは、確かめずに渡ります。前からフックが確かめていた値だけは、フックの中の型ガードで確かめます。設定のフックの `updateFromBackend…`、`setSuccess…`、`deleteSuccess…` も同じです。ただし `response_transform` で一覧を別の形に変える設定は、変える前に受け取った値が一覧であることを確かめます。
- 設定のフックは型の付いたフィールドを返します。`views` の TypeScript が型のなかったころに書いた `as { ... }` は、第 6 段で外しました。

## 移すときの手順

1. 移すファイルを `git mv` で `.ts`（JSX を含むなら `.tsx`）にします。
2. 型を付けます。外から受け取る値（バックエンドの応答、設定、DOM）には、確かめないまま狭い型を付けません。
3. 参照を書き換えます。
   - ビューやほかのソースの import は、拡張子なしにします（Vite が `.ts` を見つけます）。
   - Node でそのまま読む試験の import と、ハーネスの `loadModule(new URL(...))` は、`.ts` にします。
   - Python の試験や `tools/` がパスを指していないかも確かめます。
4. `python tools/dev.py check --scope ui` と `python tools/dev.py check --scope tooling` を実行します。
