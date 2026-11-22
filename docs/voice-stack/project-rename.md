# ASTAROTの名称と識別子

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

次の名前は旧名のままです。リポジトリは0.5.0のリリースのときに`kein5/astarot`へ改名しました（[リポジトリ名の変更手順](repository-rename.md)）。旧名の`kein5/VRCT-VOX`はいま、転送ページと0.5.0のリリースの複製だけを持つ別のリポジトリで、GitHubは旧名から転送しません。ほかの名前は内部識別子として扱い、表示名と一緒には変えません。0.6.0で、[ADR-014](../adr/adr-014-internal-identifier-migration.md)のとおりASTAROTの名前へ移します（ADR-011のP2）。この文書の表は、それぞれの変更が入るまで今の値を示します。配布物の名前は、インストーラーとupdaterが名前で探します。

| 対象 | 名称 |
|---|---|
| Pythonバックエンドの実行名（0.4まで。0.5.0の配布物には入らない） | `vrct-vox-sidecar` |
| Linuxの配布物 | `VRCT-VOX-<version>-linux-x64-release.tar.gz`、同名の`.AppImage`、`.deb`、`.rpm`（0.4までは`linux-x64-vulkan`か`linux-x64-cpu`） |
| Windowsの配布物 | `VRCT-VOX.zip`、`VRCT-VOX_setup.exe`。0.5.xまでは `VRCT-VOX_cuda.zip` も配布。ビルドが作るインストーラーは0.5.1から`ASTAROT_<version>_x64-setup.exe`で、リリースでは`VRCT-VOX_setup.exe`の名前で載せる |

## 識別子と保存先

次の値は設定・データの保存先やOSとの連携に使います。変更すると既存の設定や連携を引き継げなくなるため、変える場合は移行処理を伴わせてください。Rustのコードが使う値は`native/app-identity`に、旧名とASTAROTの名前の組で定義してあります。名前を移すPRは、そこで書く名前を切り替えます。

| 対象 | 値 |
|---|---|
| 本体の実行ファイル | 0.7.0から`astarot`（Windowsは`astarot.exe`）。0.6.xまでは`vrct-vox`（`vrct-vox.exe`）。Cargoの`[[bin]]`と`tauri.conf.json`の`mainBinaryName`で決める（npmとCargoのパッケージ、開発用のPythonのプロジェクト（`pyproject.toml`）も0.6.0より後の版から`astarot`）。Linuxのウィンドウのクラスと`StartupWMClass`はこの名前に従う。Windowsのインストーラーは更新のときに`vrct-vox.exe`を置き換え、自分が作ったショートカットを付け替える（[本体の実行ファイルの名前](../spec/data-and-persistence.md#本体の実行ファイルの名前)） |
| Linuxのパッケージ | 0.7.0から、debとrpmのパッケージ名は`astarot`で、`/opt/astarot`に入り、コマンド`/usr/bin/astarot`、デスクトップエントリー`astarot.desktop`（`Exec`と`StartupWMClass`も`astarot`）、アイコン`astarot.png`を置く。AppImageの中の同梱のファイルは`usr/lib/astarot`、tar.gzは`ASTAROT`に展開する。0.6.xまではどれも`vrct-vox`（tar.gzは`VRCT-VOX`）。新しいパッケージは旧のパッケージ`vrct-vox`を置き換え、0.7.xの間は`/usr/bin/vrct-vox`も同じ実行ファイルを起動する（[Linuxのパッケージの名前](../spec/data-and-persistence.md#linuxのパッケージの名前)） |
| TauriアプリID | 0.7.0から`io.github.kein5.astarot`（0.6.xまでは`io.github.kein5.vrct-vox`）。Tauriのデータのフォルダー、Waylandのportalのアプリ、単一起動の名前がこのIDに従う |
| Linuxの設定保存先 | 0.6.0から`$XDG_CONFIG_HOME/astarot`、既定は`~/.config/astarot`。0.5.xの`vrct-vox`は起動の最初に移し、旧名には新しいフォルダーを指すリンクを0.6.xの間残す（[Linuxの保存先の移動](../spec/data-and-persistence.md#linuxの保存先の移動)） |
| Linuxのデータ保存先 | 0.6.0から`$XDG_DATA_HOME/astarot`、既定は`~/.local/share/astarot`。移し方は設定保存先と同じ |
| Linuxのキャッシュ保存先 | なし。0.4までのPythonバックエンドだけが`$XDG_CACHE_HOME/vrct-vox`（既定は`~/.cache/vrct-vox`）を使った |
| 環境変数 | 0.6.0から`ASTAROT_*`。利用者とパッケージ作成者向けの4つ（`ASTAROT_CONFIG_DIR`、`ASTAROT_DATA_DIR`、`ASTAROT_TELEMETRY`、`ASTAROT_OPENVR_API`）は先に読み、なければ0.5.xの`VRCT_*`の名前を読む。旧名は0.6.xの間読む。`ASTAROT_TELEMETRY`と`VRCT_TELEMETRY`は、どちらかが`off`なら送信を止める。開発、試験、ビルド、プロセスの受け渡しの変数（`ASTAROT_VR_PANEL_DIR`、`ASTAROT_LINUX_BUNDLE`、`ASTAROT_TEST_*`など）は、旧名を読まない。`VRCT_CACHE_DIR`などは0.4までのPythonバックエンドだけが読んだ |
| Windowsのインストール先を記録するキー | 0.7.0から`ASTAROT`（`HKCU\Software\kein5\ASTAROT`と、アプリの一覧の`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT`）。0.6.xまでは`VRCT-VOX`。インストーラーは新しいキーを先に読み、なければ旧のキーを読む。新しいキーを書いてから旧のキーを消す（[Windowsのインストール先の移動](../spec/data-and-persistence.md#windowsのインストール先の移動)） |
| 音声経路と仮想マイク | `vrct.managed.*`ノード、`vrct-managed-*.service`、所有者識別子`vrct-vox-service-v1` |
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
