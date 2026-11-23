# ASTAROT

## Platform
web

## Product purpose
A desktop communication application built with Tauri, React 19 and a Rust backend (up to 0.4.x the backend was a bundled Python program). It combines chat translation, transcription, text-to-speech and optional voice conversion for VRChat. The interface is a desktop WebView, not a marketing website.

## Users and operating context
The user tests on Linux and Steam Frame, communicates in Japanese, and uses the application alongside VRChat. Fast access to text input, TTS/RVC enable state, audio routes and a reliable stop/mute action matters during a conversation. Windows builds carry the same voice features through a user-installed virtual cable, and can fetch the RVC runtime after consent (Seed-VC is no longer offered from 0.5.0); physical use with VRChat on Windows remains a separate validation target.

## Capabilities and constraints
Preserve existing backend contracts, settings, translations, OSC routes, hotkeys, Quick Chat, VR panels, model-download consent, and independent TTS/RVC controls. A visual redesign must not enable a microphone, download models, send messages, or change audio routes on its own. Model guidance is advisory; performance results are hardware- and workload-specific.

## Brand commitments
The user requested the name VRCT-VOX and a full application redesign on 2026-10-30. The app is now shown as ASTAROT (ADR-011), and the repository was renamed to `kein5/astarot` at the 0.5.0 release. The executable, the application ID and the release file names keep the `vrct-vox` / `VRCT-VOX` identifiers; the storage, the packages and the rest move to ASTAROT's names as ADR-014 plans (the current table is in `docs/voice-stack/project-rename.md`). The chosen visual direction is a dark studio, calm and appropriate to an audio tool; its navy palette gave way to the ASTAROT colors, dark plum and lilac, on 2026-11-18 ([DESIGN.md](DESIGN.md)). Retain upstream licensing and acknowledgements. Japanese prose uses yomiyasu.

## Evidence
The current components live under src-ui/views. Functional tests cover voice settings, model downloads, Quick Chat and native AppImage startup. Historical acceptance reports are under docs/voice-stack; their old artifact names and measurement boundaries remain factual.

## Accessibility and implementation
Keyboard access, visible focus, readable contrast, reduced motion, long Japanese labels, window resizing, and existing font/size preferences are part of acceptance. [ACCESSIBILITY.md](ACCESSIBILITY.md) tells users which help the app gives for hearing, speaking and reading, and its known limits; keep it in step when a change adds, removes or limits one of them. Keep React 19, SCSS Modules, Jotai and i18next. The staged move to TypeScript, vanilla-extract and Radix UI follows ADR-010, with the conventions for the mixed period in [docs/development.md](docs/development.md). Do not migrate frameworks or add remote fonts.

---

# ASTAROT（日本語版）

## プラットフォーム
web

## 製品の目的
Tauri、React 19、Rustのバックエンドで作った、デスクトップで会話に使うアプリです（0.4.xまでは、同梱したPythonのプログラムがバックエンドでした）。VRChat向けに、チャットの翻訳、音声認識、テキスト読み上げ、任意で使う声質変換をまとめています。画面はデスクトップのWebViewで、宣伝用のWebサイトではありません。

## 利用者と使う状況
利用者はLinuxとSteam Frameで試し、日本語で会話し、VRChatと一緒にこのアプリを使います。会話の最中は、文字の入力、TTSとRVCのオンとオフの状態、音声の経路、確実に動く停止とミュートの操作に、すぐ手が届くことが大切です。Windowsのビルドは、利用者が入れた仮想ケーブルを通して同じ音声の機能を持ち、同意を得たあとでRVCの実行環境を取得できます（Seed-VCは0.5.0から提供していません）。WindowsでVRChatと一緒に実機で使うことは、別の検証の対象のままです。

## 機能と制約
既存のバックエンドの契約、設定、翻訳、OSCの経路、ホットキー、Quick Chat、VR UI、モデルの取得の同意、TTSとRVCの独立した操作を保ちます。見た目の作り直しが、それだけでマイクをオンにしたり、モデルを取得したり、メッセージを送ったり、音声の経路を変えたりしてはいけません。モデルの案内は目安です。性能の結果は、ハードウェアと処理の内容によって変わります。

## ブランドの約束
利用者は2026-10-30に、VRCT-VOXという名前と、アプリ全体の作り直しを依頼しました。いまアプリはASTAROTと表示し（ADR-011）、リポジトリは0.5.0のリリースのときに`kein5/astarot`へ改名しました。実行ファイル、アプリID、リリースのファイル名は、`vrct-vox`と`VRCT-VOX`の識別子のままです。保存先、パッケージ、そのほかは、ADR-014の計画どおりASTAROTの名前へ移ります（いまの表は`docs/voice-stack/project-rename.md`にあります）。選んだ見た目の方向は、音声の道具にふさわしい落ち着いた「暗いスタジオ」です。その紺の配色は、2026-11-18にASTAROTの色のダークプラムとライラックに替わりました（[DESIGN.md](DESIGN.md)）。上流のライセンスと謝辞を保ちます。日本語の文章の推敲にはyomiyasuを使います。

## 裏付け
いまの部品は`src-ui/views`にあります。機能の試験は、音声の設定、モデルの取得、Quick Chat、AppImageでのネイティブの起動を確かめます。過去の受け入れの報告は`docs/voice-stack`にあります。その中の古い成果物の名前と計測の範囲は、記録として正しいままです。

## アクセシビリティと実装
キーボードでの操作、見えるフォーカス、読みやすいコントラスト、動きを減らす設定、長い日本語のラベル、ウィンドウの大きさの変更、既存のフォントと文字の大きさの設定は、受け入れの条件に入ります。[ACCESSIBILITY.md](ACCESSIBILITY.md)は、聞く、話す、読むことについてアプリが用意している手助けと、分かっている限界を利用者に伝えます。変更でそのどれかを足したり、なくしたり、制限したりするときは、ACCESSIBILITY.mdもそろえて直します。React 19、SCSS Modules、Jotai、i18nextを保ちます。TypeScript、vanilla-extract、Radix UIへの段階的な移行はADR-010に従い、混在する期間の決まりは[docs/development.md](docs/development.md)にあります。フレームワークを移したり、リモートのフォントを足したりしません。
