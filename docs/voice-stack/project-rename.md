# ASTAROT names and identifiers

[日本語版](#astarotの名称と識別子日本語版)

ASTAROT (formerly VRCT-VOX) is a derivative project based on [misyaguziya/VRCT](https://github.com/misyaguziya/VRCT) (MIT). It left GitHub's fork network on 2026-10-31, but the original license and attribution are kept. The names of upstream VRCT and of [VRCT-TTS](https://github.com/misyaguziya/VRCT-TTS), a separate project by the upstream author, are not changed.

The scope of the display name migration is in [ADR-011](../adr/adr-011-astarot-brand-and-multimodal-accessibility.md), and the places where the old name appears are listed in [the display name inventory](astarot-rename-inventory.md).

## Display names

| Item | Name |
|---|---|
| Product name, and the name shown in the UI, documents and the site | `ASTAROT` |
| Tauri's `productName` (from 0.5.1; the installer title, the install location for a new install, shortcuts, the Windows app list and the product name in the executable's version information) | `ASTAROT` |
| Titles of the secondary windows (from 0.5.1) | `ASTAROT VR Panel`, `ASTAROT Control Panel`, `ASTAROT Hexagram`, `ASTAROT Captions Handle` |
| Official subtitle | `Speech, Translation, Accessibility, Revoicing & OCR Toolkit` |

## Names that keep the old name

The following names keep the old name. The repository was renamed to `kein5/astarot` at the 0.5.0 release ([the repository rename procedure](repository-rename.md)). The old name, `kein5/VRCT-VOX`, is now a separate repository that holds only a redirect page and copies of the 0.5.0 release, and GitHub does not redirect from the old name. The other names are treated as internal identifiers and do not change together with the display name. In 0.6.0 and later versions they move to ASTAROT's names step by step, as [ADR-014](../adr/adr-014-internal-identifier-migration.md) describes (P2 of ADR-011). The tables in this document show the current values until each change lands. The installer finds the release files by name, and the updater gets them from the URLs written in `latest.json`.

| Item | Name |
|---|---|
| Executable name of the Python backend (up to 0.4; not included in the 0.5.0 release files) | `vrct-vox-sidecar` |

## Identifiers and storage locations

The following values are used for where settings and data are stored and for integration with the OS. Changing them means existing settings and integrations can no longer be carried over, so a change must come with a migration. The values that the Rust code uses are defined in `native/app-identity` as pairs of the old name and the ASTAROT name. A PR that moves a name switches which name is written there.

| Item | Value |
|---|---|
| Release files | From 0.7.0: `ASTAROT.zip`, `ASTAROT_setup.exe`, `ASTAROT-<version>-linux-x64-release.tar.gz` and the `.AppImage`, `.deb` and `.rpm` with the same name. Up to 0.6.x: `VRCT-VOX.zip`, `VRCT-VOX_setup.exe` and `VRCT-VOX-<version>-linux-x64-release.*` (up to 0.5.x also `VRCT-VOX_cuda.zip`, and up to 0.4 `linux-x64-vulkan` or `linux-x64-cpu`). Since 0.5.1 the installer that the build produces is `ASTAROT_<version>_x64-setup.exe`, and the release carries it under the name `ASTAROT_setup.exe`. Each 0.7.x release carries every release file together with a copy under its name up to 0.6.x (a file with the same content); from 0.8.0 the copies are not carried. `latest.json` points only to the new names ([Copies under the old names](release-candidates.md#旧名の写し)) |
| Main executable | From 0.7.0: `astarot` (`astarot.exe` on Windows). Up to 0.6.x: `vrct-vox` (`vrct-vox.exe`). It is set by Cargo's `[[bin]]` and by `mainBinaryName` in `tauri.conf.json` (from the versions after 0.6.0, the npm and Cargo packages and the Python project for development, `pyproject.toml`, are also `astarot`). The Linux window class and `StartupWMClass` follow this name. On update, the Windows installer replaces `vrct-vox.exe` and repoints the shortcuts it created ([Name of the main executable](../spec/data-and-persistence.md#本体の実行ファイルの名前)) |
| Linux packages | From 0.7.0, the deb and rpm package name is `astarot`; the package installs into `/opt/astarot` and places the command `/usr/bin/astarot`, the desktop entry `astarot.desktop` (with `Exec` and `StartupWMClass` also `astarot`) and the icon `astarot.png`. Inside the AppImage the bundled files are in `usr/lib/astarot`, and the tar.gz extracts to `ASTAROT`. Up to 0.6.x all of these were `vrct-vox` (`VRCT-VOX` for the tar.gz). The new package replaces the old package `vrct-vox`, and throughout 0.7.x `/usr/bin/vrct-vox` also starts the same executable ([Linux package names](../spec/data-and-persistence.md#linuxのパッケージの名前)) |
| Tauri app ID | From 0.7.0: `io.github.kein5.astarot` (up to 0.6.x: `io.github.kein5.vrct-vox`). Tauri's data folder, the Wayland portal app and the single-instance name follow this ID |
| SteamVR application | From the version with #1384, Windows only: the application key `io.github.kein5.astarot` (the app ID) in the manifest `astarot.vrmanifest` beside `astarot.exe`. SteamVR keeps the auto-launch flag under the key, so the key does not change once a version ships it. No earlier version registered with SteamVR, so there is no old name ([SteamVR's list of applications](../spec/external-interfaces.md#steamvrs-list-of-applications)) |
| Linux settings location | From 0.6.0: `$XDG_CONFIG_HOME/astarot`, by default `~/.config/astarot`. The 0.5.x `vrct-vox` is moved at the very start of launch, and a link under the old name that points to the new folder is kept throughout 0.6.x ([Moving the Linux storage locations](../spec/data-and-persistence.md#linuxの保存先の移動)) |
| Linux data location | From 0.6.0: `$XDG_DATA_HOME/astarot`, by default `~/.local/share/astarot`. It is moved the same way as the settings location |
| Linux cache location | None. Only the Python backend up to 0.4 used `$XDG_CACHE_HOME/vrct-vox` (by default `~/.cache/vrct-vox`) |
| Environment variables | From 0.6.0: `ASTAROT_*`. The 4 variables for users and packagers (`ASTAROT_CONFIG_DIR`, `ASTAROT_DATA_DIR`, `ASTAROT_TELEMETRY`, `ASTAROT_OPENVR_API`) are read first; if they are absent, the 0.5.x `VRCT_*` names are read. The old names are read throughout 0.6.x. If either `ASTAROT_TELEMETRY` or `VRCT_TELEMETRY` is `off`, sending stops. Variables for development, tests, builds and passing values between processes (`ASTAROT_VR_PANEL_DIR`, `ASTAROT_LINUX_BUNDLE`, `ASTAROT_TEST_*` and others) do not read the old names. `VRCT_CACHE_DIR` and similar variables were read only by the Python backend up to 0.4 |
| Key that records the Windows install location | From 0.7.0: `ASTAROT` (`HKCU\Software\kein5\ASTAROT`, and for the app list `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT`). Up to 0.6.x: `VRCT-VOX`. The installer reads the new key first and the old key if the new one is absent. It writes the new key, then deletes the old one ([Moving the Windows install location](../spec/data-and-persistence.md#windowsのインストール先の移動)) |
| Linux audio route and virtual microphone | From the version after 0.6.0: `astarot.managed.*` nodes (the virtual microphone's description is `ASTAROT Managed Virtual Microphone`), `astarot-managed-*.service`, the owner identifier `astarot-service-v1`, the hand-placed configuration `90-astarot-managed.conf` and the temporary streams `astarot.source-bridge.*` and `astarot.asr.capture.*`. A `vrct-managed-*.service` from 0.6.0 or earlier is stopped and removed only when its name, owner identifier and content all match what the core wrote, and it is then recreated under the new name. Nodes and streams with the old prefix are excluded from the input candidates, and when a hand-placed configuration under the old name (`90-vrct-managed.conf`) is found, nothing is created automatically. The old names are read during the version series that introduced the new names (`audio_route::READS_LEGACY_NAMES` in `native/app-identity`). Old units continue to be cleaned up with no end date (`audio_route::RETIRES_LEGACY_UNITS`) ([Migrating the audio route names](../spec/data-and-persistence.md#linuxの音声経路の名前の移行)) |
| Ownership marker for model downloads | From 0.6.0, `ASTAROT-model-download-v1` is written. `VRCT-VOX-model-download-v1`, written by 0.5.x, is also accepted throughout 0.6.x. 0.5.x reads only its own value, so after going back to 0.5.x, partially downloaded folders left by 0.6.0 stay where they are without being cleaned up |
| API keys (OS credential store) | From the versions after 0.6.0: on Windows `ASTAROT/<ID>/<項目の名前>` (the last part is the item name); on Linux the attributes `application=astarot` and `astarot-store=<ID>` with the label `ASTAROT <項目の名前>`. Keys that 0.6.0 saved under the `VRCT-VOX` names are copied to the new names at startup and read back. Lookups under the 0.6.0 names continue throughout 0.6.x. Items under the 0.6.0 names are kept; changing a key does not rewrite them, and deleting a key deletes it from both ([Where API keys are stored](../spec/data-and-persistence.md#apiキーの保存先)) |
| Ownership marker for the Linux build staging area | `VRCT-VOX Linux staging v1` |
| Wayland shortcut registration | The portal app ID `io.github.kein5.astarot` and `~/.local/share/applications/io.github.kein5.astarot.desktop` (marked with `X-ASTAROT-Generated=true`). An `io.github.kein5.vrct-vox.desktop` from up to 0.6.x is deleted only when it carries the `X-VRCT-VOX-Generated=true` mark. Shortcut and screen sharing permissions are recorded per app ID, so they have to be granted once more |

The Windows NSIS template reads the previous install location from the registry key above. From 0.5.1, `ASTAROT` appears in the installer screens, the Windows app list and the shortcuts. The default install location for a new install is `%LOCALAPPDATA%\ASTAROT`. On Windows, settings and models are placed in the install location. Up to 0.6.x, an install updated from 0.5.0 or earlier stayed in its original location, `%LOCALAPPDATA%\VRCT-VOX`. From 0.7.0, the installer moves an install in that location to `%LOCALAPPDATA%\ASTAROT` by renaming the folder after the update, and the app repoints the paths it saved at the next launch. A location the user chose is not moved. Shortcuts named `vrct-vox` are replaced with shortcuts named `ASTAROT`. From 0.7.0 the main executable is `astarot.exe`. On update, the installer replaces `vrct-vox.exe` and repoints the shortcuts it created to `astarot.exe`. Items pinned to the taskbar or Start, and shortcuts the user created, have to be set up again.

## Internal code names

Internal crates whose boundaries of responsibility are clear get code names taken from demons said to serve under Astaroth ([#689](https://github.com/kein5/astarot/issues/689)). A code name is a secondary name. The UI, documents and public APIs use names that describe the function. Setting keys, public APIs and file paths are not changed just for a code name. A name's rank comes from its affiliation in historical sources and has nothing to do with the dependencies between crates. The rank tree, the sources, the reasons for adoption and the other candidates are in #689. Tool repositories kept outside ASTAROT also get names from the same system (Sergulath in the table).

| Code name | Target | What it handles now |
|---|---|---|
| Ayperos | `native/core` | The core. Passing requests to and from the UI, settings and their migration, startup and shutdown, and coordinating each feature |
| Sargatanas | `native/speech-server` | Starting, stopping, restarting and health-checking the inference servers the app runs (the bundled speech.cpp and llama.cpp for the translation LLM) |
| Loray | `native/transcription` | Speech recognition. Recording and splitting utterances, cloud engines and real-time recognition with speech.cpp |
| Hael | `native/translation` | Requests to online translation services (DeepL and others), readings (furigana) and requests to TranslateGemma |
| Forau | `native/tts` | TTS requests, the order of TTS playback and passing the audio along |
| Humots | `native/ocr-runtime` | Reading the chat box and capturing the VRChat screen |
| Nebiros | `native/ops` | Supervising the running state. Watching the backend (watchdog) and usage reporting. Model downloads also live here |
| Nuberus | `native/vr-overlay` | SteamVR overlays (the caption log, the VR panel and the launcher) |
| Aglasis | `native/browser-core-bridge` | **Test host**. In integration tests (`tests/integration/`, ADR-017), it connects the UI shown in a browser with the core. It is a test tool and is not part of the app or the release files. It is separate from delivery inside the app (the Scirlin candidate) |
| Sergulath | [kein5/sergulath](https://github.com/kein5/sergulath) | **External repository**, not an ASTAROT crate. A set of tools that runs and checks apps using SteamVR overlays on a real headset (Steam Frame first). It is not part of the app or the release files. Its recursive acronym is Sergulath's Emulation, Recording, Gauging & Unattended-Launch Automation Testing Harness |

Code names are also written in the `description` of each crate's `Cargo.toml` and at the top of `lib.rs` (at the top of `main.rs` for crates that are only an executable). From the versions after 0.6.0, every crate's package name starts with `astarot-` (such as `astarot-core`; up to 0.6.0 they were names such as `vrct-core`, and there were also `ocr-runtime`, `rvc-runtime` and `app-identity` without a prefix; PR 12 of ADR-014). The app's crate and the npm package are `astarot`. Code names are not used as package names, only in documents and descriptions (the decision in [#797](https://github.com/kein5/astarot/pull/797)). Folder names (such as `native/core`) have not changed.

The following names have not been assigned yet.

- **Candidates waiting for a condition**: Scirlin (IPC and event delivery, once general delivery and the part specific to VRChat OSC can be separated) and Morail (masking sensitive data in logs, telemetry and diagnostic information, once masking becomes a separate responsibility). For now, general delivery (passing requests to and from the UI in `native/core`, the WebSocket server in `native/adapters`) and VRChat OSC (`native/adapters`) are not gathered within one boundary, and masking is inside `log.rs` in `native/core`. What Scirlin would handle is delivery inside the app, which does not overlap with Aglasis, the test host.
- **Reserved**: Surgat (brokering permissions) and Frucissiere (restoring state and recovering from failures).
- **Spare**: Valefar and Glasyabolas. No role has been decided for them.
- **Crates without a name**: `app-identity`, `audio-routing`, `adapters`, `openvr-client`, `onnx-runtime`, `translate-onnx`, `voice-conversion`, `rvc-runtime` and the C helper programs. Not every crate gets a name.

## Publishing

CI runs the tests and builds release candidates, as described in the [build guide](../readme_build.md). GitHub Releases drafts are created from the [manual verification gate](release-candidates.md), and a maintainer checks and publishes them. The first published version is `v0.1.0-beta.1` (a prerelease). Versions are counted from 0.1.0, separately from upstream VRCT (3.x). Automatic publishing and Hugging Face uploads from CI stay disabled (maintainers publish models by hand). The original license, copyright and acknowledgements are kept.

---

# ASTAROTの名称と識別子（日本語版）

ASTAROT（旧名VRCT-VOX）は[misyaguziya/VRCT](https://github.com/misyaguziya/VRCT)を基にした派生プロジェクトです（MIT）。2026-10-31にGitHubのfork networkから外れましたが、元のライセンスと帰属表示は維持します。上流のVRCTと、上流の作者による別プロジェクト[VRCT-TTS](https://github.com/misyaguziya/VRCT-TTS)の名称は変更しません。

表示名の移行の範囲は[ADR-011](../adr/adr-011-astarot-brand-and-multimodal-accessibility.md)にあり、旧名が出てくる場所は[表示名の棚卸し](astarot-rename-inventory.md)にまとめてあります。

## 表示名

| 対象 | 名称 |
|---|---|
| 製品名と、画面・文書・サイトに出す名前 | `ASTAROT` |
| Tauriの`productName`（0.5.1から。インストーラーの題名、新しく入れるときのインストール先、ショートカット、Windowsのアプリの一覧、実行ファイルの版情報の製品名） | `ASTAROT` |
| 補助ウィンドウのタイトル（0.5.1から） | `ASTAROT VR Panel`、`ASTAROT Control Panel`、`ASTAROT Hexagram`、`ASTAROT Captions Handle` |
| 正式なサブタイトル | `Speech, Translation, Accessibility, Revoicing & OCR Toolkit` |

## 旧名のまま使う名前

次の名前は旧名のままです。リポジトリは0.5.0のリリースのときに`kein5/astarot`へ改名しました（[リポジトリ名の変更手順](repository-rename.md)）。旧名の`kein5/VRCT-VOX`はいま、転送ページと0.5.0のリリースの複製だけを持つ別のリポジトリで、GitHubは旧名から転送しません。ほかの名前は内部識別子として扱い、表示名と一緒には変えません。0.6.0とその後の版で、[ADR-014](../adr/adr-014-internal-identifier-migration.md)のとおりASTAROTの名前へ順に移します（ADR-011のP2）。この文書の表は、それぞれの変更が入るまで今の値を示します。配布物は、インストーラーが名前で探し、updaterは`latest.json`に書いたURLから取ります。

| 対象 | 名称 |
|---|---|
| Pythonバックエンドの実行名（0.4まで。0.5.0の配布物には入らない） | `vrct-vox-sidecar` |

## 識別子と保存先

次の値は設定・データの保存先やOSとの連携に使います。変更すると既存の設定や連携を引き継げなくなるため、変える場合は移行処理を伴わせてください。Rustのコードが使う値は`native/app-identity`に、旧名とASTAROTの名前の組で定義してあります。名前を移すPRは、そこで書く名前を切り替えます。

| 対象 | 値 |
|---|---|
| 配布物 | 0.7.0から`ASTAROT.zip`、`ASTAROT_setup.exe`、`ASTAROT-<version>-linux-x64-release.tar.gz`と同名の`.AppImage`、`.deb`、`.rpm`。0.6.xまでは`VRCT-VOX.zip`、`VRCT-VOX_setup.exe`、`VRCT-VOX-<version>-linux-x64-release.*`（0.5.xまでは`VRCT-VOX_cuda.zip`も、0.4までは`linux-x64-vulkan`か`linux-x64-cpu`）。ビルドが作るインストーラーは0.5.1から`ASTAROT_<version>_x64-setup.exe`で、リリースでは`ASTAROT_setup.exe`の名前で載せる。0.7.xのリリースは、どの配布物も0.6.xまでの名前の写し（中身が同じファイル）と一緒に載せ、0.8.0からは載せない。`latest.json`は新しい名前だけを指す（[旧名の写し](release-candidates.md#旧名の写し)） |
| 本体の実行ファイル | 0.7.0から`astarot`（Windowsは`astarot.exe`）。0.6.xまでは`vrct-vox`（`vrct-vox.exe`）。Cargoの`[[bin]]`と`tauri.conf.json`の`mainBinaryName`で決める（npmとCargoのパッケージ、開発用のPythonのプロジェクト（`pyproject.toml`）も0.6.0より後の版から`astarot`）。Linuxのウィンドウのクラスと`StartupWMClass`はこの名前に従う。Windowsのインストーラーは更新のときに`vrct-vox.exe`を置き換え、自分が作ったショートカットを付け替える（[本体の実行ファイルの名前](../spec/data-and-persistence.md#本体の実行ファイルの名前)） |
| Linuxのパッケージ | 0.7.0から、debとrpmのパッケージ名は`astarot`で、`/opt/astarot`に入り、コマンド`/usr/bin/astarot`、デスクトップエントリー`astarot.desktop`（`Exec`と`StartupWMClass`も`astarot`）、アイコン`astarot.png`を置く。AppImageの中の同梱のファイルは`usr/lib/astarot`、tar.gzは`ASTAROT`に展開する。0.6.xまではどれも`vrct-vox`（tar.gzは`VRCT-VOX`）。新しいパッケージは旧のパッケージ`vrct-vox`を置き換え、0.7.xの間は`/usr/bin/vrct-vox`も同じ実行ファイルを起動する（[Linuxのパッケージの名前](../spec/data-and-persistence.md#linuxのパッケージの名前)） |
| TauriアプリID | 0.7.0から`io.github.kein5.astarot`（0.6.xまでは`io.github.kein5.vrct-vox`）。Tauriのデータのフォルダー、Waylandのportalのアプリ、単一起動の名前がこのIDに従う |
| SteamVRのアプリ | #1384を入れた版から、Windowsだけ。`astarot.exe`の隣のマニフェスト`astarot.vrmanifest`にあるアプリキー`io.github.kein5.astarot`（アプリID）。SteamVRは自動起動の印をキーごとに持つので、一度出した版からはキーを変えない。それより前の版はSteamVRに登録していないので、旧の名前はない（[SteamVRのアプリの一覧](../spec/external-interfaces.md#steamvrのアプリの一覧)） |
| Linuxの設定保存先 | 0.6.0から`$XDG_CONFIG_HOME/astarot`、既定は`~/.config/astarot`。0.5.xの`vrct-vox`は起動の最初に移し、旧名には新しいフォルダーを指すリンクを0.6.xの間残す（[Linuxの保存先の移動](../spec/data-and-persistence.md#linuxの保存先の移動)） |
| Linuxのデータ保存先 | 0.6.0から`$XDG_DATA_HOME/astarot`、既定は`~/.local/share/astarot`。移し方は設定保存先と同じ |
| Linuxのキャッシュ保存先 | なし。0.4までのPythonバックエンドだけが`$XDG_CACHE_HOME/vrct-vox`（既定は`~/.cache/vrct-vox`）を使った |
| 環境変数 | 0.6.0から`ASTAROT_*`。利用者とパッケージ作成者向けの4つ（`ASTAROT_CONFIG_DIR`、`ASTAROT_DATA_DIR`、`ASTAROT_TELEMETRY`、`ASTAROT_OPENVR_API`）は先に読み、なければ0.5.xの`VRCT_*`の名前を読む。旧名は0.6.xの間読む。`ASTAROT_TELEMETRY`と`VRCT_TELEMETRY`は、どちらかが`off`なら送信を止める。開発、試験、ビルド、プロセスの受け渡しの変数（`ASTAROT_VR_PANEL_DIR`、`ASTAROT_LINUX_BUNDLE`、`ASTAROT_TEST_*`など）は、旧名を読まない。`VRCT_CACHE_DIR`などは0.4までのPythonバックエンドだけが読んだ |
| Windowsのインストール先を記録するキー | 0.7.0から`ASTAROT`（`HKCU\Software\kein5\ASTAROT`と、アプリの一覧の`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT`）。0.6.xまでは`VRCT-VOX`。インストーラーは新しいキーを先に読み、なければ旧のキーを読む。新しいキーを書いてから旧のキーを消す（[Windowsのインストール先の移動](../spec/data-and-persistence.md#windowsのインストール先の移動)） |
| Linuxの音声経路と仮想マイク | 0.6.0の次の版から`astarot.managed.*`ノード（仮想マイクの説明は`ASTAROT Managed Virtual Microphone`）、`astarot-managed-*.service`、所有者識別子`astarot-service-v1`、手で置く設定`90-astarot-managed.conf`、一時のストリーム`astarot.source-bridge.*`と`astarot.asr.capture.*`。0.6.0までの`vrct-managed-*.service`は、名前、所有者識別子、中身がどれも中核の書いたものと一致するときだけ止めて消し、新しい名前で作り直す。旧名の接頭辞のノードとストリームは入力の候補から外し、旧名の手で置いた設定（`90-vrct-managed.conf`）を見つけたら自動で作らない。旧名を読むのは新しい名前を出した版の系列の間（`native/app-identity`の`audio_route::READS_LEGACY_NAMES`）。旧のユニットの片付けは期限なしに続ける（`audio_route::RETIRES_LEGACY_UNITS`）（[音声経路の名前の移行](../spec/data-and-persistence.md#linuxの音声経路の名前の移行)） |
| モデル取得の所有マーカー | 0.6.0から`ASTAROT-model-download-v1`を書く。0.5.xが書いた`VRCT-VOX-model-download-v1`も0.6.xの間は受け付ける。0.5.xは自分の値しか読まないので、0.5.xに戻すと0.6.0が残した取得の途中のフォルダーは片付けずに残す |
| APIキー（OSの資格情報ストア） | 0.6.0より後の版から、Windowsは`ASTAROT/<ID>/<項目の名前>`、Linuxは属性`application=astarot`と`astarot-store=<ID>`、ラベル`ASTAROT <項目の名前>`。0.6.0が`VRCT-VOX`の名前で保存したキーは、起動の時に新しい名前へ写して読み戻す。0.6.0の名前で探すのは0.6.xの間。0.6.0の名前の項目は残し、キーを変えても書き換えず、キーを消したときは両方から消す（[APIキーの保存先](../spec/data-and-persistence.md#apiキーの保存先)） |
| Linuxビルド作業領域の所有マーカー | `VRCT-VOX Linux staging v1` |
| Waylandのショートカット登録 | portalのアプリID`io.github.kein5.astarot`、`~/.local/share/applications/io.github.kein5.astarot.desktop`（印は`X-ASTAROT-Generated=true`）。0.6.xまでの`io.github.kein5.vrct-vox.desktop`は、`X-VRCT-VOX-Generated=true`の印があるときだけ消す。ショートカットと画面の共有の許可はアプリIDごとに記録されるので、一度だけ許可し直しになる |

WindowsのNSISテンプレートは上記のレジストリキーから前回のインストール先を読みます。0.5.1からはインストーラーの画面、Windowsのアプリの一覧、ショートカットに`ASTAROT`と出ます。新しく入れるときの既定のインストール先は`%LOCALAPPDATA%\ASTAROT`です。Windowsでは設定とモデルがインストール先に置かれます。0.6.xまでは、0.5.0以前から更新したときのインストール先は元の`%LOCALAPPDATA%\VRCT-VOX`のままでした。0.7.0からのインストーラーは、その場所にあるインストールを更新のあとでフォルダーの名前を変えて`%LOCALAPPDATA%\ASTAROT`へ移し、アプリが保存したパスを次の起動で付け替えます。利用者が選んだ場所は動かしません。`vrct-vox`という名前のショートカットは`ASTAROT`の名前に置き換わります。0.7.0からの本体は`astarot.exe`です。インストーラーは更新のときに`vrct-vox.exe`を置き換え、自分が作ったショートカットを`astarot.exe`に付け替えます。タスクバーやスタートにピン留めした項目と、利用者が作ったショートカットは付け直しになります。

## 内部のコードネーム

内部のクレートのうち、責務の境界がはっきりしているものには、アスタロトの配下とされる悪魔の名前をコードネームとして付けています（[#689](https://github.com/kein5/astarot/issues/689)）。コードネームは補助の名前です。画面、文書、公開するAPIでは、機能を説明する名前を使います。設定のキー、公開するAPI、ファイルのパスは、コードネームのためだけには変えません。名前の階級は史料上の所属で、クレートの依存関係とは関係ありません。階級の木、出典、採用の理由、ほかの候補は#689にあります。ASTAROTの外に置く道具のリポジトリにも、同じ体系の名前を付けています（表のSergulath）。

| コードネーム | 対象 | いま受け持っていること |
|---|---|---|
| Ayperos | `native/core` | 中核。UIとの要求の受け渡し、設定とその移行、起動と終了、各機能の取りまとめ |
| Sargatanas | `native/speech-server` | アプリが動かす推論のサーバー（同梱のspeech.cppと、翻訳のLLMのllama.cpp）の起動、停止、再起動、生存の確認 |
| Loray | `native/transcription` | 音声認識。録音と発話の区切り、クラウドのエンジン、speech.cppでのリアルタイムの認識 |
| Hael | `native/translation` | オンラインの翻訳先（DeepLなど）への要求、読みがな、TranslateGemmaへの要求 |
| Forau | `native/tts` | 読み上げの要求、読み上げの順番、音声の受け渡し |
| Humots | `native/ocr-runtime` | チャット欄の読み取りと、VRChatの画面の取得 |
| Nebiros | `native/ops` | 実行状態の監督。バックエンドの見張り（watchdog）と利用状況の通知。モデルの取得もここにある |
| Nuberus | `native/vr-overlay` | SteamVRのオーバーレイ（字幕のログ、VRパネル、ランチャー） |
| Aglasis | `native/browser-core-bridge` | **試験のホスト**。結合テスト（`tests/integration/`、ADR-017）で、ブラウザに出した画面と中核をつなぐ。試験の道具で、アプリと配布物には入らない。アプリの中の配送（Scirlinの候補）とは別のもの |
| Sergulath | [kein5/sergulath](https://github.com/kein5/sergulath) | **外部リポジトリ**で、ASTAROTのクレートではない。SteamVRのオーバーレイを使うアプリを、実機のヘッドセット（まずSteam Frame）で動かして確かめる道具一式。アプリと配布物には入らない。再帰的頭字語はSergulath's Emulation, Recording, Gauging & Unattended-Launch Automation Testing Harness |

コードネームは、各クレートの`Cargo.toml`の`description`と、`lib.rs`の冒頭（実行ファイルだけのクレートは`main.rs`の冒頭）にも書いてあります。パッケージ名は0.6.0より後の版から、どのクレートも`astarot-`で始まる名前です（`astarot-core`など。0.6.0までは`vrct-core`などで、接頭辞のない`ocr-runtime`、`rvc-runtime`、`app-identity`もあった。ADR-014のPR 12）。アプリのクレートとnpmのパッケージは`astarot`です。コードネームはパッケージ名にせず、文書と説明だけに使います（[#797](https://github.com/kein5/astarot/pull/797)の決定）。フォルダーの名前（`native/core`など）は変えていません。

次の名前は、まだ付けていません。

- **条件を待つ候補**: Scirlin（IPCとイベントの配送。汎用の配送とVRChatのOSCに固有の部分を分けられたら）、Morail（ログ、テレメトリ、診断の情報の秘匿化。秘匿化が独立した責務になったら）。いまは、汎用の配送（UIとの要求の受け渡しは`native/core`、WebSocketのサーバーは`native/adapters`）とVRChatのOSC（`native/adapters`）が1つの境界にまとまっておらず、秘匿化は`native/core`の`log.rs`の中にある。Scirlinが受け持つのはアプリの中の配送で、試験のホストのAglasisとは重ならない。
- **予約**: Surgat（権限の仲介）、Frucissiere（状態の復元と障害からの回復）。
- **予備**: Valefar、Glasyabolas。担当は決めていない。
- **名前のないクレート**: `app-identity`、`audio-routing`、`adapters`、`openvr-client`、`onnx-runtime`、`translate-onnx`、`voice-conversion`、`rvc-runtime`と、Cの補助プログラム。すべてのクレートに名前を付けるわけではない。

## 公開

CIは[ビルドガイド](../readme_build.md)のとおり、試験と配布候補の作成を行います。GitHub Releasesの下書きは[手動の検証ゲート](release-candidates.md)から作成し、保守担当者が確認して公開します。最初の公開版は`v0.1.0-beta.1`（プレリリース）です。版は上流VRCT（3.x）とは別に0.1.0から数えます。自動公開と、CIからのHugging Faceへのアップロードは無効のままです（モデルの公開は保守担当者が手動で行います）。元のライセンス・著作権・謝辞は維持します。
