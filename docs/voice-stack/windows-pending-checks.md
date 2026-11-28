# Changes not yet checked on Windows (2026-11-13)

[日本語版](#windowsで未確認の変更--2026-11-13日本語版)

This is a list of the changes that went into `develop` after 0.1.0-beta.6 (2026-11-12, `efa73156`) and have not been checked on a real Windows machine. Development and verification moved from a Linux PC to a Windows PC on 2026-11-13.

Remove a row from this list once it is checked. Write the result in the [Windows voice verification record](windows-voice-report.md) or in the relevant spec. The steps for the field tests are in [Windows field tests](windows-field-tests.md).

## What has been checked

- The changes in this period were checked screen by screen by running the real app on a CachyOS PC (KDE Plasma, Wayland).
- On Windows, the CI jobs `backend-windows` and `headless (windows-latest)` pass. Both are Python tests. They do not cover the screens, rendering in WebView2, the real VRChat or key input.
- On 2026-11-13, the screen changes were checked with a development build on Windows 11. Hotkeys, the main screen's bar and sidebar, the layout of the settings pages, the position of notices, the display of messages that were not sent, detection of the real VRChat and downloading the translation model after consent are confirmed. The results are in the "Screen changes after beta.6" section of the [verification record](windows-voice-report.md).
- On 2026-11-14, the 0.1.0-beta.7 package (`VRCT-VOX.zip`) was extracted into a working folder and started. Starting and quitting, the usage data notice and sending, each settings page, the desktop caption overlay, and everything from downloading the translation model to translating are confirmed. The steps are in [Release candidates](release-candidates.md), in the section on starting the Windows package to check it before publishing.
- The app installed on a PC with the installer and the CUDA package have not been started.

## What to check on Windows

| Change | What to check | Why it remains |
|---|---|---|
| Translation model download (#213) | In the app installed with the installer, look at where the downloaded model is saved. | The 0.1.0-beta.7 package was extracted and started, and the steps from consent to a translation appearing were confirmed, as was the model going into `weights` next to the executable. This was not looked at in the app installed with the installer. |
| Mute sync guidance (#208) | Turn it on in a state where mute sync cannot be used, such as sending to another machine, and see that the reason appears in the display language. | No state where it cannot be used was set up. Switching it in a state where it can be used was confirmed. |
| Startup warning (#205) | Right after startup, see that the warning appears only when it applies. | The screen was looked at 25 seconds or more after startup, so the warning, which disappears after 10 seconds, was not seen. |
| Desktop caption overlay (#229) | Look at captions produced by speech recognition of the microphone. Also look at the position on a monitor at 150% scaling or higher. | Appearing over VRChat in windowed and full-screen mode, passing clicks through and not changing the foreground window were confirmed with text passed directly to the caption window. Captions from speech recognition of game audio were confirmed to appear without starting VRChat (#231). Scaling was checked at 125% and 100%. |
| Telling speakers apart (#231) | In conversation between human voices, see how well the speaker labels match. Also look at a real VRChat conversation, the combination with Haas-ja, and the app installed with the installer. | Checked with conversations of 2 to 6 people made with TTS voices. In the development build, downloading after consent, applying the model, and display in the log and the caption overlay were confirmed. The results are in [Choosing and testing speaker diarization](speaker-diarization-2026-11-13.md). |

VRChat detection (#221) changed to "found" 17.7 seconds after the VRChat process appeared, and to "not found" 3.5 seconds after the process ended (once each on this Windows 11 PC). On the Linux PC it took 6 to 8 seconds after start and 3 to 4 seconds after exit (twice each). The Linux values were recorded only as "after start", so it is not known whether they were measured from the same point as the Windows values.

## Changes that do not need checking on Windows

The following changes only touch the tools for Linux field tests. They assume PipeWire, KDE and XWayland, and do not run on Windows.

- #202, #204, #207, #209: the Linux native tests and the AppImage tests
- #211, #212, #214: `tools/native_acceptance.py` and `tools/vrchat_voice_host.py` (acceptance tests that use real models and VRChat)

## Not checked on either OS

- Reading by a screen reader.
- Cloud speech recognition with a real key entered. The collapsed view of the endpoints from #223 was looked at without a key.
- The "Realtime captions" section of the speech recognition page is not collapsed. It remains the longest section on the page.

The items still unchecked on Linux (a real headset, desktops other than KDE and so on) are in the limitations section of the [README](/README.md).

## Worth fixing

- The favicon in the main screen's HTML (`src-ui/index.html`) is still the original VRCT icon (`chato_icon_fill.png`). It does not appear in the app window, only in the developer tools tab. This applies to both OSes.
- The screen that downloads models at startup and the screen shown during an update have not actually been displayed since their images were replaced with VRCT-VOX ones (#228). The normal startup screen was checked.

## Release status

- 0.1.0-beta.7 and the stable 0.1.0 were published on 2026-11-14. In the Windows packages up to 0.1.0-beta.6, local translation could not be turned on ([Release candidates](release-candidates.md) has the cause and the steps to check it with a package). The 0.1.0 package (`VRCT-VOX.zip`) was checked for the same items as beta.7.
- The user documents (`site/`) and the screenshots were remade for the 0.1.0 screens on 2026-11-14. They also show the desktop caption overlay section and the speaker diarization model field (#231). The screenshots were drawn by `tools/docs_screenshots.py` from sample data, without real models or VRChat.

---

# Windowsで未確認の変更 — 2026-11-13（日本語版）

0.1.0-beta.6（2026-11-12、`efa73156`）のあとに`develop`へ入った変更のうち、Windowsの実機で確かめていないものの一覧です。開発と検証は、2026-11-13にLinuxのPCからWindowsのPCへ移りました。

確かめた行は、この一覧から消してください。結果は、[Windows音声の検証記録](windows-voice-report.md)か、該当する仕様に書きます。実機試験の手順は[Windowsの実機試験](windows-field-tests.md)にあります。

## 確かめてある範囲

- この期間の変更は、CachyOS（KDE Plasma、Wayland）のPCで、実際のアプリを動かして画面ごとに確かめました。
- Windowsでは、CIの`backend-windows`と`headless (windows-latest)`が通っています。どちらもPythonの試験です。画面、WebView2での描画、実物のVRChat、キーの入力は含みません。
- 2026-11-13にWindows 11の開発用のビルドで画面の変更を確かめました。ホットキー、メイン画面の帯とサイドバー、設定のページの構成、お知らせの位置、送らなかったメッセージの表示、実物のVRChatの検出、同意したあとの翻訳モデルの取得は確認済みです。結果は[検証記録](windows-voice-report.md)の「beta.6のあとの画面の変更」にあります。
- 2026-11-14に、0.1.0-beta.7の配布物（`VRCT-VOX.zip`）を作業用のフォルダーへ展開して起動しました。起動と終了、利用状況のお知らせと送信、設定の各ページ、デスクトップの字幕オーバーレイ、翻訳モデルの取得から翻訳までは確認済みです。手順は[配布候補](release-candidates.md)の「公開前にWindowsのパッケージを起動して確かめる」にあります。
- インストーラーでPCに入れたアプリと、CUDA版の配布物は起動していません。

## Windowsで確かめること

| 変更 | 確かめること | 残っている理由 |
|---|---|---|
| 翻訳モデルの取得（#213） | インストーラーで入れたアプリで、取得したモデルの保存先を見る。 | 0.1.0-beta.7の配布物を展開して起動し、同意してから訳文が出るまでと、モデルが実行ファイルの隣の`weights`に入ることを確認した。インストーラーで入れたアプリでは見ていない。 |
| ミュート同期の案内（#208） | 送信先を別のマシンにするなど、ミュート同期が使えない状態でオンにして、理由が表示の言語で出ることを見る。 | 使えない状態を作っていない。使える状態での切り替えは確認した。 |
| 起動時の警告（#205） | 起動してすぐの画面で、警告が該当するときだけ出ることを見る。 | 画面を見たのが起動から25秒以上あとで、10秒で消える警告は見ていない。 |
| デスクトップの字幕オーバーレイ（#229） | マイクの音声認識から出た字幕を見る。表示倍率150%以上のモニターでの位置も見る。 | VRChatのウィンドウ表示とフルスクリーンの上に出ること、クリックを通すこと、前面のウィンドウを変えないことは、字幕のウィンドウへ直接渡した文で確認した。ゲーム音声の音声認識から出た字幕が出ることは、VRChatを起動せずに確認した（#231）。表示倍率は125%と100%で見た。 |
| 話者の聞き分け（#231） | 人の声の会話で、話者のラベルがどれくらい合うかを見る。VRChatの実際の会話、Haas-jaとの組み合わせ、インストーラーで入れたアプリでも見る。 | 読み上げの声で作った2〜6人の会話で確かめた。開発用のビルドでは、同意してからの取得、適用、ログと字幕オーバーレイへの表示までを確認した。結果は[話者分離の選定と試験](speaker-diarization-2026-11-13.md)にある。 |

VRChatの検出（#221）はVRChatのプロセスが現れてから17.7秒で「検出しました」に、プロセスが終わってから3.5秒で「検出できません」に変わりました（Windows 11のこのPCで各1回）。LinuxのPCでは起動してから6〜8秒、終了してから3〜4秒でした（各2回）。Linuxの値は「起動してから」とだけ記録していて、測りはじめがWindowsの値と同じかは分かりません。

## Windowsでは確かめなくてよい変更

次の変更は、Linuxの実機試験の道具だけを変えています。PipeWire、KDE、XWaylandを前提にしていて、Windowsでは動きません。

- #202、#204、#207、#209: Linuxのネイティブ試験とAppImageの試験
- #211、#212、#214: `tools/native_acceptance.py`と`tools/vrchat_voice_host.py`（実物のモデルとVRChatを使う受け入れ試験）

## どちらのOSでも確かめていないこと

- スクリーンリーダーでの読み上げ。
- 実際のキーを入れたクラウドの音声認識。#223で接続先を折りたたんだ表示は、キーがない状態で見た。
- 音声認識のページの「リアルタイム字幕」の欄は、折りたたんでいない。ページの中でいちばん長い欄として残っている。

Linuxで残っている未確認（実物のヘッドセット、KDE以外のデスクトップなど）は、[README](/README.md)の制限の節に書いてあります。

## 直すとよいこと

- メイン画面のHTML（`src-ui/index.html`）のfaviconが本家VRCTのアイコン（`chato_icon_fill.png`）のままです。アプリのウィンドウには出ず、開発者ツールのタブにだけ出ます。どちらのOSにも当てはまります。
- 起動時にモデルを取得する画面と更新中の画面は、画像をVRCT-VOXのものに替えたあと（#228）実際には表示していません。通常の起動の画面は確認しました。

## 公開の状態

- 0.1.0-beta.7と正式版の0.1.0は、2026-11-14に公開しました。0.1.0-beta.6までのWindowsの配布物では、ローカル翻訳をオンにできませんでした（[配布候補](release-candidates.md)に原因と、配布物で確かめる手順があります）。0.1.0の配布物（`VRCT-VOX.zip`）でも、beta.7と同じ項目を確かめています。
- 利用者向けの文書（`site/`）とスクリーンショットは、2026-11-14に0.1.0の画面に合わせて作り直しました。デスクトップの字幕オーバーレイの節と、話者分離モデルの欄（#231）も写っています。スクリーンショットは`tools/docs_screenshots.py`が見本のデータで描いたもので、実物のモデルやVRChatは使っていません。
