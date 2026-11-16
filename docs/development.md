# VRCT-VOXの開発

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

`doctor` は不足を表示します。`setup` は指定した依存関係を導入します。`check` の既定値は `quick` で、開発CLIの試験、Nodeの試験、Ruffを実行します。詳しいコマンドは各サブコマンドの `--help` で確認できます。開発CLI自体はPython 3.11以降の標準ライブラリだけで動きます。

| タスク | 中身 |
| --- | --- |
| `doctor` | `python tools/dev.py doctor` |
| `check`、`check:all` | `python tools/dev.py check`（`quick`）、`--scope all` |
| `check:voice`、`check:ui`、`check:backend`、`check:rust` | `python tools/dev.py check --scope <名前>` |
| `check:commits` | `python tools/dev.py check --scope commits --base origin/develop` |
| `setup:headless`、`setup:ui`、`setup:browser`、`setup:backend`、`setup:rust`、`setup:resources` | `python tools/dev.py setup --scope <名前>` |
| `setup:app` | Pythonバックエンド（`src-python/`）の環境を `uv.lock` に合わせる。Windowsは `bat\install.bat`（`.venv` と `.venv_cuda`）、Linuxは `.venv_linux`。配布物には使わない |
| `spec` | 機能仕様書の一覧を作り直す（`python tools/spec_catalog.py --write`） |
| `build:voice-gate`、`build:rvc-worker` | 音声の補助プログラムとRVCのワーカーを `build/` にビルドする |
| `build:windows`、`build:linux` | `npm run build`、`python tools/build_linux.py` |
| `changelog:print` | 次のリリースの変更を、書き込まずに表示する |
| `dev:web` | Web UIの開発サーバー（Vite）。検証には含めない |

機能仕様書の一覧（`docs/spec/reference/` のエンドポイント、エラーコード、設定キー）はコードから生成します。エンドポイント、エラーコード、設定キーを変えたら `mise run spec` で作り直します。`check` はこの一覧が最新かどうかも確かめます。仕様書の入口は [docs/spec/README.md](spec/README.md) です。

npmのスクリプト（`npm run doctor`、`npm run check` など）も当面は残します。中身は同じ `tools/dev.py` ですが、miseを通らないので、PATHにあるツールの版で動きます。アプリの起動（`npm run dev-fast` など）とWindowsの配布物のビルド（`npm run release`）は、今までどおりnpmのスクリプトです。miseを有効にしたシェル（`mise activate`）から呼ぶと、固定した版で動きます。

## 用意するツール

