# Linux AppImage candidate

[日本語版](#linuxのappimageの候補日本語版)

The Linux builder can also produce an x86_64 AppImage containing the release GUI, which
runs the Rust backend core in its own process, and the `_internal` folder of the
[Linux candidate](linux-build-pipeline.md): both pinned speech.cpp builds (CPU and Vulkan), the RVC worker and the
audio and capture helpers. Since 0.5.0 no Python runtime is shipped. The
releases published since the
[`v0.1.0-beta.1` prerelease](https://github.com/kein5/astarot/releases/tag/v0.1.0-beta.1)
ship an AppImage built by the hosted Linux candidate workflow; an image you
build locally is an unpublished candidate.
It deploys GTK/WebKit dependencies before adding `_internal` under `usr/lib/astarot/` (`usr/lib/vrct-vox/`
up to 0.6.x), so
GUI library rewriting never changes the engine or helper bytes. The core finds them there
(`native/core/src/resources.rs`).

## Build

Use the prerequisites in [the Linux build guide](linux-build-pipeline.md), plus
`desktop-file-utils`, `libgtk-3-dev`, `libgdk-pixbuf-2.0-dev` and `glib-networking`
on Ubuntu. Build both formats:

```sh
python tools/build_linux.py --download-speech \
  --appimage --download-appimage-tools
```

For an existing inspected Linux candidate:

```sh
python tools/build_appimage.py --download-tools
```

The second command uses `build/linux/candidate/ASTAROT`, `build/appimage` and
`build/appimage-tools`. The full builder instead keeps its AppImage staging and
tools inside `build/linux`. The download flag fetches only the five build tools
listed in [appimage-tools.json](appimage-tools.json), with fixed sizes and SHA-256.
Prepopulate the corresponding tool directory to build without that flag. A
changed or missing pinned asset fails closed. The patchelf archive is verified
before its one named executable is read and checked; other members are not extracted.
The runtime's `continuous` download URL can change upstream; a future mismatch
requires deliberate review and repinning, never a hash bypass.

Default outputs alongside tar.gz:

```text
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.AppImage
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.AppImage.sha256
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.AppImage.manifest.json
```

The builder checks the fixed runtime prefix, allowing only appimagetool's 16-byte
MD5 metadata field, before executing extraction. The extracted tree must pass
distribution policy and match the pre-packaging file/hash/mode/link inventory.
This is an integrity check of a locally built candidate, not a signature or a
sandbox for arbitrary downloaded executables.

## Run

```sh
cd build/linux/artifacts
sha256sum -c ./*.AppImage.sha256
chmod +x ASTAROT-<version>-linux-x64-release.AppImage
./ASTAROT-<version>-linux-x64-release.AppImage
```

FUSE must be available to the desktop user. For machines without FUSE:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./ASTAROT-<version>-linux-x64-release.AppImage
```

Extraction needs temporary disk space for the uncompressed payload, in addition to the
image. A noexec temporary
filesystem cannot run the extracted program. Both modes preserve settings/data
in the [XDG locations](linux-build-pipeline.md#run-and-inspect); the image is not
the writable model directory. The bundled PipeWire template is under
`usr/lib/astarot/_internal/config/pipewire/`; managed routing still requires
the explicit [host setup](local-setup-linux.md). No host audio service is restarted.

The pinned GTK plugin uses X11, including XWayland on a Wayland desktop. On hosts
with the NVIDIA kernel module loaded, the launcher defaults
`WEBKIT_DISABLE_DMABUF_RENDERER=1` unless the user already set it. This resolves
the locally reproduced GBM allocation failure at the cost of WebKit's faster
rendering path; it is scoped to the GUI (see below for programs the app starts).
Other GPUs retain their default. An explicit `WEBKIT_DISABLE_DMABUF_RENDERER=0`
requests the original path. This is unrelated to the earlier DPMS-off failure.
See [Tauri's graphics guidance](https://v2.tauri.app/develop/debug/linux-graphics/).

The image loads only its bundled GTK input method modules, which have no fcitx
or ibus module. When `XMODIFIERS` is unset and fcitx/fcitx5 or ibus-daemon is
running, the launcher sets `XMODIFIERS` to that input method and selects GTK's
XIM module, so Mozc and other host input methods can type into the window.
A user-set `XMODIFIERS` is kept.

The launcher records the host's values of these variables, `LD_LIBRARY_PATH`, `PATH` and the
GTK/GIO settings as `ASTAROT_APPIMAGE_HOST_<NAME>` and `ASTAROT_APPIMAGE_HOST_<NAME>_SET` before it
changes them. Up to 0.4 a separate launcher gave them back to the Python backend. Now the
backend runs inside the GUI process, so every program it starts gets the host values back
through one function, `astarot_app_identity::appimage::restore_host_environment` (#924, item
22): speech.cpp and the translation LLM (`native/speech-server`), the GPU listing of the
model downloads (`native/ops`), the RVC worker (`native/voice-conversion`), the audio helpers
(`native/audio-routing`'s `ProcessEnv`), the clipboard tools, `xdg-open`, `nvidia-smi` and the
screen capture helper. A variable the code that starts a program sets itself is left as it
sets it. The Tauri plugins start programs that function does not reach (#1016). The URL
opener runs `xdg-open`, and the image's own `usr/bin/xdg-open` (`packaging/appimage/xdg-open`),
first in the GUI's `PATH`, gives the host values back from the record before it runs the host's
`xdg-open`. Without it a browser the opener starts loads the image's GTK and GLib. The updater
starts no program on Linux: after it replaces the image, the app starts the image again with its
own environment, and the launcher keeps the record it is given instead of recording the GUI's
values as the host's.

With the NVIDIA fallback active, the main window is also made opaque. The
original transparent window lost its contents during ordinary startup/hover on
this host, despite passing the initial WebDriver screenshot tests. Disabling
transparency alone restored the display in a controlled comparison. Desktop
transparency/transparent rounded corners are therefore unavailable in this mode;
the opacity preference may fade content against the window background instead.
Windows and other rendering paths retain their configured transparency.

## Acceptance and limits

```sh
ASTAROT_TEST_APPIMAGE=/absolute/path/candidate.AppImage \
ASTAROT_TEST_APPIMAGE_FUSE=1 ASTAROT_TEST_NATIVE_GUI=1 \
uv run --no-project --python /usr/bin/python3 tools/display_power_guard.py -- \
build/dev/headless-venv/bin/python -m pytest \
  -c tests/voice/pytest.ini tests/platform/test_appimage.py -q
```

Supply `ASTAROT_TEST_DRIVER` for a different tauri-driver 2.1.0 location. The system
Python running the display guard needs Gio. Tests copy the actual image to a
path with spaces and cover native drawing/shutdown and the settings screen, for
both FUSE and extraction. The
normal-launch test additionally needs ImageMagick and xdotool. It starts the app
without WebDriver, idles for five seconds, then captures the actual X11 window
before and after pointer movement. It checks painted interior coverage and
restores the pointer on completion; no inference control is clicked. It records
no physical microphone and uses no inference models. The CI uses Xvfb and tests
extraction; it does not claim FUSE or physical audio acceptance on Ubuntu 24.04.

Both the WebDriver and normal-launch tests pass `VRCT_CONFIG_DIR`, so they remain
independent of an installed app. For manual AppImage tests with isolated `XDG_*`
directories, also set `ASTAROT_CONFIG_DIR` to `$XDG_CONFIG_HOME/astarot`, preserving
the same state location. See the [Linux acceptance guide](linux-build-pipeline.md#acceptance-and-exclusions)
for testing the single-instance guard itself and its D-Bus requirement.

A local build on CachyOS/glibc 2.44 includes GLIBC_2.44 references and does not
run on older distributions. Release images come from the hosted Ubuntu 24.04
workflow; other target machines must be tested separately. Host kernel/glibc, GPU drivers, PipeWire and
command-line audio tools remain requirements. Owned audio helpers currently need
Linux >=6.9. AppImage does not remove these requirements.

OCR weights and Mia2026 are rejected by the package policy. No speech.cpp or RVC model
is acquired or bundled by this builder. User models stay external. Original licenses are retained;
GTK/WebKit, runtime static dependencies and the complete native/frontend/Rust
license/SBOM review remain a check before each release ([release candidates](release-candidates.md)). A build-tool license does not cover
all libraries copied into the image. patchelf is a build tool only and is not
shipped in the runtime tree.

The workflow uploads a candidate only after its build and acceptance steps pass.
It has no release publisher or AUR submission; release drafts are made separately
as described in [release candidates](release-candidates.md).

## Investigation evidence

- [AppImageKit AppRun source](https://github.com/AppImage/AppImageKit/blob/master/src/AppRun.c):
  working directory is `APPDIR/usr`; this matches the GTK plugin's relocated WebKit paths.
- [Pinned GTK plugin](https://github.com/tauri-apps/linuxdeploy-plugin-gtk/blob/dda522bce37387f1b853d9095713bfaa924c8423/linuxdeploy-plugin-gtk.sh):
  generated environment hook and WebKit path rewriting.
- [patchelf relocation fixes](https://github.com/NixOS/patchelf/pull/652): upstream
  fixes support pinning the newer tool; they do not by themselves prove the exact
  cause of the earlier local loader crash. Updating patchelf and correcting the
  launcher are recorded separately from that unproven causal attribution.
- [Tauri AppImage baseline guidance](https://v2.tauri.app/distribute/appimage/):
  build on the oldest intended target; bundling does not guarantee old glibc support.

---

# LinuxのAppImageの候補（日本語版）

Linuxのビルダーはx86_64のAppImageも作れます。AppImageにはリリースビルドのGUIと、[Linuxの候補](linux-build-pipeline.md)の`_internal`フォルダーが入ります。GUIはRustのバックエンドの中核を自分のプロセスの中で動かします。`_internal`には固定したspeech.cppの2つのビルド（CPU版とVulkan版）、RVCのワーカー、音声と取り込みのヘルパーが入っています。0.5.0からはPythonの実行環境を同梱しません。[`v0.1.0-beta.1`のプレリリース](https://github.com/kein5/astarot/releases/tag/v0.1.0-beta.1)から後に公開したリリースには、GitHubがホストするLinuxの候補のワークフローでビルドしたAppImageが入っています。手元でビルドしたイメージは公開していない候補です。ビルダーはGTKとWebKitの依存を配置してから、`_internal`を`usr/lib/astarot/`（0.6.xまでは`usr/lib/vrct-vox/`）の下に足します。そのため、GUIのライブラリを書き換える処理がエンジンやヘルパーのバイト列を変えることはありません。中核はエンジンとヘルパーをそこから探します（`native/core/src/resources.rs`）。

## ビルド

[Linuxのビルドの手順](linux-build-pipeline.md)の前提に加えて、Ubuntuでは`desktop-file-utils`、`libgtk-3-dev`、`libgdk-pixbuf-2.0-dev`、`glib-networking`を入れます。両方の形式をビルドするコマンドは次のとおりです。

```sh
python tools/build_linux.py --download-speech \
  --appimage --download-appimage-tools
```

検査済みのLinuxの候補がすでにあるときは、次のコマンドを使います。

```sh
python tools/build_appimage.py --download-tools
```

2つ目のコマンドは`build/linux/candidate/ASTAROT`、`build/appimage`、`build/appimage-tools`を使います。一方、全体をビルドする側はAppImageを組み立てる場所とツールを`build/linux`の中に置きます。ダウンロードのフラグで取得するのは[appimage-tools.json](appimage-tools.json)に載せた5つのビルドツールだけで、サイズとSHA-256は固定してあります。このフラグなしでビルドするときは、対応するツールのフォルダーにあらかじめツールを置いておきます。固定したファイルが変わっていたりなかったりすると、先へ進まずに失敗します。patchelfのアーカイブは名前を決めた1つの実行ファイルを読み出して確かめる前に検証します。ほかの中身は展開しません。ランタイムの`continuous`のダウンロードのURLは、上流で指す先が変わることがあります。将来食い違ったときは、意図して確認してから固定し直す必要があり、ハッシュの検査を飛ばすことはしません。

tar.gzのほかに出る既定の出力は次のとおりです。

```text
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.AppImage
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.AppImage.sha256
build/linux/artifacts/ASTAROT-<version>-linux-x64-release.AppImage.manifest.json
```

ビルダーは展開を実行する前に、イメージの先頭にある固定したランタイムの部分を確かめます。違ってよいのはappimagetoolの16バイトのMD5のメタデータの欄だけです。展開したツリーは配布の方針の検査に通り、パッケージにする前のファイル、ハッシュ、モード、リンクの一覧と一致しなければなりません。これは手元でビルドした候補の完全性の検査です。署名でも、ダウンロードした任意の実行ファイルを閉じ込めるサンドボックスでもありません。

## 実行

```sh
cd build/linux/artifacts
sha256sum -c ./*.AppImage.sha256
chmod +x ASTAROT-<version>-linux-x64-release.AppImage
./ASTAROT-<version>-linux-x64-release.AppImage
```

デスクトップの利用者がFUSEを使える必要があります。FUSEのないPCでは次のように起動します。

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./ASTAROT-<version>-linux-x64-release.AppImage
```

展開して起動するには、イメージのほかに圧縮を解いた中身を置く一時的なディスクの空きが要ります。一時ファイルシステムがnoexecだと、展開したプログラムを実行できません。どちらの方式でも設定とデータは[XDGの保存先](linux-build-pipeline.md#run-and-inspect)に残ります。イメージはモデルを書き込むフォルダーにはなりません。同梱したPipeWireのテンプレートは`usr/lib/astarot/_internal/config/pipewire/`の下にあります。管理対象の音声経路には引き続き明示の[ホストでの準備](local-setup-linux.md)が要ります。ホストの音声のサービスは再起動しません。

固定したGTKのプラグインはX11を使い、WaylandのデスクトップではXWaylandを通します。NVIDIAのカーネルモジュールが読み込まれているホストでは、利用者がまだ設定していなければ、起動スクリプトが`WEBKIT_DISABLE_DMABUF_RENDERER=1`を既定にします。これで手元で再現したGBMの割り当ての失敗は解消しますが、代わりにWebKitの速い描画の経路を使わなくなります。この設定の対象はGUIだけです（アプリが起動するプログラムについては下を見てください）。ほかのGPUは既定のままです。`WEBKIT_DISABLE_DMABUF_RENDERER=0`を明示すると、元の経路を選びます。これはDPMSで画面が消えたときに以前起きた失敗とは関係ありません。[Tauriのグラフィックスの案内](https://v2.tauri.app/develop/debug/linux-graphics/)を参照してください。

イメージが読み込むのは同梱したGTKの入力メソッドのモジュールだけで、その中にfcitxとibusのモジュールはありません。`XMODIFIERS`が設定されておらず、fcitxかfcitx5かibus-daemonが動いているときは、起動スクリプトが`XMODIFIERS`をその入力メソッドに設定し、GTKのXIMのモジュールを選びます。これでMozcなどホストの入力メソッドからウィンドウに文字を入力できます。利用者が設定した`XMODIFIERS`はそのまま残します。

起動スクリプトはこれらの変数と`LD_LIBRARY_PATH`、`PATH`、GTKとGIOの設定を変える前に、ホストでの値を`ASTAROT_APPIMAGE_HOST_<NAME>`と`ASTAROT_APPIMAGE_HOST_<NAME>_SET`に記録します。0.4までは、別の起動処理がこれらの値をPythonのバックエンドに戻していました。今はバックエンドがGUIのプロセスの中で動くので、バックエンドが起動するプログラムにはすべて、1つの関数`astarot_app_identity::appimage::restore_host_environment`を通してホストの値を戻します（#924の項目22）。対象はspeech.cppと翻訳のLLM（`native/speech-server`）、モデルの取得でGPUを一覧にする処理（`native/ops`）、RVCのワーカー（`native/voice-conversion`）、音声のヘルパー（`native/audio-routing`の`ProcessEnv`）、クリップボードのツール、`xdg-open`、`nvidia-smi`、画面の取り込みのヘルパーです。プログラムを起動するコードが自分で設定する変数はその値のまま残します。Tauriのプラグインが起動するプログラムには、この関数が届きません（#1016）。URLを開く処理は`xdg-open`を起動します。GUIの`PATH`の先頭にあるイメージの`usr/bin/xdg-open`（`packaging/appimage/xdg-open`）が、記録からホストの値を戻してから、ホストの`xdg-open`を起動します。これがないと、URLを開く処理が起動したブラウザーはイメージのGTKとGLibを読み込みます。updaterはLinuxではプログラムを起動しません。イメージを置き換えたあと、アプリは自分の環境のままイメージを起動し直します。そのとき起動スクリプトは、受け取った記録をそのまま使い、GUIの値をホストの値として記録し直しません。

NVIDIA向けのフォールバックが有効なときは、メインのウィンドウも不透明にします。元の透明なウィンドウは最初のWebDriverの撮影の試験には通っていましたが、このホストでは通常の起動とホバーのときに中身が消えました。条件をそろえて比べると、透明をやめるだけで表示が戻りました。そのため、このモードではデスクトップが透けて見える表示と透明な角丸を使えません。代わりに「透明度」の設定がウィンドウの背景に対して中身を薄くすることがあります。Windowsとほかの描画の経路では設定した透明度を保ちます。

## 受け入れ試験と制限

```sh
ASTAROT_TEST_APPIMAGE=/absolute/path/candidate.AppImage \
ASTAROT_TEST_APPIMAGE_FUSE=1 ASTAROT_TEST_NATIVE_GUI=1 \
uv run --no-project --python /usr/bin/python3 tools/display_power_guard.py -- \
build/dev/headless-venv/bin/python -m pytest \
  -c tests/voice/pytest.ini tests/platform/test_appimage.py -q
```

tauri-driver 2.1.0が別の場所にあるときは、`ASTAROT_TEST_DRIVER`で指定します。`tools/display_power_guard.py`を動かすシステムのPythonにはGioが要ります。試験は実際のイメージを空白を含むパスにコピーし、FUSEと展開の両方の方式でネイティブの描画と終了、設定画面の操作を確かめます。通常起動の試験にはほかにImageMagickとxdotoolも要ります。この試験はWebDriverを使わずにアプリを起動し、5秒待ってから、ポインターを動かす前とあとに実際のX11のウィンドウを撮影します。ウィンドウの内側がどれだけ描画で埋まっているかを確かめ、終わるとポインターを元に戻します。推論に関わる部品は押しません。実際のマイクは録音せず、推論のモデルも使いません。CIはXvfbを使って展開の方式を試験します。Ubuntu 24.04でのFUSEと実際の音声の受け入れは、CIで確かめたことにしていません。

WebDriverの試験も通常起動の試験も`VRCT_CONFIG_DIR`を渡すので、インストール済みのアプリとは関係なく動きます。`XDG_*`のフォルダーを分けて手でAppImageを試験するときは、`ASTAROT_CONFIG_DIR`も`$XDG_CONFIG_HOME/astarot`に設定し、状態の保存先を同じに保ちます。二重起動の防止そのものの試験とそれに要るD-Busについては、[Linuxの受け入れ試験の案内](linux-build-pipeline.md#acceptance-and-exclusions)を参照してください。

手元のCachyOS（glibc 2.44）でビルドしたものはGLIBC_2.44への参照を含み、古いディストリビューションでは動きません。リリースのイメージは、GitHubがホストするUbuntu 24.04のワークフローで作ります。ほかの対象のPCでは別に試験する必要があります。ホストのカーネルとglibc、GPUのドライバー、PipeWire、音声のコマンドラインツールは、引き続き必要です。アプリが所有する音声のヘルパーには今のところLinux 6.9以降が必要です。AppImageにしても、これらの条件はなくなりません。

OCRの重みとMia2026はパッケージの方針で拒否します。このビルダーはspeech.cppとRVCのモデルを取得も同梱もしません。利用者のモデルは外に置いたままです。元のライセンスは残します。GTKとWebKit、実行時に静的に入る依存のライセンスの確認と、ネイティブ、フロントエンド、Rustのライセンスと部品表（SBOM）全体の確認は、引き続き毎回のリリースの前の確認として残ります（[配布候補](release-candidates.md)）。ビルドツールのライセンスがイメージにコピーしたすべてのライブラリに及ぶわけではありません。patchelfはビルドにだけ使うツールで、実行時のツリーには入れません。

ワークフローが候補をアップロードするのはビルドと受け入れ試験のステップが通ったあとだけです。ワークフローにはリリースを公開する処理もAURへ提出する処理もありません。リリースの下書きは[配布候補](release-candidates.md)にあるとおり別に作ります。

## 調査の裏付け

- [AppImageKitのAppRunのソース](https://github.com/AppImage/AppImageKit/blob/master/src/AppRun.c)：作業フォルダーは`APPDIR/usr`です。これはGTKのプラグインが再配置したWebKitのパスと合います。
- [固定したGTKのプラグイン](https://github.com/tauri-apps/linuxdeploy-plugin-gtk/blob/dda522bce37387f1b853d9095713bfaa924c8423/linuxdeploy-plugin-gtk.sh)：生成する環境のフックと、WebKitのパスの書き換え。
- [patchelfの再配置の修正](https://github.com/NixOS/patchelf/pull/652)：上流の修正は新しい版のpatchelfに固定する根拠になります。ただし、それだけで以前に手元で起きたローダーの異常終了の正確な原因を証明するものではありません。patchelfの更新と起動スクリプトの修正は、証明されていないこの原因の推定とは分けて記録しています。
- [TauriのAppImageの基準の案内](https://v2.tauri.app/distribute/appimage/)：対象にする中でいちばん古い環境でビルドします。バンドルしても、古いglibcで動くことは保証されません。
