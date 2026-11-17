# VRCT-VOXのビルドとCI

Windows向けのビルド手順と、現在のCIを説明します。Linuxでは[Linuxビルドパイプライン](voice-stack/linux-build-pipeline.md)と[AppImageガイド](voice-stack/appimage.md)を使います。Windows用のバッチコマンドはLinuxでは実行できません。

## Windowsの準備

Git、[mise](https://mise.jdx.dev/getting-started.html)、TauriのWindowsビルドに必要なVisual Studio C++ツールを用意します。Node.js、Rust、Python 3.11、uvは、`mise.toml`で固定した版をmiseが入れます。CIも同じ版を使います（[開発ガイド](development.md#用意するツール)）。依存関係は`package-lock.json`、`src-tauri/Cargo.lock`、`native/`の各`Cargo.lock`で管理しています。

```sh
git clone https://github.com/kein5/VRCT-VOX.git
cd VRCT-VOX
mise trust
mise install
mise exec -- npm ci
```

`npm`のスクリプトでビルドや起動をするときは、miseを有効にしたシェル（`mise activate`）から呼ぶか、`mise exec -- npm run build`のように呼びます。そうしないと、PATHにある別の版のツールで動きます。

0.5.0からバックエンドはアプリ（`vrct-vox.exe`）の中で動くRustの中核です（[中核の統合](voice-stack/core-integration.md)）。配布物にPythonは入りません。Pythonはビルドの道具と試験を動かすためだけに使います。`src-python/`のPythonバックエンドとその試験を動かすときだけ、`mise run setup:app`（`npm run setup-python`と同じbat）でアプリの依存を`.venv`に入れます。

Windowsのビルドは、固定版のspeech.cpp（Vulkan版、約29 MB）を公式リリースから取得し、ハッシュを確かめてから同梱します。`build/speechcpp`に同じ版があれば取り直さず、別の版が残っていれば置き換えます（`speechcpp_bundle.py --replace`）。`build/`のほかのものには触れません。モデルの取得と本体のビルドは別の操作です。

## 開発時の起動

```sh
npm run dev-fast
```

`src-tauri/bin/_internal`を`build/`にあるもので用意し（`tools/app_resources.py stage --allow-missing`）、ViteとTauriを起動します。開発用のビルドは、speech.cppなどをチェックアウトの`build/`から読みます。`build/speechcpp`がないと音声サーバーは起動しませんが、アプリは起動します。Linuxでは`build/speechcpp-cpu`にCPU版を置くと、配布物と同じく2つのビルドから選びます。どちらか片方だけでも動きます。

同梱する資源を変えたときは、次の方法で用意し直します。

```sh
npm run dev
```

こちらは既存のビルド出力を削除し、バージョン情報を同期して、speech.cpp、RVCのworker、Rustのライセンス文を用意し直してから起動します。UIだけを再起動する`npm run dev-ui`は、`src-tauri/bin/_internal`がすでにあるときに使います。

## 配布候補の作成

```sh
npm run release
npm run release-cuda
# 両方を順に作成する場合
npm run release-all
```

| 対象 | 出力 |
|---|---|
| Windows標準版 | `VRCT-VOX.zip` |
| Windows CUDA版 | `VRCT-VOX_cuda.zip` |
| Windowsインストーラー | `src-tauri/target/release/bundle/nsis/VRCT-VOX_<version>_x64-setup.exe` |
| Linux | `VRCT-VOX-<version>-linux-x64-release.tar.gz`と同名の`.AppImage`、`.deb`、`.rpm`。speech.cppのCPU版とVulkan版を両方入れる（0.4まではビルドごとに別の配布物） |

WindowsのZIPには`vrct-vox.exe`と`_internal/`を収めます。ONNX Runtimeを動的にリンクするクレートがアプリに入った場合は、ビルドが`vrct-vox.exe`の隣に置いたONNX RuntimeとDirectMLのDLLも収めます。Linuxの実行名には`.exe`を付けません。配布物の作成時にはOCR重みなどの禁止資源を検査します。ソースツリー全体をそのまま配布ZIPにしないでください。

CUDA版は0.4までPythonバックエンドのためにCUDAのライブラリを同梱していました。0.5.0からは標準版と同じ中身です。インストーラーのGPUの選択と、CUDA版から更新する利用者のために、同じ名前で作り続けています（[中核の統合](voice-stack/core-integration.md)の「判断が要ること」の20）。

`_internal/`の中身は次のとおりです（`tools/app_resources.py`）。

| パス | 内容 |
|---|---|
| `_internal/build/speechcpp/` | speech.cppのVulkan版の実行ファイル、`bundle.json`、ライセンス文 |
| `_internal/build/speechcpp-cpu/`（Linux） | speech.cppのCPU版の実行ファイル、`bundle.json`、ライセンス文。設定で「CPU」を選んだときと、「自動」でGPUを使えないときに動く |
| `_internal/build/vrct-rvc-worker.exe` | 声質変換のworker（Linuxでは`.exe`なし） |
| `_internal/build/vrct-voice-gate`ほか（Linux） | 音声経路の補助プログラム。`vrct-voice-gate`、`vrct-source-bridge`、`vrct-vc-worker`、`vrct-asr-capture`、`vrct-screen-capture`（`tools/build_voice_gate.py`） |
| `_internal/build/sudachi/` | 読みの辞書。`build/sudachi`にあるときだけ入る（`tools/sudachi_dictionary.py`） |
| `_internal/config/pipewire/`（Linux） | PipeWireの設定（リポジトリの`config/pipewire`） |
| `_internal/licenses/` | VRCT-VOXの`LICENSE`と`NOTICE.md`、Rustのクレートのライセンス文、NScurlのライセンス文（Windows） |

個別にビルドするコマンドは次のとおりです。

| 操作 | コマンド | 主な出力先 |
|---|---|---|
| 同梱する資源 | `npm run build-resources` | `build/`、`src-tauri/bin/_internal/` |
| フロントエンド | `npm run vite-build` | `dist/` |
| Tauri本体 | `npm run tauri build` | `src-tauri/target/release/` |
| まとめてビルド | `npm run build` | 上記の本体と資源 |

## 配布ビルドでのCSP検証

CSPの定義と許可理由は[外部インターフェース](spec/external-interfaces.md#webviewのcontent-security-policycsp)にある。Viteの開発サーバーや`tauri dev`は`devCsp`を使うため、配布用CSPの確認にはならない。

まず静的検査とフロントエンドのビルドを実行する。最後の単独テストで、そのビルドのJS/CSS/HTMLと依存のstylesheet hashを検査する。以前の`dist/`を検査した結果と混同しない。

```sh
python tools/dev.py check --scope ui
node --test src-ui/logics/common/contentSecurityPolicy.test.js
```

次に、対象OSの配布手順でproductionフロントエンドを埋め込んだrelease binaryを作る。配布資源（`src-tauri/bin/_internal`）を準備済みなら`npm run tauri build -- --no-bundle`で本体をビルドできる。`cargo check`は設定のparse確認であり、埋め込まれたCSPやWebviewの動作確認ではない。

WindowsのWebView2とLinuxのWebKitGTKで、それぞれ次を実施する。Linuxの実機操作は`tools/display_power_guard.py`の下で行う。OS、Webviewの版、コミット、ビルド設定、操作したウィンドウ、Console/Networkの記録を残す。

1. `main`、`quick_chat`、`vr_panel`それぞれにInspectorを接続する。配布するreleaseではInspectorを使えない（`src-tauri/Cargo.toml`の`tauri`に`devtools`機能を付けていない）。検証専用のローカル変更で`devtools`機能を足し、mainの`devtools: true`と動的ウィンドウbuilderの`.devtools(true)`を指定し、作成後にRustの`open_devtools()`を呼ぶ。CSPの変更や`tauri dev`への切り替えはしない。VRパネルは画面外にあるため、mainだけを検査して済ませない。この検証用変更は配布しない。
2. Consoleの全レベルとログ保持を有効にして各ページを再読み込みする。NetworkでHTML応答の`Content-Security-Policy`を確認する。設定したdirectiveに加え、Tauriが生成したnonce/hashがある場合も正常。`frame-ancestors`はmetaタグでは効かないため、HTMLにmetaを追加するだけで検証を代替しない。
3. 下表の操作を実施する。`Refused to …`、`Content Security Policy`、`blocked:csp`、`securitypolicyviolation`を探す。動作中の記録には以下のlistenerも使える。listenerをConsoleから登録した場合、それ以前の違反や再読み込み後の違反はこの配列には入らないので、Consoleのブラウザー自身のエラーと併せて確認する。
4. 記録を保存した後、検証用のinline scriptをDOMへ追加すると拒否されることも確かめる。例えば`const s = document.createElement('script'); s.textContent = 'window.__cspProbeExecuted = true'; document.head.append(s)`をInspectorで実行する。`__cspProbeExecuted`が設定されず、`script-src`違反が記録されることを確認する。この意図した違反は通常操作の結果と分けて記録する。

```js
window.__cspViolations = [];
window.addEventListener("securitypolicyviolation", event => {
    const entry = {
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: event.sourceFile,
        line: event.lineNumber,
    };
    window.__cspViolations.push(entry);
    console.error("CSP violation", entry);
});
```

| ウィンドウ/画面 | 操作と確認する資源 |
|---|---|
| mainの起動 | 起動中のメイン画面（操作できない仮の表示）、初期化進捗、起動中のモデル取得の進み具合、起動失敗のダイアログ、アプリアイコン、会話ログ、通知。共有JS/CSSと画像が描画される |
| mainの設定 | 全タブ、検索、開閉、保存、通知。言語5種、OSのローカルフォント、倍率、ログ文字サイズ、狭い幅、ドロップダウンとスクロールを確認する |
| About | 全言語のロゴ、開発者/貢献者/謝辞の全画像、リンクボタンの画像。外部リンクはWebview内の資源として読まれない |
| 色選択 | OBSの文字色と縁取り色のpickerを初回に開く。ドラッグ、キー操作、直接入力、保存を確認する。react-colorfulのstyle hashとdata SVG、CSSOMの更新を検査する |
| モデル取得 | TTS/RVC/ASR/OCR、翻訳・文字起こし用の取得確認、ライセンス・容量表示、キャンセル、同意後の進捗と失敗通知。許諾のあるモデルだけで取得を試す。ネットワーク処理は中核が行う |
| OCR | window/VRそれぞれの領域スライダー、矩形プレビュー、リセット、モデル準備の案内。画像URLを取得するプレビューではない |
| ログと音声 | 自動ログ保存とフォルダーを開く操作、チャット送信、TTS/RVCと停止/ミュート、音声サーバーの状態表示。blobダウンロードやHTML mediaを必要としない |
| OBS/WebSocket設定 | 設定の保存、オン/オフ、認証URLのコピー。UIからOBSページやWebSocketへ接続しない |
| Quick Chat | mainのボタン/ホットキーで開く、入力、送信、失敗表示、閉じる/再表示、言語・フォント・倍率の追従。専用chunkと共有CSS/JS、IPCを確認する |
| VRパネル | オン/オフと再作成、introのアイコン/背景、launcher、ログ開閉とスクロール、言語/フォントpicker、全設定popup、tooltip、ポインタ/押下表示、透過度/文字サイズ。virtuaの配置とCSSOM、ウィンドウ間IPCを確認する |

通常操作ではCSP違反がなく、画像・通知・色選択のstyleが欠けず、全ウィンドウでIPCが動くことを合格条件とする。Consoleに違反がないだけで、隠れている画面も確認済みとは扱わない。静的検査はブラウザー実装の差やすべての動的な資源読み込みを検証するものではない。依存の更新時も同じ実機確認を繰り返す。

## バージョン管理

バージョンは`package.json`で管理し、次のコマンドで`src-tauri/tauri.conf.json`、`src-python/config.py`、`pyproject.toml`へ同期します。`src-python/`を削除するまでは、Pythonの側も同じ版にそろえます。`pyproject.toml`の版が変わったときは、このコマンドが`uv lock`も実行して`uv.lock`を更新します。設定キーの一覧（`docs/spec/reference/config-keys.md`）に版が載るので、最後に`tools/spec_catalog.py --write`も実行します。通常のビルドコマンドでも同期処理を実行します。

```sh
npm run update-version
```

版は上流VRCT（3.x）とは別に0.1.0から数えます。`0.1.0-beta.1`のような識別子も使えます。バージョン文字列だけで公開や配布先の切り替えは行いません。ZIP名はバージョンを含まない固定名で、NSIS・Linux候補のファイル名にはバージョンが入ります。

## CIと公開先

[voice-tests.yml](../.github/workflows/voice-tests.yml)はpushとpull requestで回帰試験を実行します。[build-linux.yml](../.github/workflows/build-linux.yml)は対象ファイルのpull requestと手動実行に対応し、Linux候補を作成・検査します。[release.yml](../.github/workflows/release.yml)はWindows候補を作成・検査するワークフローで、手動実行とmain宛てのpull requestで動きます。CUDA版を先にビルドし、続くCPU版のジョブが、両方のZIPのSHA-256を埋め込んだNSISインストーラーを作ります（`tools/installer_package_hashes.py`）。最後のジョブで全部を検査します。[windows-package.yml](../.github/workflows/windows-package.yml)は、`bat/`や同梱資源の道具を変えたdevelop宛てのpull requestと手動実行で、`_internal`の用意を試します。[installer-update-tests.yml](../.github/workflows/installer-update-tests.yml)は、NSISのテンプレートやインストーラーの試験を変えたpull requestと手動実行で、Windowsの更新の試験を動かします。[prepare-release.yml](../.github/workflows/prepare-release.yml)は、検査済みの候補からリリースの下書きを作る手動のワークフローです。

ビルド候補はGitHub Actionsの成果物として保存します。これらのワークフローはGitHub ReleasesやHugging Faceへ自動公開しません。タグをpushしても公開処理は始まりません。権限は`contents: read`で、本家の公開用キーやテレメトリー用キーは使いません。

配布先は[kein5/VRCT-VOX Releases](https://github.com/kein5/VRCT-VOX/releases)です。最初の公開版は`v0.1.0-beta.1`（プレリリース、developから作成）です。WindowsのNSISインストーラーは、このリポジトリのリリースから`VRCT-VOX.zip`または`VRCT-VOX_cuda.zip`を取得します。候補をビルドしただけでは、そのURLにファイルは存在しません。

アプリ内の更新はTauriのupdaterで行い、リリースの`latest.json`を読みます（[アプリの更新](spec/external-interfaces.md#アプリの更新)）。`latest.json`と署名は下書きを作るワークフローが作ります（[配布候補の手順](voice-stack/release-candidates.md#updaterの署名とlatestjson)）。

Windowsの更新は、インストール先の`.upd`内で取得済みパッケージを検証・展開してから、アプリのファイルだけを置き換えます。取得・展開失敗では旧版を保持し、置き換え失敗では退避した旧ファイルを戻します。設定・モデル・ログは置き換えません。中断からの復旧、復元に失敗したときの扱い、実際のNSISを使うWindows試験は[配布候補の手順](voice-stack/release-candidates.md#windowsのwebview2とインストール時の通信)を参照してください。

公開前に配布物の検査とライセンス監査を行います。ローカルで作った候補と公開済みリリースは区別します。上流への連絡やPRの扱いは[公開方針](voice-stack/publication-and-upstream.md)を参照してください。

## ビルド出力の削除と診断

`npm run clean`は`build/`、`dist/`、`src-tauri/bin/`、`src-tauri/target/`を削除します。保持したい試験成果物が`build/`にある場合は、先に退避してください。`npm run clean-soft`では`src-tauri/target/`だけを残します。

`npm run task-kill`は、0.4までの開発で残った`vrct-vox-sidecar.exe`を強制終了します。保存や変換の途中で実行しないでください。

Tauriの失敗はRust・C++ツールと`src-tauri/bin/_internal`の有無、画面だけの失敗は`npm run vite-build`の出力を確認します。`src-tauri/bin/_internal`がないと、`cargo check`も`tauri dev`も止まります。`python tools/dev.py setup --scope resources`で用意できます。

設定保存先とアプリIDは[名称と識別子](voice-stack/project-rename.md)を参照してください。元の[LICENSE](../LICENSE)と[NOTICE](../NOTICE.md)を保持し、同梱ライブラリとモデルの条件はそれぞれ確認します。

## 共通の開発コマンドと下書き作成

環境診断と検査の入口は[開発ガイド](development.md)にまとめています。`npm run check`で軽い検査、`npm run test:voice`でモデル不要の音声契約、`npm run test:ui`でNodeテストとViteビルドを実行します。

候補の検査後は[配布手順](voice-stack/release-candidates.md)に従い、同じコミットのLinux・Windows成果物からリリース下書きを作成できます。公開は別途行います。
