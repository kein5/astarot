# ASTAROTの開発

開発に使うツールの版はリポジトリの直下にある `mise.toml` で固定しています。よく使う手順も [mise](https://mise.jdx.dev/) のタスクにしてあります。

```sh
mise install                 # mise.tomlの版のNode、Rust、Python、uv、Cocogittoを入れる
mise tasks                   # タスクの一覧
mise run doctor              # 足りないツールや依存を表示する
mise run setup:headless      # モデルなしの試験に使うPythonの依存を入れる
mise run setup:ui            # UIの依存を入れる
mise run check               # 軽量チェック
```

タスクの中身は `python tools/dev.py` などの既存のCLIです。miseはその前に固定した版のツールをPATHの先頭に置きます。追加の引数はタスク名の後ろに書きます（`mise run check:voice --dry-run` など）。miseを使わずに `python tools/dev.py` を直接呼んでもかまいません。そのときは、PATHにあるツールの版を自分で合わせます。

`doctor` は不足を表示します。`setup` は指定した依存関係を導入します。`check` の既定値は `quick` で、開発CLIの試験、UIの試験（Vitest）、Ruffを実行します。詳しいコマンドは各サブコマンドの `--help` で確認できます。開発CLI自体はPython 3.11以降の標準ライブラリだけで動きます。

| タスク | 中身 |
| --- | --- |
| `doctor` | `python tools/dev.py doctor` |
| `check`、`check:all` | `python tools/dev.py check`（`quick`）、`--scope all` |
| `check:voice`、`check:ui`、`check:rust` | `python tools/dev.py check --scope <名前>` |
| `check:commits` | `python tools/dev.py check --scope commits --base origin/develop` |
| `setup:headless`、`setup:ui`、`setup:browser`、`setup:rust`、`setup:resources` | `python tools/dev.py setup --scope <名前>` |
| `spec` | 機能仕様書の一覧を作り直す（`python tools/spec_catalog.py --write`） |
| `adr` | ADR の索引の表を作り直す（`python tools/adr_catalog.py --write`） |
| `build:voice-gate`、`build:rvc-worker` | 音声の補助プログラムとRVCのワーカーを `build/` にビルドする |
| `build:windows`、`build:linux` | `npm run build`、`python tools/build_linux.py` |
| `changelog:print` | 次のリリースの変更を、書き込まずに表示する |
| `changelog:notes` | 正式版のリリースノートの雛形を `docs/release-notes/<版>.md` に作る。既にあれば上書きしない（[リリースノートの書式](release-notes/README.md#雛形から書き始める)） |
| `dev:web` | Web UIの開発サーバー（Vite）。検証には含めない |

機能仕様書の一覧（`docs/spec/reference/` のエンドポイント、エラーコード、設定キー）はコードから生成します。エンドポイント、エラーコード、設定キーを変えたら `mise run spec` で作り直します。`check` はこの一覧が最新かどうかも確かめます。仕様書の入口は [docs/spec/README.md](spec/README.md) です。

設計判断の記録（ADR）の索引の表（[docs/adr/README.md](adr/README.md)）は、各 ADR の冒頭の front matter から生成します。ADR を足したり front matter を変えたりしたら `mise run adr` で作り直します。`check` は `tests/devtools/test_adr_catalog.py` で、番号の重複、項目と値、裏付けのパス、リンク、表の古さを確かめます。

npmのスクリプト（`npm run doctor`、`npm run check` など）も当面は残します。中身は同じ `tools/dev.py` ですが、miseを通らないので、PATHにあるツールの版で動きます。アプリの起動（`npm run dev-fast` など）とWindowsの配布物のビルド（`npm run release`）は、今までどおりnpmのスクリプトです。miseを有効にしたシェル（`mise activate`）から呼ぶと、固定した版で動きます。

## 用意するツール

miseを[公式の手順](https://mise.jdx.dev/getting-started.html)で入れ、リポジトリで一度 `mise trust` と `mise install` を実行します。`mise.toml` の版のツールがmiseの保存先に入ります。OSに入っている同じツールは変更しません。

| ツール | 版 | 補足 |
| --- | --- | --- |
| Node.js | 26.13.1 | npmはNodeに付属するもの |
| Rust | 1.100.0 | rustupを通して入れる（profileはminimal、clippyとrustfmtを追加）。`rust-toolchain.toml` は置かない |
| Python | 3.14.10 | ビルドの道具と試験に使う。`pyproject.toml` の `requires-python` には同じマイナー版（3.14）を書く。0.5.0から配布物にPythonは入らない |
| uv | 0.13.5 | |
| Cocogitto | 7.0.0 | コマンド名は `cog` |

版の正本は `mise.toml` です。上の表は説明のために写したもので、食い違ったら `mise.toml` が正しいです。`mise.lock` はRust以外のツールの取得元のURLとSHA-256を、LinuxとWindowsのそれぞれについて記録しています。版を変えるときは `mise.toml` を書き換え、`mise lock --platform linux-x64,windows-x64` で `mise.lock` を作り直します。CIはこの2つのファイルから同じ版を入れます（後述）。`tests/devtools/test_toolchain_pins.py` は、版が完全に固定されていること、`mise.lock` と一致すること、ワークフローがmiseの外で版を決めていないことを確かめます。

uvはmise以外で入れたPython（uvが自分で取得したものを含む）を先に見つけることがあります。環境を作るタスク（`setup:*`）は `UV_PYTHON_PREFERENCE=only-system` を付けて、PATHにあるmiseのPythonを使わせます。uvのコマンドにはPythonの版を書きません（`--python 3.14` などを付けない）。uvは `pyproject.toml` の `requires-python` に合うPythonをPATHから選び、`tools/dev.py` は `mise.toml` の版を読みます。Pythonの版を上げるときに書き換えるのは、`mise.toml`、`mise.lock`、`pyproject.toml` の `requires-python`、`uv.lock` です。`tests/devtools/test_toolchain_pins.py` は、CI、タスク、bat、`tools/dev.py` がuvに版を渡していないことも確かめます。`mise.toml` の `[env]` にはuvの設定を置いていません。`[env]` の値はmiseが起動するすべてのプログラムに引き継がれるため、環境を作るタスクだけが自分で設定します。

`[env]` に置いているのは `ORT_DISABLE_TELEMETRY=1` だけです。ONNX Runtimeは、何も設定しないとセッションを作った時点で `~/.cache/Microsoft/DeveloperTools/.onnxruntime/` に `deviceid` とイベントのデータベースを作り、Microsoftへ利用状況を送ろうとします。この値はすべてのプログラムに引き継がれてかまわないため、`[env]` に置きます。`tools/dev.py` の子プロセス、翻訳モデルの書き出し（`tools/translation_onnx/`）とHuBERTの書き出し（`native/rvc-runtime/reference/export_hubert_onnx.py`）も、自分で同じ値を設定します。miseを通さずにほかのスクリプトでONNX Runtimeを使うときは、先に `ORT_DISABLE_TELEMETRY=1` を設定してください。アプリに同梱するONNX Runtimeは、アプリが起動時に自分で止めます（`docs/spec/external-interfaces.md`）。

`setup` はOSのパッケージマネージャーやグローバルインストーラーを実行しません。Python本体の自動取得も無効にしているため、miseを使わない場合は、`mise.toml` と同じマイナー版のPython（3.14）を先に用意します。miseを使わない場合の各ツールの公式手順は次のとおりです。

| ツール | 公式手順 |
| --- | --- |
| Python | [Python downloads](https://www.python.org/downloads/) |
| uv | [uv installation](https://docs.astral.sh/uv/getting-started/installation/) |
| Node.js / npm | [Node.js downloads](https://nodejs.org/en/download) |
| Rust / Cargo | [Rust installation](https://www.rust-lang.org/tools/install) |
| Cocogitto | [Cocogitto installation](https://docs.cocogitto.io/) |

LinuxのTauri検証にはWebKitGTK 4.1などの開発ライブラリも必要です。必要なパッケージは[Linuxビルド手順](voice-stack/linux-build-pipeline.md)にあります。`doctor --scope rust` は主要ライブラリをpkg-configで調べます。WindowsではTauri用のC++ビルド環境などを別途用意します。Rustのコンパイル成功は、インストーラーの実機確認とは別です。

Linuxのトレイ用ライブラリは `ayatana-appindicator3-0.1` または `appindicator3-0.1` のどちらかがあれば診断を通します。Ubuntu向けのAyatanaパッケージ名を他のディストリビューションへ一律に要求しません。[Tauriの前提条件](https://v2.tauri.app/start/prerequisites/)と、使用中のlibappindicator-sys 0.9.0が両方のライブラリを扱う実装に合わせています。

## 依存関係の準備

`setup` はスコープを1つずつ指定します。通信を伴うコマンドなので、先に `--dry-run` で確認できます。キャッシュだけで準備するときは `--offline` を付けます。

| スコープ | 実行内容と保存先 |
| --- | --- |
| `headless` | `uv.lock` の `voice-test` グループだけを `build/dev/headless-venv` に同期 |
| `ui` | `npm ci --ignore-scripts` でルートの `node_modules` を準備 |
| `browser` | `uv.lock` の `voice-ui-test` グループを `build/dev/browser-venv` に同期。既存venvへの追加も可 |
| `rust` | `cargo fetch --locked` でCargo.lockに従う依存を取得（`src-tauri` と、`tools/dev.py` の `NATIVE_CRATES` にある `native/` のクレート。下の `check --scope rust` と同じ一覧） |
| `resources` | `tools/app_resources.py stage --allow-missing` で `src-tauri/bin/_internal` を `build/` にあるもので作り直す |

専用venvには所有マーカーを保存します。同じ場所にマーカーのない既存ディレクトリやシンボリックリンクがある場合は停止し、削除しません。Pythonのスコープはいずれも、`tools/check_python_lock.py`でロック全体のアーカイブのSHA-256とGit依存の完全なcommit SHAを検査します。続いて、`uv.lock` からハッシュと間接依存を含む一覧を `uv export` で `build/dev/<scope>-requirements.txt` に書き出し、専用venvへ `uv pip sync` で同期します。uvは一覧にあるハッシュを照合し、不一致なら停止します。Git依存にはアーカイブのハッシュを要求せず、固定commitを使います。`--python` で既存venvを指定した場合（`browser` のみ）は `uv pip install -r` で追加し、ほかのパッケージは削除しません。[uvの環境指定](https://docs.astral.sh/uv/pip/environments/)と[依存の固定・同期](https://docs.astral.sh/uv/pip/compile/)を参照してください。

`setup --scope ui` は既存の `node_modules` をnpmの仕様どおり作り直します。package.jsonとpackage-lock.jsonに不一致があれば失敗し、lockを更新しません。[npm ciの仕様](https://docs.npmjs.com/cli/v11/commands/npm-ci)を参照してください。

Windowsでも `headless`、`ui`、`browser`、`rust`、`resources` は同じ入口です。Pythonのバックエンドと、その環境を作る手順（`.venv`、`.venv_cuda`、`.venv_linux` を作っていた `mise run setup:app` と `bat\install.bat`）は0.6.0で消しました（#285）。`uv.lock` には道具と試験の依存だけが残っています。

### Tauriが読む資源を用意する

`tauri.conf.json` は `src-tauri/bin/_internal` を配布物の `_internal` として同梱します。このフォルダがないと、`cargo check`、`tauri dev`、`tauri build` が止まります。新しいcheckoutでは次の順に用意して診断します。

```sh
python tools/dev.py setup --scope resources --dry-run
python tools/dev.py setup --scope resources
python tools/dev.py doctor --scope rust
python tools/dev.py check --scope rust
```

`setup --scope resources` はフォルダを作り直し、`build/` にあるspeech.cpp、RVCのworker、Rustのライセンス文と、リポジトリの `LICENSE`、`NOTICE.md` を写します。足りないものは表示しますが、失敗にはしません。開発用のビルド（debug）は、speech.cppなどをチェックアウトの `build/` から直接読みます（`native/core/src/resources.rs`）。配布物の中身をそろえるときは `npm run build-resources`（Windows）を使います。

0.4までの開発用sidecar（`utils/dev_sidecar`、`setup --scope sidecar`、`npm run dev-fast` のPython起動）は、Pythonの同梱をやめたときに削除しました。Pythonのバックエンド（`src-python/`）は0.6.0で消しました。その振る舞いを確かめたいときは、0.5.xのタグのcheckoutか、0.4.xの配布物を使います。

### 既存Linux環境へUI試験の依存を追加する

```sh
python tools/dev.py setup --scope browser --python path/to/venv/bin/python --dry-run
python tools/dev.py setup --scope browser --python path/to/venv/bin/python
python tools/dev.py doctor --scope browser --python path/to/venv/bin/python
```

この操作は選んだvenv（`mise.toml` と同じPython 3.14）に必要なパッケージを追加・更新します。無関係なパッケージをsyncで削除しません。システムPythonは拒否します。Windowsのvenvなら `.venv\Scripts\python.exe` のように実行ファイルを指定します。

PlaywrightのPythonパッケージとChromium実行ファイルは別です。`setup --scope browser` はChromiumやOSライブラリを取得しません。既存ブラウザを使う試験には `VRCT_TEST_CHROMIUM` の指定が必要です。ブラウザ試験の実行条件は[モデル取得UIの検証記録](voice-stack/model-downloads.md)を参照してください。通常の `check` は実機・ブラウザ試験の有効化変数を除外するため、専用試験は個別の手順で実行します。Windowsの長時間運転と実マイクの試験は[Windowsの実機試験](voice-stack/windows-field-tests.md)にあります。

## 検証する対象を選ぶ

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope node
python tools/dev.py check --scope voice
python tools/dev.py check --scope ui
python tools/dev.py check --scope rust --dry-run
```

| スコープ | 内容 |
| --- | --- |
| `tooling` | 標準ライブラリのunittestで `tests/devtools` を検証 |
| `node` | `src-ui` 以下の `.test.js` / `.test.mjs` / `.test.ts` と `tools/i18n_gate` の試験を Vitest で実行（`vitest.config.js`）。`node_modules` の Vitest を Node で直接起動し、取得はしない。未導入なら `setup --scope ui` を案内して止まる。続けて[文言の検査](#uiの文言と翻訳の検査)（`tools/i18n_gate/check.mjs`）を実行する |
| `lint` | `tools/dev.py` の `LINT_PATHS`（`tests/voice`、`tests/devtools`、音声・配布・開発の道具）をRuffで検査。自動修正なし。voice CIも同じスコープを実行する |
| `voice` | `tests/voice/pytest.ini` を使ったモデルなしの契約試験と、`tests/platform`にある単体の試験3件 |
| `ui` | UIの試験（Vitest）、型チェック（`npm run typecheck`）、`npm run vite-build`。ブラウザの操作は含まない |
| `rust` | `src-tauri` の `cargo check --locked --offline` と、`native/app-identity`、`native/speech-server`、`native/ops`、`native/audio-routing`、`native/adapters`、`native/translation`、`native/transcription`、`native/openvr-client`、`native/onnx-runtime`、`native/vr-overlay`、`native/voice-conversion`、`native/translate-onnx`、`native/tts`、`native/core` の `cargo test --locked --offline`。キャッシュやOS依存（Linuxでは `libpipewire-0.3` の開発ファイルとlibclang。`src-tauri` も中核を通して使う）がなければ失敗 |
| `quick` | `tooling`、`node`、`lint`。既定値 |
| `all` | 上記6対象。時間がかかるため統合時に明示実行 |
| `commits` | `--base` からHEADまでの新規コミット形式を検証 |

Pythonは専用venvを優先し、次に既存の `.venv` を探します。`--python` があればその実行ファイルを使います。専用venvがない状態で `all` を実行しても、依存の不足を黙って省略しません。`doctor --scope all` で先に確認できます。

`doctor` と `check` は依存パッケージ・モデルを取得せず、アプリ、マイク、発声、GPU推論を起動しません。子プロセスでは `VRCT_` で始まる環境変数、pytest追加引数・外部pluginの自動読込みを除外し、Hugging Faceをofflineにします。これは試験の誤起動を防ぐ設定であり、任意のテストコードを封じるネットワークsandboxではありません。HTTP/UDP契約試験はローカルの一時ポートを使います。通信を禁止するsandboxではその試験が失敗します。

`check` はキャッシュや検証用の一時ファイルを作り、UIでは `dist`、RustではCargoのビルド先を書き換えます。起動中の通常アプリを停止するnpmの `dev` / `build` / `task-kill` は呼びません。tooling試験では、rustcがある場合に一時ディレクトリで `src-tauri/src/single_instance.rs` の単体試験をコンパイルして実行します（`tests/devtools/test_single_instance.py`）。配布ビルドは[Linuxビルド手順](voice-stack/linux-build-pipeline.md)の専用workspaceで行います。

最初に見つかった失敗で停止します。終了コードは次のとおりです。

| コード | 意味 |
| --- | --- |
| `0` | 選択した検証の成功。`--dry-run` なら計画の表示成功のみ |
| `1` | 実行した検証・導入コマンドが失敗。子コマンドの終了値も表示 |
| `2` | 引数、不足する前提、所有マーカー、Git基点などの問題 |
| `130` | Ctrl+Cによる中断 |

機械処理には `python tools/dev.py doctor --scope voice --json` を使います。未整備環境では `ok: false` と対処方法を返します。

## UIのTypeScriptとスタイル（移行中）

[ADR-010](adr/adr-010-frontend-stack.md)により、UIはJavaScriptからTypeScriptへ、SCSS Modulesからvanilla-extractへ段階的に移ります。移行が終わるまでは両方が混在します。混在期の規約は次のとおりです（第一段で定めた案で、レビューで確定します）。

- 新しく書くロジックとビューはTypeScript（`.ts`、JSXを含むものは `.tsx`）で書きます。新しいスタイルはvanilla-extract（`.css.ts`）で書きます。
- 型チェックは `npm run typecheck` です。`check --scope ui` も実行し、CIでも動きます。TypeScriptのファイルは `strict` で検査します。JavaScriptのファイルは検査せず、型を推論して読むだけです。
- `any`、`as unknown as`、`@ts-ignore`、`@ts-expect-error` は使いません。バックエンドから届く値は `unknown` として受けて絞り込みます。既存の実行時の形の検査も残します。`check --scope tooling` の `test_typescript_strictness.py` がこれらを数えます。
- 移す順序と残りの範囲は [TypeScript 移行計画](typescript-migration.md) にあります。
- 一部のUIの試験は、TypeScriptのソースを `data:` URL のモジュール経由でNodeにそのまま読ませます（Nodeの型の除去を使います）。このため、消去できる構文だけを使います（`enum`、`namespace`、コンストラクター引数のプロパティは使いません）。型だけのimportは `import type` にします。相対importは `./name.ts` のように拡張子まで書きます。

### UIの試験（Vitest）

UIの試験は Vitest で動きます。設定は `vitest.config.js` で、アプリの Vite の設定（SVG、YAML、vanilla-extract のプラグイン）は読みません。環境は Node で、DOM はありません。

```sh
npm test                 # 全件を1回実行する（check --scope node と同じ）
npx vitest run src-ui/logics/common/meterValue.test.js   # ファイルを絞る
npm run test:watch       # 変更を監視して実行する
npm run test:coverage    # カバレッジ（build/coverage/ui に HTML と json-summary）
```

- アサーションは `node:assert/strict` を使います。`test` と `vi` は `vitest` から import します。
- 後片付けは `context.onTestFinished(fn)` で登録します。`src-ui/logics/test/vitestSetup.js` が、node:test の `after` と同じく登録した順に呼びます（Vitest の既定は逆順）。
- 時計の偽装は `vi.useFakeTimers({ toFake: [...] })` と `vi.advanceTimersByTime(ms)` です。テストが終わると実時間に戻ります。`vi.spyOn` は次のテストの前に元に戻ります（`restoreMocks`）。
- `hookHarness.js` の `loadModule` で読むソースは、Babel で変換してから評価します。Vite を通らないため、カバレッジでは実行されていても0%と出ます。カバレッジの数字は、この読み込み方をしていないファイルだけを比べてください。
- `data:` URL でNodeに直接読ませたモジュールと、テストファイルが import したモジュールは別の実体になります。シングルトンを共有するときは、テストの側も `data:` URL 経由で読みます（`useStdoutToPython.test.js` の `nativeImport`）。
- 既存の `.js` を `.ts` に移すときは、同じコミットで参照をすべて書き換えます。ビューのimport、試験の読み込み、Pythonの試験やツールが指すパスが対象です。
- デザイントークンの値は `src-ui/views/app/_index_css/variables.css` が正本です。vanilla-extractからは `src-ui/views/theme/vars.css.ts` の `vars` で同じ変数を参照します。トークンを足したら両方に書きます（`vars.test.js` が食い違いを検出します）。
- Radix UIは振る舞いとアクセシビリティに使い、見た目はvanilla-extractで付けます。Radixの部品を足すときは、実行時に `<style>` 要素を差し込むかどうかを確かめます。CSPは差し込まれるスタイルをハッシュで許可していて、`contentSecurityPolicy.test.js` がその数を数えています。

### UIのミューテーションテスト

ミューテーションテストは、ソースにわざと小さな変更（ミュータント）を入れ、どれかのテストが失敗するかを確かめます。カバレッジは「実行されたか」しか見ませんが、こちらは「値の違いをテストが見ているか」を測ります。道具は [@mizchi/mutator](https://www.npmjs.com/package/@mizchi/mutator)（0.2.0 に固定）です。CIでは回しません。リファクタリングの節目や、対象のモジュールを変えたときに手で回します（[Issue #550](https://github.com/kein5/astarot/issues/550)）。

```sh
npm run test:mutation                                                  # 対象の全体
npm run test:mutation -- --include src-ui/logics/flow/flowGraph.ts    # ファイルを絞る
npm run test:mutation -- --reporter text --reporter json               # 全件を .mutator/report/mutation.json にも書く
npm run test:mutation -- --reporter agent > build/mutants.json         # 未検出の一覧（キー、場所、覆うテスト）
npx mutator accept <キー> --reason "<等価と判断した理由>"               # 等価なミュータントを記録する
```

対象は `mutator.config.mjs` に書いてあります。テストが import する純粋なロジック（`src-ui/logics` の `.ts` と `views/vr/vrPanelHover.ts`）です。mutator は Vite の変換の中で変異を入れるため、Vite を通らない読み込み方のファイルは対象にできません。`loadModule`（`hookHarness.js`）や `loadBridgeRoutes`（`bridgeHarness.js`）で読むフックと橋渡し、文字列として読むファイルは、理由を添えて `exclude` に入れてあります。テストがそのファイルを import するように変えたら、`exclude` から外してください。

結果の読み方:

| 状態 | 意味 | 扱い |
|---|---|---|
| Killed / Timeout | どれかのテストが失敗した、または止まった | 検出 |
| Survived | テストは実行したが、どれも失敗しなかった。`not infected` は、元と変異で値が変わる入力をどのテストも与えていない | 未検出 |
| NoCoverage | どのテストもその行を実行しない | 未検出 |
| CompileError | 型が合わないので実行しない（`tsc` で判定） | 分母に入れない |
| Ignored | ログだけの処理（`console.*` など）か、`mutator.accepted.json` に記録した等価なもの | 分母に入れない |

スコアは「検出 ÷（検出＋未検出）」です。

- 未検出は1件ずつコードを読み、テストの不足か、どの入力でも結果が変わらない等価なミュータントかを判断します。等価なら `npx mutator accept` で理由と一緒に記録し、`mutator.accepted.json` をコミットします。記録した行が変わると、次の実行で「古い」と報告されます。
- 変異の種類ごとの除外（`excludedMutators`）はしていません。文字列の置き換え（`StringLiteral`）は等価になりやすい一方、表のエンドポイント名やノードのIDなど、本物の穴も多く見つかったためです。
- テストからは実行されていても、mutator には見えない経路があります。`data:` URL でNodeに直接読ませるモジュール（`useStdoutToPython.test.js`）と、`loadModule` に差し替え品を渡すテストです。未検出が多いファイルは、等価か判断する前に、そのファイルを使うテストの読み込み方を確かめます。
- Vitest 5 は変換したモジュールを `node_modules/.vitest-cache` に残します（`fsModuleCache`、既定で有効）。mutator はこのキャッシュと自分の計装を区別しません。そのため、対象を変えて回すと計装のないモジュールが読まれ、エラーなしで NoCoverage ばかりになり、スコアが0%近くまで落ちます。`npm run test:mutation` は `vitest.mutator.config.js`（このキャッシュを切った設定）を使います。`npx mutator --config vitest.config.js` のように、ほかの設定で回さないでください。
- 結果のキャッシュは `.mutator/` にあり（Gitの対象外）、次の実行では関数とテストが変わっていないものを再利用します。0.2.0 は最後の実行の結果だけを持つので、`--include` で絞って回した後の全体の実行は、ほぼ全件を回し直します。`.mutator/` を共有するので、同じ作業ツリーで2つ同時に回さないでください。
- 全体の実行には数分かかります。結果を報告するときは、対象の範囲と計測した条件（版、並列数、機材）を添え、スコアを品質の保証として書かないでください。
- 0.2.0 には、Windows でパスの区切りが合わず計装されない問題が報告されています（Issue #550）。手順は Linux で確かめたものです。

## UIの文言と翻訳の検査

利用者に見せる文言は `locales/en.yml` と `locales/ja.yml` が正本です。UIは `t("キー")` で取り出し、コードに直接書きません。対象はラベル、ボタン、説明、通知、ダイアログ、検証のメッセージ、ツールチップ、読み上げ用の名前と説明、バックエンドのエラーを表示する文言です。

`tools/i18n_gate/check.mjs` がこれを検査します。`check --scope node` と `check --scope ui` に含まれ、CIでも動きます。失敗するとファイルと行と原因を表示します。

```sh
node tools/i18n_gate/check.mjs                    # 検査だけ
node tools/i18n_gate/check.mjs --inventory        # 既知の直書きを場所と種類ごとに数える
node tools/i18n_gate/check.mjs --update-baseline  # 直書きを減らしたあとに基準を書き直す
```

検査する内容は次のとおりです。

- 英語と日本語で、キーの集合が同じこと。値が空でないこと。
- `{{name}}` の補間変数が英語と同じ名前の組であること。
- 複数形（`_one`、`_other` など）に、その言語が必要とする形がそろっていること。`$t(キー)` の参照先があること。
- UIが名指しするキーが `en.yml` にあること。`t()`、`i18n.t()`、`i18nKey`、テンプレートの固定部分（`` t(`main_page.${id}`) `` なら `main_page`）、既知の名前空間のキーに見える文字列が対象です。
- JSXの文字列、利用者に見える属性（`title`、`placeholder`、`alt`、`label`、`aria-label` など）、選択肢の `label` などに、新しい直書きがないこと。

検査を始めたときにあった直書きは `tools/i18n_gate/baseline.json` にファイルごとの件数で記録してあります。件数が増えると失敗します。減ったときも、消した直書きが戻らないように、`--update-baseline` で基準を書き直すまで失敗します。

翻訳しない文字列は理由を書いて例外にします。

- 製品名、サービス名、プロトコル名、単位は `tools/i18n_gate/exceptions.yml` の `terms` に足します。
- 1行だけなら、その行の末尾か直前の行に `// i18n-exempt: 理由`（JSXの中では `{/* i18n-exempt: 理由 */}`）と書きます。
- 続く数行なら `// i18n-exempt-start: 理由` と `// i18n-exempt-end` で囲みます。

利用者の入力、外部から受け取った名前、プロトコルの識別子、ログだけに出す文字列は、もともと翻訳の対象ではありません。検査もそれらを画面の文言とは見なしません。キーを組み立てて渡す箇所（`` t(`backend_errors.${code}`) `` など）は固定部分しか確かめられないので、試験で補います。

## VRの機器なしでVRの処理を試す

0.5.0からVRのオーバーレイはRustの中核（`native/vr-overlay`、`native/openvr-client`）が扱います。中核の試験は偽のSteamVR（`native/vr-overlay` の `runtime::fake::FakeVr`）を使います。コントローラの姿勢とボタンを持ち、置いたオーバーレイの位置からレーザーの当たりを答えます。試験は `native/vr-overlay/tests/interaction.rs` と `native/core/tests/vr_overlay.rs` で、`check --scope rust` に含まれます。詳しくは[クレートのREADME](../native/vr-overlay/README.md)にあります。

Pythonのバックエンドの偽のSteamVR（`src-python/test/fake_openvr.py`）と、それをバックエンドに差し込む `tools/run_with_fake_vr.py` と `tools/fake_vr_site` は、0.6.0でバックエンドと一緒に消しました（#285）。0.5.0のアプリはPythonのバックエンドを起動しないので、これらはアプリのVRにはつながっていませんでした。アプリ全体を偽のSteamVRで動かす手順は、今のところありません。

## EditorConfigとコミット形式

`.editorconfig` はUTF-8、LF、末尾改行を指定します。基本の字下げは空白4個、JSON/YAML/TOML/HTML/CSS/SCSSは2個です。Markdownの末尾空白、patch/diffの空白と末尾改行は意味があるため、一律削除を避けています。適用はエディターで今後編集するファイルが対象です。既存ファイルを一括整形するコマンドは追加していません。[EditorConfigの設定仕様](https://editorconfig.org/)に対応するエディターまたは拡張機能を使います。

CocogittoはConventional Commitsを扱うツールで、コマンド名が `cog` です。例えば `feat(dev): add developer checks` は機能追加、`fix(tts): preserve cancellation state` は不具合修正を表します。形式は[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)に従います。

```sh
# この複製にcommit-msgフックを入れる（cog.tomlの[git_hooks.commit-msg]）
cog install-hook commit-msg

# メッセージだけを検証。コミットは作らない
cog verify "feat(dev): add developer checks"

# 基点はローカルに存在するrefを明示する
python tools/dev.py check --scope commits --base origin/develop

# 次のリリースの変更を、書き込まずに表示する
python tools/changelog.py print
```

フックは不正な形のメッセージをコミットの前に拒否します。マージのコミットと、`fixup!`・`squash!`・`amend!` のコミットは通します（後者はCIで拒否されます）。種別の選び方、フックの入れ方、困ったときの対処、CHANGELOGの分類とリリースの手順は [CONTRIBUTING.md](../CONTRIBUTING.md) の「Commit messages」と「Changelog and releases」にあります。

CLIは指定refとHEADの共通祖先を求め、その後のコミットだけを `cog check` に渡します。基点がない場合は終了コード2で止まり、自動fetchや全履歴への切替はしません。CIでは対象PRのbase/headを取得した状態で実行します。取得深さが足りず共通祖先が見つからない場合も停止します。

既存履歴を遡って形式を直す必要はありません。引数なしの `cog check` は全履歴を調べるため、通常は上記の範囲指定を使います。merge commitは設定で除外し、fixup commitは除外しません。CIはPRのコミットと、developとmainへpushされたコミットを検査します。[履歴検証](https://docs.cocogitto.io/guide/check.html)、[Gitフック](https://docs.cocogitto.io/guide/git_hooks.html)、[changelog](https://docs.cocogitto.io/guide/changelog.html)の公式手順も参照できます。

`CHANGELOG.md` は正式版のリリースを準備するときに `tools/changelog.py` が書きます。載せるのは正式版だけで、前の正式版からの変更をまとめます。ベータ版のノートは、前のタグからのコミットで作ります。コミットの解析はCocogittoの `cog changelog` に任せ、利用者向けと内部向けの分類と書式をこのスクリプトが決めます。種別ごとの見出しは `cog.toml` の `[commit_types]` にあります。試験は `tests/devtools/test_changelog.py` です。

開発CLIはフックを自動では入れません。フックは開発者が `cog install-hook commit-msg` で入れます。履歴を書き換える `cog edit`、版とタグを作る `cog bump`、commit/push、公開hookも開発CLIに含めません。版は今までどおり `package.json` で決めて `npm run update-version` で反映し、タグはGitHub Releasesの下書きを公開したときにできます。

## CIでの利用と再現性

CIのワークフローはNode、Rust、Python、uv、Cocogittoを `jdx/mise-action`（コミットSHAで固定）で入れます。版は `mise.toml`、取得するファイルとSHA-256は `mise.lock` から読むので、開発者の手元と同じ版になります。ジョブごとに必要なツールだけを `install_args` で選びます。uvを使うジョブは `UV_PYTHON_PREFERENCE=only-system` と `UV_PYTHON_DOWNLOADS=never` を付け、miseのPythonを使わせて、uvが別のPythonを取得しないようにします。署名の秘密情報を扱う `prepare-release.yml` では、書き込みのできるトークンをmise-actionに渡さず、キャッシュも使いません。

CIでは準備と検証を分けます。例えば、依存を導入した後は次のように同じコマンドを呼べます。WindowsではPython実行ファイルを `.venv\Scripts\python.exe` に変更します。

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope voice --python .venv/bin/python
python tools/dev.py check --scope lint --python .venv/bin/python
python tools/dev.py check --scope ui
python tools/dev.py check --scope commits --base origin/develop
```

このCLIはvoice gateのコンパイルを代行しません。Linux CIの `tools/build_voice_gate.py` と必要なOS依存の準備は既存の手順を維持します。ブラウザ試験、ネイティブアプリ、実GPU、マイク、配布物の受け入れ試験も別の明示的な工程です。

新規のLinux checkoutで `check --scope voice` を実行する前には、Cコンパイラー、pkg-config、PipeWire開発ライブラリを用意し、次を実行してください。音声試験用の補助バイナリを `build/` に生成します。これを省くと、Python依存がそろっていてもcaptureなどの試験が失敗します。

検証済みの音声基盤はPipeWire 1.6.10とWirePlumber 0.5.18です。Ubuntu 24.04標準のAPIではcaptureをコンパイルできません。[Linuxビルド手順](voice-stack/linux-build-pipeline.md)の隔離セットアップは、固定ハッシュの公式ソースから必要な版を作ります。ホストの音声サービスは変更しません。Python用の `setup --scope headless` とは別の明示操作です。

```sh
mise run build:voice-gate
mise run check:voice
```

ソースから起動したアプリでRVCを使うときは、RVCのワーカーも `build/` にビルドします（Rustが必要です。WindowsとLinuxのどちらでも同じです）。ワーカーはONNX Runtimeを持たず、アプリが同意のうえで取得した実行環境から読み込むので、このビルドは何もダウンロードしません。配布物のビルド（`tools/build_linux.py`、`bat/build.bat`）はこれを自動で実行します。

```sh
mise run build:rvc-worker
```

`native/rvc-runtime` 自体の試験（`cargo test`）は、ビルド時に `ort` がONNX Runtimeを取得します。手順は[クレートのREADME](../native/rvc-runtime/README.md)にあります。

npm、Cargo、Pythonの依存はそれぞれ `package-lock.json`、`Cargo.lock`、`uv.lock` を使います。Pythonの検証対象はロックにある配布アーカイブとGitのcommitです。Node、Rust、Python本体、uv、Cocogittoの版は `mise.toml` で固定します。ソースビルド時に隔離環境へ追加されるビルド依存とOSライブラリは固定しません。同じビット列の配布物や全機種での動作を保証するものではありません。検証記録には `doctor --json` の結果、実行scope、commit、OSを併記します。
