# Linux build pipeline

`tools/build_linux.py` builds an x86_64 candidate: the `vrct-vox` app, which runs the Rust
backend core (`native/core`) in its own process, and its `_internal` folder with both pinned
speech.cpp 0.11.0 builds (Vulkan in `build/speechcpp`, CPU in `build/speechcpp-cpu`), the RVC worker, the C audio and capture helpers, the
PipeWire template and the license texts (`tools/app_resources.py` lists them). Since 0.5.0
no Python runtime is frozen or shipped. The default output is a `tar.gz`, a SHA-256 file
and a JSON file inventory. Keep `vrct-vox` and `_internal` together: the core finds
speech.cpp and the helpers in `_internal` beside the binary.
Add `--appimage --download-appimage-tools` for an additional inspected AppImage;
see [AppImage build and acceptance](appimage.md). The CI builds both formats.

The CI then makes a `.deb` and an `.rpm` from the same candidate directory with
`python3 tools/linux_packages.py --candidate build/linux/candidate/VRCT-VOX --output-dir build/linux/artifacts`
(needs `dpkg-deb` and `rpmbuild`). They install the unchanged files under `/opt/vrct-vox`,
add `/usr/bin/vrct-vox`, a desktop entry, an icon and the license notices, and write
`/opt/vrct-vox/package-manager` (`deb` or `rpm`) so the app can tell a package-manager install.
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
It runs on relevant pull requests or manual dispatch, tests the relocated package,
and the AppImage extraction fallback, then retains successful candidates for seven days. It has `contents: read`, no
publishing credentials and no release/AUR actions. The Linux packages of the
[`v0.1.0-beta.1` prerelease](https://github.com/kein5/VRCT-VOX/releases/tag/v0.1.0-beta.1)
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
(`speech-0.11.0-linux-x64-vulkan.zip` and `speech-0.11.0-linux-x64-cpu.zip`).
Alternatively use `--speech-archive-dir /absolute/path` with both archives under those names;
the archive and executable hashes are checked against `speechcpp-bundle-artifacts.json`.
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
build/linux/artifacts/VRCT-VOX-<version>-linux-x64-release.tar.gz
build/linux/artifacts/VRCT-VOX-<version>-linux-x64-release.tar.gz.sha256
build/linux/artifacts/VRCT-VOX-<version>-linux-x64-release.manifest.json
```

Until 0.4 the names carried the engine build (`linux-x64-vulkan`, `linux-x64-cpu`). Since 0.5.0
`build-manifest.json` records `"variant": "linux-x64"` and both builds in `speech_builds`.
Carrying both builds adds the CPU executable (9,965,440 bytes unpacked; 3,798,516 bytes
deflated in the pinned 0.11.0 ZIP) and a second copy of the notices (about 47 KB) to each
package. The Vulkan executable is 52,174,848 bytes unpacked. These are the sizes of the files
in the pinned archives, not of a built package.

## Run and inspect

```sh
cd build/linux/artifacts
sha256sum -c ./*.tar.gz.sha256
# Inspect with tools/linux_package.py before extracting an independently obtained candidate.
tar -xzf VRCT-VOX-<version>-linux-x64-release.tar.gz
./VRCT-VOX/vrct-vox
```

The full `VRCT-VOX` directory must stay together. The host supplies WebKitGTK 4.1,
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
The package carries the template at `_internal/config/pipewire/90-vrct-managed.conf`;
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
Original licenses and notices are retained. The Rust crates built into `vrct-vox` and `astarot-rvc-worker` are listed with their
license texts in `_internal/licenses/rust/` (`tools/rust_licenses.py`, which needs
the Cargo registry sources, so `--offline` builds need them cached). The build
stops if a crate publishes no license text and has no reviewed entry in
`licenses/rust/supplements.json`.
The Silero v5 VAD files and the Python package notices left with the Python backend.
OCR weights are excluded regardless.

## Remaining release gates

- The hosted Ubuntu workflow runs for every candidate. Runtime acceptance on clean
  installations of other distributions remains a release gate.
- All bundled native/Rust/frontend components need a completed license/SBOM
  audit, including GPL/LGPL corresponding-source/relink obligations, and the
  user-requested Trail of Bits Skills security review. Collected notices alone
  are not redistribution clearance.
- Real model, listening quality, physical latency, Windows and cross-distribution
  tests retain their existing acceptance status; these smoke tests do not replace them.
- AUR needs a real approved release URL/hash, PKGBUILD/.SRCINFO, clean-chroot and
  install/update/remove tests. No AUR submission is performed here.

## Primary evidence

- Inside the AppImage the GUI process runs with the bundled library path
  (`LD_LIBRARY_PATH`) and GTK settings. The launcher keeps the host values in
  `ASTAROT_APPIMAGE_HOST_*`; a program the app starts should get them back, as the screen
  capture helper does (`src-tauri/src/portal_screencast.rs`). See [AppImage](appimage.md#run).
- [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux) define the
  native WebKitGTK build boundary; [official WebDriver CI](https://v2.tauri.app/develop/tests/webdriver/ci/)
  uses a virtual display on Linux.
