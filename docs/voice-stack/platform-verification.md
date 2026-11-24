# Platform verification records

[日本語版](#対応環境の検証の記録日本語版)

This is the list of records behind the user-facing [Platform support](../../site/en/guide/support.md) page and its Japanese version ([対応環境と検証の範囲](../../site/ja/guide/support.md)). Every cell of the matrix rests on one of the records in this list. A cell with no record says "Not verified".

This list was created on 2026-11-18. Its target version is 0.6.0, and it was last updated on 2026-11-22.

## Terms

The matrix keeps the level of support apart from how it was checked. Passing CI does not mean that it works on a real PC.

| Term | Meaning |
|---|---|
| Supported | An environment we ship release files for and fix bugs on |
| Best effort | An environment expected to work, but not checked, or checked only within a narrow range. Reports are accepted, but a fix may not be possible |
| Not supported | An environment with no release files, or one known not to work |
| Verified in CI | Checked automatically on GitHub Actions runners. No real audio devices, GPU, VRChat or headset are used |
| Verified on a real PC | Checked by running the release files or a development build on a real PC, with a record kept. The version and OS are given |
| Not verified | No record of a check in CI or on a real PC |

A real-PC record always gives the version that was checked. 0.5.0 rebuilt the backend from Python into the Rust core, so records from 0.4 and earlier are not used as evidence for how 0.5.x behaves. The matrix marks them separately as "Checked before 0.5".

## What CI checks

| Workflow and job | Runner | What it checks | What it does not check |
|---|---|---|---|
| `headless` in `voice-tests.yml` | `ubuntu-latest`, `windows-latest` | Contract tests without models, and the UI unit tests, type check and build (`check --scope voice`, `ui`). On Linux, it sets up a pinned version of PipeWire in an isolated location and tests the audio helper programs | Screens, real audio devices, models |
| `core-integration` in `voice-tests.yml` | `ubuntu-latest`, `windows-latest` | Tests of the crates for the core (`native/core`), OpenVR, the VR overlay, speech recognition and voice conversion. VR uses the fake SteamVR (`FakeVr`) | Models, devices, network, the real SteamVR |
| `crates` in `voice-tests.yml` | `ubuntu-latest`, `windows-latest` | Tests of the crates the other jobs do not test: downloads and operations (`ops`), management of the speech servers, the OSC and OBS adapters, OCR for chat reading, the RVC runtime | Models, devices, the real VRChat |
| `integration` in `voice-tests.yml` | `ubuntu-latest`, `windows-latest` | Integration tests (`tests/integration`) that drive the app's screens in Chromium and WebKit, connected to the real core. Translation, the OSC receiver and the speech servers are stand-ins | The app window (WebView2, WebKitGTK), real audio devices, models, VRChat |
| `build-linux.yml` | `ubuntu-24.04` | Builds the tar.gz, AppImage, deb and rpm. On Xvfb (X11), runs a test that starts the tar.gz from a read-only location and a test that starts the AppImage by extraction, covering start, drawing, using the settings screen and shutdown. Installs the deb and rpm in Ubuntu 24.04, Debian 13 and Fedora 44 containers and checks that the libraries resolve, that the bundled speech engine starts and that removal leaves nothing | Starting through FUSE, Wayland, real audio, models, VRChat. The deb and rpm windows |
| `release.yml` | `windows-latest` | Builds the ZIP (`VRCT-VOX.zip`) and the NSIS installer, and checks for files that must not be distributed, size, SHA-256 and the built-in hash | Starting the app, screens, audio |
| `windows-package.yml` | `windows-latest` | That the files for `_internal` are all present | Starting the app |
| `installer-update-tests.yml` | `windows-latest` | With the real NSIS installer and a light dummy payload: new installation, update, rollback, recovery from an interruption and the change of display name | The contents of the real release files, starting the app |

`build-linux.yml`, `windows-package.yml` and `installer-update-tests.yml` run only on PRs that change related files and on manual runs. `release.yml` runs on PRs into main and on manual runs. No CI opens the app window (WebView2) on Windows. The only screen tests are the integration tests that open the screens in a browser (`integration`).

## Records on real PCs

### 0.6 series

| Record | Version | OS and package | What was checked | What was not checked |
|---|---|---|---|---|
| "Known issues" in the [0.6.0 release notes](https://github.com/kein5/astarot/releases/tag/v0.6.0) | 0.6.0 (before publishing) | A real Windows PC. OS version and package not recorded | Before publishing, checked on a real Windows PC with the real SteamVR and the real VRChat. The subtitle overlay connects to the real SteamVR and draws subtitles (confirmed by reading the overlay's contents). Choosing only the TTS model in the setup goes all the way through the download. "Stop speech" looks unavailable when there is nothing to stop | What the notes list under known issues. How it looks inside the headset, downloading the translation model in the setup, moving the folder on Linux, a real Linux PC and more |
| [Comment on Issue #442](https://github.com/kein5/astarot/issues/442#issuecomment-7071922969) | 0.6.0-beta.1 | Windows. OS version and package not recorded | Used with the real VRChat, no Windows Firewall prompt appears | Other features |

The 0.6.0 real-PC records do not include the OS version or the package, so the real-PC cells of the matrix have not been changed yet (see "Updating the matrix" below). The version and date at the top of the matrix are set to the published version even when the real-PC cells do not change (decision 3 of PR #772). The 0.6.0 Linux release files have not been checked on a real PC.

### 0.5 series

| Record | Version | OS and package | What was checked | What was not checked |
|---|---|---|---|---|
| [Comment on Issue #516](https://github.com/kein5/astarot/issues/516#issuecomment-7042956469) | 0.5.2 | CachyOS (rolling, Linux 6.18 series), a KDE Plasma 6.8.2 Wayland session (the app window under XWayland), x64. AppImage | With `appimage` and `ui` of `tools/native_acceptance.py` from v0.5.2, 11 of 16 tests passed. Starting through FUSE and by extraction, drawing, shutdown. Saving in the settings screen at display scale 100% and 150%, and fitting into a small window. The window stays drawn after waiting and after hovering the mouse over it. The text input field. Keyboard operation of the split settings screens | Unmuting the managed audio route (the test could not confirm it, and whether the product or the test is at fault has not been isolated). The desktop subtitle window (`xwininfo`, which the test needs, was missing). Opening and closing the settings screen repeatedly (the test helper code is outdated). The round trip with VRChat. Speech recognition, TTS, RVC, the virtual microphone. deb, rpm, tar.gz. Windows |
| "Results of the candidate build and the verification on Windows" in a [comment on PR #571](https://github.com/kein5/astarot/pull/571#issuecomment-6956375435) | The 0.5.1 candidate | Windows 11 Home Insider Preview build 26320, x64. Installer and ZIP | Checking the provenance and `.sha256`. Updating from 0.5.0 (with an installer from the same commit whose download source was switched to a local one, `/P /UPDATE`). The entry in "Apps & features". Starting after the update. Reading a selected area with chat reading (a test window). ONNX Runtime sends nothing with telemetry turned off | New installation, local translation (the model is not in the catalog), detecting bubbles in the real VRChat, speech recognition, TTS, RVC, the virtual microphone, VR. Linux |
| [PR #520](https://github.com/kein5/astarot/pull/520) | 0.5.0-beta.5 and fixes | Windows 11, x64 | The real-PC check of 0.5.0-beta.5 found a bug where TTS sent to the virtual microphone went silent with `output_underflow`. After the fix, playback to the Steam Streaming virtual device was confirmed with a test (`native/audio-routing/tests/wasapi_live.rs`) | An end-to-end check that the app's TTS reaches VRChat. Other virtual microphones such as VB-CABLE |
| [PR #453](https://github.com/kein5/astarot/pull/453) | 0.5.0-beta.2 and fixes | Linux (distribution and desktop not recorded), AppImage and tar.gz. A development build on Windows 11 | The real-PC test on Linux found problems with the engine notice right after the AppImage starts, the name of the close button when there is no tray, and the tray's title. Checked the window position on Windows | A real-PC check on Linux after the fixes |

The only real-PC record for the 0.5.x Linux release files is the 0.5.2 AppImage (the first row of the table above). The deb, rpm and tar.gz have not been checked on a real PC. 0.5.2 was not checked on a real Windows PC, so the Windows cells of the matrix still rest on the 0.5.1 record.

### Versions before 0.5

| Record | Version | OS and package | What was checked |
|---|---|---|---|
| [Windows voice verification report](windows-voice-report.md) | Around the 0.1.0 betas (2026-11-07 to 11-13), Python backend | Windows 11 Insider build 26220, a development build and the frozen sidecar | TTS and speech recognition with the bundled speech.cpp, RVC and Seed-VC, input forwarding, the overlay on the real SteamVR (null driver), a real microphone, hotkeys (`SendInput`), VRChat detection, downloading the translation model, the desktop subtitle overlay |
| [Changes not yet checked on Windows](windows-pending-checks.md) | 0.1.0-beta.7, the 0.1.0 ZIP | Windows 11 | Unpacking and starting, each page of the settings, the desktop subtitle overlay, from downloading the translation model through to translating |
| "VRChat desktop manual test" in [Benchmarks](benchmarks.md#vrchatデスクトップ手動試験) | Versions with the Python backend | Linux, the virtual microphone the app creates | The virtual microphone was chosen as VRChat's input, and the voice was heard in VRChat's record and playback test. The latency inside VRChat and the transmission to other users were not checked |
| The Platforms section of the [README](../../README.md) and [Release candidates](release-candidates.md#動く環境) | 0.4 and earlier | CachyOS (KDE Plasma, Wayland), x64 | Tests with real models (`tools/native_acceptance.py`). On Linux desktops, only KDE Plasma (Wayland) was checked |

## Updating the matrix

- Each time a stable or hotfix version is published, bring the matrix and this list up to the published version. The steps are in [Release candidates](release-candidates.md#公開したあとに対応環境の表を更新する) (#516). When a beta is checked on a real PC, add it only to the real-PC records in this list.
- What is checked on a real PC (the Windows OS, the Linux packages and desktops, VR) is in the pre-release check sections of [Release candidates](release-candidates.md). It was decided on 2026-11-18 (#516).
- A PR that changes the scope of support (packages, OS, runtime requirements, platform-specific code) states in its description the affected platforms, the environments checked, the environments not checked and the effect on backward compatibility ([PR template](../../.github/pull_request_template.md)).
- After a real-PC check, add the record to this list first, then change the matrix cells. The record gives the version, the OS and its version, the package, and what was and was not checked. Do not write anything that identifies the PC's owner.
- When the release file names, the containers that test the deb and rpm, or the CI runners change, update the matrix too. `tests/voice/test_support_matrix.py` checks that the release file names and the container OSes written in the workflows appear in the matrix.
- Keep what the matrix says consistent with the [README](../../README.md), [System requirements](../../site/ja/guide/requirements.mdx) and [Install](../../site/ja/guide/install.mdx).

---

# 対応環境の検証の記録（日本語版）

利用者向けの[対応環境と検証の範囲](../../site/ja/guide/support.md)（英語は[Platform support](../../site/en/guide/support.md)）の根拠にした記録の一覧です。マトリクスのどの欄もこの一覧のどれかの記録に基づきます。記録がない欄は「未検証」と書きます。

作成日は 2026-11-18 です。対象の版は 0.6.0 で、2026-11-22 に更新しました。

## 言葉の決まり

マトリクスでは対応の扱いと確かめ方を分けて書きます。CI が通っていることは、実際の PC で動くことを意味しません。

| 区分 | 意味 |
|---|---|
| 正式サポート | 配布物を出していて、不具合を直す対象にしている環境 |
| ベストエフォート | 動くことを想定しているが、確かめていないか、確かめた範囲が狭い環境。報告は受け付けるが、直せないことがある |
| 未対応 | 配布物がない、または動かないと分かっている環境 |
| CI で検証 | GitHub Actions のランナーで自動で確かめた。実際の音声機器、GPU、VRChat、ヘッドセットは使わない |
| 実機で検証 | 実際の PC で、配布物か開発用のビルドを動かして確かめ、その記録が残っている。版と OS を添える |
| 未検証 | CI でも実機でも確かめた記録がない |

実機の記録には確かめた版を必ず添えます。0.5.0 でバックエンドを Python から Rust の中核に作り直したので、0.4 以前の記録は 0.5 系の動作の根拠にしません。マトリクスでは「0.5より前の版で確認」と分けて書きます。

## CI が確かめていること

| ワークフローとジョブ | ランナー | 確かめること | 確かめないこと |
|---|---|---|---|
| `voice-tests.yml` の `headless` | `ubuntu-latest`、`windows-latest` | モデルなしの契約試験、UI の単体試験と型チェックとビルド（`check --scope voice`、`ui`）。Linux では固定した版の PipeWire を隔離した場所に作って、音声の補助プログラムを試す | 画面、実際の音声機器、モデル |
| `voice-tests.yml` の `core-integration` | `ubuntu-latest`、`windows-latest` | 中核（`native/core`）、OpenVR、VR オーバーレイ、音声認識、声質変換のクレートの試験。VR は偽の SteamVR（`FakeVr`）を使う | モデル、機器、ネットワーク、実際の SteamVR |
| `voice-tests.yml` の `crates` | `ubuntu-latest`、`windows-latest` | ほかのジョブが試さないクレートの試験。取得と運用（`ops`）、音声のサーバーの管理、OSC と OBS のアダプター、チャット読み取りの OCR、RVC の実行環境 | モデル、機器、実際の VRChat |
| `voice-tests.yml` の `integration` | `ubuntu-latest`、`windows-latest` | アプリの画面を Chromium と WebKit で操作し、本物の中核につなぐ結合テスト（`tests/integration`）。翻訳、OSC の受け手、音声のサーバーは代わりの部品を使う | アプリの窓（WebView2、WebKitGTK）、実際の音声機器、モデル、VRChat |
| `build-linux.yml` | `ubuntu-24.04` | tar.gz、AppImage、deb、rpm を作る。tar.gz を読み取り専用の場所に置いて起動する試験と、AppImage を展開方式で起動する試験を Xvfb（X11）で行う。起動、描画、設定画面の操作、終了まで。deb と rpm は Ubuntu 24.04、Debian 13、Fedora 44 のコンテナに入れて、ライブラリがそろうこと、同梱の音声エンジンが起動すること、削除で残らないことを確かめる | FUSE での起動、Wayland、実際の音声、モデル、VRChat。deb と rpm の画面 |
| `release.yml` | `windows-latest` | ZIP（`VRCT-VOX.zip`）と NSIS のインストーラーを作り、配布してはいけないファイル、容量、SHA-256、組み込んだハッシュを確かめる | アプリの起動、画面、音声 |
| `windows-package.yml` | `windows-latest` | `_internal` に入るファイルがそろっていること | アプリの起動 |
| `installer-update-tests.yml` | `windows-latest` | 実際の NSIS のインストーラーで、軽いダミーの中身を使った新規インストール、更新、巻き戻し、中断からの復旧、表示名の変更 | 実際の配布物の中身、アプリの起動 |

`build-linux.yml`、`windows-package.yml`、`installer-update-tests.yml` は、関係するファイルを変えた PR と手動の実行でだけ動きます。`release.yml` は main 宛ての PR と手動の実行で動きます。Windows でアプリの窓（WebView2）を開く CI はありません。画面はブラウザーで開く結合テスト（`integration`）だけです。

## 実機の記録

### 0.6 系

| 記録 | 版 | OS と形式 | 確かめたこと | 確かめなかったこと |
|---|---|---|---|---|
| [0.6.0 のリリースノート](https://github.com/kein5/astarot/releases/tag/v0.6.0)の「既知の問題」 | 0.6.0（公開前） | Windows の実機。OS の版と配布形式は記録なし | 公開の前に、Windows の実機、実物の SteamVR、実物の VRChat で確かめた。字幕のオーバーレイが実物の SteamVR につながって字幕を描くこと（オーバーレイの中身を読み取って確認）。初期設定で読み上げのモデルだけを選んで取得まで通ること。「読み上げを停止」が、止めるものがないときに押せない見た目になること | ノートの「既知の問題」に挙げたこと。ヘッドセットの中での見た目、初期設定での翻訳のモデルの取得、Linux のフォルダーの移動、Linux の実機など |
| [Issue #442 のコメント](https://github.com/kein5/astarot/issues/442#issuecomment-7071922969) | 0.6.0-beta.1 | Windows。OS の版と配布形式は記録なし | 実物の VRChat と使い、Windows のファイアウォールの確認が出ないこと | ほかの機能 |

0.6.0 の実機の記録には OS の版と配布形式が残っていないので、マトリクスの実機の欄はまだ変えていません（下の「マトリクスを更新するとき」）。マトリクスの冒頭の版と日付は、実機の欄を変えないときも公開した版にします（PR #772 の判断 3）。0.6.0 の Linux の配布物は実機で確かめていません。

### 0.5 系

| 記録 | 版 | OS と形式 | 確かめたこと | 確かめなかったこと |
|---|---|---|---|---|
| [Issue #516 のコメント](https://github.com/kein5/astarot/issues/516#issuecomment-7042956469) | 0.5.2 | CachyOS（rolling、Linux 6.18 系）、KDE Plasma 6.8.2 の Wayland のセッション（アプリの窓は XWayland）、x64。AppImage | v0.5.2 の `tools/native_acceptance.py` の `appimage` と `ui` で、16 件のうち 11 件が成功。FUSE と展開の両方式での起動、描画、終了。表示倍率 100% と 150% での設定画面の保存と、小さい窓への収まり。待ったあとやマウスを載せたあとも窓が描かれたままであること。文の入力欄。分かれた設定画面のキーボードでの操作 | 管理された音声経路のミュートの解除（試験で確かめられず、製品と試験のどちらの問題かは切り分けていない）。デスクトップの字幕の窓（試験に要る `xwininfo` がなかった）。設定画面の開閉のくり返し（試験の補助コードが古い）。VRChat との往復。音声認識、読み上げ、RVC、仮想マイク。deb、rpm、tar.gz。Windows |
| [PR #571 のコメント](https://github.com/kein5/astarot/pull/571#issuecomment-6956375435) の「候補のビルドと Windows での検証の結果」 | 0.5.1 の候補 | Windows 11 Home Insider Preview build 26320、x64。インストーラーと ZIP | 来歴と `.sha256` の照合。0.5.0 からの更新（取得先をローカルに替えた同じコミットのインストーラーで、`/P /UPDATE`）。「アプリと機能」の表示。更新後の起動。チャット読み取りの範囲読み（試験用のウィンドウ）。テレメトリを切った状態で ONNX Runtime が送信しないこと | 新規インストール、ローカル翻訳（モデルがカタログにない）、実際の VRChat での吹き出しの検出、音声認識、読み上げ、RVC、仮想マイク、VR。Linux |
| [PR #520](https://github.com/kein5/astarot/pull/520) | 0.5.0-beta.5 と修正 | Windows 11、x64 | 0.5.0-beta.5 の実機確認で、読み上げを仮想マイクへ送ると `output_underflow` で無音になる不具合を見つけた。修正のあと、Steam Streaming の仮想デバイスへの再生を試験（`native/audio-routing/tests/wasapi_live.rs`）で確かめた | アプリの読み上げから VRChat まで届くことの通し確認。VB-CABLE などほかの仮想マイク |
| [PR #453](https://github.com/kein5/astarot/pull/453) | 0.5.0-beta.2 と修正 | Linux（ディストリビューションとデスクトップの記録なし）、AppImage と tar.gz。Windows 11 の開発用のビルド | Linux の実機テストで、AppImage の起動直後のエンジンの通知、トレイがないときの閉じるボタンの名前、トレイの題を見つけた。Windows で窓の位置を確かめた | 修正のあとの Linux の実機での確認 |

0.5 系の Linux の配布物を実機で確かめた記録は、0.5.2 の AppImage（上の表の最初の行）だけです。deb、rpm、tar.gz は実機では確かめていません。0.5.2 は Windows の実機では確かめていないので、マトリクスの Windows の欄は 0.5.1 の記録のままです。

### 0.5 より前の版

| 記録 | 版 | OS と形式 | 確かめたこと |
|---|---|---|---|
| [Windows 音声の検証記録](windows-voice-report.md) | 0.1.0 のベータ版のころ（2026-11-07〜11-13）、Python のバックエンド | Windows 11 Insider build 26220、開発用のビルドと凍結したサイドカー | 同梱の speech.cpp での読み上げと音声認識、RVC と Seed-VC、入力の転送、実際の SteamVR（null ドライバー）でのオーバーレイ、実マイク、ホットキー（`SendInput`）、VRChat の検出、翻訳モデルの取得、デスクトップの字幕オーバーレイ |
| [Windows で未確認の変更](windows-pending-checks.md) | 0.1.0-beta.7、0.1.0 の ZIP | Windows 11 | 展開して起動、設定の各ページ、デスクトップの字幕オーバーレイ、翻訳モデルの取得から翻訳まで |
| [ベンチマーク](benchmarks.md#vrchatデスクトップ手動試験)の「VRChatデスクトップ手動試験」 | Python のバックエンドの版 | Linux、アプリが作る仮想マイク | 仮想マイクを VRChat の入力に選び、VRChat の録音・再生のテストで声が聞こえた。VRChat の中の遅延とほかの利用者への送信は確かめていない |
| [README](../../README.md) の Platforms の節と[配布候補](release-candidates.md#動く環境) | 0.4 以前 | CachyOS（KDE Plasma、Wayland）、x64 | 実際のモデルを使った試験（`tools/native_acceptance.py`）。Linux のデスクトップでの確認は KDE Plasma（Wayland）だけ |

## マトリクスを更新するとき

- 正式版とホットフィックスの版を公開するたびに、マトリクスとこの一覧を公開した版に合わせて更新します。手順は[配布候補](release-candidates.md#公開したあとに対応環境の表を更新する)にあります（#516）。ベータ版を実機で確かめたときは、この一覧の実機の記録にだけ足します。
- 実機で確かめる範囲（Windows の OS、Linux の配布形式とデスクトップ、VR）は、[配布候補](release-candidates.md)の公開前の確認の節にあります。2026-11-18 に決めました（#516）。
- 対応の範囲を変える PR（配布形式、OS、ランタイムの条件、プラットフォーム固有の処理）は、PR の本文に、影響するプラットフォーム、確かめた環境、確かめていない環境、後方互換性への影響を書きます（[PR のテンプレート](../../.github/pull_request_template.md)）。
- 実機で確かめたら、この一覧に記録を足してから、マトリクスの欄を変えます。記録には版、OS とその版、配布形式、確かめたことと確かめなかったことを書きます。PC の持ち主が分かる情報は書きません。
- 配布物の名前、deb と rpm を試すコンテナ、CI のランナーを変えたら、マトリクスも直します。`tests/voice/test_support_matrix.py` が、ワークフローに書かれた配布物の名前とコンテナの OS がマトリクスにあるかを確かめます。
- マトリクスに書く内容は[README](../../README.md)、[動作環境と推奨スペック](../../site/ja/guide/requirements.mdx)、[インストール](../../site/ja/guide/install.mdx)と食い違わないようにします。
