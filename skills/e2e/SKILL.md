---
name: e2e
description: How to run ASTAROT's real-app E2E tests (tools/native_acceptance.py) and the SERGULATH real-machine suite (Windows PC + Steam Frame) and report the results. Use when running them after a beta is published, before a stable release or after changing the native GUI, the SteamVR overlay or the installer's update path, and when posting E2E results to issues or updating the test overview and the E2E badge. Not for changes only to tests/integration (Playwright and the real core) or tests/installer, which CI runs, or for the usual unit and integration checks (python tools/dev.py check). ASTAROTの実アプリE2Eテスト（tools/native_acceptance.py）とSERGULATH実機スイート（Windows PC＋Steam Frame）の実行手順と結果報告のしかた。ベータ公開後の実機確認、安定版リリース前の確認、ネイティブGUI・SteamVRオーバーレイ・インストーラー更新経路の変更後に実機E2Eを走らせるとき、結果をIssueやテスト概要・E2Eシールドへ反映するときに使う。CIで自動実行するtests/integration（Playwright＋実コア）やtests/installerだけの修正、通常のunit・integrationチェック（python tools/dev.py check）には使わない。
---

# Running E2E tests and reporting the results

[日本語版](#e2eテストの実行と結果の報告日本語版)

This skill gathers the steps for running the E2E tests on the real app and on real machines, which the usual `python tools/dev.py check` does not include, reporting the results in one format and carrying them into the test overview and the badge.

It covers these two E2E tests.

1. **The real-app acceptance tests** (`tools/native_acceptance.py`): a suite that starts a real build (an AppImage or a built binary) on a Linux desktop and checks it
2. **The SERGULATH real-machine suite** (`kein5/sergulath`): a suite that checks how ASTAROT works on real machines, the VR overlay, a 30-minute soak and the update scenarios on a Windows PC and a Steam Frame (and a virtual HMD and virtual controllers)

The authoritative detailed steps are in each test's own documents. This skill does not copy the details of the steps, so that they are not maintained in two places.

- The authoritative source for the real-app acceptance tests: [docs/voice-stack/linux-build-pipeline.md](../../docs/voice-stack/linux-build-pipeline.md), [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md), `python tools/native_acceptance.py --help`
- The authoritative source for the SERGULATH real-machine suite: `README.md`, `docs/README.ja.md`, `docs/checks/e2e-suite.md` and `docs/checks/soak-and-upgrade.md` in the SERGULATH repository

The E2E tests that CI runs automatically (the tests in `tests/integration/` that use Playwright and the real core, and the Windows installer update scenarios in `tests/installer/`) are handled by `voice-tests.yml` and `installer-update-tests.yml`, and are not part of this skill's steps.

## 1. When to run (how this connects to the release steps)

Run the tests at the milestones below, together with the release steps ([skills/release/SKILL.md](../release/SKILL.md) and [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md)).

| Occasion | What to run | Purpose |
|---|---|---|
| Real-machine check after a beta is published | The SERGULATH real-machine suite (including `--slow`), and `native_acceptance.py` when needed | Check the published beta on a real PC and headset, and find the defects and check the carry-over across updates before moving up to the stable version |
| Check before a stable or hotfix version is published | `native_acceptance.py`, the SERGULATH real-machine suite | Check the files the release candidate build puts in place and how it works on real machines |
| Large changes to the related paths | The affected groups or cases (`--only`) | Check changes to the native GUI, Quick Chat, the VR overlay, the PipeWire virtual microphone route or the installer's updates in the real app |

## 2. Prerequisites and preparation

Check the following before you run. Do not pass an item whose prerequisites are missing on a guess; record it as skipped or unsupported.

### Common checks

- **Identify the version and build under test**: write down the version of the app you check (for example `0.7.0-beta.1`), the SHA of the commit it was built from and the name of the package file you used (an AppImage, an installer, a ZIP, a debug build or the like).
- **Make sure no one else is using the machine**: check that no other session or person is operating the same real machine at the same time. Do not run while there is a conflict.
- **Protect user data**: use an isolated settings folder for the test, so that the existing settings, API keys and downloaded models are not overwritten.

### Real-app acceptance tests (Linux)

- When the display sleeps, drawing stops and tests fail for the wrong reason, so run under `tools/display_power_guard.py` (`native_acceptance.py` itself starts each group through `display_power_guard.py`).
- Each group needs the following. A group whose prerequisites are not all in place is skipped automatically.
  - `appimage`: runs only when you give the packaged build with `--appimage`
  - `ui`: the real app can start in a desktop environment
  - `vrchat`: the `--vrchat` option and the OCR models (`ASTAROT_TEST_OCR_MODELS`, by default `~/.cache/vrct-vox-chatbox-lab/models`)
  - `vrchat-voice`: the prerequisites of `vrchat`, plus a managed virtual microphone already set up on the PC (`astarot.managed.source`) and `pw-record`
  - `quick_chat`: a KDE desktop, `xdotool` and `xprop`

### SERGULATH real-machine suite (Windows PC + Steam Frame)

The authoritative list of prerequisites is `docs/checks/e2e-suite.md` in the SERGULATH repository. Check the following before you start.

- The version of ASTAROT under test is installed on the Windows PC (`sergulath suite run` stops the default ASTAROT only while it runs, starts its own instance in the isolated folder `records/suite/app` and puts the original back when it ends).
- SteamVR and the Steam Frame are connected. Even with the headset lying on the desk, the cases that need it worn or need hand input run with the virtual HMD (`hmd`) and the virtual controllers.
- The virtual controller driver is built (if it is not, run `sergulath driver build`).
- To run the cases that look at the Frame side (E20, E23), an SSH connection to the Steam Frame (`sergulath frame`) works.

## 3. Running the tests

This section does not copy the individual steps from the authoritative documents; it shows only the commands to start from. When the arguments or the list of cases change, follow the authoritative documents.

### 3.1 Real-app acceptance tests (`tools/native_acceptance.py`)

1. Check the build under test (`--appimage` or `--app`) and the options (for every option, see `python tools/native_acceptance.py --help`). Add `--vrchat` only when you include the round trip through VRChat, and use `--only <group name>` to check particular groups again (you can give more than one). Use `--output` to choose where the records go.

   ```sh
   python tools/native_acceptance.py --appimage <path to the AppImage>
   python tools/native_acceptance.py --app <path to the built binary> --only ui
   python tools/native_acceptance.py --appimage <path to the AppImage> --vrchat --output <directory for the records>
   ```

2. Write down the exit code and each group's JUnit XML and standard output, and keep the numbers passed, failed and skipped, and the reasons for skipping.

### 3.2 SERGULATH real-machine suite

Run it at the root of the SERGULATH repository (the paths in the case definitions are relative to the repository root).

1. Check the current list of cases, whether each one can run and, for those that are unsupported, why.

   ```sh
   sergulath suite list --cases suites/astarot-e2e.toml
   ```

2. Run the suite and save the records in a record folder. At the milestones after a beta is published and before a stable version, include `--slow` too (it includes the 30-minute soak and others). To check a single case again, use `--only <case ID>`.

   ```sh
   sergulath suite run --cases suites/astarot-e2e.toml --record records/suite/<timestamp or version>
   sergulath suite run --cases suites/astarot-e2e.toml --slow --record records/suite/<timestamp or version>-slow
   sergulath suite run --cases suites/astarot-e2e.toml --only E16
   ```

3. Teardown runs even after a failure or an interruption, but if the process crashes partway and leaves the virtual HMD or the VR view behind, restore them with the recovery commands in the authoritative document (`docs/checks/e2e-suite.md`).

   ```sh
   sergulath hmd off
   sergulath view close
   sergulath app stop
   sergulath app start
   ```

## 4. Form of the results post

Leave the results where you were told to report them (the release's check issue, the related pull request, or a report to the maintainer), in the structure below. When you write in a public issue or pull request, do not include personal names that identify the PC's owner, or secrets specific to the environment.

### Status classification (aligned with SERGULATH's rules)

- **Pass (`pass`)**: a case or group that passed as expected
- **Fail (`fail`)**: a case or group where the app behaved differently from what was expected
- **Error (`error`)**: a case or group that stopped while setting up its prerequisites or starting the surrounding tools
- **Unsupported (`unsupported`)**: a case that is not yet automated or supported in the environment. Always give the reason; it does not count toward the failures
- **Manual (`manual`)**: a case that needs a person to act, such as someone wearing the headset to look. Do not mark it as passed while it has not been done; set it apart as an item for the maintainer to check
- **Skipped (`skipped`)**: a case or group that was not run because `--slow` was not given or a prerequisite of the environment was missing. Give the reason

The whole suite passes when there are 0 `fail` and 0 `error` results (`unsupported`, `manual` and `skipped` do not count as failures).

### Template for the post

```markdown
## E2E test results (<version under test> / <suite name>)

- Run at: YYYY-MM-DD HH:MM JST
- Build under test: ASTAROT <version> (commit `<short SHA>` / package file `<file name>`)
- Environment: <OS and version, headset or desktop environment (without information that identifies a person)>
- Command: `<the command you actually ran>`
- Totals: Pass X / Fail Y / Error Z / Unsupported U / Manual M / Skipped S

| Case / group | Result | Notes and reasons |
|---|---|---|
| <ID or group name> | Pass / Fail / Error / Unsupported / Manual / Skipped | <measured values, reason for skipping, reason it is unsupported> |

### Narrowing down failures and errors, and the next steps

- <case>: <whether it looks like a product defect (fail) or a setup cause (error), the logs and record paths you checked, the result of running it alone again (--only), the number of the issue you opened or refer to>
```

### Next steps after a failure or an error

1. Tell `error` results apart from `fail` results, and preserve the logs, screenshots and JSON output in the record folder.
2. Run only the failed cases once more with `--only`, and check whether the failure reproduces (whether it is constant or transient).
3. For a `fail` that reproduces, open an issue with the likely causes and the key lines of the log (add to the existing issue if there is one), and follow it with a pull request that fixes it.
4. When you cannot decide, and for `manual` items that need a person to wear the headset and check, gather the facts not yet verified and the evidence and take them to the maintainer.

## 5. Connecting to the test overview, the E2E badge and the verification records

When you finish the E2E tests at a milestone, do not stop at posting the results; bring them into the records in the repository and into the badge.

- **The test overview and the E2E badge** (`docs/testing/overview.md` and `docs/testing/badges/`)
  - The E2E badge's JSON goes in `docs/testing/badges/` in the repository, not in the `badges` branch that CI updates automatically, and is updated by hand at milestones so that its history can be followed.
  - Once the results of a milestone's real-machine E2E tests are in (from the first SERGULATH check after `0.7.0-beta.1` was published onward), update the JSON for the E2E badge (pass or fail and the date of the last check) and the date of the last check, the counts and the record links in `docs/testing/overview.md` in a pull request.
  - Every value on the badge (passed, failed, the date checked) must be backed by a link to the record of an actual run. Do not count guesses or items that were not run as passed.
- **Records of supported environments after a stable or hotfix version is published**
  - To update the real-machine verification records in [docs/voice-stack/platform-verification.md](../../docs/voice-stack/platform-verification.md) and `site/en/guide/support.md` and `site/ja/guide/support.md`, follow "Update the support matrix after publishing" in [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md).
  - Use the URL of the issue or pull request comment where you posted the E2E results as the supporting link in the verification records.

---

# E2Eテストの実行と結果の報告（日本語版）

このスキルは、通常の `python tools/dev.py check` には含まれない実アプリ・実機のE2Eテストを実行し、結果を同じ書式で報告してテスト概要とシールドへつなぐ手順をまとめます。

対象のE2Eテストは次の2つです。

1. **実アプリの受け入れテスト**（`tools/native_acceptance.py`）：Linuxデスクトップで実ビルド（AppImageまたはビルド済みバイナリ）を起動して確認するスイート
2. **SERGULATHの実機スイート**（`kein5/sergulath`）：Windows PCとSteam Frame（および仮想HMD・仮想コントローラー）でASTAROTの実機動作・VRオーバーレイ・30分ソーク・更新シナリオを確認するスイート

詳しい手順の正本はそれぞれの資料に置きます。このスキルに手順の細部を書き写して二重管理にしません。

- 実アプリの受け入れテストの正本：[docs/voice-stack/linux-build-pipeline.md](../../docs/voice-stack/linux-build-pipeline.md)、[docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md)、`python tools/native_acceptance.py --help`
- SERGULATH実機スイートの正本：SERGULATHリポジトリの `README.md`、`docs/README.ja.md`、`docs/checks/e2e-suite.md`、`docs/checks/soak-and-upgrade.md`

CIで自動実行するE2Eテスト（`tests/integration/` のPlaywright＋実コア試験、`tests/installer/` のWindowsインストーラー更新シナリオ）は `voice-tests.yml` と `installer-update-tests.yml` が受け持ち、このスキルの手順には含めません。

## 1. 実行する場面（リリース手順との接続）

リリース手順（[skills/release/SKILL.md](../release/SKILL.md) と [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md)）と連動して、次の節目に実行します。

| 場面 | 対象 | 目的 |
|---|---|---|
| ベータ公開後の実機確認 | SERGULATH実機スイート（`--slow` を含む）、必要に応じて `native_acceptance.py` | 公開したベータ版を実PC・ヘッドセットで確認し、安定版へ上げる前の不具合と更新引き継ぎを洗い出す |
| 安定版・ホットフィックス公開前の確認 | `native_acceptance.py`、SERGULATH実機スイート | リリース候補ビルドの配置物・実機動作を確かめる |
| 関連経路の大きな変更時 | 影響を受けるグループまたはケース（`--only`） | ネイティブGUI、Quick Chat、VRオーバーレイ、PipeWire仮想マイク経路、インストーラー更新の変更を実アプリで確認する |

## 2. 前提と準備

実行前に次を確かめます。前提が欠けている項目は推測で合格にせず、スキップまたは未対応として記録します。

### 共通の確認

- **対象の版とビルドの特定**：検証するアプリの版（例：`0.7.0-beta.1`）、元コミットのSHA、使った配布ファイル名（AppImage・インストーラー・ZIP・デバッグビルドなど）を控えます。
- **実機の排他確認**：同じ実機を別のセッションや作業者が同時に操作していないことを確かめます。競合する状態で実行しません。
- **利用者データの保護**：既存の設定・APIキー・取得済みモデルを上書きしないよう、テスト用の隔離された設定フォルダーを使います。

### 実アプリの受け入れテスト（Linux）

- 画面がスリープすると描画が止まり誤失敗するため、`tools/display_power_guard.py` の下で実行します（`native_acceptance.py` 自体は各グループを `display_power_guard.py` 経由で起動します）。
- グループごとの前提は次のとおりです。前提がそろっていないグループは自動でスキップ扱いになります。
  - `appimage`：`--appimage` でパッケージ版を指定したときのみ対象
  - `ui`：デスクトップ環境で実アプリを起動できること
  - `vrchat`：`--vrchat` の指定とOCRモデル（`ASTAROT_TEST_OCR_MODELS`、既定 `~/.cache/vrct-vox-chatbox-lab/models`）
  - `vrchat-voice`：`vrchat` の前提に加え、PCに設定済みの管理対象仮想マイク（`astarot.managed.source`）と `pw-record`
  - `quick_chat`：KDEデスクトップと `xdotool`、`xprop`

### SERGULATHの実機スイート（Windows PC＋Steam Frame）

前提の正本はSERGULATHリポジトリの `docs/checks/e2e-suite.md` です。着手前に次を確かめます。

- 対象版のASTAROTがWindows PCへ導入済みであること（`sergulath suite run` は実行中だけ既定のASTAROTを止め、隔離フォルダー `records/suite/app` で専用インスタンスを起動し、終了時に元へ戻します）。
- SteamVRとSteam Frameが接続されていること。机に置いた状態でも、装着や手の操作が要るケースは仮想HMD（`hmd`）と仮想コントローラーで実行されます。
- 仮想コントローラードライバーがビルド済みであること（未ビルドなら `sergulath driver build`）。
- フレーム側を参照するケース（E20、E23）を走らせる場合は、Steam FrameへのSSH接続（`sergulath frame`）が通ること。

## 3. 実行手順

正本にある個別の手順は書き写さず、入口のコマンドだけを示します。引数やケース一覧が変わったときは正本に従います。

### 3.1 実アプリの受け入れテスト（`tools/native_acceptance.py`）

1. 対象ビルド（`--appimage` または `--app`）とオプションを確かめます（全オプションは `python tools/native_acceptance.py --help` を参照します）。VRChatの往復確認を含める場合だけ `--vrchat` を付け、特定のグループだけ再確認するときは `--only <グループ名>` を使います（複数指定できます）。記録の出力先を指定するときは `--output` を使います。

   ```sh
   python tools/native_acceptance.py --appimage <AppImageのパス>
   python tools/native_acceptance.py --app <ビルド済みバイナリのパス> --only ui
   python tools/native_acceptance.py --appimage <AppImageのパス> --vrchat --output <記録先ディレクトリ>
   ```

2. 終了コードと各グループのJUnit XML・標準出力を控え、合格・失敗・スキップの件数とスキップ理由を残します。

### 3.2 SERGULATHの実機スイート

SERGULATHリポジトリのルートで実行します（ケース定義内のパスはリポジトリルート基準です）。

1. 現在のケース一覧と実行可否・未対応理由を確認します。

   ```sh
   sergulath suite list --cases suites/astarot-e2e.toml
   ```

2. スイートを実行し、記録フォルダーへ保存します。ベータ公開後や安定版前の節目では `--slow`（30分ソークなどを含む）も対象にします。個別ケースの再確認は `--only <ケースID>` を使います。

   ```sh
   sergulath suite run --cases suites/astarot-e2e.toml --record records/suite/<日時や版>
   sergulath suite run --cases suites/astarot-e2e.toml --slow --record records/suite/<日時や版>-slow
   sergulath suite run --cases suites/astarot-e2e.toml --only E16
   ```

3. 失敗や中断でもteardownは走りますが、プロセスが途中で落ちて仮想HMDやVR表示が残った場合は正本（`docs/checks/e2e-suite.md`）の復帰コマンドで元に戻します。

   ```sh
   sergulath hmd off
   sergulath view close
   sergulath app stop
   sergulath app start
   ```

## 4. 結果のポストの形

実行結果は指定された報告先（リリースの確認Issue、対応PR、または保守担当者への報告）へ次の構成で残します。公開のIssueやPRに書くときは、PC所有者を特定できる個人名や環境固有の秘密情報を含めません。

### 状態の分類規約（SERGULATHの規約にそろえる）

- **合格（`pass`）**：期待どおりに通過したケース・グループ
- **失敗（`fail`）**：アプリの振る舞いが期待と食い違ったケース・グループ
- **エラー（`error`）**：前提のセットアップや周辺ツールの起動で止まったケース・グループ
- **未対応（`unsupported`）**：現時点で自動化・環境対応していないケース。理由を必ず添え、失敗の件数には数えません
- **人手（`manual`）**：人がヘッドセットを装着して見るなど、人の操作が必要なケース。未実施のまま合格にせず、保守担当者の確認事項として切り出します
- **スキップ（`skipped`）**：`--slow` 未指定や環境前提の不足で走らせなかったケース・グループ。理由を添えます

スイート全体の合否は `fail` と `error` が0件かどうかで判定します（`unsupported`、`manual`、`skipped` は失敗に数えません）。

### ポストのテンプレート

```markdown
## E2Eテスト結果（<対象版> / <スイート名>）

- 実行日時：YYYY-MM-DD HH:MM JST
- 対象ビルド：ASTAROT <版>（コミット `<短縮SHA>` / 配布ファイル `<ファイル名>`）
- 実行環境：<OSと版、ヘッドセットまたはデスクトップ環境（個人特定情報は除く）>
- 実行コマンド：`<実際に実行したコマンド>`
- 集計：合格 X / 失敗 Y / エラー Z / 未対応 U / 人手 M / スキップ S

| ケース / グループ | 結果 | 補足・理由 |
|---|---|---|
| <IDまたはグループ名> | 合格 / 失敗 / エラー / 未対応 / 人手 / スキップ | <実測値・スキップ理由・未対応理由> |

### 失敗・エラー時の切り分けと次の一手

- <対象ケース>：<製品側の不具合（fail）かセットアップ要因（error）かの見立て、確認したログや記録パス、単独再実行（--only）の結果、起票・参照するIssue番号>
```

### 失敗・エラー時の次の一手

1. 結果が `error` か `fail` かを分け、記録フォルダー内のログ・スクリーンショット・JSON出力を保全します。
2. 失敗したケースだけを `--only` で1回再実行し、再現するか（恒常か一過性か）を確かめます。
3. 再現する `fail` は原因候補とログの要点を添えてIssueへ起票（既存Issueがあれば追記）し、修正PRへつなぎます。
4. 判断が付かない場合や、人の装着確認が要る `manual` 項目は、未確認の事実と証拠をそろえて保守担当者へ上げます。

## 5. テスト概要とE2Eシールド・検証記録との接続

節目のE2Eテストを終えたら、結果のポストだけで終わらせず、リポジトリ内の記録とシールドへ反映します。

- **テスト概要とE2Eシールド**（`docs/testing/overview.md` および `docs/testing/badges/`）
  - E2EシールドのJSONは、CI自動更新の `badges` ブランチではなくリポジトリ内の `docs/testing/badges/` に置き、履歴を追える形で節目に手動更新します。
  - 節目の実機E2E（`0.7.0-beta.1` 公開後の初回SERGULATH確認以降）の結果がそろったら、E2Eシールド用のJSON（合否と最終確認日）と `docs/testing/overview.md` の最終確認日・件数・記録リンクをPRで更新します。
  - シールドに載せる値（合格・不合格・確認日）は、必ず実測の記録リンクを裏付けにします。推測や未実施の項目を合格に含めません。
- **安定版・ホットフィックス公開後の対応環境記録**
  - [docs/voice-stack/platform-verification.md](../../docs/voice-stack/platform-verification.md) の実機検証記録と、`site/en/guide/support.md`・`site/ja/guide/support.md` の更新手順は [docs/voice-stack/release-candidates.md](../../docs/voice-stack/release-candidates.md) の「Update the support matrix after publishing」に従います。
  - E2Eテストの結果をポストしたIssueやPRのコメントURLを、検証記録の根拠リンクとして使います。
