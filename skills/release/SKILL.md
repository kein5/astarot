---
name: release
description: Steps for releasing an ASTAROT version. Covers the beta change freeze, the release/X.Y.Z branch, version bump, CHANGELOG, release notes (docs/release-notes), candidate builds, the draft from "Prepare verified ASTAROT release draft", checks before publishing (tag_name, real PCs, telemetry), publishing, checks after it (latest, the Worker's latest.json, asset count), the support matrix and verification records, merging main back into develop and stopping delivery. Use when asked to prepare, draft, publish, check or halt a release (beta, stable or hotfix), bump a version or write release notes. Not for ordinary pull requests (pull-request skill). ASTAROTの版を出す手順。ベータ期間の変更凍結、release/X.Y.Zブランチ、版上げとCHANGELOG、リリースノート（docs/release-notes）、候補のビルド、「Prepare verified ASTAROT release draft」での下書き、公開前のtag_name・実機・テレメトリの確認、公開、公開後のlatest・Workerのlatest.json・資産の件数の確認、対応環境の表と検証の記録の更新、mainをdevelopへ戻す統合、問題が見つかったときの配信停止を扱う。リリース、版上げ、ベータ、正式版、ホットフィックスの版、下書き、公開、リリースノート、配信停止を頼まれたときに使う。通常のPRはpull-requestスキル。
---

# Releasing a version

[日本語版](#版を出す日本語版)

Versions are published on GitHub Releases. A workflow makes the draft, and the maintainer publishes it after checking the draft.

- Do not create tags by hand, and do not push them. Do not use `cog bump` either. GitHub creates the tag when the draft is published.
- Do not delete or move published releases and tags.
- `docs/voice-stack/release-candidates.md` is authoritative for the overall diagram and the detailed description of each stage.

| Kind | Branch | Version | GitHub Releases |
|---|---|---|---|
| Beta | `develop` | `X.Y.Z-beta.N` | A pre-release. Not made the latest |
| Stable release | `release/X.Y.Z` cut from `develop` | `X.Y.Z` | Made the latest |
| Hotfix | `release/X.Y.Z` cut from `main` | `X.Y.Z` | Made the latest |

Follow the steps in this order.

1. The release branch (freeze changes to develop during the beta period)
2. Building the candidates
3. The draft
4. Checks before publishing (tag_name, real PCs and, for a stable release, the beta period's telemetry)
5. Publishing
6. Checks after publishing (make_latest, releases/latest, the Worker's latest.json and the asset count)
7. Updating the support matrix and the verification records (stable releases and hotfixes)
8. Merging main back into develop

## 1. The release branch

Cut a stable release from `origin/develop` and a hotfix from `origin/main`. The steps for bringing fixes into a hotfix are in section 8 of the pull-request skill ("Hotfixes").

```sh
git fetch origin --tags
git worktree add ../<repository-name>-release-<version> -b release/X.Y.Z origin/develop
```

1. Set `version` in `package.json` to `X.Y.Z`, and apply it to each file with `npm run update-version`.
2. Write this version's section in `CHANGELOG.md` with `npm run changelog`. Read the section, and fix lines that are hard to understand in the file. In the frame of the same section added to the Japanese version, translate the summaries and notes into Japanese and delete the comment at the start of the frame.
3. Make 1 and 2 one commit, `chore(release): version X.Y.Z`.
4. Create the scaffold of `docs/release-notes/X.Y.Z.md` with `python tools/changelog.py scaffold-notes` (`mise run changelog:notes`), and rewrite it with the steps of the release-notes skill (see 9). Commit it as `docs(release): add the X.Y.Z release notes`.
5. Open a pull request into main (`gh pr create --base main`). In its description, write the changes it includes, what you checked and what needs a decision.
6. Merge the pull request into main with a merge commit after the maintainer has reviewed it. The `CHANGELOG.md` section links to the commits on `release/X.Y.Z`, so do not use squash or rebase.

For a stable release, run the full mutation testing (the whole UI side and the list of the main Rust crates) before merging the pull request into main, and comment the results on the issue that keeps the record (for now, #550). The commands and the rough times are in "When to run mutation testing" in `docs/development.md`. Do not run it for a beta.

If you add commits after the version bump, rewrite the section with `python tools/changelog.py write --force`. Before rewriting, compare it with the output of `python tools/changelog.py print`. The Japanese section is not rewritten, so translate the lines of the added commits and add them by hand.

For a beta, do not cut `release/`. On a branch from develop, set `package.json` to `X.Y.Z-beta.N`, run `npm run update-version` and bring in `chore(release): version X.Y.Z-beta.N` through a pull request into develop. Do not write a beta in `CHANGELOG.md` or in `docs/release-notes/`. Its changes go in the pre-release notes.

From the time the first beta of a version (`X.Y.Z-beta.1`) is published as a pre-release until the stable release (`X.Y.Z`) is published and the pull request in 8 that merges `main` back into `develop` is merged, the only changes that may be merged into `develop` are fixes for problems found in the betas. Open pull requests for new features and unrelated changes, let them wait, and merge them after the stable release ("Change freeze during the beta period" in `release-candidates.md`).

## 2. Building the candidates

For a stable release, merging the pull request into main starts "Start ASTAROT release draft" (`release-draft-auto.yml`). It builds the Linux and Windows candidates from the merge commit and goes straight on to the draft in 3. Its progress appears in that job's Summary.

```sh
gh run list --workflow release-draft-auto.yml --limit 3
gh run watch <run-id>
```

- The workflows that build the candidates are `build-linux.yml` for Linux and `release.yml` for Windows. Build both from the same commit. Candidates are kept for 7 days.
- If the automatic run stops, fix the cause, then run the same workflow by hand on `main` (`gh workflow run release-draft-auto.yml --ref main`). Candidates that succeeded are used as they are.
- For a beta, run the same workflow by hand on `develop` (`gh workflow run release-draft-auto.yml --ref develop`).

## 3. The draft

"Prepare verified ASTAROT release draft" (`prepare-release.yml`) makes the draft. The automatic flow in 2 calls it, so you do not usually run it by hand. The workflow checks the candidates' origin, commit, version, SHA-256 and build provenance, adds the updater signatures and `latest.json`, and then makes the draft for `v<version>`. A stable release is made with `--latest`, and a beta with `--prerelease --latest=false`.

When you run it by hand, pass the run IDs of the candidates built from the same commit on the same branch.

```sh
gh workflow run prepare-release.yml --ref main -f linux_run=<run-id> -f windows_run=<run-id>
```

When the draft is ready, note its id and contents.

```sh
gh api 'repos/{owner}/{repo}/releases?per_page=10' \
  --jq '.[] | select(.draft) | {id, tag_name, target_commitish, name, assets: (.assets | length)}'
```

## 4. Before publishing

1. Replace the body with the notes: `docs/release-notes/X.Y.Z.md` for a stable release, and for a beta, the notes written with the steps of the release-notes skill (see 9).

   ```sh
   gh api -X PATCH repos/{owner}/{repo}/releases/<id> -F body=@docs/release-notes/X.Y.Z.md
   ```

2. PATCH the draft with `tag_name` and `target_commitish` stated explicitly, then read it back to check. The commands and the values to check are in "Rewrite the tag name just before publishing" in `release-candidates.md`. If a tag with the same name already exists, stop and tell the maintainer.
3. Finish the checks on real PCs. For Windows, follow "Start the Windows package before publishing" in `release-candidates.md`, and for Linux, "Check on a Linux desktop before publishing". Each section also gives the scope to check (the OS for Windows, the package formats and desktops for Linux, and VR). Write what you could not check under `## 🐞 Known issues` (`## 🐞 既知の問題`) in the release notes. Note what you checked and what you did not, together with the version, the OS and its version, and the package format (they are used in 7).
4. For a stable release, compare the errors during the beta period (`X.Y.Z-beta.N`) with the previous stable release, using the `app_started` and `error` events of ASTAROT's own telemetry system (`vrct-vox-telemetry`). Check that there is no notable rise in the rate of `error` against `app_started`, in the breakdown by `error_code` or in the skew by `os` and `os_version` (the detailed steps are in "Check the beta period's telemetry before publishing" in `release-candidates.md`). If there is a notable rise or a new error with no explanation, hold the release, and check again with the next beta, which fixes the cause. A hotfix has no beta period before it, so check the trend after publishing instead.
5. Report that the release is ready to publish, and wait for the maintainer's review.

## 5. Publishing

The maintainer publishes. When you are asked to publish, publish with a PATCH that states `make_latest` explicitly as a string (`"true"` for a stable release, `"false"` for a beta). The command is at the end of "Rewrite the tag name just before publishing" in `release-candidates.md`.

## 6. After publishing

Check the four points in "Check after publishing" in `release-candidates.md`.

1. The tag's commit is the same as the commit the candidates were built from
2. `releases/latest` is `vX.Y.Z` for a stable release, and stays at the previous stable release for a beta (the result of `make_latest`)
3. For a stable release, the update-check Worker's `latest.json` returns `X.Y.Z`
4. The number and names of the assets match the list of the candidates (the expected count is "(the sum of the `assets` counts of the two candidates) + (the number of Windows ZIP assets) + 5")

If anything differs, fix it or tell the maintainer.

## 7. Update the support matrix and the verification records

After publishing a stable release or a hotfix version, update the user-facing support matrix (`site/ja/guide/support.md` and `site/en/guide/support.md`) and the evidence behind it, `docs/voice-stack/platform-verification.md`, to match the published version (#516). The steps are in "Update the support matrix after publishing" in `release-candidates.md`.

1. Cut a branch such as `docs/support-matrix-X.Y.Z` from develop.
2. Add the results of the real-PC checks you noted in step 3 of 4 to the evidence list, and update the version and date at the top of the Japanese and English tables, the rows of package formats and the real-PC columns. Do not mark a cell that has only an earlier version's record as checked on this version.
3. Run `python tools/dev.py check --scope voice` (`tests/voice/test_support_matrix.py`) and the build of `site/`.
4. Open a pull request into develop. The site is published from develop, so merge it after the version is published.

For a beta, do not change the tables. When you check a beta on a real PC, add it only to the real-PC records in the evidence list.

## 8. Merge main back into develop

When a stable release is published, "Open ASTAROT back-merge pull request" (`release-back-merge.yml`) opens a pull request from `chore/merge-main-back-X.Y.Z` into develop. Its title is `chore(release): merge main (X.Y.Z) back into develop`. It does not open one for a beta.

1. This pull request is opened with the Actions token, so its checks do not start automatically. Close the pull request once and reopen it (`gh pr close <number> && gh pr reopen <number>`).
2. If it conflicts, resolve the conflict on that branch. If you had already moved develop's version on to the next `-beta.N`, keep develop's side for the version lines.
3. Check the conditions in section 6 of the pull-request skill ("CI and the conditions for merging"), and merge with a merge commit.
4. Move develop on to the next `-beta.N` (the beta steps in 1).

If the pull request did not open, a person opens it from the link in the job's Summary. If the repository settings do not allow Actions to create pull requests, the job stops after creating the branch.

## 9. Release notes

Write the release notes for both stable releases and betas with the steps of the [release-notes skill](../release-notes/SKILL.md). It covers how to collect the pull requests in the range, how to check the facts, how to put together the English and Japanese versions, revising, the checks and putting the notes into the draft. `docs/release-notes/README.md` is authoritative for the format.

- For a stable release, write `docs/release-notes/<version>.md` on the release branch (step 4 of 1) and use it as the body of the GitHub release.
- For a beta, write the notes neither in `docs/release-notes/` nor in `CHANGELOG.md`, and use them only as the body of the pre-release. A beta's notes also carry both the English and the Japanese versions (decision of 2026-11-25).
- If the notes disagree with `CHANGELOG.md`, fix `CHANGELOG.md` first, then fix the notes.

## 10. Stopping delivery when a problem is found

When a serious bug is found in a published version, do not delete the published release and tag. Instead, stop delivery to users who have not updated by pointing it back at the previous version. Do not downgrade automatically; release the fix as a new patch version (`X.Y.(Z+1)`) (roll forward). "Stop delivery when a problem is found" in `release-candidates.md` is authoritative for the commands and the detailed cautions.

1. PATCH `make_latest=true` onto the release of the last safe stable version (`v<previous>`), and point `releases/latest`, the stable Worker's `/latest.json` and the official site's download back at the previous version.
2. To stop delivery on the beta channel as well, replace `beta/latest.json` on the `updater-channels` branch with the previous version's `latest.json` and push (`update-channels.yml` does not point it back automatically).
3. At the top of the faulty version's release notes, add what the problem is, that delivery is stopped, and guidance for users who already updated.
4. After the fix is in `develop`, publish a new patch version with the hotfix steps (`release/X.Y.(Z+1)` from `main`).

---

# 版を出す（日本語版）

版はGitHub Releasesで公開します。下書きはワークフローが作り、公開は保守担当者が下書きを確かめてから行います。

- タグは手で作らず、pushもしません。`cog bump`も使いません。タグは下書きを公開したときにGitHubが作ります。
- 公開したリリースとタグは、消したり動かしたりしません。
- 全体の図と各段の詳しい説明は`docs/voice-stack/release-candidates.md`が正本です。

| 種類 | ブランチ | 版 | GitHub Releases |
|---|---|---|---|
| ベータ | `develop` | `X.Y.Z-beta.N` | プレリリース。latestにしない |
| 正式版 | `develop`から切った`release/X.Y.Z` | `X.Y.Z` | latestにする |
| ホットフィックス | `main`から切った`release/X.Y.Z` | `X.Y.Z` | latestにする |

手順は次の順に進めます。

1. releaseブランチ（ベータ期間中はdevelopを変更凍結する）
2. 候補のビルド
3. 下書き
4. 公開の前の確認（tag_name、実機、正式版はベータ期間のテレメトリ）
5. 公開
6. 公開の後の確認（make_latest、releases/latest、Workerのlatest.json、資産の件数）
7. 対応環境の表と検証の記録の更新（正式版とホットフィックス）
8. mainをdevelopへ戻す統合

## 1. releaseブランチ

正式版は`origin/develop`から、ホットフィックスは`origin/main`から切ります。ホットフィックスで修正を取り込む手順は、pull-requestスキルの「ホットフィックス」にあります。

```sh
git fetch origin --tags
git worktree add ../<リポジトリ名>-release-<版> -b release/X.Y.Z origin/develop
```

1. `package.json`の`version`を`X.Y.Z`にし、`npm run update-version`で各ファイルへ反映します。
2. `npm run changelog`で`CHANGELOG.md`にこの版の節を書きます。節を読み、分かりにくい行はファイルの上で直します。日本語版に足された同じ節の枠は、要約と注記を日本語に訳し、枠の先頭のコメントを消します。
3. 1と2を`chore(release): version X.Y.Z`の1つのコミットにします。
4. `python tools/changelog.py scaffold-notes`（`mise run changelog:notes`）で`docs/release-notes/X.Y.Z.md`の雛形を作り、release-notesスキルの手順で書き直します（9）。`docs(release): add the X.Y.Z release notes`でコミットします。
5. mainへのPRを開きます（`gh pr create --base main`）。本文には、含める変更、確かめたこと、判断が要ることを書きます。
6. mainへのPRは保守担当者の確認を受けてからマージコミットで統合します。`CHANGELOG.md`の節が`release/X.Y.Z`のコミットへリンクしているので、squashとrebaseは使いません。

正式版では、mainへのPRをマージするまでに、ミューテーションテストの全体（画面側の全体と、Rustの主なクレートの一覧）を回し、結果を記録のIssue（いまは#550）にコメントします。コマンドと時間の目安は`docs/development.md`の「ミューテーションテストを回す場面」にあります。ベータでは回しません。

版上げのあとにコミットを足したときは、`python tools/changelog.py write --force`で節を書き直します。書き直す前に`python tools/changelog.py print`の結果と比べます。日本語の節は書き直さないので、足したコミットの行を訳して手で足します。

ベータは`release/`を切りません。developからのブランチで`package.json`を`X.Y.Z-beta.N`にして`npm run update-version`を実行し、`chore(release): version X.Y.Z-beta.N`をdevelopへのPRで入れます。ベータは`CHANGELOG.md`にも`docs/release-notes/`にも書きません。変更はプレリリースのノートに載せます。

ある版の最初のベータ（`X.Y.Z-beta.1`）をプレリリースとして公開してから正式版（`X.Y.Z`）を公開し、8の`main`を`develop`へ戻すPRを統合するまでのあいだ、`develop`へマージしてよいのはベータで見つかった問題の修正だけです。新しい機能や無関係な変更はPRを作って待たせ、正式版のあとにマージします（`release-candidates.md`の「ベータ期間の変更凍結」）。

## 2. 候補のビルド

正式版ではmainへのPRをマージすると「Start ASTAROT release draft」（`release-draft-auto.yml`）が動きます。マージのコミットでLinuxとWindowsの候補を作り、そのまま3の下書きまで進めます。経過はそのジョブのSummaryに出ます。

```sh
gh run list --workflow release-draft-auto.yml --limit 3
gh run watch <run-id>
```

- 候補を作るワークフローは、Linuxが`build-linux.yml`、Windowsが`release.yml`です。両方を同じコミットから作ります。候補の保存期間は7日です。
- 自動の実行が止まったら、原因を直してから同じワークフローを`main`で手動実行します（`gh workflow run release-draft-auto.yml --ref main`）。成功した候補はそのまま使われます。
- ベータでは同じワークフローを`develop`で手動実行します（`gh workflow run release-draft-auto.yml --ref develop`）。

## 3. 下書き

「Prepare verified ASTAROT release draft」（`prepare-release.yml`）が下書きを作ります。2の自動の流れが呼ぶので、ふつうは手で動かしません。このワークフローは候補の出どころ、コミット、版、SHA-256、ビルドの来歴を確かめ、updaterの署名と`latest.json`を付けてから、`v<版>`の下書きを作ります。正式版は`--latest`、ベータは`--prerelease --latest=false`で作ります。

手で動かすときは、同じブランチの同じコミットで作った候補のrun IDを渡します。

```sh
gh workflow run prepare-release.yml --ref main -f linux_run=<run-id> -f windows_run=<run-id>
```

下書きができたら、そのidと中身を控えます。

```sh
gh api 'repos/{owner}/{repo}/releases?per_page=10' \
  --jq '.[] | select(.draft) | {id, tag_name, target_commitish, name, assets: (.assets | length)}'
```

## 4. 公開の前

1. 本文をノートに差し替えます。正式版は`docs/release-notes/X.Y.Z.md`、ベータ版はrelease-notesスキルの手順で書いたノートです（9）。

   ```sh
   gh api -X PATCH repos/{owner}/{repo}/releases/<id> -F body=@docs/release-notes/X.Y.Z.md
   ```

2. `tag_name`と`target_commitish`を明示してPATCHし、読み直して確かめます。コマンドと確かめる値は`release-candidates.md`の「公開の直前にタグ名を書き直す」にあります。同じ名前のタグがすでにあったら止めて、保守担当者に伝えます。
3. 実機での確認を済ませます。Windowsは`release-candidates.md`の「公開前にWindowsのパッケージを起動して確かめる」、Linuxは「公開前にLinuxのデスクトップで確かめる」の手順です。確かめる範囲（WindowsのOS、Linuxの配布形式とデスクトップ、VR）もそれぞれの節にあります。確かめられなかったことは、リリースノートの`## 🐞 既知の問題`に書きます。確かめたことと確かめなかったことは、版、OSとその版、配布形式と一緒に控えます（7で使います）。
4. 正式版では、自前のテレメトリ基盤（`vrct-vox-telemetry`）の`app_started`と`error`イベントで、ベータ期間（`X.Y.Z-beta.N`）のエラー発生状況を前の正式版と比べます。`app_started`に対する`error`の割合、`error_code`ごとの内訳、`os`と`os_version`ごとの偏りに目立った増加がないことを確かめます（具体的な手順は`release-candidates.md`の「公開前にベータ期間のテレメトリを確かめる」）。目立った増加や説明のつかない新しいエラーがあれば公開を止め、原因を直した次のベータ版で確かめ直します。ホットフィックスは事前のベータ期間がないため、公開したあとの推移を確かめます。
5. 公開の準備ができたことを報告し、保守担当者の確認を待ちます。

## 5. 公開

公開は保守担当者が行います。公開を任されたときは、`make_latest`を文字列で明示したPATCHで公開します（正式版は`"true"`、ベータは`"false"`）。コマンドは`release-candidates.md`の「公開の直前にタグ名を書き直す」の最後にあります。

## 6. 公開の後

`release-candidates.md`の「公開してから確かめる」の4つを確かめます。

1. タグのコミットが候補を作ったコミットと同じこと
2. `releases/latest`が、正式版なら`vX.Y.Z`、ベータなら前の正式版のままであること（`make_latest`の結果）
3. 更新確認のWorkerの`latest.json`が、正式版なら`X.Y.Z`を返すこと
4. 資産の件数と名前が候補の一覧と合うこと（期待する件数は「（2つの候補の`assets`の数の合計）+（WindowsのZIPの件数）+ 5」）

違うものがあれば、直すか保守担当者に伝えます。

## 7. 対応環境の表と検証の記録を更新する

正式版とホットフィックスの版を公開したら、利用者向けの対応環境の表（`site/ja/guide/support.md`と`site/en/guide/support.md`）と、その根拠の`docs/voice-stack/platform-verification.md`を、公開した版に合わせて更新します（#516）。手順は`release-candidates.md`の「公開したあとに対応環境の表を更新する」にあります。

1. developから`docs/support-matrix-X.Y.Z`のようなブランチを切ります。
2. 4の3で控えた実機の確認の結果を根拠の一覧に足し、日英の表の冒頭の版と日付、配布形式の行、実機の欄を直します。前の版の記録しかない欄を、この版で確かめたことにしません。
3. `python tools/dev.py check --scope voice`（`tests/voice/test_support_matrix.py`）と、`site/`のビルドを流します。
4. developへのPRを開きます。サイトはdevelopから公開されるので、版を公開したあとにマージします。

ベータ版では表を変えません。ベータ版を実機で確かめたときは、根拠の一覧の実機の記録にだけ足します。

## 8. mainをdevelopへ戻す

正式版を公開すると、「Open ASTAROT back-merge pull request」（`release-back-merge.yml`）が`chore/merge-main-back-X.Y.Z`からdevelopへのPRを開きます。題は`chore(release): merge main (X.Y.Z) back into develop`です。ベータでは開きません。

1. このPRはActionsのトークンで開くので、チェックが自動では動きません。PRを一度閉じて開き直します（`gh pr close <番号> && gh pr reopen <番号>`）。
2. 衝突したら、そのブランチの上で解きます。developの版を先に次の`-beta.N`へ進めていたときは、版の行はdevelopの側を残します。
3. pull-requestスキルの「CIとマージの条件」を確かめ、マージコミットで統合します。
4. developを次の`-beta.N`へ進めます（1のベータの手順）。

PRが開かなかったときは、ジョブのSummaryにあるリンクから人がPRを開きます。リポジトリの設定でActionsにPRの作成を許していないと、ジョブはブランチを作ったところで止まります。

## 9. リリースノート

リリースノートは、正式版もベータ版も[release-notesスキル](../release-notes/SKILL.md)の手順で書きます。範囲のPRの集め方、事実の確かめ方、英語版と日本語版の組み方、推敲、検査、下書きへの反映はそこにあります。書式の正本は`docs/release-notes/README.md`です。

- 正式版は`docs/release-notes/<版>.md`をreleaseブランチで書き（1の4）、GitHubのリリースの本文にします。
- ベータ版は`docs/release-notes/`にも`CHANGELOG.md`にも書かず、プレリリースの本文だけにします。ベータ版のノートも英語版と日本語版の両方を載せます（2026-11-25の決定）。
- `CHANGELOG.md`と食い違ったら、`CHANGELOG.md`を先に直してからノートを直します。

## 10. 問題が見つかったときの配信停止

公開した版で重大な不具合が見つかったときは、公開済みのリリースとタグを消さず、未更新の利用者への配信を前版へ戻して止めます。自動ダウングレードはせず、修正版を新しいパッチ版（`X.Y.(Z+1)`）として出し直します（ロールフォワード）。コマンドと詳しい注意は`release-candidates.md`の「問題が見つかったときに配信を止める」が正本です。

1. 直前の安全な安定版（`v<前版>`）のリリースへ`make_latest=true`をPATCHし、`releases/latest`、安定版Workerの`/latest.json`、公式サイトのダウンロード先を前版へ戻します。
2. ベータチャンネルへの配信も止めるときは、`updater-channels`ブランチの`beta/latest.json`を前版の`latest.json`で置き換えてpushします（`update-channels.yml`は自動で戻しません）。
3. 問題のある版のリリースノート先頭に、問題の内容、配信停止中であること、すでに更新した利用者向けの案内を書き足します。
4. 修正を`develop`へ入れたあと、ホットフィックス手順（`main`から`release/X.Y.(Z+1)`）で新しいパッチ版を公開します。
