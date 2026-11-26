# Quick Chat window

[日本語版](#チャット入力の小窓日本語版)

A key you set opens an input-only window without bringing the main window to the front. By default no key is
assigned. The "Open input window" button in the hotkey settings also opens it.
Each time it opens, the window is set to always-on-top and then shown, unminimized and given focus.
While it is shown, it stays in front of other normal windows. The main window's minimized state is not changed.
The hotkey opens the window when the key is released.
Esc or the window's close action hides it, and the draft is kept until the app exits.
Enter sends, and Shift+Enter starts a new line. The window follows the main window's setting that disables sending with Enter, and its auto-clear setting.
Enter during IME composition and key repeats do not send.

## Handing over to the main window

The window's entry point is `src-ui/quick-chat.html`. It does not load the main window's App or StartPythonController.
The window label is `quick_chat`, and the size is 480×160 (minimum 320×120). The same window is reused.

1. The window passes a UUID and the text to a native command. Rust checks the actual caller's label, the ID format and
   whitespace-only input, and holds one request at a time.
2. The event sent to the main window carries no text; it only signals that a request exists.
   The main window takes the pending request from a native command, once. It never sends from an arbitrary event payload.
3. The main window's `useMessage.sendMessage` passes the text to `/run/send_message_box` on the backend (the Rust core inside the app from 0.5.0, the Python sidecar up to 0.4).
   History, translation, OSC and TTS take the same path as in the main window. The Quick Chat window does not start the backend.
4. A repeated signal with the same ID does not send again. The results of the last 64 handovers are kept.
   The send confirmation means that the request was written to the backend (`backend_write` in 0.5.0, the sidecar's stdin up to 0.4); it is not a notice that translation or audio playback finished.

While a send is pending, the input and the send button are locked. If no confirmation arrives within 5 seconds, the window shows the reason,
and it does not allow the next send until the confirmation comes. A failure or a missing confirmation does not erase the draft. The shared send hook
also rejects text that is only whitespace. The main window defines no maximum length for chat text, so
no character limit or truncation is added for the Quick Chat window alone. The OSC display handling also stays as it was.

The `quick-chat` capability applies only to the Quick Chat window and allows only subscribing to and unsubscribing from events.
Each new native command checks for `main` / `quick_chat`. No shell or file
permissions are added to the window. Handover is refused while the settings page is open (in a browser) or while the main window is getting ready. The settings window does not refuse it (#1236).

## Shortcuts and Wayland

On Windows, X11 and XWayland, the existing Tauri global-shortcut plugin is reused. The local source of the pinned dependency `global-hotkey` (0.8.0 as of 2026-11-23)
supports only X11 on Linux. On native Wayland, the GlobalShortcuts portal is used (below).
A HOTKEYS setting that has only the earlier 4 entries keeps its values and gets `open_quick_chat: null` added.

The [GlobalShortcuts portal specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)
defines CreateSession, BindShortcuts and notification through Activated.
The `activation_token` from Activated is used to activate the target window.
Registration alone does not guarantee that the focus moves.

At first (2026-10-29), no registration was attempted on native Wayland, and the app told users to open the window with the button.
From 2026-10-31, the key is registered through the portal (`src-tauri/src/portal_shortcuts.rs`). The portal identifies the app by an installed
desktop file, so if none is provided otherwise, the app creates `~/.local/share/applications/io.github.kein5.astarot.desktop` (`io.github.kein5.vrct-vox.desktop` up to 0.6.x).
A key press arrives as a portal signal and is passed to the main window. The first time, the desktop shows a confirmation dialog.
On KDE, the key given to the portal is only the initial value for a new registration, so ASTAROT also writes its key to kglobalaccel
and reads back the key KDE actually uses. If a different key remains, the app says so.
KDE's portal passes no activation token on a key press, so a shown Quick Chat window behind the game
is brought to the front with a KWin script that targets only the windows of the app's own process. On other desktops, the app makes only the normal show request.
If the portal is not supported or registration fails, the app shows the reason and how to open the window with the button.
On XWayland, the existing registration is attempted, and the app shows that the key and the focus may be limited by
the desktop while you are using another Wayland app. OS registration errors and failures of the window show and focus APIs are also reported.
Behavior on real Windows hardware, with a physical IME and while typing in VRChat is not verified.

A default Y key assignment, a mechanism that keeps arbitrary keys from reaching VRChat, and an input panel in VR space are not included.

## Showing the window in front of the game

Moving the focus alone leaves the window hidden behind a game set to always-on-top, so the Quick Chat window is also set to always-on-top.
On Linux, the show, unminimize and focus requests run in order on the GTK main thread.
A global key on X11/XWayland is not a GTK input event, so the usual
`present_with_time(GDK_CURRENT_TIME)` uses an old GTK input time, and KWin may refuse
focus. The X server time is fetched at the moment of each request and passed in.
Before it is fetched, the property-change event mask that `get_server_time` requires is added.
GTK and gdkx11 are declared as direct Linux dependencies at the same versions already in the lockfile, so nothing new is downloaded.
On Wayland, no X11 functions are called; the normal GTK show request is used.

A case was also confirmed where moving the focus while an X11 key press is being handled keeps global-hotkey from receiving the key release,
so the key stays pressed and the next press is ignored. Quick Chat therefore opens on the
`Released` event and moves the focus after the key is released. Other hotkeys stay on
`Pressed` as before. The diagnosis was done on a separate copy of the library, and the pinned dependency itself is not changed.

References: [GTK show request](https://docs.gtk.org/gtk3/method.Window.present_with_time.html),
[X server time and the event mask requirement](https://docs.gtk.org/gdk3-x11/func.x11_get_server_time.html).

The regression test places a dedicated full-screen, always-on-top GTK window on the same monitor, and also checks that the two windows
actually overlap. For the first open, after Esc, after minimizing and for a repeat call while the window is shown, it checks
the stacking order, the input focus, that the main window stays minimized and that the draft is kept.

In the final check on 2026-10-29, 3 native tests passed, and the 4 foreground patterns also passed 2 more runs.
The existing translation, OSC and TTS sends happened once each, and the sidecar stayed a single process. The 4 browser and settings regression tests and
the 2 Rust tests also passed. The real VRChat, an HMD and Windows were not part of this test.
The fixed build was generated locally in `build/quick-chat-foreground-artifacts/`, and the old candidate was kept.
The AppImage's SHA-256 is `11c9d3e8cd34836223e9b48fb42c78754fee59aa5f8b26aa55d9f404e71a0e17`.

---

# チャット入力の小窓（日本語版）

本体を前面へ戻さず、設定したキーで入力専用のウィンドウを開く。初期状態ではキーを
割り当てない。ホットキー設定の「入力の小窓を開く」ボタンでも開ける。
小窓は開くたびに最前面へ指定してから表示・最小化解除・フォーカス移動する。
表示中は他の通常ウィンドウより手前に保つ。本体の最小化状態は変更しない。
ホットキーはキーを離した時点で小窓を開く。
Escまたはウィンドウの閉じる操作で非表示にし、終了するまでは下書きを保持する。
Enterで送信、Shift+Enterで改行する。本体の「Enter送信を無効にする」と自動クリア設定を引き継ぐ。
IME変換中のEnterとキーリピートは送信しない。

## 本体への受け渡し

小窓のエントリーは `src-ui/quick-chat.html`。本体のAppやStartPythonControllerを読み込まない。
ウィンドウlabelは `quick_chat`、サイズは480×160（最小320×120）。同じウィンドウを再利用する。

1. 小窓はUUIDと文字列をnative commandへ渡す。Rustは実際の呼出元label、ID形式、空白だけの
   入力を検証し、一度に一件の要求を保持する。
2. 本体宛てのイベントには本文を載せず、要求があることだけを通知する。
   本体はnative commandから未処理の要求を一度だけ取り出す。任意のイベント本文から送信しない。
3. 本体の `useMessage.sendMessage` がバックエンド（0.5.0からはアプリの中のRustの中核、0.4まではPythonのsidecar）の `/run/send_message_box` へ渡す。
   履歴、翻訳、OSC、TTSは本体と同じ経路になる。小窓はバックエンドを起動しない。
4. 同じIDの再通知では再送しない。直近64件の受け渡し結果を保持する。
   送信確認はバックエンドへの要求の書き込み（0.5.0では`backend_write`、0.4まではsidecarのstdin）の完了であり、翻訳や音声再生の完了通知ではない。

送信待ち中は入力と送信ボタンをロックする。5秒で確認が届かなければ理由を表示し、
確認が来るまで次の送信を許可しない。失敗や未確認で下書きを消さない。空白だけの本文は
共通送信hookでも拒否する。本体にはチャット本文の最大長が定義されていないため、
小窓だけの文字数制限や切り詰めは追加しない。OSCの表示処理も既存のまま。

`quick-chat` capabilityは小窓だけを対象にし、イベント購読・解除だけを許可する。
新規native commandはそれぞれ `main` / `quick_chat` を検証する。シェルやファイル操作の
権限を小窓へ追加しない。設定のページが開いている間（ブラウザーのとき）や本体が準備中は受け渡しを拒否する。設定のウィンドウでは拒否しない（#1236）。

## ショートカットとWayland

Windows、X11、XWaylandでは既存のTauri global-shortcut pluginを再利用する。固定依存 `global-hotkey`（2026-11-23 時点で 0.8.0）の
ローカルソースはLinuxをX11のみとしている。ネイティブWaylandではGlobalShortcuts portalを使う（下記）。
過去の4項目だけを持つHOTKEYS設定は、値を保持したまま `open_quick_chat: null` を補う。

[GlobalShortcuts portalの原典](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)
では、CreateSession、BindShortcuts、Activatedによる通知を定義している。
Activatedの `activation_token` は対象ウィンドウをアクティブにするために使う。
登録だけでフォーカス移動まで保証できるものではない。

当初（2026-10-29）はネイティブWaylandで登録を試みず、ボタンでの開き方を案内していた。
2026-10-31からはportalで登録する（`src-tauri/src/portal_shortcuts.rs`）。portalはインストール済みの
desktop fileでアプリを識別するため、ほかに用意されていなければ `~/.local/share/applications/io.github.kein5.astarot.desktop` を作る（0.6.xまでは `io.github.kein5.vrct-vox.desktop`）。
押下はportalのシグナルとして受け取り、本体ウィンドウへ渡す。初回はデスクトップが確認画面を出す。
KDEではportalの指定キーが新規登録時の初期値にしかならないため、ASTAROTのキーをkglobalaccelにも書き込み、
KDEが実際に使うキーを読み戻す。別のキーが残った場合はその旨を表示する。
KDEのportalは押下時にactivation tokenを渡さないため、ゲームの背面にある表示中の小窓は、
自プロセスのウィンドウだけを対象にしたKWinスクリプトで前面に出す。ほかのデスクトップでは通常の表示要求だけを行う。
portalに対応していない場合や登録に失敗した場合は、理由とボタンでの開き方を表示する。
XWaylandでは既存登録を試みるが、他のWaylandアプリを操作しているときのキーとフォーカスは
デスクトップの制限を受け得る旨を表示する。OS登録エラーとウィンドウ表示・フォーカスAPIの失敗も通知する。
Windowsでの実機動作、物理IME、VRChat入力中の挙動は未検証。

Yキーの既定割当て、任意キーをVRChatへ渡さない仕組み、VR空間の入力パネルは含めない。

## ゲームより手前に表示する処理

フォーカス移動だけでは、最前面指定のゲームに隠れるため、小窓にも最前面指定を行う。
LinuxではGTKのメインスレッド上で表示・最小化解除・フォーカス要求を順に実行する。
X11/XWaylandのグローバルキーはGTKの入力イベントではないため、通常の
`present_with_time(GDK_CURRENT_TIME)` は古いGTK入力時刻を使い、KWinにフォーカスを
拒否される場合がある。今回の要求時にXサーバーの時刻を取得して渡す。
`get_server_time` の前提であるproperty-changeイベントマスクを追加してから取得する。
GTKとgdkx11は元からlockfileにある同じ版をLinuxの直接依存として指定し、追加取得はしない。
WaylandではX11の関数を呼ばず、GTKの通常の表示要求を使う。

また、X11のキー押下処理中にフォーカスを移すと、global-hotkeyがキー解放を受け取れず
押下中の状態が残り、次の押下を無視するケースを確認した。Quick Chatの起動は
`Released` イベントで行い、キーの解放後にフォーカスを移す。他のホットキーは従来の
`Pressed` のまま。診断は専用のライブラリコピーで行い、固定依存の本体は変更しない。

参照: [GTKの表示要求](https://docs.gtk.org/gtk3/method.Window.present_with_time.html)、
[Xサーバー時刻とイベントマスクの条件](https://docs.gtk.org/gdk3-x11/func.x11_get_server_time.html)。

回帰テストは専用の全画面・最前面GTKウィンドウを同じモニターに置き、両窓が実際に
重なる座標であることも検査する。初回・Esc後・最小化後・表示中の再呼び出しについて、
重なり順、入力フォーカス、本体の最小化維持、下書き保持を調べる。

2026-10-29の最終確認ではネイティブ試験3件が成功し、前面表示の4パターンは追加2回も成功した。
既存の翻訳・OSC・TTS送信は各1回、sidecarは1プロセスのまま。ブラウザ・設定回帰4件と
Rust試験2件も成功した。実VRChat・HMD・Windowsはこの試験に含めていない。
修正版は `build/quick-chat-foreground-artifacts/` にローカル生成し、旧候補は維持した。
AppImageのSHA-256は `11c9d3e8cd34836223e9b48fb42c78754fee59aa5f8b26aa55d9f404e71a0e17`。
