# 画面側の TypeScript 移行計画

画面側（`src-ui`）の JavaScript を TypeScript へ移す順序と切り分けです。目的と進め方の正本は Issue #544、採用の判断は [ADR-010](adr/adr-010-frontend-stack.md) です。混在期の書き方（拡張子つきの import、消去できる構文だけを使うことなど）は [development.md](development.md) の「UIのTypeScriptとスタイル」にあります。

## 方針

- 振る舞いを変えない移行に徹します。機能の変更や修正は別の PR にします。
- 依存の少ない範囲から移します。移すファイルが未移行の JavaScript を import していると、そこから受け取る値の型が推論頼みになり、厳密に型を付けられないためです。
- 移したファイルには、実際の型を付けます。`any`、`unknown` を経由した二重のキャスト、`@ts-ignore` などで検査を止めることはしません。`tests/devtools/test_typescript_strictness.py` がこれを数えます（下の「型の厳しさ」）。
- 1 回の PR はレビューできる量にします。目安は数百行です。大きなファイルは 1 本で 1 回の PR にします。
- どの段階でも、ビルド、型検査、試験が通る状態を保ちます。

## 現状の量

第 1 段を終えた時点で、`src-ui` の中のファイルは次のとおりです。`.jsx` は JavaScript に含めます。

| 範囲 | JavaScript | TypeScript |
|---|---|---|
| `src-ui/logics`（試験を除く） | 55 本、321KB | 81 本、263KB（うち `.css.ts` が 1 本） |
| `src-ui/views`（試験を除く） | 170 本、829KB | 18 本、61KB（うち vanilla-extract の `.css.ts` が 8 本） |
| 試験（`*.test.js` と `src-ui/logics/test/`） | 175 本、1.1MB | 0 本 |

残りの JavaScript の一覧は、次のコマンドで出せます。

```sh
git ls-files src-ui | grep -E '\.(js|jsx|mjs)$' | grep -v -E '\.test\.|/logics/test/'
```

## 段階

| 段 | 対象 | 状態 |
|---|---|---|
| 1 | 未移行の JavaScript を import しない `logics` の葉のモジュール | 済み |
| 2 | データ層の根（ストアと IPC） | 未着手 |
| 3 | ストアと IPC だけに依存する小さなフック | 未着手 |
| 4 | `logics` の大きなモジュール（1 本ずつ） | 未着手 |
| 5 | `logics` の中の JSX（`.jsx` から `.tsx` へ） | 未着手 |
| 6 | `views` | 未着手 |
| 7 | 試験とテスト用のハーネス | #550 の Vitest 移行の後 |
| 8 | 仕上げ（`allowJs` を外し、検査を強める） | 未着手 |

### 第 1 段：`logics` の葉のモジュール

プロジェクトの中の未移行の JavaScript を import しないモジュールです。React、Jotai、Tauri の API だけを使います。

- `common/fileDrop`、`common/fontLanguages`、`voice/saveBar`、`voice/rvcStartOptions`、`captionOverlay/bridge`
- `common/useConsentDialog`、`common/useLegacyDownloadStatus`、`ocr/useOcrSetup`、`translation/useTranslationSetup`、`transcription/useTranscriptionConsent`

ドラッグの状態、保存バーの項目、RVC の設定と起動オプション、翻訳モデルの確認の要求、文字起こしの同意の要求とその 2 つのモードに、名前の付いた型ができました。

### 第 2 段：データ層の根

- `store.js`（Jotai の atom の定義。134 本のファイルが参照しています）
- `common/useStdoutToPython.js`（バックエンドへの送信。53 本が参照しています）
- 再輸出だけのファイル（`common/index.js`、`configs/index.js`、`main/index.js`）

ここを先に型付けすると、第 3 段以降のフックが推論ではなく実際の型を受け取れます。`CompanionController.tsx` に残っている 2 つのキャストもここで外せます。ストアの値の形はバックエンドが返すデータの形でもあるので、`docs/spec/` の該当する仕様と照らし合わせて型を書きます。

### 第 3 段：小さなフック

ストアと IPC だけに依存する、数十行ほどのフックです。機能ごとにまとめて移します。

