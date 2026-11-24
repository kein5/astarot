# Building ASTAROT and CI

[日本語版](#astarotのビルドとci日本語版)

This document describes the build steps for Windows and the current CI. On Linux, use the [Linux build pipeline](voice-stack/linux-build-pipeline.md) and the [AppImage guide](voice-stack/appimage.md). The batch commands for Windows do not run on Linux.

## Preparing Windows

Install Git, [mise](https://mise.jdx.dev/getting-started.html) and the Visual Studio C++ tools that the Tauri build for Windows needs. mise installs Node.js, Rust, Python and uv at the versions pinned in `mise.toml`. CI uses the same versions ([development guide](development.md#用意するツール)). Dependencies are managed in `package-lock.json`, `src-tauri/Cargo.lock` and each `Cargo.lock` under `native/`.

```sh
git clone https://github.com/kein5/astarot.git
cd astarot
mise trust
mise install
mise exec -- npm ci
```

When you build or launch with the `npm` scripts, call them from a shell with mise activated (`mise activate`), or call them as in `mise exec -- npm run build`. Otherwise they run with other versions of the tools that are on PATH.

From 0.5.0 the backend is the Rust core, which runs inside the app (`astarot.exe` from 0.7.0, `vrct-vox.exe` up to 0.6.x) ([core integration](voice-stack/core-integration.md)). The packages contain no Python. Python is used only to run the build tools and the tests. The Python backend (`src-python/`) and the environment for the app's dependencies (`mise run setup:app`, `npm run setup-python`) were removed in 0.6.0.

The Windows build downloads a pinned version of speech.cpp (the Vulkan build, about 29 MB) from the official release, checks its hash and then bundles it. If `build/speechcpp` already holds the same version, it is not downloaded again; if a different version is left there, it is replaced (`speechcpp_bundle.py --replace`). Nothing else in `build/` is touched. Downloading models and building the app itself are separate operations.

## Launching during development

```sh
npm run dev-fast
```

This prepares `src-tauri/bin/_internal` from what is in `build/` (`tools/app_resources.py stage --allow-missing`) and starts Vite and Tauri. A development build reads speech.cpp and the other resources from `build/` in the checkout. Without `build/speechcpp` the speech server does not start, but the app does. On Linux, if you put the CPU build in `build/speechcpp-cpu`, the app chooses between the two builds, as the packages do. Either one on its own also works.

When you change the bundled resources, prepare them again this way.

```sh
npm run dev
```

This one deletes the existing build output, syncs the version information, prepares speech.cpp, the RVC worker and the Rust license texts again, and then starts the app. `npm run dev-ui`, which restarts only the UI, is for when `src-tauri/bin/_internal` already exists.

## Building release candidates

```sh
npm run release
```

| Target | Output |
|---|---|
| Windows | `ASTAROT.zip` (`VRCT-VOX.zip` up to 0.6.x) |
| Windows installer | `src-tauri/target/release/bundle/nsis/ASTAROT_<version>_x64-setup.exe` |
| Linux | `ASTAROT-<version>-linux-x64-release.tar.gz` and the `.AppImage`, `.deb` and `.rpm` of the same name (`VRCT-VOX-<version>-…` up to 0.6.x). Each holds both the CPU and the Vulkan build of speech.cpp (up to 0.4, each build had its own package) |

The Windows ZIP holds `astarot.exe` and `_internal/` (up to 0.6.x the executable was `vrct-vox.exe`). When the app contains a crate that links ONNX Runtime dynamically, the ZIP also holds the ONNX Runtime and DirectML DLLs that the build put next to `astarot.exe`. On Linux the executable name has no `.exe`. When the packages are built, they are checked for forbidden resources such as OCR weights. Do not turn the whole source tree into a release ZIP as it is.

Windows has one package. Up to 0.5, a CUDA package (`VRCT-VOX_cuda.zip`) was built as well. Up to 0.4 it bundled the CUDA libraries for the Python backend, and from 0.5.0 its contents were the same as the standard package. #288 dropped the CUDA package. The installer accepts the GPU choice (`/EDITION=gpu`) that apps up to 0.5 pass when they update, and downloads the single ZIP ([one package for Windows](voice-stack/single-package.md)).

From 0.7.0 the package names start with `ASTAROT` (section 2.10 of ADR-014). When the packages go on a release, copies under their names up to 0.6.x (`VRCT-VOX.zip`, `VRCT-VOX_setup.exe`, `VRCT-VOX-<version>-linux-x64-release.*`) go on it as well as `ASTAROT.zip`, `ASTAROT_setup.exe` and `ASTAROT-<version>-linux-x64-release.*`. The contents are the same, and the copies also get `.sha256` files and lines in `SHA256SUMS`. This keeps outside links such as `releases/latest/download/VRCT-VOX_setup.exe` working. The copies are made when the candidates are built (`tools/release_candidate.py`), and they go on releases during 0.7.x (`LEGACY_COPIES_UNTIL`). `latest.json` points only to the new names.

`_internal/` contains the following (`tools/app_resources.py`).

| Path | Contents |
|---|---|
| `_internal/build/speechcpp/` | The executables of the Vulkan build of speech.cpp, `bundle.json` and the license texts |
| `_internal/build/speechcpp-cpu/` (Linux) | The executables of the CPU build of speech.cpp, `bundle.json` and the license texts. It runs when "CPU" is chosen in the settings, and when "Automatic" cannot use a GPU |
| `_internal/build/astarot-rvc-worker.exe` | The voice conversion worker (no `.exe` on Linux) |
| `_internal/build/astarot-voice-gate` and others (Linux) | Helper programs for the audio routes: `astarot-voice-gate`, `astarot-source-bridge` and `astarot-screen-capture` (`tools/build_voice_gate.py`; up to 0.5.x they had `vrct-*` names, and there were also `vrct-vc-worker` and `vrct-asr-capture`) |
| `_internal/build/sudachi/` | The reading dictionary SudachiDict full (`system.dic`) and its license texts (`LEGAL`, `LICENSE-2.0.txt`). `bat\build.bat` and `tools/build_linux.py` download it with `tools/sudachi_dictionary.py` (#924) |
| `_internal/config/pipewire/` (Linux) | The PipeWire settings (`config/pipewire` in the repository) |
| `_internal/licenses/` | The repository's `LICENSE` and `NOTICE.md`, the license texts of the Rust crates and the NScurl license text (Windows) |

These are the commands that build each part on its own.

| Operation | Command | Main output |
|---|---|---|
| Bundled resources | `npm run build-resources` | `build/`, `src-tauri/bin/_internal/` |
| Frontend | `npm run vite-build` | `dist/` |
| Tauri app | `npm run tauri build` | `src-tauri/target/release/` |
| Build everything | `npm run build` | The app and the resources above |

## Checking the CSP in a release build

The CSP definition and the reasons for what it allows are in [external interfaces](spec/external-interfaces.md#webviewのcontent-security-policycsp). The Vite dev server and `tauri dev` use `devCsp`, so running them does not check the release CSP.

First run the static checks and the frontend build. The standalone test at the end checks the JS, CSS and HTML of that build and the stylesheet hashes of the dependencies. Do not mix it up with the result of checking an older `dist/`.

```sh
python tools/dev.py check --scope ui
npx vitest run src-ui/logics/common/contentSecurityPolicy.test.ts
```

Next, build a release binary with the production frontend embedded, using the release steps for the target OS. If the release resources (`src-tauri/bin/_internal`) are already prepared, `npm run tauri build -- --no-bundle` builds the app itself. `cargo check` only confirms that the configuration parses. It does not check the embedded CSP or how the Webview behaves.

Do the following in both WebView2 on Windows and WebKitGTK on Linux. On Linux, operate the real machine under `tools/display_power_guard.py`. Keep a record of the OS, the Webview version, the commit, the build settings, the windows you operated and the Console and Network logs.

1. Attach the Inspector to each of `main`, `quick_chat` and `vr_panel`. A distributed release cannot use the Inspector (the `tauri` dependency in `src-tauri/Cargo.toml` does not have the `devtools` feature). In a local change made only for this check, add the `devtools` feature, set `devtools: true` on main and `.devtools(true)` on the builder for dynamic windows, and call Rust's `open_devtools()` after each window is created. Do not change the CSP or switch to `tauri dev`. The VR UI sits outside the screen, so do not check main alone and stop there. Do not distribute this verification change.
2. Turn on every Console level and log preservation, then reload each page. In Network, check the `Content-Security-Policy` of the HTML response. Nonces or hashes that Tauri generated, in addition to the directives you set, are normal. `frame-ancestors` has no effect in a meta tag, so adding a meta tag to the HTML does not replace this check.
3. Carry out the operations in the table below. Look for `Refused to …`, `Content Security Policy`, `blocked:csp` and `securitypolicyviolation`. The listener below can also record violations while you work. If you register the listener from the Console, violations from before that point and violations after a reload do not go into its array, so check them together with the browser's own errors in the Console.
4. After you save the record, also confirm that an inline script added to the DOM for this check is refused. For example, run `const s = document.createElement('script'); s.textContent = 'window.__cspProbeExecuted = true'; document.head.append(s)` in the Inspector. Confirm that `__cspProbeExecuted` is not set and that a `script-src` violation is recorded. Record this intended violation apart from the results of the normal operations.

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

| Window or screen | Operations and resources to check |
|---|---|
| Starting main | The main screen during startup (a placeholder you cannot operate), the initialization progress, the progress of model downloads during startup, the startup failure dialog, the app icon, the conversation log and notifications. The shared JS, CSS and images render |
| Settings in main | Every tab, search, expanding and collapsing, saving and notifications. Check both UI languages (English and Japanese), the OS's local fonts, the zoom, the log text size, a narrow width, dropdowns and scrolling |
| About | The logo in every language, every image of the developers, contributors and acknowledgements, and the images on the link buttons. External links are not loaded as resources inside the Webview |
| Color picker | Open the pickers for the OBS text color and outline color for the first time. Check dragging, keyboard operation, direct input and saving. Check react-colorful's style hashes and data SVG, and the CSSOM updates |
| Model downloads | TTS, RVC, ASR and OCR, the download confirmations for translation and transcription, the license and size display, canceling, and the progress and failure notices after consent. Try downloads only with models that you have permission to download. The core does the network work |
| OCR | The region sliders for both the window and VR, the rectangle preview, reset and the guidance for preparing models. This preview does not fetch an image URL |
| Log and audio | Saving the log automatically and opening its folder, sending chat, TTS and RVC, stop and mute, and the speech server status. None of these need blob downloads or HTML media |
| OBS and WebSocket settings | Saving the settings, turning them on and off, copying the authentication URL. The UI does not connect to the OBS page or to the WebSocket |
| Quick Chat | Opening it with main's button or the hotkey, typing, sending, the failure display, closing and showing it again, and following the language, font and zoom. Check its own chunk, the shared CSS and JS, and IPC |
| VR UI | Turning it on and off and re-creating it, the intro icon and background, the launcher, opening, closing and scrolling the log, the language and font pickers, every settings popup, tooltips, the pointer and press display, opacity and text size. Check virtua's layout, the CSSOM and IPC between windows |

The check passes when normal operation causes no CSP violations, no styles are missing from images, notifications or the color picker, and IPC works in every window. A Console without violations does not by itself mean that the hidden screens were checked too. The static checks do not verify differences between browser implementations or every dynamic resource load. Repeat the same hands-on check when dependencies are updated.

## Version management

The version is kept in `package.json`, and the following command syncs it to `src-tauri/tauri.conf.json` and `pyproject.toml`. When the version in `pyproject.toml` changes, this command also runs `uv lock` to update `uv.lock`. The version appears in the list of setting keys (`docs/spec/reference/config-keys.md`), so run `tools/spec_catalog.py --write` last as well. The normal build commands also run the sync.

```sh
npm run update-version
```

Versions count from 0.1.0, separately from upstream VRCT (3.x). Identifiers such as `0.1.0-beta.1` can be used too. The version string alone does not publish anything or switch where a release goes. The ZIP name is fixed and does not include the version, while the file names of the NSIS and Linux candidates do.

## CI and where releases go

[voice-tests.yml](../.github/workflows/voice-tests.yml) runs the regression tests on pull requests and on pushes to develop and main. On a branch without a pull request, you can run it by hand. [build-linux.yml](../.github/workflows/build-linux.yml) runs on pull requests that touch its target files and by hand, and builds and checks the Linux candidates. [release.yml](../.github/workflows/release.yml) is the workflow that builds and checks the Windows candidates. It runs by hand and on pull requests to main. Its build job makes `ASTAROT.zip` and an NSIS installer with that ZIP's SHA-256 embedded (`tools/installer_package_hashes.py`). The last job checks everything. [windows-package.yml](../.github/workflows/windows-package.yml) tries preparing `_internal` on pull requests to develop that change `bat/` or the tools for the bundled resources, and by hand. [installer-update-tests.yml](../.github/workflows/installer-update-tests.yml) runs the Windows update tests on pull requests that change the NSIS templates or the installer tests, and by hand. [prepare-release.yml](../.github/workflows/prepare-release.yml) is a manual workflow that makes a release draft from checked candidates. [release-draft-auto.yml](../.github/workflows/release-draft-auto.yml) starts the candidate builds and then `prepare-release.yml` when a `release/X.Y.Z` pull request is merged into main. [release-back-merge.yml](../.github/workflows/release-back-merge.yml) opens a pull request that merges main back into develop when a stable release is published ([release candidate steps](voice-stack/release-candidates.md#公開したあと)).

Build candidates are kept as GitHub Actions artifacts. These workflows do not publish to GitHub Releases or Hugging Face automatically. Pushing a tag does not start any publishing. The workflows that build candidates have the permission `contents: read` and do not use the original project's keys for publishing or telemetry.

Releases are published at [kein5/astarot Releases](https://github.com/kein5/astarot/releases). The first published version is `v0.1.0-beta.1` (a pre-release, made from develop). The NSIS installer for Windows downloads `ASTAROT.zip` from this repository's releases. When `/VERSION` names a version up to 0.6.x, it downloads that version's `VRCT-VOX.zip` (releases up to 0.5 also have `VRCT-VOX_cuda.zip`). Building a candidate does not by itself put a file at that URL.

In-app updates use Tauri's updater, which reads the release's `latest.json`. The stable channel checks the project's Worker (`https://vrct-vox-updates.kei9d09.workers.dev/latest.json`), and the Worker forwards to the `latest.json` of the latest release. The beta channel reads `/beta/latest.json` on the same Worker. When a release is published, a workflow rewrites the files they lead to into the `latest.json` of the newest version (for both beta and stable). Until you choose a channel, the app's version decides it, and you can choose it on the Experimental page of Settings (#466, [app updates](spec/external-interfaces.md#アプリの更新)). The workflow that makes the draft creates `latest.json` and the signatures ([release candidate steps](voice-stack/release-candidates.md#updaterの署名とlatestjson)).

A Windows update first verifies and extracts the downloaded package in `.upd` inside the install folder, then replaces only the app's files. If downloading or extracting fails, the old version stays; if replacing fails, the old files that were moved aside are put back. Settings, models and logs are not replaced. For recovery from an interruption, what happens when restoring fails, and the Windows tests that use the real NSIS, see the [release candidate steps](voice-stack/release-candidates.md#windowsのwebview2とインストール時の通信).

Before publishing, the packages are checked and the licenses are audited. Keep candidates built locally apart from published releases. For contact with upstream and how pull requests are handled, see the [publication policy](voice-stack/publication-and-upstream.md).

## Deleting build output and diagnosing problems

`npm run clean` deletes `build/`, `dist/`, `src-tauri/bin/` and `src-tauri/target/`. If `build/` holds test artifacts you want to keep, move them elsewhere first. `npm run clean-soft` keeps only `src-tauri/target/`.

`npm run task-kill` forcibly ends `vrct-vox-sidecar.exe` left over from development up to 0.4. Do not run it in the middle of saving or converting.

If Tauri fails, check the Rust and C++ tools and whether `src-tauri/bin/_internal` exists. If only the screens fail, check the output of `npm run vite-build`. Without `src-tauri/bin/_internal`, both `cargo check` and `tauri dev` stop. `python tools/dev.py setup --scope resources` prepares it.

For where settings are stored and the app ID, see [names and identifiers](voice-stack/project-rename.md). Keep the original [LICENSE](../LICENSE) and [NOTICE](../NOTICE.md), and check the terms of each bundled library and model.

## Common development commands and making a draft

The entry points for diagnosing the environment and for the checks are collected in the [development guide](development.md). `mise run check` runs the light checks, `mise run check:voice` the voice contract tests that need no models, and `mise run check:ui` the UI tests, the type check and the Vite build.

After the candidates are checked, you can make a release draft from the Linux and Windows artifacts of the same commit by following the [release steps](voice-stack/release-candidates.md). Publishing is a separate step.

---

# ASTAROTのビルドとCI（日本語版）

Windows向けのビルド手順と、現在のCIを説明します。Linuxでは[Linuxビルドパイプライン](voice-stack/linux-build-pipeline.md)と[AppImageガイド](voice-stack/appimage.md)を使います。Windows用のバッチコマンドはLinuxでは実行できません。

## Windowsの準備

Git、[mise](https://mise.jdx.dev/getting-started.html)、TauriのWindowsビルドに必要なVisual Studio C++ツールを用意します。Node.js、Rust、Python、uvは、`mise.toml`で固定した版をmiseが入れます。CIも同じ版を使います（[開発ガイド](development.md#用意するツール)）。依存関係は`package-lock.json`、`src-tauri/Cargo.lock`、`native/`の各`Cargo.lock`で管理しています。

```sh
git clone https://github.com/kein5/astarot.git
cd astarot
mise trust
mise install
mise exec -- npm ci
```

`npm`のスクリプトでビルドや起動をするときは、miseを有効にしたシェル（`mise activate`）から呼ぶか、`mise exec -- npm run build`のように呼びます。そうしないと、PATHにある別の版のツールで動きます。

0.5.0からバックエンドはアプリ（0.7.0から`astarot.exe`、0.6.xまでは`vrct-vox.exe`）の中で動くRustの中核です（[中核の統合](voice-stack/core-integration.md)）。配布物にPythonは入りません。Pythonはビルドの道具と試験を動かすためだけに使います。Pythonのバックエンド（`src-python/`）とアプリの依存の環境（`mise run setup:app`、`npm run setup-python`）は0.6.0で消しました。

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
```

| 対象 | 出力 |
|---|---|
| Windows | `ASTAROT.zip`（0.6.xまでは`VRCT-VOX.zip`） |
| Windowsインストーラー | `src-tauri/target/release/bundle/nsis/ASTAROT_<version>_x64-setup.exe` |
| Linux | `ASTAROT-<version>-linux-x64-release.tar.gz`と同名の`.AppImage`、`.deb`、`.rpm`（0.6.xまでは`VRCT-VOX-<version>-…`）。speech.cppのCPU版とVulkan版を両方入れる（0.4まではビルドごとに別の配布物） |

WindowsのZIPには`astarot.exe`と`_internal/`を収めます（0.6.xまでの実行ファイルは`vrct-vox.exe`）。ONNX Runtimeを動的にリンクするクレートがアプリに入った場合は、ビルドが`astarot.exe`の隣に置いたONNX RuntimeとDirectMLのDLLも収めます。Linuxの実行名には`.exe`を付けません。配布物の作成時にはOCR重みなどの禁止資源を検査します。ソースツリー全体をそのまま配布ZIPにしないでください。

Windowsの配布物は1つです。0.5まではCUDA版（`VRCT-VOX_cuda.zip`）も作っていました。0.4まではPythonバックエンドのためにCUDAのライブラリを同梱していて、0.5.0からは標準版と同じ中身でした。#288でCUDA版をやめました。インストーラーは、0.5までのアプリが更新のときに渡すGPUの選択（`/EDITION=gpu`）を受け付け、1つのZIPを取ります（[Windowsの配布物の一本化](voice-stack/single-package.md)）。

0.7.0から配布物の名前は`ASTAROT`で始まります（ADR-014の2.10）。リリースに載せるときは、`ASTAROT.zip`、`ASTAROT_setup.exe`、`ASTAROT-<version>-linux-x64-release.*`に加えて、それぞれの0.6.xまでの名前（`VRCT-VOX.zip`、`VRCT-VOX_setup.exe`、`VRCT-VOX-<version>-linux-x64-release.*`）の写しも載せます。中身は同じで、`.sha256`と`SHA256SUMS`の行も付けます。`releases/latest/download/VRCT-VOX_setup.exe`のような外のリンクを生かすためです。写しを作るのは候補の作成（`tools/release_candidate.py`）で、載せるのは0.7.xの間です（`LEGACY_COPIES_UNTIL`）。`latest.json`は新しい名前だけを指します。

`_internal/`の中身は次のとおりです（`tools/app_resources.py`）。

| パス | 内容 |
|---|---|
| `_internal/build/speechcpp/` | speech.cppのVulkan版の実行ファイル、`bundle.json`、ライセンス文 |
| `_internal/build/speechcpp-cpu/`（Linux） | speech.cppのCPU版の実行ファイル、`bundle.json`、ライセンス文。設定で「CPU」を選んだときと、「自動」でGPUを使えないときに動く |
| `_internal/build/astarot-rvc-worker.exe` | 声質変換のworker（Linuxでは`.exe`なし） |
| `_internal/build/astarot-voice-gate`ほか（Linux） | 音声経路の補助プログラム。`astarot-voice-gate`、`astarot-source-bridge`、`astarot-screen-capture`（`tools/build_voice_gate.py`。0.5.xまでは`vrct-*`の名前で、`vrct-vc-worker`と`vrct-asr-capture`もあった） |
| `_internal/build/sudachi/` | 読みの辞書SudachiDict full（`system.dic`）と、そのライセンス文（`LEGAL`、`LICENSE-2.0.txt`）。`bat\build.bat`と`tools/build_linux.py`が`tools/sudachi_dictionary.py`で取得する（#924） |
| `_internal/config/pipewire/`（Linux） | PipeWireの設定（リポジトリの`config/pipewire`） |
| `_internal/licenses/` | リポジトリの`LICENSE`と`NOTICE.md`、Rustのクレートのライセンス文、NScurlのライセンス文（Windows） |

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
npx vitest run src-ui/logics/common/contentSecurityPolicy.test.ts
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
| mainの設定 | 全タブ、検索、開閉、保存、通知。UIの言語2種（英語と日本語）、OSのローカルフォント、倍率、ログ文字サイズ、狭い幅、ドロップダウンとスクロールを確認する |
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

バージョンは`package.json`で管理し、次のコマンドで`src-tauri/tauri.conf.json`と`pyproject.toml`へ同期します。`pyproject.toml`の版が変わったときは、このコマンドが`uv lock`も実行して`uv.lock`を更新します。設定キーの一覧（`docs/spec/reference/config-keys.md`）に版が載るので、最後に`tools/spec_catalog.py --write`も実行します。通常のビルドコマンドでも同期処理を実行します。

```sh
npm run update-version
```

版は上流VRCT（3.x）とは別に0.1.0から数えます。`0.1.0-beta.1`のような識別子も使えます。バージョン文字列だけで公開や配布先の切り替えは行いません。ZIP名はバージョンを含まない固定名で、NSIS・Linux候補のファイル名にはバージョンが入ります。

## CIと公開先

[voice-tests.yml](../.github/workflows/voice-tests.yml)はpull requestと、developとmainへのpushで回帰試験を実行します。PRのない枝では手動で実行できます。[build-linux.yml](../.github/workflows/build-linux.yml)は対象ファイルのpull requestと手動実行に対応し、Linux候補を作成・検査します。[release.yml](../.github/workflows/release.yml)はWindows候補を作成・検査するワークフローで、手動実行とmain宛てのpull requestで動きます。ビルドのジョブが`ASTAROT.zip`と、そのSHA-256を埋め込んだNSISインストーラーを作ります（`tools/installer_package_hashes.py`）。最後のジョブで全部を検査します。[windows-package.yml](../.github/workflows/windows-package.yml)は、`bat/`や同梱資源の道具を変えたdevelop宛てのpull requestと手動実行で、`_internal`の用意を試します。[installer-update-tests.yml](../.github/workflows/installer-update-tests.yml)は、NSISのテンプレートやインストーラーの試験を変えたpull requestと手動実行で、Windowsの更新の試験を動かします。[prepare-release.yml](../.github/workflows/prepare-release.yml)は、検査済みの候補からリリースの下書きを作る手動のワークフローです。[release-draft-auto.yml](../.github/workflows/release-draft-auto.yml)は、`release/X.Y.Z`のPRをmainへマージしたときに、候補のビルドと`prepare-release.yml`を順に始めます。[release-back-merge.yml](../.github/workflows/release-back-merge.yml)は、正式版を公開したときに、mainをdevelopへ戻すPRを開きます（[配布候補の手順](voice-stack/release-candidates.md#公開したあと)）。

ビルド候補はGitHub Actionsの成果物として保存します。これらのワークフローはGitHub ReleasesやHugging Faceへ自動公開しません。タグをpushしても公開処理は始まりません。候補をビルドするワークフローの権限は`contents: read`で、本家の公開用キーやテレメトリー用キーは使いません。

配布先は[kein5/astarot Releases](https://github.com/kein5/astarot/releases)です。最初の公開版は`v0.1.0-beta.1`（プレリリース、developから作成）です。WindowsのNSISインストーラーは、このリポジトリのリリースから`ASTAROT.zip`を取得します。`/VERSION`で0.6.xまでの版を指したときは、その版の`VRCT-VOX.zip`を取ります（0.5までのリリースには`VRCT-VOX_cuda.zip`もあります）。候補をビルドしただけでは、そのURLにファイルは存在しません。

アプリ内の更新はTauriのupdaterで行い、リリースの`latest.json`を読みます。安定版の確認先はプロジェクトのWorker（`https://vrct-vox-updates.kei9d09.workers.dev/latest.json`）で、Workerが最新のリリースの`latest.json`へ転送します。ベータ版のチャンネルは、同じWorkerの`/beta/latest.json`を読みます。リリースを公開するとワークフローが、その先のファイルを最も新しい版（ベータ版と安定版の両方）の`latest.json`に書き直します。チャンネルは、選ぶまではアプリの版で決まり、設定の実験的機能のページで選べます（#466、[アプリの更新](spec/external-interfaces.md#アプリの更新)）。`latest.json`と署名は下書きを作るワークフローが作ります（[配布候補の手順](voice-stack/release-candidates.md#updaterの署名とlatestjson)）。

Windowsの更新は、インストール先の`.upd`内で取得済みパッケージを検証・展開してから、アプリのファイルだけを置き換えます。取得・展開失敗では旧版を保持し、置き換え失敗では退避した旧ファイルを戻します。設定・モデル・ログは置き換えません。中断からの復旧、復元に失敗したときの扱い、実際のNSISを使うWindows試験は[配布候補の手順](voice-stack/release-candidates.md#windowsのwebview2とインストール時の通信)を参照してください。

公開前に配布物の検査とライセンス監査を行います。ローカルで作った候補と公開済みリリースは区別します。上流への連絡やPRの扱いは[公開方針](voice-stack/publication-and-upstream.md)を参照してください。

## ビルド出力の削除と診断

`npm run clean`は`build/`、`dist/`、`src-tauri/bin/`、`src-tauri/target/`を削除します。保持したい試験成果物が`build/`にある場合は、先に退避してください。`npm run clean-soft`では`src-tauri/target/`だけを残します。

`npm run task-kill`は、0.4までの開発で残った`vrct-vox-sidecar.exe`を強制終了します。保存や変換の途中で実行しないでください。

Tauriの失敗はRust・C++ツールと`src-tauri/bin/_internal`の有無、画面だけの失敗は`npm run vite-build`の出力を確認します。`src-tauri/bin/_internal`がないと、`cargo check`も`tauri dev`も止まります。`python tools/dev.py setup --scope resources`で用意できます。

設定保存先とアプリIDは[名称と識別子](voice-stack/project-rename.md)を参照してください。元の[LICENSE](../LICENSE)と[NOTICE](../NOTICE.md)を保持し、同梱ライブラリとモデルの条件はそれぞれ確認します。

## 共通の開発コマンドと下書き作成

環境診断と検査の入口は[開発ガイド](development.md)にまとめています。`mise run check`で軽い検査、`mise run check:voice`でモデル不要の音声契約、`mise run check:ui`でUIの試験、型チェック、Viteのビルドを実行します。

候補の検査後は[配布手順](voice-stack/release-candidates.md)に従い、同じコミットのLinux・Windows成果物からリリース下書きを作成できます。公開は別途行います。
