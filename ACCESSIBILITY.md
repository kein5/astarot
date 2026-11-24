# Accessibility

[日本語版](#アクセシビリティ日本語)

ASTAROT puts captions, text to speech and chat reading into one app, so that people who find hearing, speaking or reading hard can still hold a conversation in VRChat. This page lists the help the app gives, how the app itself tries to be easy to use, and what it cannot do yet. It describes version 0.5.0. Anything planned for a later version is marked as planned.

## Help the app gives

### Hearing

- **Real-time captions.** The app turns your microphone and the game's audio into text and shows it in the conversation log. With translation on, the translation is shown as well.
- **Desktop caption overlay.** Lines from the conversation log appear as captions on top of other windows, including VRChat played without a headset. Your own words are blue and other people's words are purple. Clicks pass through the captions to the window below.
- **VR caption overlay.** Captions appear inside SteamVR. You can change where they appear (the headset or either hand), their size, how long they stay and how see-through they are.
- **OBS browser source.** Captions can be added to a stream.
- **Planned for 0.6.0: notes for sounds.** Notes such as [applause] for sounds that are not speech ([#386](https://github.com/kein5/astarot/issues/386)). Version 0.5.0 does not have this.

### Speaking

- **Text to speech (TTS).** The app reads aloud the text you type and the translation of what you said into the microphone. To let people in VRChat hear it, the voice goes through a virtual microphone (a virtual audio cable). On Windows the app cannot create one, so it has to be installed separately.
- **Quick Chat.** A hotkey opens a small input box, so you can send a message without switching to the main window.
- **Voice changer (RVC).** Your voice is changed into the voice of the model you choose. It has its own switch, separate from text to speech.
- **Stop and mute.** Speech can be stopped, and the voice muted, from the main window or with a hotkey.
- **Planned for 0.6.0: saved phrases.** Phrases you save in advance, read aloud and sent from a hotkey ([#445](https://github.com/kein5/astarot/issues/445)). Version 0.5.0 does not have this.

### Seeing

- **Chat reading (OCR).** The app reads the text in VRChat's chat bubbles, shows it in the conversation log and the captions, and translates it. Small bubble text can be read there at the size you choose. Version 0.5.0 does not read this text aloud.
- **Font and text size.**
  - Main window: UI size, the log's font size, and the font.
  - Desktop captions: the text size (also Ctrl and + or − while the pointer is over the captions), the background's opacity, and the captions' font.
  - VR: the caption overlay's size, and the text size in the VR UI (A− and A+).
  - OBS browser source: the text size, colour and outline.

## How the app itself tries to be easy to use

- **Keyboard.** The buttons, switches, input boxes and option lists in the main window and settings are made to work with the keyboard. Sliders move with the arrow keys, Page Up, Page Down, Home and End. Option lists open with Enter, Space or the arrow keys and close with Esc. In Settings → Hotkeys you can assign keys to show or hide the window, open Quick Chat, turn translation and voice recognition on or off, stop speech, mute, and turn TTS or the voice changer on or off. No hotkey is assigned at first, and hotkeys do not work while Settings is open.
  - Moving the desktop captions by dragging needs a mouse. Choosing the top or the bottom of the screen in the settings works with the keyboard.
  - The VR UI is used with VR controllers.
- **Focus.** When you move with the keyboard, the selected control gets a blue outline.
- **Contrast.** Light text on a dark background. For some text and background pairs, tests check that the contrast is at least 4.5:1, the WCAG AA level for normal text. Not every screen has been checked.
- **Reduced motion.** When the operating system asks for less motion (on Windows, "Animation effects" turned off), the app stops its animations and transitions.
- **Languages.** The app's screens are in Japanese and English.

## Known limitations

- Screen readers cannot read the VR overlays (the VR captions and the VR UI). They are sent to SteamVR as images. The same lines can be read in the main window's conversation log.
- When a new line reaches the conversation log, screen readers are not told automatically. Move to the log to read it.
- How accurate the captions and chat reading are depends on the microphone, the noise around you, how you speak, the language, and the engine and model you choose. Mistakes happen. Check anything important with the other person.
- The app does not follow the operating system's high-contrast (forced colours) mode.
- Using every screen with the keyboard alone has not been checked from end to end.

## Getting help

- To learn how to use the app, see the user guide and [SUPPORT.md](SUPPORT.md).
- If a feature on this page does not work for you, or something is hard to use, open a [bug report](https://github.com/kein5/astarot/issues/new?template=bug_report.yml) or a [feature request](https://github.com/kein5/astarot/issues/new?template=feature_request.yml) and include "accessibility" in the title. Please say what you use (for example a screen reader or the keyboard alone) and where you got stuck.
- Remove personal data, such as voice recordings and chat text, from anything you attach. See [SUPPORT.md](SUPPORT.md).

---

## アクセシビリティ（日本語）

ASTAROT は字幕と読み上げとチャットの読み取りを1つにまとめたアプリです。聞くことや話すこと、文字を読むことに困りごとがある人も VRChat で会話できるようにします。この文書には、アプリが提供する支援と、アプリ自体の使いやすさへの配慮と、まだできないことを書きます。対象は 0.5.0 です。後の版で予定しているものは、予定と書きます。

### アプリが提供する支援

#### 聞こえの支援

- リアルタイム字幕：マイクの声とゲームの音声を文字にして、会話ログに出します。翻訳を有効にすると訳文も出ます。
- デスクトップの字幕オーバーレイ：会話ログの文をほかのウィンドウの上に字幕として重ねます。ヘッドセットを使わない VRChat の画面にも出せます。自分の発言は青、相手の発言は紫の文字です。字幕はクリックを通すので、下のウィンドウをそのまま操作できます。
- VR の字幕オーバーレイ：SteamVR の中に字幕を出します。出す位置（頭か左右の手）と大きさ、表示時間、透明度を変えられます。
- OBS ブラウザソース：配信の画面に字幕を出せます。
- 音の注記（0.6.0 で予定）：話し声でない音に、[拍手] のような注記を字幕で付けます（[#386](https://github.com/kein5/astarot/issues/386)）。0.5.0 にはありません。

#### 話すことの支援

- テキスト読み上げ（TTS）：入力した文と、マイクで話した内容の訳文を読み上げます。VRChat の相手に届けるには、声を仮想マイク（仮想ケーブル）に通します。Windows ではアプリが仮想マイクを作れないので、別に入れる必要があります。
- 入力の小窓（Quick Chat）：ホットキーで小さな入力欄を開きます。メイン画面に切り替えずに文を送れます。
- ボイスチェンジャー（RVC）：自分の声を選んだモデルの声に変えて届けます。読み上げとは別のスイッチで入り切りできます。
- 停止とミュート：読み上げの停止とミュートは、メイン画面からもホットキーからもできます。
- 定型文（0.6.0 で予定）：登録しておいた文を、ホットキーから読み上げて送ります（[#445](https://github.com/kein5/astarot/issues/445)）。0.5.0 にはありません。

#### 見えの支援

- チャット読み取り（OCR）：VRChat のチャットの吹き出しの文字を読み取って、会話ログと字幕に出し、翻訳します。吹き出しの小さな文字を好きな大きさで読めます。読み取った文の読み上げは、0.5.0 ではできません。
- 文字の大きさと書体
  - メイン画面：UI サイズ、ログのフォントサイズ、使用フォント
  - デスクトップの字幕：字幕の文字の大きさ（字幕の上にマウスを置いて Ctrl と「+」か「-」でも変えられます）、字幕の背景の濃さ、字幕の書体
  - VR：字幕オーバーレイのサイズ、VR UI の文字の大きさ（A− と A＋）
  - OBS ブラウザソース：文字の大きさ、色、縁取り

### アプリ自体の配慮

- キーボード：メイン画面と設定画面のボタン、スイッチ、入力欄、選択肢は、キーボードで操作できるように作っています。スライダーは矢印キーと Page Up、Page Down、Home、End で動きます。選択肢の一覧は Enter か Space か矢印キーで開き、Esc で閉じます。設定の「ホットキー」では次の操作にキーを割り当てられます：ウィンドウの最小化と表示、入力の小窓、翻訳と音声認識のオンとオフ、読み上げの停止、ミュート、TTS とボイスチェンジャーのオンとオフ。最初はどれも割り当てていません。設定画面を開いている間は、ホットキーは効きません。
  - デスクトップの字幕をドラッグで動かすには、マウスが要ります。設定で字幕を画面の上か下に出す選択は、キーボードでもできます。
  - VR UI は VR のコントローラーで操作します。
- フォーカスの表示：キーボードで移動すると、選んでいる部品に青い枠が付きます。
- コントラスト：暗い背景に明るい文字の配色です。一部の文字と背景の組み合わせは、コントラスト比が 4.5:1 以上（WCAG の AA の基準）あることをテストで確かめています。すべての画面を確かめたわけではありません。
- 動きを減らす：OS で動きを減らす設定にすると（Windows では「アニメーション効果」をオフ）、アプリのアニメーションと画面の移り変わりを止めます。
- 言語：画面の表示は英語と日本語です。

### 既知の制限

- VR のオーバーレイ（VR の字幕と VR UI）は、スクリーンリーダーでは読めません。SteamVR に画像として渡しているためです。同じ文はメイン画面の会話ログで読めます。
- 会話ログに新しい文が届いても、スクリーンリーダーには自動で知らせません。ログの欄に移動して読んでください。
- 字幕とチャット読み取りの精度は、マイク、周りの音、話し方、言語、選んだエンジンとモデルで変わります。誤りが出ることがあります。大事な内容は相手に確かめてください。
- OS のハイコントラスト（強制カラー）の表示には対応していません。
- すべての画面をキーボードだけで通して操作できるかは、まだ確かめ終えていません。

### 困ったときは

- 使い方はガイドと [SUPPORT.md](SUPPORT.md) を見てください。
- この文書にある配慮が使えないときや、使いにくいところがあるときは、[不具合の報告](https://github.com/kein5/astarot/issues/new?template=bug_report.yml)か[機能の要望](https://github.com/kein5/astarot/issues/new?template=feature_request.yml)を出してください。タイトルに「アクセシビリティ」と入れてください。使っているもの（スクリーンリーダー、キーボードだけ、など）と、どこで困ったかを書いてもらえると助かります。
- 添付するものからは音声やチャットの本文などの個人情報を取り除いてください。詳しくは [SUPPORT.md](SUPPORT.md) にあります。