- `common/` の `use*.js`（`useNotificationStatus`、`useMessage`、`useWindow`、`useVolume` など）
- `main/`、`translation/useOpenTranslatorList`、`transcription/`（`useRealtimeASR`、`useLocalAsrMigration`）、`flow/useIoFlow`
- `voice/` の `use*.js`（`useVoice`、`useModelDownloads`、`useSpeechServers`、`useVirtualMic`、`useVcRuntimes`）
- `configs/useOcrSharedWindow`、`configs/config_page_setter/_aux/useSettingBoxScrollPosition`

### 第 4 段：大きなモジュール

1 本で 1 回の PR にします。行数は移行計画を書いた時点のものです。

| ファイル | 行数 |
|---|---|
| `configs/config_page_setter/ui_config_setter.js` | 約 1,470 |
| `useReceiveRoutes.js` | 約 750 |
| `_useBackendErrorHandling.js` | 約 690 |
| `configs/config_page_setter/useSettingsLogics.js` | 約 470 |
| `configs/config_page_setter/hotkeys/useHotkeys.js` | 約 470 |
| `configs/config_page_setter/_aux/useConfigSearch.js` | 約 280 |

`useReceiveRoutes.js` と `_useBackendErrorHandling.js` は、バックエンドからの応答とエラーの形を扱います。IPC の契約を型にする作業なので、`docs/spec/` と食い違いがあれば、型で隠さずに報告します。

### 第 5 段：`logics` の中の JSX

`common/MessageActions.jsx`、`common/TranslatedNotice.jsx`、`common/useIsVrctAvailable.jsx`、`voice/useSettingsDraft.jsx` を `.tsx` にします。

### 第 6 段：`views`

ADR-010 のとおり、画面を触る作業に合わせて移すのが基本です。まとめて移すときは、小さな窓から始めます。

1. `common_components`、`theme`
2. `quick_chat`、`caption_overlay`、`companion_handle`、`companion_panel`
3. `vr`
4. `app`。最も大きい範囲なので、設定画面の `setting_box` は区画ごとに分けて移します。

### 第 7 段：試験とハーネス

試験のファイル（`*.test.js`）と `src-ui/logics/test/` のハーネスは、Issue #550 で決まった Vitest への移行が済んでから TypeScript にします。それまでは次のように扱います。

- ソースを移す PR では、試験のうち移したファイルを名指しする行だけを書き換えます（`./saveBar.js` を `./saveBar.ts` にするなど）。試験の書き方、実行の方法、ハーネスの API は変えません。
- 試験は今のまま `node --test --experimental-strip-types` で `.ts` のソースを読み込みます。ハーネスの `loadModule` は `.ts` を Babel で変換して読み込みます。依存の指定に拡張子がなくても、対応するモックを見つけます。
- Vitest は `.ts` のソースを拡張子つきで import できるので、ここでの書き換えは Vitest への移行の妨げになりません。

### 第 8 段：仕上げ

- `tsconfig.json` から `allowJs` を外します。
- 型の検査を段階的に強めます。候補は `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters` です。1 つずつ有効にし、出たエラーを直してから次に進みます。
- `.eslintrc.json` を TypeScript の構文に対応させるかどうかを決めます。

## 型の厳しさ

- `tsconfig.json` は `strict` です。TypeScript のファイルだけを検査し、JavaScript のファイルは型を推論して読むだけです。
- `tests/devtools/test_typescript_strictness.py` は、`src-ui` の TypeScript のファイルにある `any`、`as unknown as`、`@ts-ignore`、`@ts-nocheck`、`@ts-expect-error` を数えます。まだ外せないものは、ファイルごとの数を `ALLOWED` に書きます。数が増えても減っても失敗するので、外したら一覧も減らします。
- DOM の要素を扱うところでは、型を決めつけるキャストの代わりに型ガードで確かめます。たとえば `Element` には `focus()` がないので、`useConsentDialog` は `focus` を持つ要素だけを `Focusable` として扱います。

## 移すときの手順

1. 移すファイルを `git mv` で `.ts`（JSX を含むなら `.tsx`）にします。
2. 型を付けます。外から受け取る値（バックエンドの応答、設定、DOM）には、確かめないまま狭い型を付けません。
3. 参照を書き換えます。
   - ビューやほかのソースの import は、拡張子なしにします（Vite が `.ts` を見つけます）。
   - Node でそのまま読む試験の import と、ハーネスの `loadModule(new URL(...))` は、`.ts` にします。
   - Python の試験や `tools/` がパスを指していないかも確かめます。
4. `python tools/dev.py check --scope ui` と `python tools/dev.py check --scope tooling` を実行します。
