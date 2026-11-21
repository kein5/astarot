---
date: 2026-11-19
status: accepted
era: rust-core
validity: current
implementation_status: pending
implementation_checked: 2026-11-19
evidence:
  - docs/adr/adr-014-internal-identifier-migration.md
  - docs/voice-stack/project-rename.md
  - src-tauri/tauri.conf.json
  - src-tauri/nsis/template.nsi
  - src-tauri/src/backend_host.rs
  - native/core/src/config/secrets/credential_manager.rs
  - native/core/src/config/secrets/secret_service.rs
  - native/audio-routing/src/pipewire/managed.rs
---
# ADR-014: 内部識別子を ASTAROT にそろえ、設定とモデルを引き継ぐ

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

インストール先の移動と実行ファイル名の変更（判断 4）で、本体のパスが変わる。Windows のファイアウォールの許可は実行ファイルのパスごとに記録されるので、更新のあとの最初の起動で確認がもう一度出る。キャンセルすると遮断の規則ができて、OSCQuery（mDNS）が届かなくなる。Windows の版によっては、マイクの許可も実行ファイルごとに聞き直される（未確認）。確認が一度で済むように、インストール先の移動と実行ファイル名の変更は同じ版で出す。リリースノートでは許可を求められたら許可すること、固定した項目を固定し直すことを案内する。#442 で直したあとは、Windows のアプリは mDNS のために受信しないので、ファイアウォールの確認は出ない（`docs/voice-stack/local-setup-windows.md`）。

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

### 2.11 旧名を読む期間（判断 9）

環境変数の旧名、所有マーカーの旧値、Linux の旧のパスのリンク、資格情報の旧名の項目、一時のストリームの旧の接頭辞は、0.6.x の間は読む（残す）。いつ外すかは 0.7.0 の計画で決める。

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
