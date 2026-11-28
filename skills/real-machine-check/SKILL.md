---
name: real-machine-check
description: Steps for checking ASTAROT on a real Windows PC after a beta or stable release is published. Covers installing, updating, carrying over data, the settings screen and the update channels. Use when checking, after a release, the installer and its SHA-256, the installed files and the registry, the migration from an older version and the carry-over of user data, the update channels with the SERGULATH CLI or the settings screen by eye with cua-driver. Use the e2e skill for Linux acceptance tests and the full SERGULATH E2E suite of 26 tests, and the release skill for creating and publishing the release draft. ベータ版と安定版の公開後に、Windowsの実機でASTAROTのインストール・更新・引き継ぎ・設定画面・更新チャネルを確かめる手順。公開後のWindows実機確認、インストーラー導入とSHA-256照合、旧版からの移行と利用者データ引き継ぎ確認、SERGULATH CLIでの更新チャネル確認、cua-driverによる設定画面の目視確認を行うときに使う。Linuxの受け入れテストやSERGULATHの全26件E2Eスイートはe2eスキル、リリースドラフト作成と公開はreleaseスキルを使う。
---

# Steps for checking on a real Windows PC

[日本語版](#windows実機確認の手順日本語版)

After a beta or a stable release is published, these steps check the following on a real Windows PC: installing the release files, carrying over existing data, the migration at first start, the update channels and how the settings screen works. They connect the post-release checks of the release steps ([skills/release/SKILL.md](../release/SKILL.md) and [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md)) with the E2E tests ([skills/e2e/SKILL.md](../e2e/SKILL.md)).

## 1. Checks before you start and avoiding conflicts

Before you touch the real PC, always finish the three steps below.

1. **Check that no other session is using the PC**: check that no other session or person is operating the same real Windows PC at the same time. Two sessions do not touch the real PC at the same time (to prevent conflicts over the installer's mutex against running twice and over starting the app, and sessions fighting over the screen). If another session has work that comes before or after yours, divide in advance the part you take over and the part you leave to the other session, and state it in your completion report.
2. **Identify the build**: note the version you check (for example, `0.7.0-beta.1`), the SHA of the commit it was built from and the URL of the release files (the tag page on GitHub Releases).
3. **Keep a copy and measure a baseline before installing**: before you run the installer, save a copy of the `config.json` in the current settings folder to a separate working folder, then measure and note the counts and total size (in bytes) of the three items below.
   - `config.json` (its size, the current `NEWEST_SAVING_VERSION`, the UI language setting and whether `secrets.json` exists)
   - The number of files and total bytes under `downloaded_models`
   - The number of files and total bytes under `vc_runtimes`

## 2. Getting the installer, checking its hash and installing silently

1. Download the installer of the release (`ASTAROT_setup.exe`) and `SHA256SUMS-windows` from GitHub Releases to a working folder.
2. Compute the SHA-256 of the downloaded `ASTAROT_setup.exe`, and check that it matches its line in `SHA256SUMS-windows`. If it does not match, do not run the file. Stop at once and report it.
3. If ASTAROT is running, make sure it has exited. Then run the silent install (`/S`, plus options such as `/UPDATE` as needed when you check an update), and note the exit code of the process.
   - Treat exit code `0` as success.
   - Exit code `2` means that the guard against running twice stopped the installer because another installer was running at the same time. Find out what it conflicted with, then try again.
   - Record any other nonzero exit code as a failure, and do not go further.

## 3. Checking the installed files, the registry and the shortcuts

After the install finishes, check the following by measuring it.

- **The executable's name and version**: `astarot.exe` is in the install folder (by default `%LOCALAPPDATA%\ASTAROT`), and its file version (`FileVersion` / `ProductVersion`) matches the version you check.
- **No executable of the old version left**: no executable under the old name (such as `vrct-vox.exe`) remains in the install folder.
- **Migration of the registry** (the uninstall information and the HKCU key)
  - Uninstall information: `DisplayName`, `DisplayVersion`, `InstallLocation` and `UninstallString` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT` point to the version you check (this includes checking the migration from the old key `...\Uninstall\VRCT-VOX`).
  - The app's HKCU key: `HKCU\Software\kein5\ASTAROT` (its migration from the old `HKCU\Software\kein5\VRCT-VOX` and its values) is as expected.
- **Where the shortcuts point**: the target (`TargetPath`) of the ASTAROT shortcuts (`.lnk`) in the Start menu and on the desktop is the new `astarot.exe`.

## 4. Checking that user data carries over

Compare the baseline you noted before installing with the values you measure after installing.

- `downloaded_models`: the difference in the number of files and in the total bytes is zero.
- `vc_runtimes`: the difference in the number of files and in the total bytes is zero.
- `config.json`: compared with the copy from before installing, no existing setting value is lost (migrated items that change after the first start, such as `NEWEST_SAVING_VERSION`, are checked in the next section).

Do not write "unchanged" for the number of files or the total bytes. Record the values measured before and after installing side by side.

## 5. Checking the migration at first start

Start the installed `astarot.exe`, and check the migration of the settings and whether there are errors.

- **The saved version is updated**: `NEWEST_SAVING_VERSION` in `config.json` has been updated to the version you check.
- **Check the error log**: check whether `error.log` exists in the log folder. If it exists, read its contents and timestamps, and record whether the errors come from this start or from an old log.
- **The UI language carries over**: the UI language set before installing (Japanese, English and so on) stays the same after the first start.
- **When to check the copy of the credentials**: copying the credential entries to the new name in the OS credential store (the migration of ADR-013 / ADR-014) applies only where `secrets.json` exists in the settings folder. Without `secrets.json` in the settings folder, ASTAROT by design does not read from or migrate to the OS store at all, so record this item as **not applicable** and do not count it as a failure.

## 6. Checking the update channels (SERGULATH CLI)

Check what the update channels serve with the SERGULATH CLI, not only by what the app shows.

```sh
sergulath upgrade channel --channel beta --from-version <baseline version to compare against>
sergulath upgrade channel --channel stable --from-version <baseline version to compare against>
```

- Record the `version` that the `latest.json` of both `beta` and `stable` returns, and the `newer` result (the exit code and the JSON output), with the measured values.
- Right after a beta is published, check that `beta` returns the new beta and that `stable` stays at the existing stable release.

## 7. Checking the settings screen by eye (`cua-driver`)

Operate the settings screen and check it by eye with `cua-driver`.

- **About the desktop session**: always operate from **the normal desktop session**. Do not use a separate desktop (a virtual desktop or an isolated desktop of another session), because WebView2 fails to initialize or draw there.
- **How to make the check items for the main features of the version**: from the release notes of the version you publish (the changes for users that start with `##`), pick about 3 to 5 items in advance that you check by operating the screen on the real PC, and make a checklist of them.
  - Examples (the 0.7.0 series):
    - Switching the theme (the presets and Custom), saving it and keeping it after a restart
    - Being able to choose "Original text" in "Text to speech (TTS)" → "More settings" → "Realtime microphone speech"
    - Checking that the card for adding an API in "Speech recognition (ASR)" shows and saves
  - Include in the checks the persistence of settings, which you cannot tell from only opening the screen (whether a value stays after you save it and restart the app).
- If you take screenshots, leave in the report the path where they are saved or what you checked as evidence.

## 8. Setting apart the items that need a person wearing the headset

Set apart from the automated and remote checks on the real PC the items that cannot be checked unless a person actually wears the headset, such as how the VR UI looks in the field of view, how readable the subtitles are and operating the launcher or hand tracking while wearing it.

- Always write **not done** for an item that was not done. Do not fill it with guesses or phrases such as "looks fine".
- At the end of the report, list the items that a maintainer checks while wearing the headset (the feature, what to check and the screens or overlays to look at).

## 9. The form of the report

When you finish the checks, report in the format below. Keep clearly apart **pass or fail** for each item with the measured values behind it, **not applicable** and **not done**. When you post the report to a public issue or pull request, do not include personal names that identify the owner of the PC, or secrets.

```markdown
## Results of the check on a real Windows PC (ASTAROT <version>)

- Date and time: YYYY-MM-DD HH:MM JST
- Build: ASTAROT <version> (commit `<short SHA>`, `ASTAROT_setup.exe`)
- Environment: Windows <OS name and build number> (leave out information that identifies a person)
- Scope and handover: done in this session = <scope> / left to another session or a maintainer = <scope>

| Area | Item | Status | Evidence (measured values, reason) |
|---|---|---|---|
| Install | SHA-256 check of the installer | pass / fail | The computed value matches `SHA256SUMS-windows` (first 8 digits `xxxxxxxx`) |
| Install | Exit code of the silent install | pass / fail | `exit 0` |
| Installed files | Executable name and version, removal of the old executable | pass / fail | `astarot.exe` (`<version>`) present, no `vrct-vox.exe` |
| Installed files | Registry migration (Uninstall / HKCU) | pass / fail | `DisplayVersion=<version>`, old key migrated |
| Installed files | Shortcut targets | pass / fail | `astarot.exe` in both the Start menu and on the desktop |
| Carry-over | `downloaded_models` count and size | pass / fail | Before: N files / X bytes → after: N files / X bytes (difference 0) |
| Carry-over | `vc_runtimes` count and size | pass / fail | Before: N files / X bytes → after: N files / X bytes (difference 0) |
| Carry-over | `config.json` settings carried over | pass / fail | Existing settings kept, compared with the copy |
| First start | `NEWEST_SAVING_VERSION`, `error.log`, UI language | pass / fail | `NEWEST_SAVING_VERSION=<version>`, no `error.log`, language kept |
| First start | Copy of the credentials | pass / fail / not applicable | Not applicable because there is no `secrets.json` (or the values from checking the copy) |
| Update channels | SERGULATH CLI (beta / stable) | pass / fail | `beta=<version> (newer=true)`, `stable=<version> (newer=false)` |
| Screen check | `cua-driver` check of the main features (<items>) | pass / fail | Measured results checked in the normal desktop session |
| VR headset check | <how the VR UI looks, and so on> | not done | Needs a person to wear the headset, so handed over to a maintainer |

### For the maintainers to check (items not done)

- <items a person checks while wearing the headset, and what to check>

### Remaining concerns and defects

- <defects found and points that need more investigation ("none" if there are none)>
```

---

# Windows実機確認の手順（日本語版）

ベータ版と安定版を公開したあと、Windowsの実機で配布物の導入、既存データの引き継ぎ、初回起動時の移行、更新チャネル、設定画面の動作を確かめる手順です。リリース手順（[skills/release/SKILL.md](../release/SKILL.md) と [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md)）の公開後確認と、E2Eテスト（[skills/e2e/SKILL.md](../e2e/SKILL.md)）の間をつなぎます。

## 1. 着手前の確認と競合回避

実機を触る前に、次の3つを必ず済ませます。

1. **他セッションとの排他確認**：同じWindows実機を別のセッションや作業者が同時に操作していないかを確かめます。同時に2つのセッションが実機を触りません（インストーラーの多重起動ミューテックスやアプリ起動の競合、画面操作の取り合いを防ぐため）。ほかのセッションが先行作業や後続作業を持つ場合は、自分が引き継ぐ範囲と相手に任せる範囲を事前に切り分け、完了報告に明記します。
2. **対象ビルドの特定**：確認する版（例：`0.7.0-beta.1`）、元コミットのSHA、配布物URL（GitHub Releasesのタグページ）を控えます。
3. **導入前の控えとベースライン計測**：インストーラーを実行する前に、現在の設定フォルダーにある `config.json` を別の作業フォルダーへ控えとして保存し、次の3つの件数と合計容量（バイト数）を実測して控えます。
   - `config.json`（サイズ、現在の `NEWEST_SAVING_VERSION`、UI言語設定、`secrets.json` の有無）
   - `downloaded_models` 配下のファイル件数と合計バイト数
   - `vc_runtimes` 配下のファイル件数と合計バイト数

## 2. インストーラーの取得・ハッシュ照合・サイレントインストール

1. GitHub Releasesから対象のインストーラー（`ASTAROT_setup.exe`）と `SHA256SUMS-windows` を作業フォルダーへ取得します。
2. 取得した `ASTAROT_setup.exe` のSHA-256を計算し、`SHA256SUMS-windows` の該当行と一致することを確かめます。一致しなければそのファイルは実行せず、即座に中止して報告します。
3. 実行中のASTAROTがあれば終了を確認したうえで、サイレントインストール（`/S`、更新確認時は必要に応じて `/UPDATE` などの対象オプション）を実行し、プロセスの終了コードを控えます。
   - 終了コード `0` を正常終了とします。
   - 終了コード `2` はほかのインストーラーが同時に動いているときの多重起動ガードによる終了です。競合相手を確認してからやり直します。
   - その他の非0終了コードは失敗として記録し、先へ進みません。

## 3. 配置物・レジストリ・ショートカットの確認

インストール完了後、次を実測で確認します。

- **実行ファイルの名前と版**：インストール先（既定は `%LOCALAPPDATA%\ASTAROT`）に `astarot.exe` が配置され、ファイルバージョン（`FileVersion` / `ProductVersion`）が対象版と一致すること。
- **旧版実行ファイルの残存確認**：旧名の実行ファイル（`vrct-vox.exe` など）がインストール先に残っていないこと。
- **レジストリの移行**（アンインストール情報とHKCUキー）
  - アンインストール情報：`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT` の `DisplayName`、`DisplayVersion`、`InstallLocation`、`UninstallString` が対象版を指していること（旧キー `...\Uninstall\VRCT-VOX` からの移行確認を含む）。
  - アプリのHKCUキー：`HKCU\Software\kein5\ASTAROT`（旧 `HKCU\Software\kein5\VRCT-VOX` からの移行状態と値）が期待どおりであること。
- **ショートカットの指す先**：スタートメニューとデスクトップにあるASTAROTのショートカット（`.lnk`）のリンク先（`TargetPath`）が新しい `astarot.exe` を指していること。

## 4. 利用者データの引き継ぎ確認

導入前に控えたベースラインと導入後の実測値を比べます。

- `downloaded_models`：ファイル件数と合計バイト数の差分がゼロであること。
- `vc_runtimes`：ファイル件数と合計バイト数の差分がゼロであること。
- `config.json`：導入前の控えと比べ、既存の設定値が失われていないこと（初回起動後に書き換わる `NEWEST_SAVING_VERSION` などの移行項目は次の節で確認します）。

ファイル件数や合計バイト数は「変わらない」と書かず、導入前・導入後の実測値を並べて記録します。

## 5. 初回起動の移行確認

導入した `astarot.exe` を起動し、設定の移行とエラーの有無を確かめます。

- **保存版数の更新**：`config.json` の `NEWEST_SAVING_VERSION` が対象版へ更新されていること。
- **エラーログの確認**：ログフォルダー内の `error.log` の有無を確認します。存在する場合は内容とタイムスタンプを読み、今回起動のエラーか過去ログかを区別して記録します。
- **UI言語の引き継ぎ**：導入前に設定していたUI言語（日本語・英語など）が初回起動後もそのまま保たれていること。
- **資格情報のコピー確認の条件**：OS資格情報ストアでの登録名コピー（ADR-013 / ADR-014 の移行）は、設定フォルダーに `secrets.json` が存在する環境でのみ対象になります。`secrets.json` が無い設定フォルダーではOSストアへの参照・移行自体が起きない仕様のため、この項目は **対象なし** と記録し、失敗には数えません。

## 6. 更新チャネルの確認（SERGULATH CLI）

更新チャネルの配信状態は、アプリ内の表示だけに頼らずSERGULATH CLIで確認します。

```sh
sergulath upgrade channel --channel beta --from-version <比較する基準版>
sergulath upgrade channel --channel stable --from-version <比較する基準版>
```

- `beta` と `stable` の両方の `latest.json` が返す `version` と、`newer` 判定（終了コードおよびJSON出力）を実測値ごと記録します。
- ベータ公開直後は `beta` が新しいベータ版を返し、`stable` が既存の安定版のまま据え置かれていることを確かめます。

## 7. 設定画面の目視確認（`cua-driver`）

設定画面の操作と目視確認は `cua-driver` で行います。

- **デスクトップセッションの注意**：必ず**通常のデスクトップのセッション**から操作します。分離したデスクトップ（仮想デスクトップや別セッションの隔離デスクトップ）ではWebView2の初期化や描画が失敗するため使いません。
- **その版の目玉機能の確認項目の作り方**：公開する版のリリースノート（`##` で始まる利用者向け変更）から、実機で画面を操作して確かめる項目を事前に3〜5件ほど抜き出してチェックリストを作ります。
  - 例（0.7.0系）：
    - テーマの切り替え（プリセットおよびCustom）、保存、再起動後の維持
    - 「テキスト読み上げ（TTS）」→「詳細設定」→「マイクのリアルタイム字幕の読み上げ」で「原文」を選べること
    - 「音声認識（ASR）」でのAPI追加カードの表示と保存確認
  - 確認の過程で画面を開いただけでは分からない設定の永続化（保存後にアプリを再起動して値が残るか）まで含めます。
- スクリーンショットを撮った場合は、保存先パスまたは根拠となる確認内容を報告へ残します。

## 8. 人がヘッドセットを装着しないとできない項目の切り分け

VR UIの視野内での見え方、字幕の読みやすさ、装着時のランチャーやハンドトラッキング操作など、人がヘッドセットを実際に装着しないと確かめられない項目は、自動・遠隔の実機確認から切り分けます。

- 未実施の項目は必ず **未実施** と書き、推測や「問題なさそう」という表現で埋めません。
- 保守担当者が装着して確かめる項目の一覧（対象機能、確認観点、見るべき画面やオーバーレイ）を報告の末尾に明示します。

## 9. 報告の形

確認が終わったら、次の書式で報告します。項目ごとの **合格・不合格** と実測値の根拠、**対象なし**、**未実施** を明確に区別します。公開のIssueやPRへ載せるときは、PC所有者を特定できる個人名や秘密情報を含めません。

```markdown
## Windows実機確認の結果（ASTAROT <版>）

- 実施日時：YYYY-MM-DD HH:MM JST
- 対象ビルド：ASTAROT <版>（コミット `<短縮SHA>`、`ASTAROT_setup.exe`）
- 実行環境：Windows <OS名・ビルド番号>（個人特定情報は除く）
- 作業範囲と引き継ぎ：本セッションで実施した範囲＝<範囲>／別セッション・保守担当者へ任せる範囲＝<範囲>

| 区分 | 確認項目 | 状態 | 根拠（実測値・理由） |
|---|---|---|---|
| 導入 | インストーラーのSHA-256照合 | 合格 / 不合格 | 計算値と `SHA256SUMS-windows` が一致（先頭8桁 `xxxxxxxx`） |
| 導入 | サイレントインストール終了コード | 合格 / 不合格 | `exit 0` |
| 配置物 | 実行ファイル名と版・旧実行ファイルの削除 | 合格 / 不合格 | `astarot.exe`（`<版>`）あり、`vrct-vox.exe` なし |
| 配置物 | レジストリ移行（Uninstall / HKCU） | 合格 / 不合格 | `DisplayVersion=<版>`、旧キー移行済み |
| 配置物 | ショートカットのリンク先 | 合格 / 不合格 | スタートメニュー・デスクトップとも `astarot.exe` |
| 引き継ぎ | `downloaded_models` 件数・容量 | 合格 / 不合格 | 導入前 N件 / X bytes → 導入後 N件 / X bytes（差分0） |
| 引き継ぎ | `vc_runtimes` 件数・容量 | 合格 / 不合格 | 導入前 N件 / X bytes → 導入後 N件 / X bytes（差分0） |
| 引き継ぎ | `config.json` 設定値引き継ぎ | 合格 / 不合格 | 控えと照合して既存設定維持 |
| 初回起動 | `NEWEST_SAVING_VERSION`・`error.log`・UI言語 | 合格 / 不合格 | `NEWEST_SAVING_VERSION=<版>`、`error.log` なし、言語維持 |
| 初回起動 | 資格情報のコピー確認 | 合格 / 不合格 / 対象なし | `secrets.json` なしのため対象なし（またはコピー確認値） |
| 更新チャネル | SERGULATH CLI（beta / stable） | 合格 / 不合格 | `beta=<版> (newer=true)`、`stable=<版> (newer=false)` |
| 画面確認 | `cua-driver` 目玉機能確認（<項目>） | 合格 / 不合格 | 通常デスクトップセッションで確認した実測結果 |
| VR装着確認 | <VR UIの見え方など> | 未実施 | 人のヘッドセット装着が必要なため保守担当者へ引き継ぎ |

### 保守担当者への確認事項（未実施項目）

- <人がヘッドセットを装着して確認する項目と観点>

### 残っている懸念・不具合

- <見つかった不具合や追加調査が必要な点（なければ「なし」）>
```