miseを[公式の手順](https://mise.jdx.dev/getting-started.html)で入れ、リポジトリで一度 `mise trust` と `mise install` を実行します。`mise.toml` の版のツールがmiseの保存先に入ります。OSに入っている同じツールは変更しません。

| ツール | 版 | 補足 |
| --- | --- | --- |
| Node.js | 26.13.1 | npmはNodeに付属するもの |
| Rust | 1.100.0 | rustupを通して入れる（profileはminimal、clippyとrustfmtを追加）。`rust-toolchain.toml` は置かない |
| Python | 3.11.18 | `pyproject.toml` の `requires-python`（3.11）に合わせる。ビルドの道具と試験に使う。0.5.0から配布物にPythonは入らない |
| uv | 0.13.5 | |
| Cocogitto | 7.0.0 | コマンド名は `cog` |

版の正本は `mise.toml` です。上の表は説明のために写したもので、食い違ったら `mise.toml` が正しいです。`mise.lock` はRust以外のツールの取得元のURLとSHA-256を、LinuxとWindowsのそれぞれについて記録しています。版を変えるときは `mise.toml` を書き換え、`mise lock --platform linux-x64,windows-x64` で `mise.lock` を作り直します。CIはこの2つのファイルから同じ版を入れます（後述）。`tests/devtools/test_toolchain_pins.py` は、版が完全に固定されていること、`mise.lock` と一致すること、ワークフローがmiseの外で版を決めていないことを確かめます。

uvはmise以外で入れたPython（uvが自分で取得したものを含む）を先に見つけることがあります。環境を作るタスク（`setup:*`）は `UV_PYTHON_PREFERENCE=only-system` を付けて、PATHにあるmiseのPythonを使わせます。`mise.toml` の `[env]` にはuvの設定を置いていません。miseが起動したプログラムにはこの環境変数が引き継がれ、開発起動したアプリがSeed-VCの実行環境を入れるときのuv（自分でPythonを取得する必要がある）まで変えてしまうからです。

`setup` はOSのパッケージマネージャーやグローバルインストーラーを実行しません。Python本体の自動取得も無効にしているため、miseを使わない場合は、Python 3.11を先に用意します。miseを使わない場合の各ツールの公式手順は次のとおりです。

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
| `backend` | `uv.lock` の本体・`dev`・`linux-build` を `build/dev/backend-venv` に同期（Linux） |
| `rust` | `cargo fetch --locked` でCargo.lockに従う依存を取得（`src-tauri` と `native/speech-server`、`native/ops`、`native/audio-routing`、`native/adapters`） |
| `resources` | `tools/app_resources.py stage --allow-missing` で `src-tauri/bin/_internal` を `build/` にあるもので作り直す |

専用venvには所有マーカーを保存します。同じ場所にマーカーのない既存ディレクトリやシンボリックリンクがある場合は停止し、削除しません。Pythonのスコープはいずれも、`tools/check_python_lock.py`でロック全体のアーカイブのSHA-256とGit依存の完全なcommit SHAを検査します。続いて、`uv.lock` からハッシュと間接依存を含む一覧を `uv export` で `build/dev/<scope>-requirements.txt` に書き出し、専用venvへ `uv pip sync` で同期します。uvは一覧にあるハッシュを照合し、不一致なら停止します。Git依存にはアーカイブのハッシュを要求せず、固定commitを使います。`--python` で既存venvを指定した場合（`browser` のみ）は `uv pip install -r` で追加し、ほかのパッケージは削除しません。[uvの環境指定](https://docs.astral.sh/uv/pip/environments/)と[依存の固定・同期](https://docs.astral.sh/uv/pip/compile/)を参照してください。

`setup --scope ui` は既存の `node_modules` をnpmの仕様どおり作り直します。package.jsonとpackage-lock.jsonに不一致があれば失敗し、lockを更新しません。[npm ciの仕様](https://docs.npmjs.com/cli/v11/commands/npm-ci)を参照してください。

Windowsでも `headless`、`ui`、`browser`、`rust` は同じ入口です。backend自動準備は現在Linuxのlockを使うため、Windowsでは診断を出して終了します。Windowsの全体セットアップは `mise run setup:app`（`npm run setup-python` と同じbat）です。このbatは `uv sync --frozen` で `.venv` と `.venv_cuda` を `uv.lock` に合わせるため、lockにないパッケージは削除されます。既存環境を保持したい場合には実行せず、利用できる環境を `--python` で検証に渡してください。

### Tauriが読む資源を用意する

`tauri.conf.json` は `src-tauri/bin/_internal` を配布物の `_internal` として同梱します。このフォルダがないと、`cargo check`、`tauri dev`、`tauri build` が止まります。新しいcheckoutでは次の順に用意して診断します。

```sh
python tools/dev.py setup --scope resources --dry-run
python tools/dev.py setup --scope resources
python tools/dev.py doctor --scope rust
python tools/dev.py check --scope rust
```

`setup --scope resources` はフォルダを作り直し、`build/` にあるspeech.cpp、RVCのworker、Rustのライセンス文と、リポジトリの `LICENSE`、`NOTICE.md` を写します。足りないものは表示しますが、失敗にはしません。開発用のビルド（debug）は、speech.cppなどをチェックアウトの `build/` から直接読みます（`native/core/src/resources.rs`）。配布物の中身をそろえるときは `npm run build-resources`（Windows）を使います。

0.4までの開発用sidecar（`utils/dev_sidecar`、`setup --scope sidecar`、`npm run dev-fast` のPython起動）は、Pythonの同梱をやめたときに削除しました。Pythonバックエンドを動かして比べたいときは、0.4.xの配布物か、そのタグのcheckoutを使います。

### 既存Linux環境へUI試験の依存を追加する

```sh
python tools/dev.py setup --scope browser --python .venv_linux/bin/python --dry-run
python tools/dev.py setup --scope browser --python .venv_linux/bin/python
python tools/dev.py doctor --scope browser --python .venv_linux/bin/python
```

この操作は選んだPython 3.11のvenvに必要なパッケージを追加・更新します。無関係なパッケージをsyncで削除しません。システムPythonは拒否します。Windowsのvenvなら `.venv\Scripts\python.exe` のように実行ファイルを指定します。

PlaywrightのPythonパッケージとChromium実行ファイルは別です。`setup --scope browser` はChromiumやOSライブラリを取得しません。既存ブラウザを使う試験には `VRCT_TEST_CHROMIUM` の指定が必要です。ブラウザ試験の実行条件は[モデル取得UIの検証記録](voice-stack/model-downloads.md)を参照してください。通常の `check` は実機・ブラウザ試験の有効化変数を除外するため、専用試験は個別の手順で実行します。Windowsの長時間運転と実マイクの試験は[Windowsの実機試験](voice-stack/windows-field-tests.md)にあります。

## 検証する対象を選ぶ

```sh
python tools/dev.py check --scope tooling
python tools/dev.py check --scope node
python tools/dev.py check --scope voice
python tools/dev.py check --scope ui
python tools/dev.py check --scope backend --python .venv_linux/bin/python
python tools/dev.py check --scope rust --dry-run
```

| スコープ | 内容 |
| --- | --- |
| `tooling` | 標準ライブラリのunittestで `tests/devtools` を検証 |
| `node` | `src-ui` 以下の `.test.js` / `.test.mjs` を全列挙して `node --test` |
| `lint` | voice CIと同じRuff対象に開発CLI、配布候補CLI2本、専用試験を追加。自動修正なし |
| `voice` | `tests/voice/pytest.ini` を使ったモデルなしの契約試験と、`tests/platform`にある単体の試験4件 |
| `ui` | Nodeの試験と `npm run vite-build`。ブラウザの操作は含まない |
| `backend` | 既存 `pytest.ini` による `src-python/test` と、`tests/platform`の単体の試験1件。runtime依存が必要 |
| `rust` | `src-tauri` の `cargo check --locked --offline` と、`native/speech-server`、`native/ops`、`native/audio-routing`、`native/adapters` の `cargo test --locked --offline`。キャッシュやOS依存（Linuxでは `libpipewire-0.3` の開発ファイルとlibclang）がなければ失敗 |
| `quick` | `tooling`、`node`、`lint`。既定値 |
| `all` | 上記7対象。時間がかかるため統合時に明示実行 |
| `commits` | `--base` からHEADまでの新規コミット形式を検証 |

Pythonは専用venvを優先し、次に既存 `.venv_linux`、`.venv` を探します。`--python` があればその実行ファイルを使います。backend専用venvがない状態で `all` を実行しても、依存の不足を黙って省略しません。`doctor --scope all` で先に確認できます。

`doctor` と `check` は依存パッケージ・モデルを取得せず、アプリ、マイク、発声、GPU推論を起動しません。子プロセスでは `VRCT_` で始まる環境変数、pytest追加引数・外部pluginの自動読込みを除外し、Hugging Faceをofflineにします。これは試験の誤起動を防ぐ設定であり、任意のテストコードを封じるネットワークsandboxではありません。HTTP/UDP契約試験はローカルの一時ポートを使います。通信を禁止するsandboxではその試験が失敗します。

`check` はキャッシュや検証用の一時ファイルを作り、UIでは `dist`、RustではCargoのビルド先を書き換えます。起動中の通常アプリを停止するnpmの `dev` / `build` / `task-kill` は呼びません。tooling試験では、Linuxにrustcがある場合に一時ディレクトリでwrapperをコンパイルし、隔離したダミーPythonで引数転送を確かめます。配布ビルドは[Linuxビルド手順](voice-stack/linux-build-pipeline.md)の専用workspaceで行います。

最初に見つかった失敗で停止します。終了コードは次のとおりです。

| コード | 意味 |
| --- | --- |
| `0` | 選択した検証の成功。`--dry-run` なら計画の表示成功のみ |
| `1` | 実行した検証・導入コマンドが失敗。子コマンドの終了値も表示 |
| `2` | 引数、不足する前提、所有マーカー、Git基点などの問題 |
| `130` | Ctrl+Cによる中断 |

機械処理には `python tools/dev.py doctor --scope voice --json` を使います。未整備環境では `ok: false` と対処方法を返します。

## VRの機器なしでVRの処理を試す

`src-python/test/fake_openvr.py` は、SteamVRの代わりになる偽のOpenVRです。pyopenvrの定数と構造体は本物を使い、`openvr.init`、`IVRSystem`、`IVROverlay` など、SteamVRにつながる入口だけを差し替えます。製品のコードと設定は変えません。頭と両手の姿勢、ボタン、オーバーレイの表示・位置・画像、SteamVRの終了（`VREvent_Quit`）を扱えます。

試験では `with FakeOpenVR() as vr:` の中でオーバーレイを動かし、`vr.overlay_by_key("VRCT0")` などで結果を確かめます。本物にはない検査として、`shutdown` の後に古いインターフェースを使うと `vr.misuse` に、消さずに残したオーバーレイを `vr.leaked` に記録します。呼び出しの形が本物とずれていないかは `test_fake_openvr.py` が確かめます。使用例は `test_overlay_fake_vr.py` にあります。

アプリ全体では、次のように起動するとバックエンド（`src-python/mainloop.py`）だけが偽物につながります。`tools/fake_vr_site` を `PYTHONPATH` に入れ、Pythonの `sitecustomize` で差し込みます。

```sh
python tools/run_with_fake_vr.py --out build/fake-vr -- npx tauri dev
```

`--out` には、ヘッドセットに出るはずの画像（オーバーレイごとのPNGと、VR画面のテクスチャ全体）と、オーバーレイの状態の `state.json` を1秒ごとに書き出します。`control.json` を書き換えると、コントローラの向きやボタンを操作できます。書き方は `tools/fake_vr_site/fake_vr_recorder.py` の先頭にあります。ミラー画面（OCRのVRの撮影）は扱いません。実機のSteamVRでの見え方や性能の確認の代わりにはなりません。

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
