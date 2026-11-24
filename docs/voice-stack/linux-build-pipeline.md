# Linux build pipeline

[日本語版](#linuxのビルドの手順日本語版)

`tools/build_linux.py` builds an x86_64 candidate: the `astarot` app (`vrct-vox` up to 0.6.x), which runs the Rust
backend core (`native/core`) in its own process, and its `_internal` folder with both pinned
speech.cpp 0.11.2 builds (Vulkan in `build/speechcpp`, CPU in `build/speechcpp-cpu`), the RVC worker, the C audio and capture helpers, the
PipeWire template and the license texts (`tools/app_resources.py` lists them). Since 0.5.0
no Python runtime is frozen or shipped. The default output is a `tar.gz`, a SHA-256 file
and a JSON file inventory. Keep `astarot` and `_internal` together: the core finds
speech.cpp and the helpers in `_internal` beside the binary.
Add `--appimage --download-appimage-tools` for an additional inspected AppImage;
see [AppImage build and acceptance](appimage.md). The CI builds both formats.

The CI then makes a `.deb` and an `.rpm` from the same candidate directory with
`python3 tools/linux_packages.py --candidate build/linux/candidate/ASTAROT --output-dir build/linux/artifacts`
(needs `dpkg-deb` and `rpmbuild`). The package is `astarot`. It installs the unchanged files under
`/opt/astarot`, adds the command `/usr/bin/astarot`, a desktop entry (`astarot.desktop`), an icon
(`astarot.png`) and the license notices, and writes `/opt/astarot/package-manager` (`deb` or
`rpm`) so the app can tell a package-manager install. Up to 0.6.x the package was `vrct-vox`, under
`/opt/vrct-vox`. The new package replaces it: the deb conflicts with, replaces and provides
`vrct-vox`, and the rpm obsoletes and provides it, so installing the new file removes the old
package. The command up to 0.6.x, `/usr/bin/vrct-vox`, starts the same executable during 0.7.x
(`LEGACY_COMMAND_UNTIL` in `tools/linux_packages.py`). The CI installs a stand-in of the old
package first (`tools/ci/legacy_linux_packages.py`) and checks that it is replaced.
They require glibc (the highest version the manifest records), GTK 3, WebKitGTK 4.1 and
libpipewire. The Vulkan loader (`libvulkan1`, `vulkan-loader`), the Mesa Vulkan drivers and the
PipeWire tools are recommended: the Vulkan build of speech.cpp loads the loader from the system,
and the CPU build in the same package runs without it (decision 48 in
[core integration](core-integration.md)). `tools/ci/check_linux_package.sh` installs each package in a
clean Ubuntu 24.04, Debian 13 or Fedora 44 container without recommended packages and checks
that the GUI binary's libraries resolve, the CPU build starts without Vulkan, the Vulkan build
starts once the loader is installed, and removal leaves nothing behind. It does not open the GUI, so the backend core inside it is tested by the tar.gz and
AppImage acceptance instead.

The GitHub Actions workflow `VRCT-VOX Linux candidate (no publication)` targets Ubuntu 24.04.
It runs on relevant pull requests or manual dispatch, runs the app's unit tests (`src-tauri`, which
no other job runs), tests the relocated package,
and the AppImage extraction fallback, then retains successful candidates for seven days. It has `contents: read`, no
publishing credentials and no release/AUR actions. The Linux packages of the releases published since the
[`v0.1.0-beta.1` prerelease](https://github.com/kein5/astarot/releases/tag/v0.1.0-beta.1)
are candidates from this workflow, published through the
[release draft gate](release-candidates.md). A local build is an unpublished candidate.

## Build locally

Use Linux x86_64, a C compiler and pkg-config. Node, Rust, Python and uv come from
`mise install` at the versions pinned in `mise.toml`, the same versions the workflow uses.
Run the build from a shell where mise is active (`mise activate`), or through
`mise run build:linux -- <options>`. Python runs the build tools only.
Ubuntu build/runtime prerequisites (see the workflow for GUI-test dependencies):

```sh
sudo apt-get install build-essential pkg-config binutils libwebkit2gtk-4.1-dev \
  libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev libclang-dev pipewire-bin libvulkan1 libglfw3 libportaudio2 libasound2-dev \
  meson ninja-build libsndfile1-dev libglib2.0-dev liblua5.4-dev
mkdir -p build
bash tools/ci/setup_pipewire.sh "$PWD/build/ci-audio"
while IFS= read -r setting; do export "$setting"; done < build/ci-audio/environment
export PATH="$PWD/build/ci-audio/prefix/bin:$PATH"
python tools/build_linux.py --download-speech
```

The application's backend core lists and watches the audio devices through
libpipewire-0.3 (`native/audio-routing`, the `pipewire` feature that `src-tauri`
turns on), so building the app needs the PipeWire development files and libclang
for the bindings. The core's own tests build without that feature and need neither.

The native capture helper uses the clock API tested with PipeWire **1.6.10**.
Ubuntu 24.04's stock headers lack the cycle and discontinuity fields; its stock
packages alone cannot build this helper. Both Linux workflows build the pinned
PipeWire 1.6.10 and WirePlumber 0.5.18 sources in a new, isolated prefix after
checking SHA-256. Headers, client libraries, tools, modules and configuration are
selected together. The script never installs or starts system services and
refuses an existing destination. WirePlumber 0.5 supplies the policy-only profile
used by private synthetic tests; that is not compatible with Ubuntu's 0.4 CLI.
Hosts with the already tested versions can use their system installation instead.
The capture helper requires headers, the linked client library and the connected
daemon to report PipeWire 1.6.10 or newer. It rejects older/malformed runtime versions
before emitting PCM; compile-time checks give an explicit dependency error. This
does not relax timestamp/discontinuity checks or validate every newer release.

`--download-speech` authorizes acquisition of **only the two pinned engine archives**
(`speech-0.11.2-linux-x64-vulkan.zip` and `speech-0.11.2-linux-x64-cpu.zip`), the pinned
runtime libraries (`tools/runtime_libraries.py`) and the readings' dictionary, SudachiDict full
(`sudachi-dictionary-20250825-full.zip`, `tools/sudachi_dictionary.py`); never model weights.
Alternatively use `--speech-archive-dir /absolute/path` with the engine archives and the
dictionary archive under those names; the archive and executable hashes are checked against
`speechcpp-bundle-artifacts.json`, and the dictionary against the size and SHA-256 pinned in
`tools/sudachi_dictionary.py`.
Since 0.5.0 one candidate carries both builds; there is no `--variant` any more. The user
chooses CPU or GPU in the speech server settings: `cpu` runs the CPU build, `gpu` and a named
GPU the Vulkan build, and `auto` the Vulkan build when it starts and lists a GPU, else the CPU
build (`native/speech-server/src/builds.rs`).
`--offline` requires the npm and Cargo caches to be populated. No engine models or
reference recordings are fetched. `--resources-only` stages and inspects `_internal`
(in `build/linux/internal`) and produces no distributable. `--profile debug` is also
diagnostic; normal output is release.

The builder installs no Python packages. It uses `npm ci --ignore-scripts` and builds
Cargo with `--locked` in a copied workspace (`build/linux/workspace`), whose
`src-tauri/bin/_internal` is the staged folder; it does not replace the checkout's
`src-tauri/bin`. The one file outside the crates that a crate reads at compile time
(`CRATE_INPUTS` of `tools/build_linux.py`) is copied too. This is **not** a claim of
bit-for-bit reproducible builds.
The Rust, Node, Python and uv versions are pinned in `mise.toml`; system libraries and
actual ELF version requirements remain host dependent.
The inventory records the build commit, tracked dirty state, host, hashes and ELF versions.

Default outputs:

```text
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.tar.gz
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.tar.gz.sha256
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.manifest.json
```

The files were named `VRCT-VOX-<version>-…` up to 0.6.x. The release candidate adds a copy of
each file under that name for the releases of 0.7.x ([old-name copies](release-candidates.md#旧名の写し)).

Until 0.4 the names carried the engine build (`linux-x64-vulkan`, `linux-x64-cpu`). Since 0.5.0
`build-manifest.json` records `"variant": "linux-x64"` and both builds in `speech_builds`.
Carrying both builds adds the CPU executable (9,980,104 bytes unpacked; 3,805,693 bytes
deflated in the pinned 0.11.2 ZIP) and a second copy of the notices (about 47 KB) to each
package. The Vulkan executable is 52,185,408 bytes unpacked. These are the sizes of the files
in the pinned archives, not of a built package.

## Run and inspect

```sh
cd build/linux/artifacts
sha256sum -c ./*.tar.gz.sha256
# Inspect with tools/linux_package.py before extracting an independently obtained candidate.
tar -xzf ASTAROT-<version>-linux-x64-release.tar.gz
./ASTAROT/astarot
```

The archive unpacks to `ASTAROT` (`VRCT-VOX` up to 0.6.x). The full directory must stay together. The host supplies WebKitGTK 4.1,
GTK3, OpenSSL, PipeWire/tools, the Vulkan loader for the GPU choices and other system
ELF dependencies. This is a portable directory layout, **not** an AppImage or a
promise of compatibility with all distributions. A build made on CachyOS may
require newer glibc than the Ubuntu CI build; consult its manifest.

Packaged Linux settings/logs go to `$XDG_CONFIG_HOME/astarot` (default `~/.config/astarot`), and
weights and other writable data to `$XDG_DATA_HOME/astarot` (default `~/.local/share/astarot`).
Up to 0.5.x both were named `vrct-vox`; the first start of 0.6.0 moves them and leaves links with
the old names ([the move](../spec/data-and-persistence.md#linuxの保存先の移動)). The app keeps no
cache directory. `ASTAROT_CONFIG_DIR` and `ASTAROT_DATA_DIR` (or `VRCT_CONFIG_DIR` and
`VRCT_DATA_DIR`) override those directories, and a directory named that way is never moved.
An explicitly supplied `HF_HOME` is respected. Existing development/Windows paths are unchanged.

Managed audio still needs the explicit PipeWire setup in `local-setup-linux.md`.
The package carries the template at `_internal/config/pipewire/90-astarot-managed.conf`;
it does not install it or restart the user's audio service. Owned audio workers
require Linux >=6.9 (`PIDFD_THREAD`), in addition to a supported PipeWire runtime.
User RVC models remain external selections. The Seed-VC adapter and its Python setup files
are no longer shipped.

## Acceptance and exclusions

```sh
ASTAROT_TEST_LINUX_ARCHIVE=/absolute/path/candidate.tar.gz \
  build/dev/headless-venv/bin/python -m pytest \
  -c tests/voice/pytest.ini tests/platform/test_linux_package.py -q
```

`python tools/dev.py setup --scope headless` prepares that test environment from `uv.lock`
(pytest and the other test tools; no app dependencies). The test extracts to a path
containing spaces, makes the installation read-only, checks that no Python backend is
present and that both bundled engine builds start, and verifies installation hashes did not
change. For GUI tests also set
`ASTAROT_TEST_NATIVE_GUI=1` and `ASTAROT_TEST_DRIVER` to a tauri-driver 2.1.0 executable.
The shared `NativeWebDriver` launcher passes `VRCT_CONFIG_DIR` explicitly, defaulting
to its existing `$XDG_CONFIG_HOME/vrct-vox` location and preserving caller overrides.
This lets release-build tests run beside the installed app: debug builds and launches
with `VRCT_CONFIG_DIR` set bypass the [single-instance guard](../spec/ipc-protocol.md#起動と初期化).
For manual tests with isolated `XDG_*` directories, also pass `VRCT_CONFIG_DIR`
pointing to that same config directory; changing `XDG_*` alone does not bypass the guard.
To test duplicate-launch prevention itself, leave `VRCT_CONFIG_DIR` unset and use
a release build with a working D-Bus session bus shared by both launches.
On a physical desktop run under `tools/display_power_guard.py` via system Python/Gio.
CI explicitly uses `ASTAROT_TEST_XVFB=1` with Xvfb, checks its server and real rendering.
Setting `ASTAROT_TEST_NATIVE_ROUTE=1` additionally tests a private PipeWire graph and
managed mute/resume/restart (requires WirePlumber 0.5's policy profile). This is a
local acceptance option; Ubuntu 24.04 CI runs the remaining smoke cases and does
not claim audio-graph acceptance. None of these tests record the physical microphone,
contact VRChat, or load inference models.

The collector and final tree/tar checks reject OCR weights, Mia2026 assets, unsafe
links, traversal, duplicate paths, special files and uninspectable nested archives.
These are path/type checks, not a detector for deliberately renamed weights.
Original licenses and notices are retained. The Rust crates built into `astarot` and `astarot-rvc-worker` are listed with their
license texts in `_internal/licenses/rust/` (`tools/rust_licenses.py`, which needs
the Cargo registry sources, so `--offline` builds need them cached). The build
stops if a crate publishes no license text and has no reviewed entry in
`licenses/rust/supplements.json`.
The Silero v5 VAD files and the Python package notices left with the Python backend.
OCR weights are excluded regardless.

## Remaining release gates

These are the gates that still apply; the first releases have been published.

- Before each release, the checks in [release candidates](release-candidates.md):
  - the license and SBOM review of everything the packages bundle (GTK, WebKit, static
    runtime dependencies, native, frontend and Rust components), including the GPL/LGPL
    corresponding-source and relink obligations. Collected notices alone are not
    redistribution clearance.
  - the Linux desktop check decided in #516: the AppImage on a real desktop; deb and rpm
    only in the container tests and the tar.gz only on a virtual screen (`build-linux.yml`).
- The requested Trail of Bits Skills security review of the whole app has no record of
  being done; it is still open.
- Real model, listening quality, physical latency and Windows tests keep their own
  acceptance status; these smoke tests do not replace them.
- An AUR package would need a real release URL and hash, PKGBUILD/.SRCINFO, clean-chroot
  and install/update/remove tests. None has been submitted.

## Primary evidence

- Inside the AppImage the GUI process runs with the bundled library path
  (`LD_LIBRARY_PATH`) and GTK settings. The launcher keeps the host values in
  `ASTAROT_APPIMAGE_HOST_*`; the programs the app starts get them back
  (`astarot_app_identity::appimage`). See [AppImage](appimage.md#run).
- [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux) define the
  native WebKitGTK build boundary; [official WebDriver CI](https://v2.tauri.app/develop/tests/webdriver/ci/)
  uses a virtual display on Linux.

---

# Linuxのビルドの手順（日本語版）

`tools/build_linux.py`はx86_64の候補をビルドします。候補は`astarot`アプリ（0.6.xまでは`vrct-vox`）とその`_internal`フォルダーです。`astarot`アプリはRustのバックエンドの中核（`native/core`）を自分のプロセスの中で動かします。`_internal`には固定したspeech.cpp 0.11.2の2つのビルド（Vulkan版は`build/speechcpp`、CPU版は`build/speechcpp-cpu`）、RVCのワーカー、Cで書いた音声と取り込みのヘルパー、PipeWireのテンプレート、ライセンスの文書が入ります（`tools/app_resources.py`がこれらを列挙しています）。0.5.0からはPythonの実行環境を固めることも同梱することもありません。既定の出力は`tar.gz`、SHA-256のファイル、JSONのファイルの一覧です。`astarot`と`_internal`は一緒に置いてください。中核は実行ファイルの隣の`_internal`からspeech.cppとヘルパーを探します。検査済みのAppImageも作るときは、`--appimage --download-appimage-tools`を足します（[AppImageのビルドと受け入れ試験](appimage.md)）。CIは両方の形式をビルドします。

CIは続けて、同じ候補のフォルダーから`.deb`と`.rpm`を作ります。コマンドは`python3 tools/linux_packages.py --candidate build/linux/candidate/ASTAROT --output-dir build/linux/artifacts`です（`dpkg-deb`と`rpmbuild`が要ります）。パッケージの名前は`astarot`です。パッケージは変更していないファイルを`/opt/astarot`の下に入れ、コマンド`/usr/bin/astarot`、デスクトップエントリ（`astarot.desktop`）、アイコン（`astarot.png`）、ライセンスの通知文書を足します。また、パッケージマネージャーで入れたことをアプリが見分けられるように、`/opt/astarot/package-manager`（`deb`か`rpm`）を書きます。0.6.xまでのパッケージの名前は`vrct-vox`で、`/opt/vrct-vox`の下に入っていました。新しいパッケージは古いパッケージを置き換えます。debは`vrct-vox`に対してconflicts、replaces、providesを宣言し、rpmはobsoletesとprovidesを宣言するので、新しいファイルを入れると古いパッケージは削除されます。0.6.xまでのコマンド`/usr/bin/vrct-vox`は、0.7.xの間は同じ実行ファイルを起動します（`tools/linux_packages.py`の`LEGACY_COMMAND_UNTIL`）。CIは先に古いパッケージの代わりになるもの（`tools/ci/legacy_linux_packages.py`）を入れ、それが置き換わることを確かめます。パッケージにはglibc（マニフェストに記録したいちばん新しい版）、GTK 3、WebKitGTK 4.1、libpipewireが要ります。Vulkanローダー（`libvulkan1`、`vulkan-loader`）、MesaのVulkanドライバー、PipeWireのツールは推奨の依存です。speech.cppのVulkan版はローダーをシステムから読み込み、同じパッケージのCPU版はローダーがなくても動くからです（[中核の統合](core-integration.md)の決定48）。`tools/ci/check_linux_package.sh`は各パッケージを推奨パッケージなしで、クリーンなUbuntu 24.04、Debian 13、Fedora 44のいずれかのコンテナに入れます。そして、GUIの実行ファイルのライブラリが解決できること、CPU版がVulkanなしで起動すること、ローダーを入れるとVulkan版が起動すること、削除で何も残らないことを確かめます。この検査はGUIを開かないので、GUIの中にあるバックエンドの中核は代わりにtar.gzとAppImageの受け入れ試験で確かめます。

GitHub Actionsのワークフロー`VRCT-VOX Linux candidate (no publication)`はUbuntu 24.04を対象にします。関係するPRか手動実行で動き、アプリの単体試験（`src-tauri`。ほかのジョブは実行しません）を流し、再配置したパッケージとAppImageの展開による代わりの起動を試験します。そのあと、成功した候補を7日間保存します。権限は`contents: read`で、公開のための資格情報もリリースやAURへの操作もありません。[`v0.1.0-beta.1`のプレリリース](https://github.com/kein5/astarot/releases/tag/v0.1.0-beta.1)から後に公開したリリースのLinuxのパッケージは、このワークフローの候補で、[リリースの下書きの検査](release-candidates.md)を通して公開しました。手元でビルドしたものは公開していない候補です。

## 手元でビルドする

Linux x86_64、Cのコンパイラー、pkg-configを使います。Node、Rust、Python、uvは`mise install`で`mise.toml`に固定した版を入れます。ワークフローが使う版と同じです。ビルドはmiseが有効なシェル（`mise activate`）で実行するか、`mise run build:linux -- <options>`で実行します。Pythonはビルドツールを動かすためだけに使います。Ubuntuでのビルドと実行の前提は次のとおりです（GUIの試験に要るものはワークフローを見てください）。

```sh
sudo apt-get install build-essential pkg-config binutils libwebkit2gtk-4.1-dev \
  libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev libclang-dev pipewire-bin libvulkan1 libglfw3 libportaudio2 libasound2-dev \
  meson ninja-build libsndfile1-dev libglib2.0-dev liblua5.4-dev
mkdir -p build
bash tools/ci/setup_pipewire.sh "$PWD/build/ci-audio"
while IFS= read -r setting; do export "$setting"; done < build/ci-audio/environment
export PATH="$PWD/build/ci-audio/prefix/bin:$PATH"
python tools/build_linux.py --download-speech
```

アプリのバックエンドの中核はlibpipewire-0.3を通して音声デバイスを一覧にし、監視します（`src-tauri`がオンにする`native/audio-routing`の`pipewire`のfeature）。そのため、アプリのビルドにはPipeWireの開発用ファイルと、バインディングを作るためのlibclangが要ります。中核自身の試験はこのfeatureなしでビルドするので、どちらも要りません。

ネイティブの取り込みのヘルパーはPipeWire **1.6.10**で試験したクロックのAPIを使います。Ubuntu 24.04の標準のヘッダーにはcycleとdiscontinuityのフィールドがなく、標準のパッケージだけではこのヘルパーをビルドできません。Linuxの2つのワークフローはどちらもSHA-256を確かめてから、固定したPipeWire 1.6.10とWirePlumber 0.5.18のソースを新しい独立したインストール先（prefix）にビルドします。ヘッダー、クライアントのライブラリ、ツール、モジュール、設定は、そろえて選びます。スクリプトはシステムのサービスを入れることも起動することもせず、出力先がすでにあると断ります。WirePlumber 0.5は専用の合成試験で使うポリシーだけのプロファイルを持っています。これはUbuntuの0.4のCLIと互換性がありません。すでに試験した版が入っているホストでは、代わりにシステムに入っているものを使えます。取り込みのヘルパーは、ヘッダー、リンクしたクライアントのライブラリ、接続したデーモンのすべてがPipeWire 1.6.10以降を示すことを求めます。実行時の版が古いか形式がおかしいときは、PCMを出す前に拒否します。コンパイル時の検査は依存が足りないことをはっきりしたエラーで示します。これはタイムスタンプと不連続の検査を緩めるものでも、新しい版をすべて検証したものでもありません。

`--download-speech`で取得を許可するのは**固定した2つのエンジンのアーカイブだけ**（`speech-0.11.2-linux-x64-vulkan.zip`と`speech-0.11.2-linux-x64-cpu.zip`）と、固定した実行時のライブラリ（`tools/runtime_libraries.py`）、読みの辞書のSudachiDict full（`sudachi-dictionary-20250825-full.zip`、`tools/sudachi_dictionary.py`）です。モデルの重みは取得しません。代わりに、エンジンのアーカイブと辞書のアーカイブを上の名前で置いたフォルダーを`--speech-archive-dir /absolute/path`で指定することもできます。アーカイブと実行ファイルのハッシュは`speechcpp-bundle-artifacts.json`と、辞書は`tools/sudachi_dictionary.py`に固定したサイズとSHA-256と照合します。0.5.0からは1つの候補に両方のビルドが入り、`--variant`はもうありません。CPUかGPUかは、利用者がspeech.cppのサーバーの設定で選びます。`cpu`ではCPU版を、`gpu`とGPUの名前を選んだときはVulkan版を動かします。`auto`では、Vulkan版が起動してGPUを一覧に出せばVulkan版を、そうでなければCPU版を動かします（`native/speech-server/src/builds.rs`）。`--offline`にはnpmとCargoのキャッシュがそろっている必要があります。エンジンのモデルも参照音声も取得しません。`--resources-only`は`_internal`を（`build/linux/internal`に）用意して検査するだけで、配布物は作りません。`--profile debug`も診断用で、通常の出力はreleaseです。

ビルダーはPythonのパッケージを入れません。`npm ci --ignore-scripts`を使い、Cargoはコピーしたワークスペース（`build/linux/workspace`）の中で`--locked`を付けてビルドします。このワークスペースの`src-tauri/bin/_internal`は組み立てたフォルダーそのもので、checkoutの`src-tauri/bin`は置き換えません。クレートの外にあってクレートがコンパイル時に読むファイル1つ（`tools/build_linux.py`の`CRATE_INPUTS`）もコピーします。これはビット単位で再現できるビルドだという主張では**ありません**。Rust、Node、Python、uvの版は`mise.toml`で固定しています。システムのライブラリと、実際のELFが求める版はホストによって変わります。ファイルの一覧にはビルドしたコミット、追跡しているファイルに未コミットの変更があるか、ホスト、ハッシュ、ELFの版を記録します。

既定の出力は次のとおりです。

```text
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.tar.gz
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.tar.gz.sha256
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.manifest.json
```

0.6.xまでのファイルの名前は`VRCT-VOX-<version>-…`でした。0.7.xのリリースでは、リリースの候補が各ファイルの写しをこの名前で足します（[旧名の写し](release-candidates.md#旧名の写し)）。

0.4までは名前にエンジンのビルド（`linux-x64-vulkan`、`linux-x64-cpu`）が入っていました。0.5.0からの`build-manifest.json`は`"variant": "linux-x64"`を記録し、両方のビルドを`speech_builds`に記録します。両方のビルドを入れるので、各パッケージにはCPU版の実行ファイル（展開後に9,980,104バイト、固定した0.11.2のZIPの中ではdeflateで3,805,693バイト）と、2つ目の通知文書の写し（約47 KB）が加わります。Vulkan版の実行ファイルは展開後に52,185,408バイトです。これらは固定したアーカイブの中のファイルの大きさで、ビルドしたパッケージの大きさではありません。

## 実行と検査

```sh
cd build/linux/artifacts
sha256sum -c ./*.tar.gz.sha256
# 別の経路で手に入れた候補は、展開する前にtools/linux_package.pyで検査する
tar -xzf ASTAROT-<version>-linux-x64-release.tar.gz
./ASTAROT/astarot
```

アーカイブを展開すると、`ASTAROT`（0.6.xまでは`VRCT-VOX`）ができます。フォルダー全体をまとめて置いておく必要があります。WebKitGTK 4.1、GTK3、OpenSSL、PipeWireとそのツール、GPUを選ぶときのVulkanローダー、そのほかのシステムのELFの依存は、ホストが用意します。これは持ち運べるフォルダーの構成で、AppImageでも、すべてのディストリビューションで動く約束でも**ありません**。CachyOSで作ったビルドはUbuntuのCIのビルドより新しいglibcを求めることがあります。そのビルドのマニフェストを確かめてください。

配布版のLinuxでは設定とログを`$XDG_CONFIG_HOME/astarot`（既定は`~/.config/astarot`）に、重みとそのほかの書き込むデータを`$XDG_DATA_HOME/astarot`（既定は`~/.local/share/astarot`）に置きます。0.5.xまではどちらも`vrct-vox`という名前でした。0.6.0の最初の起動でこれらを移し、古い名前でリンクを残します（[保存先の移動](../spec/data-and-persistence.md#linuxの保存先の移動)）。アプリはキャッシュのフォルダーを持ちません。`ASTAROT_CONFIG_DIR`と`ASTAROT_DATA_DIR`（または`VRCT_CONFIG_DIR`と`VRCT_DATA_DIR`）は、これらのフォルダーを別の場所に変えます。この方法で指定したフォルダーは移しません。明示した`HF_HOME`には従います。開発用とWindowsの既存のパスは変わりません。

管理対象の音声には引き続き`local-setup-linux.md`にあるPipeWireの明示の準備が要ります。パッケージは`_internal/config/pipewire/90-astarot-managed.conf`にテンプレートを持っていますが、それをインストールすることも利用者の音声のサービスを再起動することもしません。アプリが所有する音声のワーカーには、対応するPipeWireの実行環境に加えてLinux 6.9以降（PIDFD_THREAD）が要ります。利用者のRVCのモデルはこれまでどおり外にあるものを選びます。Seed-VCのアダプターとそのPythonの準備用のファイルは、もう同梱しません。

## 受け入れ試験と除外

```sh
ASTAROT_TEST_LINUX_ARCHIVE=/absolute/path/candidate.tar.gz \
  build/dev/headless-venv/bin/python -m pytest \
  -c tests/voice/pytest.ini tests/platform/test_linux_package.py -q
```

`python tools/dev.py setup --scope headless`がこの試験の環境を`uv.lock`から用意します（pytestとほかの試験のツールだけで、アプリの依存は入りません）。試験は空白を含むパスに展開し、インストールしたものを読み取り専用にします。そして、Pythonのバックエンドがないこと、同梱した両方のエンジンのビルドが起動すること、インストールしたファイルのハッシュが変わっていないことを確かめます。GUIの試験では`ASTAROT_TEST_NATIVE_GUI=1`と、tauri-driver 2.1.0の実行ファイルを指す`ASTAROT_TEST_DRIVER`も設定します。共通の`NativeWebDriver`の起動処理は`VRCT_CONFIG_DIR`を明示して渡します。既定は既存の`$XDG_CONFIG_HOME/vrct-vox`で、呼び出し側が上書きした値はそのまま使います。これでリリースビルドの試験をインストール済みのアプリと並べて実行できます。デバッグビルドと、`VRCT_CONFIG_DIR`を設定した起動は、[二重起動の防止](../spec/ipc-protocol.md#起動と初期化)の対象になりません。`XDG_*`のフォルダーを分けて手で試験するときは、同じ設定のフォルダーを指す`VRCT_CONFIG_DIR`も渡します。`XDG_*`を変えるだけでは二重起動の防止の対象から外れません。二重起動の防止そのものを試験するときは、`VRCT_CONFIG_DIR`を設定せずにリリースビルドを使い、動いているD-Busのセッションバスを2回の起動で共有します。実機のデスクトップでは、システムのPythonとGioで動かす`tools/display_power_guard.py`の下で実行します。CIは`ASTAROT_TEST_XVFB=1`を明示してXvfbを使い、そのサーバーと実際の描画を確かめます。`ASTAROT_TEST_NATIVE_ROUTE=1`を設定すると、専用のPipeWireのグラフと、管理対象の経路のミュート、再開、再起動も試験します（WirePlumber 0.5のポリシーのプロファイルが要ります）。これは手元で受け入れ試験をするときの選択肢です。Ubuntu 24.04のCIは残りのスモークテストを流し、音声のグラフの受け入れを確かめたことにはしていません。これらの試験はどれも実際のマイクを録音せず、VRChatに接続せず、推論のモデルも読み込みません。

収集の処理と、最後のツリーとtarの検査は、OCRの重み、Mia2026の素材、安全でないリンク、パスのトラバーサル、重複したパス、特殊ファイル、中を検査できない入れ子のアーカイブを拒否します。これらはパスと種類の検査で、わざと名前を変えた重みを見つけるものではありません。元のライセンスと通知文書は残します。`astarot`と`astarot-rvc-worker`に組み込んだRustのクレートは、ライセンスの文書と一緒に`_internal/licenses/rust/`に一覧にします（`tools/rust_licenses.py`。Cargoのレジストリのソースが要るので、`--offline`のビルドではソースをキャッシュしておく必要があります）。クレートがライセンスの文書を公開しておらず、`licenses/rust/supplements.json`に確認済みの項目もないときは、ビルドが止まります。Silero v5のVADのファイルとPythonのパッケージの通知文書は、Pythonのバックエンドと一緒になくなりました。OCRの重みはいずれにしても除外します。

## 残っているリリースの条件

今も当てはまるリリースの条件は次のとおりです。最初のリリースはすでに公開しています。

- 毎回のリリースの前に行う[配布候補](release-candidates.md)の確認
  - パッケージが同梱するものすべて（GTK、WebKit、実行時に静的に入る依存、ネイティブ、フロントエンド、Rustの部品）のライセンスと部品表（SBOM）の確認。GPLとLGPLが課す、対応するソースの提供と再リンクの義務も含みます。集めた通知文書だけでは再配布してよいことの確認になりません。
  - #516で決めたLinuxのデスクトップでの確認。AppImageは実機のデスクトップで確かめます。debとrpmはコンテナに入れる試験だけ、tar.gzは仮想の画面での試験だけです（`build-linux.yml`）。
- 頼まれていた、Trail of Bits Skillsによるアプリ全体のセキュリティレビューは、行った記録がありません。まだ未解決です。
- 実際のモデル、聞いたときの品質、実機での遅延、Windowsの試験は、それぞれの受け入れの状態を保ちます。これらのスモークテストはその代わりになりません。
- AURのパッケージを出すなら、実際のリリースのURLとハッシュ、PKGBUILDと.SRCINFO、clean chrootでの試験、インストールと更新と削除の試験が要ります。まだ何も提出していません。

## 一次資料

- AppImageの中では、GUIのプロセスは同梱したライブラリのパス（`LD_LIBRARY_PATH`）とGTKの設定で動きます。起動スクリプトはホストの値を`ASTAROT_APPIMAGE_HOST_*`に残し、アプリが起動するプログラムではその値が元に戻ります（`astarot_app_identity::appimage`）。[AppImage](appimage.md#run)を参照してください。
- [TauriのLinuxの前提条件](https://v2.tauri.app/start/prerequisites/#linux)は、ネイティブのWebKitGTKのビルドの境界を定めています。[公式のWebDriverのCI](https://v2.tauri.app/develop/tests/webdriver/ci/)はLinuxで仮想の画面を使います。
