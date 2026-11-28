---
date: 2026-11-19
status: accepted
era: rust-core
validity: current
implementation_status: partial
implementation_checked: 2026-11-23
implementation_note: 0.6.0 で Linux の保存先、環境変数、モデル取得の所有マーカーを移し、その後に資格情報の名前、クレートとパッケージの名前、Linux の音声経路の名前（#979）を移した（project-rename.md の表）。アプリ ID、Windows のインストール先とレジストリのキー、実行ファイル名、Linux のパッケージ、配布物の名前（手順 4〜8）はまだ旧名のままで、0.7.0 で一緒に出す（2.10 の決定の注記）。
evidence:
  - docs/adr/adr-014-internal-identifier-migration.md
  - docs/voice-stack/project-rename.md
  - src-tauri/tauri.conf.json
  - src-tauri/nsis/template.nsi
  - src-tauri/src/backend_host.rs
  - native/core/src/config/secrets/credential_manager.rs
  - native/core/src/config/secrets/secret_service.rs
  - native/audio-routing/src/pipewire/managed.rs
  - native/app-identity/src/lib.rs
---
# ADR-014: Align internal identifiers with ASTAROT and carry over settings and models

[日本語版](#adr-014-内部識別子を-astarot-にそろえ設定とモデルを引き継ぐ日本語版)

Status: Accepted (2026-11-19). The decision items follow the record of decisions in Issue #635 (2026-11-19). The implementation goes into 0.6.0 and is split into PRs as section 5 describes.
Date: 2026-11-19
Decision owners: the repository maintainers
Related: Issue #635, Issue #535, sections 5 and 6 of [ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md), [ADR-013](adr-013-secret-store.md), [Names and identifiers](../voice-stack/project-rename.md), [Repository rename procedure](../voice-stack/repository-rename.md), [Display name inventory](../voice-stack/astarot-rename-inventory.md), [Core integration](../voice-stack/core-integration.md), PR #629

## 1. Context

### 1.1 The migration so far

- ADR-011 decided to name the product ASTAROT and left the migration of internal identifiers (P2) to a separate ADR (section 5 and item 1 of section 6 of ADR-011).
- Display names moved in 0.5.0. The display names involved in installation (Tauri's `productName`, the installer title, shortcuts and the install location for new installs) moved in 0.5.1 as well (#535).
- The policy was to leave internal identifiers unchanged in 0.5.x. On develop as of 2026-11-19, the app ID, storage locations, environment variables, executable names and release file names are still `vrct-vox`, `VRCT-VOX` and `vrct` ([Names and identifiers](../voice-stack/project-rename.md)).

### 1.2 The configuration this ADR assumes (develop on 2026-11-19)

- From 0.5.0 the backend is only the Rust core (`native/core`). `src-python/` is not in the release files, and it is deleted in 0.6.0 when the move to the core is finished (item 27 of [Core integration](../voice-stack/core-integration.md)).
- `src-tauri/src/backend_host.rs` decides the storage locations.
  - On Windows it is the executable's folder: the install location for the installer version, and the extraction folder for the ZIP version. Settings, logs, downloaded models and `weights/` are all there.
  - The Linux packages (AppImage, deb, rpm, tar.gz) use `$XDG_CONFIG_HOME/vrct-vox` (settings, logs, `downloaded_models/`, `vc_runtimes/`) and `$XDG_DATA_HOME/vrct-vox` (`weights/`, `translation-models/`, `telemetry_state.json`). The folder name is written directly in the code, not built from the app ID.
- `config.json` holds absolute paths to downloaded models (the profiles in `SPEECH_SERVER_SETTINGS`, `rvc_model` and `rvc_index` in `DIRECT_VOICE_SETTINGS`, and others). Moving the storage location breaks these paths.
- The Windows installer reads the previous install location from `HKCU\Software\kein5\VRCT-VOX`. The app appears in the list of apps through `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCT-VOX`. Installs updated from 0.5.0 or earlier are in `%LOCALAPPDATA%\VRCT-VOX`, and installs made fresh with 0.5.1 or later are in `%LOCALAPPDATA%\ASTAROT`.
- The change that keeps API keys in the OS credential store (ADR-013, #575) is on develop, but not in any released version (up to 0.5.2). Only develop builds wrote to the credential store under the `VRCT-VOX` name.
- The URLs of the update check and telemetry endpoints (Workers) are in every shipped version.

### 1.3 Why decide now

0.6.0 aligns the internal identifiers with ASTAROT (#635). Renaming cuts the storage locations, credentials, OS registrations, audio routes and release file names off from the previous version. With the condition that users' settings and models are always carried over, each name needs a decision on whether to change it and how to move it. The decision items were listed in #635, and the maintainers decided them on 2026-11-19. This ADR records those decisions, the migration method and how the implementation is split. In this document, "decision N" refers to decision item N in #635.

## 2. Decision

### 2.1 Properties to keep

1. Do not lose users' settings, downloaded models or API keys. When something cannot be moved, it keeps working at the old location under the old name.
2. Wherever the migration stops, the next launch or the next update can continue it. The migration runs once and does nothing after it has finished.
3. Do not change the settings file format or the IPC and OSC contracts just because a name changes (`AGENTS.md`).
4. Do not turn on the microphone without a user action. Do not download models, send messages or change audio routes either. When the migration rebuilds an audio route, keep the behavior of stop and mute.
5. Migration logs hold only results and reason codes. They do not hold setting values, API keys, text or audio.

### 2.2 Name mapping

The spelling is as follows (decision 1). Paths, packages, executables, and node and unit names use lower-case `astarot`. The environment variable prefix is `ASTAROT_`, and the app ID is `io.github.kein5.astarot`. Names that people read (the credential prefix, labels, descriptions) use `ASTAROT`.

| Item | Current | From 0.6.0 | Decision | How it moves |
|---|---|---|---|---|
| Tauri app ID | `io.github.kein5.vrct-vox` | `io.github.kein5.astarot` | 1 | 2.6 |
| Linux settings folder | `$XDG_CONFIG_HOME/vrct-vox` | `$XDG_CONFIG_HOME/astarot` | 1 | 2.4 |
| Linux data folder | `$XDG_DATA_HOME/vrct-vox` | `$XDG_DATA_HOME/astarot` | 1 | 2.4 |
| Windows install location (including settings and models) | `%LOCALAPPDATA%\VRCT-VOX` (installs updated from 0.5.0 or earlier) | `%LOCALAPPDATA%\ASTAROT` | 2 | 2.5 |
| Windows registry keys | `HKCU\Software\kein5\VRCT-VOX`, `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCT-VOX` | `HKCU\Software\kein5\ASTAROT`, `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT` | 3 | 2.5 |
| Main executable | `vrct-vox`, `vrct-vox.exe` | `astarot`, `astarot.exe` | 4 | 2.5, 2.6 |
| Linux packages | Package name `vrct-vox`, `/opt/vrct-vox`, `/usr/bin/vrct-vox`, `vrct-vox.desktop`, icon `vrct-vox.png`, `usr/lib/vrct-vox` inside the AppImage | `astarot`, `/opt/astarot`, `/usr/bin/astarot`, `astarot.desktop`, `astarot.png`, `usr/lib/astarot` | 4 | 2.7 |
| Helper programs | `vrct-rvc-worker(.exe)`, and on Linux `vrct-voice-gate`, `vrct-source-bridge`, `vrct-asr-capture`, `vrct-screen-capture` | `astarot-*` | 1 | Changed together within the same version. The code that counts GPU memory by process name (`native/core/src/gpu_memory/`) changes with them. `vrct-vc-worker` is used only by the Python path, so it is deleted without being renamed |
| Linux audio routes | Nodes `vrct.managed.*`, descriptions `VRCT Managed ...`, `vrct-managed-{source,tts,vc}.service`, owner `vrct-vox-service-v1`, manually placed configuration `90-vrct-managed.conf`, temporary streams `vrct.source-bridge.*` and others | `astarot.managed.*`, `ASTAROT Managed ...`, `astarot-managed-*.service`, `astarot-service-v1`, `90-astarot-managed.conf`, `astarot.*` | 5 | 2.8 |
| API keys (Windows) | `VRCT-VOX/<store_id>/<entry>` in Credential Manager | `ASTAROT/<store_id>/<entry>` | 1 | 2.9 |
| API keys (Linux) | Secret Service attributes `application=vrct-vox` and `vrct-vox-store`, label `VRCT-VOX <entry>` | `application=astarot`, `astarot-store`, `ASTAROT <entry>` | 1 | 2.9 |
| Wayland portal app id, and the `.desktop` file the app creates | `io.github.kein5.vrct-vox`, marker `X-VRCT-VOX-Generated=true` | `io.github.kein5.astarot`, `X-ASTAROT-Generated=true` | 1 | 2.6 |
| Ownership marker for model downloads | `VRCT-VOX-model-download-v1` | `ASTAROT-model-download-v1` | 1, 9 | Reading accepts both the old and the new value; writing uses the new value |
| Environment variables (for users and packagers) | `VRCT_CONFIG_DIR`, `VRCT_DATA_DIR`, `VRCT_TELEMETRY`, `VRCT_OPENVR_API` | `ASTAROT_*` | 1, 9 | Read the new name first, and the old name if the new one is not set |
| Environment variables (development, tests, builds, passing values between processes) | `VRCT_TELEMETRY_URL`, `VRCT_VOICE_TRACE`, `VRCT_LINUX_BUNDLE`, `VRCT_VR_PANEL_DIR` and others | `ASTAROT_*` | 1 | The old names are not kept; the tools and documents are fixed at the same time. Variables used only by Python, such as `VRCT_CACHE_DIR`, go away with `src-python/` |
| Release files | `VRCT-VOX.zip`, `VRCT-VOX_cuda.zip`, `VRCT-VOX_setup.exe`, `VRCT-VOX-<version>-linux-x64-release.{tar.gz,AppImage,deb,rpm}` | `ASTAROT.zip`, `ASTAROT_cuda.zip`, `ASTAROT_setup.exe`, `ASTAROT-<version>-linux-x64-release.*` | 7 | 2.10 |
| Names visible from outside at run time | `VRCT:<n>` in OSCQuery and mDNS, overlay keys `VRCT0` to `VRCT4` and others, the title of the OBS page, the User-Agent, lines in `startup.log`, thread names, `$XDG_RUNTIME_DIR/vrct-vox`, the tray ID | ASTAROT's names | 1 | They are not saved, so they change directly. The telemetry User-Agent changes only after confirming that the receiving side does not filter on the User-Agent |
| CI artifact names, ownership marker of the build workspace | `VRCT-VOX-*-candidate`, `VRCT-VOX Linux staging v1` | `ASTAROT-*` | 1 | Used only within development. If a workflow file is renamed, fix the provenance check (`tools/prepare_release.py`) in the same change |
| Names used only in code | Cargo's `vrct-*`, npm's `vrct-vox`, UI file names and hooks, locale keys such as `config_page.about_vrct.*` | ASTAROT's names | 10 | 2.12 |

`VRCT-VOX_cuda.zip` is the name used until the CPU and CUDA versions merge into one (#288).

### 2.3 What does not change

- The names and URLs of the update check and telemetry Workers (`vrct-vox-updates` and `vrct-vox-telemetry`, on workers.dev). Shipped versions contain the URLs, so the old Workers cannot be stopped (decision 6).
- The chat box detection model ID `vrct-vox-chatbox-detector`, its folder name and the Hugging Face repository `kein5/vrct-vox-chatbox-detector`. Changing them would mean that downloaded models are not found, and users would have to download them again (decision 8).
- Setting keys and value formats, including `HOTKEYS.toggle_vrct_visibility`. Changing this key would make the validation discard the whole hotkey table and reset every hotkey to its default.
- IPC endpoints and values (such as `vrct-vox-chatbox` for chat box detection) and OSC addresses.
- The DPAPI entropy `VRCT-VOX secrets v1` that encrypts `secrets.json`. Changing it would make saved files impossible to decrypt.
- The updater signing key and the format of `latest.json` (the platform keys `windows-x86_64` and `linux-x86_64`).
- The `publisher` of the Windows installer (`kein5`). It becomes the parent of the registry keys (`Software\kein5`).
- Past releases, tags and the past sections of `CHANGELOG.md`.

### 2.4 How data is carried over: common steps and Linux

The common steps are these.

1. The migration runs before the core starts and reads the settings. The result is recorded in a separate file in the new storage location, and from then on the migration does nothing.
2. Before moving anything, confirm that the old version is not running. Changing the app ID also changes the names used for the single-instance check (the Windows mutex `<id>-sim` and the Linux D-Bus name `<id>.SingleInstance`). Left as it is, the old and new versions could then run at the same time, so the old names are checked as well. If the old version is running, nothing is moved.
3. After moving the storage location, rewrite the absolute paths in its files (`config.json`, `user_models.json` and others) that point under the old storage location so that they point to the same place under the new one. Other paths (such as models the user put outside the storage location) do not change. Before the rewrite, the existing mechanism keeps a copy of `config.json` (`config.json.before-migration-*`). On Linux, the core knows the old storage location because the core did the move. On Windows, the installer passes it on (2.5).
4. When the move fails, start with the old location as it is (fallback), and try again at the next launch. The user is not asked to do anything.

On Linux the move goes as follows.

1. If environment variables set the storage locations (`ASTAROT_CONFIG_DIR`, `ASTAROT_DATA_DIR`, or the old names `VRCT_CONFIG_DIR` and `VRCT_DATA_DIR`), do nothing.
2. If the new folder does not exist and the old one does, move it to the new name with `rename`. Both are in the same parent folder, so even large models move without being copied.
3. Put a symbolic link at the old location that points to the new folder. Going back to 0.5.x then reads the same settings and models, and external scripts that use the old path keep working. The link stays for the whole of 0.6.x (decision 9).
4. When the move fails (a different file system, no permission, the old version running), use the old folder.
5. When both exist, use the new one and leave the old one untouched. However, if it cannot be confirmed that this app created the folder with the new name (for example, when it belongs to another app with the same name), use the old folder.

The settings folder and the data folder go through the same steps.

### 2.5 How data is carried over: Windows (decisions 2, 3 and 4)

Decision 2 (move the install location) and decision 3 (change the registry keys) are the opposite of the options #635 recommended (do not move, do not change). In the confirmation comment on #635 (2026-11-19), the maintainers confirmed them as understood here, that is, going ahead together with the migration code. Both go in together with the migration below. The folder or key names are never changed on their own, without the migration. On Windows the settings and models are in the install location, so moving the install location also moves the user's data.

From 0.6.0, the installer behaves as follows, both when it is run from its own window and when the in-app update runs it with `/P /UPDATE`.

1. Read the previous install location from the new key (`Software\kein5\ASTAROT`). If it is not there, read it from the old key (`Software\kein5\VRCT-VOX`). The `Installer Language` value in the old key is carried over as well.
2. Only when the previous install location is the old default (`%LOCALAPPDATA%\VRCT-VOX`), move it to `%LOCALAPPDATA%\ASTAROT`. Other locations that the user chose are not moved. Installs made fresh with 0.5.1 or later are already in `%LOCALAPPDATA%\ASTAROT`, so only the keys move.
3. Before moving, stop every process started from the install location (the main executable and the helper programs, under both the old and the new names). If the working folder of a previous update (`.upd`) is left over, clean it up with the existing steps.
4. Move the folder by renaming it (moving it within the same drive). Do not copy it and then delete the original. If the destination already exists and is not empty, or if the rename fails (for example, because another program has a file open), install into the original location without moving. The next update tries again.
5. After the move, pass the old storage path to the app in a file that is read once, in the same form as `installer_language.txt`, which the installer uses to pass the UI language. At the next launch, the core rewrites the paths as step 3 of 2.4 describes, and deletes the file.
6. Wherever the installer stops, the location that the registry key points to must hold a launchable app and its settings. Delete the old keys (`Software\kein5\VRCT-VOX` and `Uninstall\VRCT-VOX`) only after the new keys (the install location, and `Uninstall\ASTAROT` for the list of apps) are written. The list of apps must not show two entries.
7. Of the shortcuts the installer created (Start menu and desktop), repoint only those that still exist to the executable at its new location and name. Do not recreate the ones the user deleted (updates already handle them this way). Items pinned to the taskbar or Start cannot be re-pinned by a program, so the release notes explain this.
8. When the app restarts after an update (`/R`), start the executable at its new location and name.
9. Do not put a link or junction at the old location. Deletion code that does not expect a link, such as the uninstaller of an old version, could touch the data the link points to.

From 0.6.0, the uninstaller deletes both the old and the new keys. When "Delete the application data" is selected, it also deletes the WebView folders for both app IDs (`%LOCALAPPDATA%\io.github.kein5.vrct-vox` and `%LOCALAPPDATA%\io.github.kein5.astarot`).

The ZIP version runs in its extraction folder, so its storage location does not change. Only the executable name changes, and shortcuts the user made have to be set up again.

Moving the install location and renaming the executable (decision 4) change the path of the main executable. Windows Firewall records permission per executable path, so its prompt appears again at the first launch after the update. Cancelling it creates a blocking rule, and OSCQuery (mDNS) no longer gets through. Depending on the Windows version, microphone permission may also be asked again per executable (not verified). So that the prompt appears only once, the install location move and the executable rename ship in the same version. After the fix in #442, the Windows app does not receive mDNS traffic, so no firewall prompt appears (`docs/voice-stack/local-setup-windows.md`). The release notes tell users to pin their pinned items again. On the firewall, they only warn people who cancelled the prompt in an earlier version and got a blocking rule, and they do not tell users to choose to allow (#901).

### 2.6 App ID and Linux desktop integration

- Change the app ID to `io.github.kein5.astarot`. The UI saves nothing in the WebView, so WebView data is not moved.
- Register with the Wayland portal under the new app id, and create a `.desktop` file for the new app id. Delete the old app id's `.desktop` file only when it has the old marker (`X-VRCT-VOX-Generated=true`). Files without the marker are left alone as the user's.
- The desktop environment stores global shortcut and screen sharing permissions per app id. With the new app id, users are expected to grant them once more (not verified on KDE or GNOME). The screen sharing restore token (`OCR_PORTAL_RESTORE_TOKEN`) stops working, so the user picks the window once more.
- On Linux, WM_CLASS and `StartupWMClass` come from the executable name, so they change together with it.

### 2.7 Linux packages (decision 4)

- Name the package `astarot`, and install it to `/opt/astarot` and `/usr/bin/astarot`. There are no apt or dnf repositories; users install from a file. So that the new package replaces the old one, the deb gets `Conflicts`, `Replaces` and `Provides` (all `vrct-vox`), and the rpm gets `Obsoletes` and `Provides` (`vrct-vox`).
- The file that marks an install by a package manager (`package-manager`) also goes to the new location. The places where the core looks for bundled files (`/opt/vrct-vox` and `usr/lib/vrct-vox` in `native/core/src/resources.rs`) change with it.
- Give the `.desktop` file, the icon and `StartupWMClass` the new name. The file name of the AppImage is the user's choice, and the in-app update replaces that file.

### 2.8 Linux audio routes (decision 5)

Rename the nodes, descriptions, systemd user units, owner marker, manually placed configuration file and temporary streams. The description `VRCT Managed Virtual Microphone` is also the name shown in microphone lists such as VRChat's.

The current core has no code to stop or delete units. Renaming alone would leave the old units running. There would be two virtual microphones, and the microphone selected in VRChat would stay on the silent one. So the following migration goes in.

1. Stop, disable and delete the units with the old names. Only units whose name, owner marker and content all match what the core created are affected. Units that do not match are left as the user's and reported with the existing `managed_setup_conflict`.
2. Look for manually placed configuration under both the old and the new names, and when one is found, do not create anything automatically.
3. Recreate everything under the new names. The behavior of stop and mute does not change.
4. The microphone selected in VRChat comes unselected, so show a one-time notice asking the user to select it again (`locales/en.yml` and `locales/ja.yml`).

For the whole of 0.6.x, the code that removes temporary streams from the input candidates by name prefix removes both the old and the new prefixes.

### 2.9 API keys

- Use new names in Credential Manager and Secret Service. At launch, copy the entries under the old name to the new name, and count as moved only those that read back (the same steps as 4.3 of ADR-013).
- Keep the entries under the old name for the whole of 0.6.x (decision 9). When a key is deleted in 0.6.x, its entry under the old name is deleted too.
- As 1.2 says, only develop builds have entries under the old name. The entries in `secrets.json` from 0.5.x move straight to the new name through the ADR-013 migration. So that no more environments end up with entries under the old name, this change goes in before the first 0.6.0 beta.
- The `store_id` in `secrets.json` moves together with the storage location, so the same ID is used under the new name.

### 2.10 Release files (decision 7)

- Rename the release files. `latest.json` points only to the new names. The in-app update uses the URL written in `latest.json`, so updates still arrive after the rename. The installer downloads only the ZIP of its own version, so installers of old versions are not affected either.
- 0.6.x releases also carry copies of the renamed files under their old names (files with the same content). This keeps links posted elsewhere, such as `releases/latest/download/VRCT-VOX_setup.exe`, working for the whole of 0.6.x. The copies also get `.sha256` files and are listed in `SHA256SUMS`. From 0.7.0 they are no longer included.
- The release candidate check (`tools/release_candidate.py`) confirms that both the new names and the copies are present.

> **Decision note** (2026-11-23, PR #1006): It was decided that steps 4 to 8 of the rename (the app ID, the install location and keys, the executable name, the Linux packages and the release file names) ship together in 0.7.0 rather than in 0.6.0. So the old-name copies go into the 0.7.x releases instead of the "0.6.x releases" above, and are no longer included from 0.8.0 (the statement in 4.2 that the release files grow by the old-name copies during 0.6.x also becomes 0.7.x). Copies are made for every release file, including the Linux files whose names contain the version. When `/VERSION` installs a version up to 0.6.x, the releases up to 0.6.x have no ZIP under the new name, so the installer downloads `VRCT-VOX.zip` under the old name. The paragraphs above are kept as the record of the time they were written.

### 2.11 How long the old names are read (decision 9)

The old environment variable names, the old value of the ownership marker, the links at the old Linux paths, the credential entries under the old name and the old prefixes of temporary streams are read (kept) for the whole of 0.6.x. When to remove them is decided in the 0.7.0 plan.

> **Decision note** (2026-11-23, PR #979): 0.6.0 was released without these steps, so the old names of the Linux audio routes (2.8) are read for the release series that ships the new names (0.7.x, if they ship in 0.7.0), rather than "for the whole of 0.6.x" above. Reading the old names (removing nodes and streams with the old prefixes from the input candidates, finding manually placed configuration under the old name, reporting old routes that are not the core's) and cleaning up the old units (stopping and deleting them only when their name, owner marker and content all match what the core up to 0.6.0 wrote) use separate constants, and the cleanup stays with no end date. This keeps environments that skipped versions when updating from being left with an old virtual microphone. The paragraph above is kept as the record of the time it was written.

### 2.12 Names used only in code (decision 10)

Cargo and npm package names, UI file names and hooks, locale keys and test fixtures are renamed in a mechanical PR, after `src-python/` is deleted and the 0.6.0 feature PRs are all in. Users do not see them. If this does not make it into 0.6.0, it moves to 0.6.x.

## 3. Alternatives considered

| Item | Option | Why it was not chosen |
|---|---|---|
| Storage location | Keep reading under the old names (fallback only) | Existing environments would keep the old names forever, which does not meet the aim of aligning the identifiers. It is used only as the way out when the move fails |
| Storage location | Copy to the new location and keep the old one as well | Models can take several GB, so disk use doubles. The contents of the two locations drift apart |
| Windows install location | Do not move it (recommended in #635) | The maintainers decided to move it (decision 2). Not moving it leaves a folder with the old name |
| Windows registry keys | Do not change them (recommended in #635) | The maintainers decided to change them (decision 3). Not changing them leaves keys with the old name |
| Old Windows location | Put a junction there | Step 9 of 2.5 |
| Path rewriting | Search for and rewrite paths whose ends match, including those outside the storage location | That would mean rewriting by guesswork. The source of the move is known, so only paths under it are rewritten |
| Worker | Add a Worker with the new name | The old Worker cannot be stopped, so both would have to be kept running (decision 6) |
| Release files | Do not rename them | Decision 7. The old-name copies keep external links working for the whole of 0.6.x |
| Audio routes | Do not rename them | Decision 5. The description is visible to users |

## 4. Consequences

### 4.1 Gains

- From 0.6.0, the names of the storage locations, OS registrations, executables, packages, release files and audio routes all match ASTAROT. Old names remain only during the period in which they are read (2.11) and in what was decided not to change (2.3).
- Windows environments in use since 0.5.0 or earlier end up in `%LOCALAPPDATA%\ASTAROT`, the same as fresh installs.

### 4.2 Costs and risks

- On Windows, the firewall prompt appears at the first launch after the update (2.5). From the version that includes the #442 fix, it does not appear. Pinned items and shortcuts the user made have to be set up again. The old firewall rules remain (removing them needs administrator rights).
- The Windows installer moves a folder that holds data. Tests confirm that it carries on at the original location when the move fails, and that the move can resume after stopping partway (6).
- On Linux, users grant the global shortcut and screen sharing permissions once more. In VRChat, they select the microphone again.
- Going back from 0.6.0 to 0.5.x has these results.
  - On Linux, 0.5.x reads the same settings and models from the old path through the link.
  - On Windows, the install location has moved to `%LOCALAPPDATA%\ASTAROT`. The 0.5.1 and 0.5.2 installers install to the default `%LOCALAPPDATA%\ASTAROT` when the old key is missing, so the settings and models are expected to be visible. However, they write the key with the old name, so the list of apps may show two entries (not verified). The 0.5.0 installer makes a fresh install in `%LOCALAPPDATA%\VRCT-VOX`, so the settings are not visible.
  - 0.5.x does not use the credential store, so API keys have to be entered again. This follows 10.2 of ADR-013 and happens regardless of P2.
  - Versions from before PR #629 drop setting keys they do not know when they save.
  - In every case, the settings and model files are not deleted.
- For the whole of 0.6.x, each release carries more files because of the old-name copies (the Linux files included).
- PRs that rewrite names tend to conflict with PRs in progress at the same time. PR 1, which gathers the name definitions in one place, goes in early, and the mechanical rename (PR 12) comes last.

### 4.3 Documents

- The table in `docs/voice-stack/project-rename.md` shows the current values until the implementation is in. Each PR updates the rows it changes to the new values and the period in which the old names are read.
- The front matter of ADR-011 (the implementation state of P2) is updated in a separate PR that changes only metadata (step 4 of "Writing a new ADR" in the [index](README.md)).

## 5. Implementation plan (how the PRs are split)

| PR | Content | Needs first | Main checks |
|---|---|---|---|
| 0 | This ADR | None | `tools/adr_catalog.py --check` |
| 1 | Gather the name definitions in one place. Environment variables and ownership markers are read under both the old and the new names, and still written under the old ones. Behavior does not change | PR 0 | Tests of the core and of each crate |
| 2 | The storage migration mechanism (core): checking whether the old version is running, rewriting absolute paths, moving the Linux settings and data folders, recording the migration (2.4) | PR 1 | Tests that imitate the 0.5.x layout (Linux and Windows CI). AppImage, deb and rpm on real machines |
| 3 | Migrating the API key names (2.9) | PR 1 | Credential tests (Windows and Linux CI) |
| 4 | App ID and Linux desktop integration (2.6): single instance, WebView, portal, `.desktop` | PR 2 | Granting permissions again on KDE and GNOME. Running at the same time as the old version |
| 5 | Migrating the Windows install location and registry keys (steps 1 to 7 and 9 of 2.5, and the uninstaller). Code in the core that receives the old storage location and rewrites the paths | PR 2, PR 4 | Installer tests (when the move fails, when it stops partway). On real machines: updating from 0.5.0, 0.5.1 and 0.5.2 (installer and in-app update), a fresh install, a location the user chose |
| 6 | The main executable name (2.5, 2.6). Stop the processes under both the old and the new names, delete the old exe, repoint the shortcuts and start the new exe with `/R`. Also change the Linux `.desktop` file and `StartupWMClass` | PR 5 | Installer tests. Updating and the firewall prompt on real machines |
| 7 | Linux packages (2.7) | PR 6 | `apt install ./` and `dnf install ./` replace the old package |
| 8 | Release file names, old-name copies and release tools (2.10): `release.yml`, `build-linux.yml`, `tools/release_candidate.py`, `tools/updater_manifest.py`, `tools/prepare_release.py`, the name of the ZIP that NSIS downloads, `utils/zip.py`, the download check on the site | PR 6, PR 7 | Building a release candidate and checking `latest.json` |
| 9 | Linux audio routes (2.8) | PR 1 | PipeWire and VRChat on real machines. Stop and mute behavior |
| 10 | Helper programs and names visible from outside at run time (2.2). Deleting `vrct-vc-worker` | PR 1 | Tests of each crate. VRChat can see the app through OSCQuery |
| 11 | Documents and the manual (the spec, the build and release procedures, the site in English and Japanese, the environment variables on the privacy page, the rest of `project-rename.md`) | PRs 2 to 10 | `tools/spec_catalog.py --check`, a site build |
| 12 | Names used only in code (2.12) | Deleting `src-python/`, the 0.6.0 feature PRs | The full test suite |

The dependencies run PR 0 → PR 1 → PRs 2, 3, 9 and 10 (these may proceed in parallel), and PR 2 → PR 4 → PR 5 → PR 6 → PR 7 → PR 8. PR 11 collects the document changes that PRs 2 to 10 did not finish. PR 12 comes last.

The relation to releases is as follows.

- Every PR leaves the code in a state that can ship on its own. Even if a beta is built partway through, settings and models are not lost.
- PR 3 goes in before the first 0.6.0 beta (2.9).
- PR 5 and PR 6 ship in the same version, so that the firewall prompt appears only once (2.5). PR 7 and PR 8 also ship in the same version as PR 6, so that the executable, package and release file names match.
- The update check and telemetry Workers do not change, so there is no work outside the repository.

The following points changed from the plan in #635.

- Decisions 2 and 3 mean that the Windows install location and keys are moved. So PR 5 of #635 (installer and executable name) was split into PR 5 (install location and keys) and PR 6 (executable name). The numbers after it each went up by one.
- Path rewriting is needed on Windows too. So PR 2 grew from a Linux-only migration into the core's migration mechanism.
- PR 0 does not rewrite the table in `project-rename.md`; each PR fixes it (4.3).

## 6. Verification / Acceptance criteria

| Aspect | What to confirm | How |
|---|---|---|
| Storage migration (Linux) | Starting from the 0.5.x layout (`~/.config/vrct-vox`, `~/.local/share/vrct-vox`, a `config.json` with absolute paths, `downloaded_models/` with `owner.json`, `secrets.json`), the folders move and the paths are rewritten. The second launch does nothing. When the move fails, the app runs at the old location. When the old version is running, nothing is moved | Core tests (fake HOME). AppImage, deb and rpm on real machines |
| Windows install location and keys | In environments updated from 0.5.0 or earlier, the folder and keys move and the list of apps shows one entry. Settings, models and API keys are carried over. A location the user chose does not move. When the move fails and when it stops partway, the app starts at the location the key points to | NSIS tests (extending the staged update tests in `tests/devtools/`). On real machines from 0.5.0, 0.5.1 and 0.5.2, with both the installer and the in-app update |
| Path rewriting | Only paths under the old storage location change; other paths (models the user put outside the storage location) do not | Core tests |
| API keys | Entries under the old name move to the new name, and the old entries stay for the whole of 0.6.x. Deleting a key removes it from both | Tests with a fake store. Tests with the real store in Windows and Linux CI |
| Audio routes | The old units stop and are deleted, and only one virtual microphone, under the new name, remains. The user's units are not touched. Stop and mute behave as before | Tests in `native/audio-routing`. PipeWire and VRChat on real machines |
| Desktop integration | The app registers under the new app id, and only the old generated files are deleted. Granting the global shortcut and screen sharing permissions again is needed only once | KDE and GNOME on real machines |
| Packages | The old package is replaced, and the two are not installed side by side | deb and rpm test environments |
| Release files | The new names and the old-name copies are all present, and `latest.json` points to the new names. The in-app update of 0.5.x moves up to 0.6.0 | The release candidate check. Checking the update in a beta |
| Going back | Going back to 0.5.x does not delete the settings or model files. What the user sees is as described in 4.2 | Real machines (in a beta) |
| Logs | Migration logs contain no setting values, keys, text or audio | Tests check the output |

VR is covered by the existing fake OpenVR. Anything that cannot be confirmed on both OSes is marked "not verified" in the PR, confirmed during the release candidate check, and only then goes into the stable release (the same handling as section 7 of ADR-013).

## 7. Revisit triggers

- When many Windows environments cannot move the install location, and many users keep running at the old location
- When the app is published to a repository such as apt, dnf, AUR or winget (review the package name and how the old names are handled)
- When the update check or telemetry endpoints move to a custom domain (review decision 6)
- When the 0.7.0 plan ends the period in which the old names are read (2.11)

## 8. Open questions

1. How far to support going back to 0.5.x. For now, the only decision is that the settings and model files are not deleted (4.2). Whether the release notes explain how to go back is decided after checking in a beta.
2. Whether the Linux package carries a compatibility link `/usr/bin/vrct-vox` during 0.6.x only. Decided in PR 7.
3. Whether to delete the WebView folder for the old app ID that remains on Linux (`~/.local/share/io.github.kein5.vrct-vox`). Decided in PR 4.
4. When to change the telemetry User-Agent. It changes after confirming that the receiving side does not filter on the User-Agent (PR 10).

---

# ADR-014: 内部識別子を ASTAROT にそろえ、設定とモデルを引き継ぐ（日本語版）

Status: 採用（2026-11-19）。判断の項目は Issue #635 の決定の記録（2026-11-19）のとおりである。実装は 0.6.0 で行い、5 のとおり PR に分ける。
Date: 2026-11-19
Decision owners: リポジトリの保守担当者
Related: Issue #635、Issue #535、[ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md) の 5 と 6、[ADR-013](adr-013-secret-store.md)、[名称と識別子](../voice-stack/project-rename.md)、[リポジトリ名の変更手順](../voice-stack/repository-rename.md)、[表示名の棚卸し](../voice-stack/astarot-rename-inventory.md)、[中核の統合](../voice-stack/core-integration.md)、PR #629

## 1. Context（背景）

### 1.1 これまでの移行

- ADR-011 は製品の名前を ASTAROT にすると決め、内部識別子の移行（P2）は別の ADR で決めることにした（ADR-011 の 5 と、6 の 1）。
- 表示名は 0.5.0 で移した。インストールに関わる表示名（Tauri の `productName`、インストーラーの題名、ショートカット、新しく入れるときのインストール先）も 0.5.1 で移した（#535）。
- 内部識別子は 0.5.x では変えない方針だった。2026-11-19 の develop でも、アプリ ID、保存先、環境変数、実行ファイル名、配布物の名前は `vrct-vox`、`VRCT-VOX`、`vrct` のままである（[名称と識別子](../voice-stack/project-rename.md)）。

### 1.2 前提にした構成（2026-11-19 の develop）

- 0.5.0 からバックエンドは Rust の中核（`native/core`）だけである。`src-python/` は配布物に入らず、0.6.0 で中核への移行が終わったときに消す（[中核の統合](../voice-stack/core-integration.md)の 27）。
- 保存先は `src-tauri/src/backend_host.rs` で決まる。
  - Windows は実行ファイルのフォルダーである。インストーラー版はインストール先、ZIP 版は展開先になる。設定、ログ、ダウンロードしたモデル、`weights/` はすべてここにある。
  - Linux のパッケージ（AppImage、deb、rpm、tar.gz）は、`$XDG_CONFIG_HOME/vrct-vox`（設定、ログ、`downloaded_models/`、`vc_runtimes/`）と `$XDG_DATA_HOME/vrct-vox`（`weights/`、`translation-models/`、`telemetry_state.json`）である。フォルダー名はアプリ ID から作らず、コードに直に書いてある。
- `config.json` にはダウンロードしたモデルの絶対パスが入る（`SPEECH_SERVER_SETTINGS` のプロファイル、`DIRECT_VOICE_SETTINGS` の `rvc_model` と `rvc_index` など）。保存先を動かすと、このパスが切れる。
- Windows のインストーラーは `HKCU\Software\kein5\VRCT-VOX` から前のインストール先を読む。アプリの一覧には `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCT-VOX` で載る。0.5.0 以前から更新した環境のインストール先は `%LOCALAPPDATA%\VRCT-VOX` で、0.5.1 以降に新しく入れた環境は `%LOCALAPPDATA%\ASTAROT` である。
- API キーを OS の資格情報ストアに置く変更（ADR-013、#575）は develop に入っているが、リリースした版（0.5.2 まで）には入っていない。資格情報ストアに `VRCT-VOX` の名前で書いたのは、develop のビルドだけである。
- 更新確認とテレメトリの送信先（Worker）の URL は、出荷したすべての版に入っている。

### 1.3 いま決める理由

0.6.0 で内部識別子を ASTAROT にそろえる（#635）。名前を変えると、保存先、資格情報、OS への登録、音声経路、配布物の名前が前の版から切れる。利用者の設定とモデルを必ず引き継ぐことを条件に、名前ごとに変えるかどうかと移し方を決める必要がある。判断の項目は #635 に挙げ、保守担当者が 2026-11-19 に決めた。この ADR はその決定と、移行の方式と、実装の分け方を記録する。本文の「判断 N」は #635 の判断項目の番号である。

## 2. Decision（決定）

### 2.1 守る性質

1. 利用者の設定、ダウンロードしたモデル、API キーを失わない。移せないときは、旧の場所と旧の名前のまま動き続ける。
2. どこで止まっても、次の起動か次の更新で続きから移せる。移行は一度だけ行い、済んだあとは何もしない。
3. 設定のファイルの形式と、IPC と OSC の契約は、名前を変えるという理由だけでは変えない（`AGENTS.md`）。
4. 利用者の操作なしにマイクを有効にしない。モデルの取得、メッセージの送信、音声経路の変更もしない。移行で音声経路を作り直すときも、停止とミュートの振る舞いを保つ。
5. 移行のログには結果と理由のコードだけを書く。設定の値、API キー、テキスト、音声は書かない。

### 2.2 名前の対応

綴りは次のとおりにする（判断 1）。パス、パッケージ、実行ファイル、ノードとユニットの名前は小文字の `astarot` にする。環境変数の接頭辞は `ASTAROT_`、アプリ ID は `io.github.kein5.astarot` にする。人が読む名前（資格情報の接頭辞、ラベル、説明）は `ASTAROT` にする。

| 対象 | 現行 | 0.6.0 から | 判断 | 移し方 |
|---|---|---|---|---|
| Tauri のアプリ ID | `io.github.kein5.vrct-vox` | `io.github.kein5.astarot` | 1 | 2.6 |
| Linux の設定フォルダー | `$XDG_CONFIG_HOME/vrct-vox` | `$XDG_CONFIG_HOME/astarot` | 1 | 2.4 |
| Linux のデータフォルダー | `$XDG_DATA_HOME/vrct-vox` | `$XDG_DATA_HOME/astarot` | 1 | 2.4 |
| Windows のインストール先（設定とモデルを含む） | `%LOCALAPPDATA%\VRCT-VOX`（0.5.0 以前から更新した環境） | `%LOCALAPPDATA%\ASTAROT` | 2 | 2.5 |
| Windows のレジストリのキー | `HKCU\Software\kein5\VRCT-VOX`、`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCT-VOX` | `HKCU\Software\kein5\ASTAROT`、`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT` | 3 | 2.5 |
| 本体の実行ファイル | `vrct-vox`、`vrct-vox.exe` | `astarot`、`astarot.exe` | 4 | 2.5、2.6 |
| Linux のパッケージ | パッケージ名 `vrct-vox`、`/opt/vrct-vox`、`/usr/bin/vrct-vox`、`vrct-vox.desktop`、アイコン `vrct-vox.png`、AppImage の中の `usr/lib/vrct-vox` | `astarot`、`/opt/astarot`、`/usr/bin/astarot`、`astarot.desktop`、`astarot.png`、`usr/lib/astarot` | 4 | 2.7 |
| 補助プログラム | `vrct-rvc-worker(.exe)`、Linux の `vrct-voice-gate`・`vrct-source-bridge`・`vrct-asr-capture`・`vrct-screen-capture` | `astarot-*` | 1 | 同じ版の中で一緒に変える。GPU のメモリをプロセス名で数える処理（`native/core/src/gpu_memory/`）も合わせる。`vrct-vc-worker` は Python の経路だけが使うので、名前を変えずに消す |
| Linux の音声経路 | ノード `vrct.managed.*`、説明 `VRCT Managed ...`、`vrct-managed-{source,tts,vc}.service`、所有者 `vrct-vox-service-v1`、手で置いた設定 `90-vrct-managed.conf`、一時のストリーム `vrct.source-bridge.*` など | `astarot.managed.*`、`ASTAROT Managed ...`、`astarot-managed-*.service`、`astarot-service-v1`、`90-astarot-managed.conf`、`astarot.*` | 5 | 2.8 |
| API キー（Windows） | 資格情報マネージャーの `VRCT-VOX/<store_id>/<entry>` | `ASTAROT/<store_id>/<entry>` | 1 | 2.9 |
| API キー（Linux） | Secret Service の属性 `application=vrct-vox` と `vrct-vox-store`、ラベル `VRCT-VOX <entry>` | `application=astarot`、`astarot-store`、`ASTAROT <entry>` | 1 | 2.9 |
| Wayland の portal の app id と、アプリが作る `.desktop` | `io.github.kein5.vrct-vox`、マーカー `X-VRCT-VOX-Generated=true` | `io.github.kein5.astarot`、`X-ASTAROT-Generated=true` | 1 | 2.6 |
| モデル取得の所有マーカー | `VRCT-VOX-model-download-v1` | `ASTAROT-model-download-v1` | 1、9 | 読むときは新旧どちらも受け付け、書くのは新しい値にする |
| 環境変数（利用者とパッケージ作成者向け） | `VRCT_CONFIG_DIR`、`VRCT_DATA_DIR`、`VRCT_TELEMETRY`、`VRCT_OPENVR_API` | `ASTAROT_*` | 1、9 | 新しい名前を先に読み、なければ旧名を読む |
| 環境変数（開発、試験、ビルド、プロセスの間の受け渡し） | `VRCT_TELEMETRY_URL`、`VRCT_VOICE_TRACE`、`VRCT_LINUX_BUNDLE`、`VRCT_VR_PANEL_DIR` など | `ASTAROT_*` | 1 | 旧名は残さず、道具と文書を一緒に直す。Python だけが使う `VRCT_CACHE_DIR` などは `src-python/` と一緒に消える |
| 配布物 | `VRCT-VOX.zip`、`VRCT-VOX_cuda.zip`、`VRCT-VOX_setup.exe`、`VRCT-VOX-<version>-linux-x64-release.{tar.gz,AppImage,deb,rpm}` | `ASTAROT.zip`、`ASTAROT_cuda.zip`、`ASTAROT_setup.exe`、`ASTAROT-<version>-linux-x64-release.*` | 7 | 2.10 |
| 実行時に外から見える名前 | OSCQuery と mDNS の `VRCT:<n>`、オーバーレイのキー `VRCT0`〜`VRCT4` など、OBS のページの題名、User-Agent、`startup.log` の行、スレッド名、`$XDG_RUNTIME_DIR/vrct-vox`、トレイの ID | ASTAROT の名前 | 1 | 保存されないので、そのまま変える。テレメトリの User-Agent は、受け取る側が User-Agent で絞っていないことを確かめてから変える |
| CI の成果物の名前、ビルド作業領域の所有マーカー | `VRCT-VOX-*-candidate`、`VRCT-VOX Linux staging v1` | `ASTAROT-*` | 1 | 開発の中だけで使う。ワークフローのファイル名を変えるなら、来歴の検査（`tools/prepare_release.py`）も一緒に直す |
| コードの中だけの名前 | Cargo の `vrct-*`、npm の `vrct-vox`、UI のファイル名とフック、ロケールのキー `config_page.about_vrct.*` など | ASTAROT の名前 | 10 | 2.12 |

`VRCT-VOX_cuda.zip` は、CPU 版と CUDA 版が 1 つにまとまるまでの名前である（#288）。

### 2.3 変えないもの

- 更新確認とテレメトリの Worker の名前と URL（`vrct-vox-updates` と `vrct-vox-telemetry`、workers.dev）。出荷した版に URL が入っているので、旧の Worker は止められない（判断 6）。
- チャット欄検出モデルの ID `vrct-vox-chatbox-detector`、そのフォルダー名、Hugging Face のリポジトリ `kein5/vrct-vox-chatbox-detector`。変えると取得済みのモデルが見つからず、取り直しになる（判断 8）。
- 設定のキーと値の形式。`HOTKEYS.toggle_vrct_visibility` も含む。このキーを変えると、検査がホットキーの表を丸ごと捨てて、すべて既定に戻る。
- IPC のエンドポイントと値（チャット欄検出の `vrct-vox-chatbox` など）と、OSC のアドレス。
- `secrets.json` を暗号化する DPAPI のエントロピー `VRCT-VOX secrets v1`。変えると、保存済みのファイルを復号できなくなる。
- updater の署名鍵と、`latest.json` の形式（プラットフォームのキー `windows-x86_64` と `linux-x86_64`）。
- Windows のインストーラーの `publisher`（`kein5`）。レジストリのキーの親（`Software\kein5`）になる。
- 過去のリリース、タグ、`CHANGELOG.md` の過去の節。

### 2.4 引き継ぎの方式：共通と Linux

共通の手順は次のとおりである。

1. 移行は、中核が起動して設定を読む前に行う。結果は新しい保存先に別のファイルで記録し、次からは何もしない。
2. 移す前に旧版が動いていないことを確かめる。アプリ ID を変えると、単一起動に使う名前（Windows の mutex `<id>-sim`、Linux の D-Bus 名 `<id>.SingleInstance`）も変わる。そのままでは旧版と新版が同時に起動できてしまうので、旧の名前も確かめる。旧版が動いていれば移さない。
3. 保存先を移したら、保存先のファイル（`config.json`、`user_models.json` など）の中で、旧の保存先の下を指す絶対パスを新しい保存先の同じ場所に付け替える。それ以外のパス（利用者が保存先の外に置いたモデルなど）は変えない。書き換える前の `config.json` は今の仕組み（`config.json.before-migration-*`）で写しを残す。旧の保存先は、Linux では中核が移したときに分かる。Windows ではインストーラーが渡す（2.5）。
4. 移せないときは、旧の場所をそのまま使って起動し（読み替え）、次の起動でまた試す。利用者に操作は求めない。

Linux では次の手順で移す。

1. 保存先を環境変数（`ASTAROT_CONFIG_DIR`、`ASTAROT_DATA_DIR`、旧名の `VRCT_CONFIG_DIR`、`VRCT_DATA_DIR`）で指定しているときは何もしない。
2. 新しいフォルダーがなく旧のフォルダーがあるときは、`rename` で新しい名前に移す。同じ親フォルダーの中なので、大きいモデルも写さずに移る。
3. 旧の場所に、新しいフォルダーを指すシンボリックリンクを置く。0.5.x に戻しても同じ設定とモデルを読める。旧のパスを書いた外部のスクリプトも動く。リンクは 0.6.x の間は残す（判断 9）。
4. 移せないとき（ファイルシステムが違う、権限がない、旧版が動いている）は、旧のフォルダーを使う。
5. 両方あるときは新しいほうを使い、旧のほうには触らない。ただし、新しい名前のフォルダーをこのアプリが作ったと確かめられないとき（同じ名前の別のアプリなど）は、旧のフォルダーを使う。

設定フォルダーとデータフォルダーに、同じ手順を使う。

### 2.5 引き継ぎの方式：Windows（判断 2、3、4）

判断 2（インストール先を移す）と判断 3（レジストリのキーを変える）は、#635 で推奨した案（動かさない、変えない）と逆の決定である。保守担当者は #635 の確認のコメント（2026-11-19）で、移行の処理と一緒に進めるこの理解のまま確定した。どちらも下の移行の処理と一緒に入れる。移行の処理なしに、フォルダー名やキーの名前だけを変えることはしない。Windows では設定とモデルがインストール先にあるので、インストール先を移すことは利用者のデータを移すことでもある。

0.6.0 からのインストーラーは画面から実行したときも、アプリ内更新から `/P /UPDATE` で実行したときも、次のとおりに動く。

1. 前のインストール先を、新しいキー（`Software\kein5\ASTAROT`）から読む。なければ旧のキー（`Software\kein5\VRCT-VOX`）から読む。旧のキーにある `Installer Language` も引き継ぐ。
2. 前のインストール先が旧の既定の場所（`%LOCALAPPDATA%\VRCT-VOX`）のときだけ、`%LOCALAPPDATA%\ASTAROT` へ移す。利用者が選んだほかの場所は動かさない。0.5.1 以降に新しく入れた環境はすでに `%LOCALAPPDATA%\ASTAROT` にあるので、キーだけを移す。
3. 移す前に、インストール先から起動したプロセス（新旧どちらの名前の本体と補助プログラム）をすべて止める。前の更新の作業フォルダー（`.upd`）が残っていれば、今の手順で片付ける。
4. フォルダーは名前を変える（同じドライブの中で動かす）ことで移す。写してから消すことはしない。移す先がすでにあって空でないときと、名前を変えられないとき（ほかのプログラムがファイルを開いているなど）は、移さずに元の場所に入れる。次の更新でまた試す。
5. 移したら、旧の保存先のパスを一度だけ読むファイルでアプリに渡す。インストーラーが UI の言語を渡す `installer_language.txt` と同じ形にする。中核は次の起動で 2.4 の 3 のとおりにパスを付け替え、そのファイルを消す。
6. どこで止まっても、レジストリのキーが指す場所に、起動できるアプリと設定がそろっているようにする。新しいキー（インストール先と、アプリの一覧の `Uninstall\ASTAROT`）を書き終えてから、旧のキー（`Software\kein5\VRCT-VOX` と `Uninstall\VRCT-VOX`）を消す。アプリの一覧に 2 つ並ばないようにする。
7. インストーラーが作ったショートカット（スタートメニューとデスクトップ）は、残っているものだけを新しい場所と名前の実行ファイルに付け替える。利用者が消したものは作り直さない（今の更新の扱いのまま）。タスクバーやスタートに固定した項目はプログラムから固定し直せないので、リリースノートで案内する。
8. 更新のあとにアプリを起動し直すとき（`/R`）は、新しい場所と名前の実行ファイルを起動する。
9. 旧の場所にリンクやジャンクションは置かない。旧の版のアンインストーラーなど、リンクを想定していない削除の処理が、リンクの先のデータに触れるおそれがあるためである。

0.6.0 からのアンインストーラーは新旧どちらのキーも消す。「アプリのデータを消す」を選んだときは、新旧どちらのアプリ ID の WebView のフォルダー（`%LOCALAPPDATA%\io.github.kein5.vrct-vox` と `%LOCALAPPDATA%\io.github.kein5.astarot`）も消す。

ZIP 版は展開先で動くので、保存先は変わらない。実行ファイル名だけが変わり、利用者が作ったショートカットは付け直しになる。

インストール先の移動と実行ファイル名の変更（判断 4）で、本体のパスが変わる。Windows のファイアウォールの許可は実行ファイルのパスごとに記録されるので、更新のあとの最初の起動で確認がもう一度出る。キャンセルすると遮断の規則ができて、OSCQuery（mDNS）が届かなくなる。Windows の版によっては、マイクの許可も実行ファイルごとに聞き直される（未確認）。確認が一度で済むように、インストール先の移動と実行ファイル名の変更は同じ版で出す。#442 で直したあとは、Windows のアプリは mDNS のために受信しないので、ファイアウォールの確認は出ない（`docs/voice-stack/local-setup-windows.md`）。リリースノートでは固定した項目を固定し直すことを案内する。ファイアウォールについては、前の版で確認をキャンセルしてブロックの規則ができた人への注意だけを書き、許可を選ぶ案内は入れない（#901）。

### 2.6 アプリ ID と Linux のデスクトップ連携

- アプリ ID を `io.github.kein5.astarot` にする。UI は WebView に何も保存していないので、WebView のデータは移さない。
- Wayland の portal に新しい app id で登録し、新しい app id の `.desktop` を作る。旧の app id の `.desktop` は旧のマーカー（`X-VRCT-VOX-Generated=true`）があるときだけ消す。マーカーのないファイルは利用者のものとして残す。
- グローバルショートカットと画面共有の許可は、デスクトップ環境が app id ごとに保存している。新しい app id では一度だけ許可し直しになる見込みである（KDE と GNOME では未確認）。画面共有の再開トークン（`OCR_PORTAL_RESTORE_TOKEN`）は使えなくなるので、利用者がウィンドウを一度選び直す。
- Linux の WM_CLASS と `StartupWMClass` は実行ファイル名から決まるので、実行ファイル名と一緒に変える。

### 2.7 Linux のパッケージ（判断 4）

- パッケージ名を `astarot` にし、`/opt/astarot` と `/usr/bin/astarot` に置く。apt と dnf のリポジトリはなく、利用者はファイルから入れる。旧のパッケージから置き換わるように、deb には `Conflicts`、`Replaces`、`Provides`（どれも `vrct-vox`）を付け、rpm には `Obsoletes` と `Provides`（`vrct-vox`）を付ける。
- パッケージ管理で入れたことを示すファイル（`package-manager`）も新しい場所に置く。中核が同梱のファイルを探す場所（`native/core/src/resources.rs` の `/opt/vrct-vox` と `usr/lib/vrct-vox`）も一緒に変える。
- `.desktop`、アイコン、`StartupWMClass` を新しい名前にする。AppImage のファイル名は利用者が決めたもので、アプリ内更新はそのファイルを置き換える。

### 2.8 Linux の音声経路（判断 5）

ノード、説明、systemd のユーザーユニット、所有者のマーカー、手で置いた設定のファイル名、一時のストリームの名前を新しい名前にする。説明の `VRCT Managed Virtual Microphone` は VRChat などのマイクの一覧に出る名前でもある。

今の中核はユニットを止める処理も消す処理も持っていない。名前だけを変えると旧のユニットが動き続ける。仮想マイクが二重になり、VRChat で選んだマイクは音の出ないほうに残る。そのため、次の移行の処理を入れる。

1. 旧の名前のユニットを止めて無効にし、消す。名前と所有者のマーカーと中身がどれも中核の作ったものと一致するユニットだけを対象にする。一致しないものは利用者のものとして残し、今の `managed_setup_conflict` で知らせる。
2. 手で置いた設定は新旧どちらの名前でも見つけ、見つけたら自動の作成をしない。
3. 新しい名前で作り直す。停止とミュートの振る舞いは変えない。
4. VRChat で選んだマイクは外れるので、選び直す案内を一度だけ出す（`locales/en.yml` と `locales/ja.yml`）。

一時のストリームを名前の接頭辞で入力の候補から外す処理は、0.6.x の間は新旧どちらの接頭辞も外す。

### 2.9 API キー

- 資格情報マネージャーと Secret Service での名前を新しくする。起動のときに旧名の項目を新しい名前に写し、読み戻せたものだけを移せたものとする（ADR-013 の 4.3 と同じ手順）。
- 旧名の項目は 0.6.x の間は残す（判断 9）。0.6.x でキーを消したときは、旧名の項目も消す。
- 1.2 のとおり、旧名の項目があるのは develop のビルドだけである。0.5.x の `secrets.json` にある項目は、ADR-013 の移行で新しい名前に直接移る。旧名の項目を持つ環境を増やさないように、この変更は 0.6.0 の最初のベータより前に入れる。
- `secrets.json` の `store_id` は保存先と一緒に移るので、新しい名前でも同じ ID を使う。

### 2.10 配布物（判断 7）

- 配布物の名前を新しくする。`latest.json` は新しい名前だけを指す。アプリ内更新は `latest.json` に書いた URL を使うので、名前が変わっても届く。インストーラーは自分の版の ZIP だけを取るので、旧の版のインストーラーにも影響しない。
- 0.6.x のリリースには名前を変えた配布物の旧名の写し（中身が同じファイル）も載せる。外に貼られた `releases/latest/download/VRCT-VOX_setup.exe` のようなリンクを 0.6.x の間は生かすためである。写しにも `.sha256` を付け、`SHA256SUMS` に載せる。0.7.0 からは載せない。
- 配布候補の検査（`tools/release_candidate.py`）は、新しい名前と写しの両方がそろっていることを確かめる。

> **決定の注記**（2026-11-23、PR #1006）：名前を変える手順 4〜8（アプリ ID、インストール先とキー、実行ファイル名、Linux のパッケージ、配布物の名前）は、0.6.0 ではなく 0.7.0 で一緒に出すと決まった。そのため、旧名の写しは上の「0.6.x のリリース」ではなく 0.7.x のリリースに載せ、0.8.0 からは載せない（4.2 の「0.6.x の間は旧名の写しの分だけ配布物が増える」も 0.7.x の間になる）。写しは、名前に版を含む Linux の配布物も含めて、すべての配布物に作る。`/VERSION` で 0.6.x までの版を入れるときは、0.6.x までのリリースに新しい名前の ZIP がないので、インストーラーが旧名の `VRCT-VOX.zip` を取る。上の段落は書いた時点の記録として残す。

### 2.11 旧名を読む期間（判断 9）

環境変数の旧名、所有マーカーの旧値、Linux の旧のパスのリンク、資格情報の旧名の項目、一時のストリームの旧の接頭辞は、0.6.x の間は読む（残す）。いつ外すかは 0.7.0 の計画で決める。

> **決定の注記**（2026-11-23、PR #979）：0.6.0 はこの手順を含まずに公開されたので、Linux の音声経路の旧名（2.8）は、上の「0.6.x の間」ではなく、新しい名前を出した版の系列の間読む（0.7.0 で出せば 0.7.x の間）。旧名を読むこと（旧の接頭辞のノードとストリームを入力の候補から外す、旧の名前の手で置いた設定を見つける、中核のものでない旧の経路を知らせる）と、旧のユニットの片付け（0.6.0 までの中核が書いたものと名前、所有者のマーカー、中身がどれも一致するときだけ止めて消す）は定数を分け、片付けは期限を設けずに残す。版を飛ばして更新した環境でも旧の仮想マイクを残さないためである。上の段落は書いた時点の記録として残す。

### 2.12 コードの中だけの名前（判断 10）

Cargo と npm のパッケージ名、UI のファイル名とフック、ロケールのキー、試験の素材は、`src-python/` を消し、0.6.0 の機能の PR がそろってから、機械的な PR で変える。利用者には見えない。0.6.0 に間に合わなければ 0.6.x に送る。

## 3. Alternatives considered（検討した案）

| 対象 | 案 | 採らなかった理由 |
|---|---|---|
| 保存先 | 旧の名前のまま読み続ける（読み替えだけ） | 既存の環境に旧の名前が残り続け、識別子をそろえる目的を満たさない。移せないときの逃げ道としてだけ使う |
| 保存先 | 新しい場所に写し、旧の場所も残す | モデルで数 GB になることがあり、ディスクを倍使う。2 か所の中身が食い違う |
| Windows のインストール先 | 動かさない（#635 の推奨） | 保守担当者は移すと決めた（判断 2）。動かさないと旧の名前のフォルダーが残る |
| Windows のレジストリのキー | 変えない（#635 の推奨） | 保守担当者は変えると決めた（判断 3）。変えないと旧の名前のキーが残る |
| Windows の旧の場所 | ジャンクションを置く | 2.5 の 9 |
| パスの付け替え | パスの末尾が一致するファイルを、保存先の外も含めて探して付け替える | 推測で書き換えることになる。移した元が分かっているので、その下のパスだけを付け替える |
| Worker | 新しい名前の Worker を足す | 旧の Worker を止められず、2 つを持ち続けることになる（判断 6） |
| 配布物 | 名前を変えない | 判断 7。外のリンクは、旧名の写しで 0.6.x の間は生かす |
| 音声経路 | 名前を変えない | 判断 5。説明の名前は利用者に見える |

## 4. Consequences（影響）

### 4.1 得るもの

- 0.6.0 から、保存先、OS への登録、実行ファイル、パッケージ、配布物、音声経路の名前が ASTAROT にそろう。旧の名前が残るのは、旧名を読む期間（2.11）と、変えないと決めたもの（2.3）だけになる。
- 0.5.0 以前から使っている Windows の環境も新しく入れた環境と同じ `%LOCALAPPDATA%\ASTAROT` になる。

### 4.2 負担とリスク

- Windows では更新のあとの最初の起動でファイアウォールの確認が出る（2.5）。#442 の修正を含む版からは出ない。固定した項目と利用者が作ったショートカットは付け直しになる。古いファイアウォールの規則は残る（消すには管理者の権限が要る）。
- Windows のインストーラーはデータの入ったフォルダーを動かす。移せないときに元の場所で続けることと、途中で止まったときに続きから移せることを、試験で確かめる（6）。
- Linux ではグローバルショートカットと画面共有の許可を一度し直す。VRChat ではマイクを選び直す。
- 0.6.0 から 0.5.x に戻すと、次のようになる。
  - Linux はリンクを通して旧のパスから同じ設定とモデルを読める。
  - Windows はインストール先が `%LOCALAPPDATA%\ASTAROT` に移っている。0.5.1 と 0.5.2 のインストーラーは、旧のキーがなければ既定の `%LOCALAPPDATA%\ASTAROT` に入れるので、設定とモデルは見える見込みである。ただし旧の名前のキーを書くので、アプリの一覧に 2 つ並ぶことがある（未確認）。0.5.0 のインストーラーは `%LOCALAPPDATA%\VRCT-VOX` に新しく入れるので、設定は見えない。
  - 0.5.x は資格情報ストアを使わないので、API キーは入れ直しになる。これは ADR-013 の 10.2 のとおりで、P2 とは関係なく起きる。
  - PR #629 が入る前の版は知らない設定のキーを消して保存する。
  - どの場合も設定とモデルのファイルは消えない。
- 0.6.x の間は旧名の写しの分だけリリースの配布物が増える（Linux の配布物も含む）。
- 名前を書き換える PR は並行して進む PR と衝突しやすい。名前の定義を一か所に集める PR 1 を早く入れ、機械的な改名（PR 12）は最後にする。

### 4.3 文書

- `docs/voice-stack/project-rename.md` の表は、実装が入るまで今の値を示す。各 PR が変えた行を新しい値と旧名を読む期間に直す。
- ADR-011 の front matter（P2 の実装の状況）は、メタデータだけを直す別の PR で更新する（[索引](README.md)の「新しい ADR の書き方」の 4）。

## 5. 実施の計画（PR の分け方）

| PR | 内容 | 先に要るもの | 主な確認 |
|---|---|---|---|
| 0 | この ADR | なし | `tools/adr_catalog.py --check` |
| 1 | 名前の定義を一か所に集める。環境変数と所有マーカーは新旧どちらも読み、書くのは旧のままにする。振る舞いは変えない | PR 0 | 中核と各クレートの試験 |
| 2 | 保存先の移行の仕組み（中核）。旧版の起動の確認、絶対パスの付け替え、Linux の設定とデータのフォルダーの移行、移行の記録（2.4） | PR 1 | 0.5.x の配置を模した試験（Linux と Windows の CI）。実機の AppImage、deb、rpm |
| 3 | API キーの名前の移行（2.9） | PR 1 | 資格情報の試験（Windows と Linux の CI） |
| 4 | アプリ ID と Linux のデスクトップ連携（2.6）。単一起動、WebView、portal、`.desktop` | PR 2 | KDE と GNOME での許可のし直し。旧版との同時起動 |
| 5 | Windows のインストール先とレジストリのキーの移行（2.5 の 1〜7、9 とアンインストーラー）。中核が旧の保存先を受け取ってパスを付け替える処理 | PR 2、PR 4 | インストーラーの試験（移せないとき、途中で止まったとき）。実機で 0.5.0、0.5.1、0.5.2 から更新（インストーラーとアプリ内更新）、新規インストール、利用者が選んだ場所 |
| 6 | 本体の実行ファイル名（2.5、2.6）。新旧どちらの名前のプロセスも止め、旧の exe を消し、ショートカットを付け替え、`/R` で新しい exe を起動する。Linux の `.desktop` と `StartupWMClass` も変える | PR 5 | インストーラーの試験。実機での更新とファイアウォールの確認 |
| 7 | Linux のパッケージ（2.7） | PR 6 | `apt install ./` と `dnf install ./` で旧のパッケージが置き換わること |
| 8 | 配布物の名前、旧名の写し、リリースの道具（2.10）。`release.yml`、`build-linux.yml`、`tools/release_candidate.py`、`tools/updater_manifest.py`、`tools/prepare_release.py`、NSIS が取る ZIP の名前、`utils/zip.py`、サイトのダウンロードの確認 | PR 6、PR 7 | 配布候補の作成と `latest.json` の検査 |
| 9 | Linux の音声経路（2.8） | PR 1 | 実機の PipeWire と VRChat。停止とミュートの振る舞い |
| 10 | 補助プログラムと、実行時に外から見える名前（2.2）。`vrct-vc-worker` の削除 | PR 1 | 各クレートの試験。VRChat から OSCQuery で見えること |
| 11 | 文書とマニュアル（仕様、ビルドと配布の手順、サイトの日英、プライバシーのページの環境変数、`project-rename.md` の残り） | PR 2〜10 | `tools/spec_catalog.py --check`、サイトのビルド |
| 12 | コードの中だけの名前（2.12） | `src-python/` の削除、0.6.0 の機能の PR | 全体の試験 |

依存の流れは PR 0 → PR 1 → PR 2・3・9・10（並行してよい）と、PR 2 → PR 4 → PR 5 → PR 6 → PR 7 → PR 8 である。PR 11 は PR 2〜10 で直しきれなかった文書をまとめる。PR 12 は最後に回す。

リリースとの関係は次のとおりにする。

- どの PR もそれだけで出荷できる状態にする。途中でベータを作っても、設定とモデルが失われないようにする。
- PR 3 は 0.6.0 の最初のベータより前に入れる（2.9）。
- PR 5 と PR 6 は同じ版で出す。ファイアウォールの確認を一度で済ませるためである（2.5）。PR 7 と PR 8 も PR 6 と同じ版で出し、実行ファイル名、パッケージ、配布物の名前をそろえる。
- 更新確認とテレメトリの Worker は変えないので、リポジトリの外の作業はない。

#635 の計画から次の点を変えた。

- 判断 2 と 3 で Windows のインストール先とキーを移すことになった。そのため #635 の PR 5（インストーラーと実行ファイル名）を PR 5（インストール先とキー）と PR 6（実行ファイル名）に分けた。それより後の番号は 1 つずつ後ろにずれた。
- パスの付け替えは Windows でも要る。そのため PR 2 を Linux だけの移行から中核の移行の仕組みに広げた。
- PR 0 では `project-rename.md` の表を書き直さず、各 PR で直す（4.3）。

## 6. Verification / Acceptance criteria（検証と受け入れの条件）

| 観点 | 確かめること | 方法 |
|---|---|---|
| 保存先の移行（Linux） | 0.5.x の配置（`~/.config/vrct-vox`、`~/.local/share/vrct-vox`、絶対パス入りの `config.json`、`owner.json` 付きの `downloaded_models/`、`secrets.json`）から移り、パスが付け替わる。2 回目の起動では何もしない。移せないときは旧の場所で動く。旧版が動いているときは移さない | 中核の試験（偽の HOME）。実機の AppImage、deb、rpm |
| Windows のインストール先とキー | 0.5.0 以前から更新した環境で、フォルダーとキーが移り、アプリの一覧が 1 つになる。設定、モデル、API キーが引き継がれる。利用者が選んだ場所は動かない。移せないときと途中で止まったときに、キーが指す場所でアプリが起動する | NSIS の試験（`tests/devtools/` の staged update の試験の続き）。実機で 0.5.0、0.5.1、0.5.2 から、インストーラーとアプリ内更新の両方で |
| パスの付け替え | 旧の保存先の下を指すパスだけが変わり、ほかのパス（利用者が保存先の外に置いたモデル）は変わらない | 中核の試験 |
| API キー | 旧名の項目が新しい名前に移り、旧名の項目が 0.6.x の間は残る。消したときは両方から消える | 偽のストアの試験。Windows と Linux の CI での本物のストアの試験 |
| 音声経路 | 旧のユニットが止まって消え、仮想マイクが新しい名前の 1 つだけになる。利用者のユニットには触れない。停止とミュートの振る舞いが変わらない | `native/audio-routing` の試験。実機の PipeWire と VRChat |
| デスクトップ連携 | 新しい app id で登録され、旧の生成ファイルだけが消える。グローバルショートカットと画面共有の許可のし直しが一度で済む | KDE と GNOME の実機 |
| パッケージ | 旧のパッケージが置き換わり、2 つ並ばない | deb と rpm の試験の環境 |
| 配布物 | 新しい名前と旧名の写しがそろい、`latest.json` が新しい名前を指す。0.5.x のアプリ内更新で 0.6.0 に上がる | 配布候補の検査。ベータでの更新の確認 |
| 戻したとき | 0.5.x に戻しても設定とモデルのファイルが消えない。見え方は 4.2 のとおり | 実機（ベータで） |
| ログ | 移行のログに、設定の値、キー、テキスト、音声が入らない | 試験で出力を確かめる |

VR は今の偽の OpenVR で代える。両方の OS で確かめられないものは PR に「未確認」と書き、リリース候補の確認で確かめてから正式版に入れる（ADR-013 の 7 と同じ扱い）。

## 7. Revisit triggers（見直す条件）

- Windows でインストール先を移せない環境が多く、旧の場所で動き続ける利用者が多いとき
- apt、dnf、AUR、winget などのリポジトリに載せるとき（パッケージ名と旧名の扱いを見直す）
- 更新確認やテレメトリの送信先を独自のドメインへ移すとき（判断 6 を見直す）
- 0.7.0 の計画で、旧名を読む期間（2.11）を終えるとき

## 8. 未決のこと

1. 0.5.x へ戻す経路をどこまで支えるか。今は設定とモデルのファイルを消さないことだけを決めた（4.2）。戻し方をリリースノートに書くかはベータでの確認の後に決める。
2. Linux のパッケージに 0.6.x の間だけ `/usr/bin/vrct-vox` の互換のリンクを置くか。PR 7 で決める。
3. Linux に残る旧のアプリ ID の WebView のフォルダー（`~/.local/share/io.github.kein5.vrct-vox`）を消すか。PR 4 で決める。
4. テレメトリの User-Agent を変える時期。受け取る側が User-Agent で絞っていないことを確かめてから変える（PR 10）。
