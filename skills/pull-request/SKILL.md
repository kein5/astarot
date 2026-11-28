---
name: pull-request
description: Steps for bringing an ASTAROT change from a branch into develop. Covers the worktree and branch, verification, commits, the pull request to develop, its description and "Decisions needed", what not to write in public text, CI, the conditions for merging and who decides to merge (pull requests that need a code owner review), the order of stacked pull requests, hotfixes cut from main and cleaning up. Use when starting a change, committing, opening a pull request, writing its description, waiting for CI, checking whether it can be merged, merging it, stacking pull requests or cutting a hotfix branch. Not for version bumps, drafts or publishing (release skill) or ADRs (adr skill). ASTAROTの変更をブランチからdevelopへ入れる手順。作業ツリーとブランチ、検証、コミット、developへのPR、PRの本文と「判断が要ること」、公開物に書かないこと、CI、マージの条件とマージを決める人（コードオーナーのレビューが要るPR）、積み重ねたPRの順序、mainから切るホットフィックス、片付けを扱う。PRを出す、PRの本文を書く、CIを待つ、マージできるか確かめる、マージする、PRを積む、ホットフィックスのブランチを作るときに使う。版上げ、下書き、公開はreleaseスキル、ADRはadrスキル。
---

# From a branch to develop

[日本語版](#ブランチからdevelopへ日本語版)

Every change goes into develop through a pull request. Do not commit or push directly to develop or main. Only pull requests from a release branch go into main (the release skill).

## 1. Start

1. Check the branch, HEAD and uncommitted changes (`git status`, `git log -1`). Do not delete or revert changes you did not make.
2. Create your own worktree and branch from `origin/develop`.

   ```sh
   git fetch origin
   git worktree add ../<repository-name>-<topic> -b <type>/<issue-number>-<topic> origin/develop
   ```

   Name the branch after the commit type and the topic (`fix/quick-chat-focus`, `feat/614-settings-descriptions`, `docs/hotfix-release-path`).
3. When other work uses the same clone, do not switch the branch of another worktree; edit and commit only in your own worktree. Check `git branch --show-current` right before you commit. Do not use `git stash`, because all worktrees share one list of stashes.
4. First read the ADRs related to the behavior you change (the adr skill).

## 2. Verify and commit

- Run the light checks (`python tools/dev.py check`) and the scopes for the areas you changed. Choose the scopes by the table in "Entry points for development and verification" in `AGENTS.md`.
- When you change behavior, add or fix tests.
- When you write or revise a document, pass the prose check that the light checks include (`tools/writing_gate/check.mjs`). Check the pull request description too before you open the pull request, with `node tools/writing_gate/check.mjs --file <description-file>`. Check the rules that a pattern cannot catch against the final checks section of the guidelines in `docs/writing/`, and write in "Verification" in the description that you ran these checks and what they showed.
- When you change the UI logic (`src-ui/logics`, `src-ui/views`) or the `src/` of a Rust crate, running mutation testing with `mise run mutation:changed` is recommended (it is not required). In "Verification" in the pull request description, write the counts of Survived and NoCoverage and whether you read them one by one. If you did not run it, write why. The authoritative rule is "When to run mutation testing" in `docs/development.md`.
- Commit in steps. Put only what you changed for one reason into one commit.
- Write commit messages in English, in the Conventional Commits form. The rules for the type, the scope and the footers are in "Commit messages" in `CONTRIBUTING.md`. Before you commit, check the message with `cog verify "<message>"`, and pass `python tools/dev.py check --scope commits --base origin/develop` over all the commits together.
- CI stops `fixup!`, `squash!` and `amend!` commits, so fold them in before you open the pull request.
- Update the text shown in the UI in `locales/en.yml` and `locales/ja.yml` in the same pull request.
- To record a decision, add an ADR following the adr skill.

## 3. What not to write in public text

Pull requests, issues, commits, release notes and documents are public. Do not write the following in their body, comments or title.

- People's names, who is in charge, who decided and which worker or session did the work
- Information about the development environment. This covers machine names, local paths, the names of working folders, the names of the agents and editors used for the work and the configuration of your own hardware.
- Recognized text, sentences read aloud, the content of chats and the content of recorded audio. When you paste logs or test output too, remove the text and audio content.

Do write the information that the results depend on. This covers the kind and version of the OS, the package format and the kind of GPU used for a measurement.

In text for users, do not call the user's environment "this PC". Write something like "your PC".

Before you post or update, search the text for people's names and local paths.

## 4. Open a pull request to develop

1. Right before you push, run `git fetch origin` and check that there are no conflicts.

   ```sh
   git merge-tree --write-tree origin/develop HEAD
   ```

   Parallel work moves develop often. Also check whether a pull request on the same files or the same topic has been merged before yours (`gh pr list --state merged --search "<topic>"`). If the same change is already in, use it and remove your duplicate.
2. Push and open the pull request. Make the title one English sentence in the Conventional Commits form, the same as the commit that represents the change.

   ```sh
   git push -u origin <branch>
   gh pr create --base develop --title "<type>(<scope>): <summary>" --body-file <description-file>
   ```

3. Write the description following `.github/pull_request_template.md`, in the same split form as the bilingual documents. Write all the sections in English in the first half, and after the `---` divider write the same content in Japanese in all the sections. The English follows `docs/writing/english-guideline.md`, and the Japanese follows `docs/writing/japanese-guideline.md`. Issue bodies and comments that agents write take the same form (`AGENTS.md`).

   | English section | Japanese section | What to write |
   |---|---|---|
   | `## Summary` | `## 概要` | What changed and why. Link issues with `Refs #NNN` or `Fixes #NNN` |
   | `## Decisions needed` | `## 判断が要ること` | The points a maintainer decides, numbered, in the form given in 5. Write the same items with the same numbers in both languages. If there are none, omit the section or write "None" / "なし" |
   | `## Verification` | `## 確認したこと` | The checks you ran and their results, and the checks you did not run and why. Separate passed, failed, skipped, not run and missing environment. CI passing does not count as a check on a real PC |
   | `## Platforms` | `## 対応環境` | For a change that depends on the OS. Otherwise "No platform impact" / "影響なし" |
   | `## Checklist` | `## チェックリスト` | The template's items |

   In "Decisions needed" (`## Decisions needed` and `## 判断が要ること`), always write the same items with the same numbers in both English and Japanese.

4. Check whether the files you changed are in the list in `.github/CODEOWNERS`. The list gives only paths from the root, so the command below tells you. If it prints nothing, none of them are in the list.

   ```sh
   git diff --name-only origin/develop...HEAD | awk '
     NR == FNR { if ($1 ~ /^\//) owned[substr($1, 2)]; next }
     { for (p in owned) if ($0 == p || (p ~ /\/$/ && index($0, p) == 1)) { print; break } }
   ' .github/CODEOWNERS -
   ```

   If any are, write "This PR requires a code owner review" / "コードオーナーのレビューが要るPRです" at the start of the English and the Japanese versions respectively, and list the files the command printed. For merging, follow "Who decides to merge" in 6.

## 5. Record what needs a decision

Write the points you cannot decide yourself as open items in `## Decisions needed` and `## 判断が要ること` in the pull request description. List the same items with the same numbers in both languages. Where you can go on without stopping, go on with a provisional choice and then write the point down. Confirm points that cannot be undone later, such as deleting data or publishing externally, before you act on them.

Write the following for each item.

- What needs to be decided
- The options, and what each one changes
- The option this pull request takes now, and why
- What to change in this pull request once it is decided

To refer to an item from elsewhere in the description, write its number, as in "(Decisions needed 2)". Once it is decided, delete the item or move it to "Decisions made" (決まったこと), and bring the pull request's changes in line.

## 6. CI and the conditions for merging

- Look at the checks with `gh pr checks <number>`. Right after a push, the checks may not be listed yet.
- If a check fails, read the log (`gh run view <run-id> --log-failed`) and fix the cause. In the UI tests, the end of the log may be the output of another test. Find the name of the failed test in the check's annotations (`gh api repos/{owner}/{repo}/check-runs/<check-run-id>/annotations`).

Merge only after you have confirmed these three things.

1. The checks are for the latest head.
2. Taking the newest result for each check name, all of them are `success`. A rerun lists several results with the same name, so do not judge by an old result. If even one is not `success`, do not merge until you know why.
3. `mergeable` is `MERGEABLE`, and `mergeStateStatus` is `CLEAN`.

```sh
sha=$(gh pr view <number> --json headRefOid --jq .headRefOid)
gh api "repos/{owner}/{repo}/commits/$sha/check-runs?per_page=100" --jq '
  .check_runs | group_by(.name) | map(max_by(.started_at))
  | .[] | "\(.conclusion // .status)\t\(.name)"'
gh pr view <number> --json headRefOid,mergeable,mergeStateStatus
```

Also check that `headRefOid` from the second command is the same SHA as the one used in the first. If it differs, a push came in while you were checking, so start again from the beginning. `mergeable` and `mergeStateStatus` are `UNKNOWN` until GitHub has finished computing them, so in that case wait a while and read them again.

- Merge with a merge commit (`gh pr merge <number> --merge`). Do not use squash or rebase.
- If develop moved just before the merge, also check that the changes do not conflict in meaning (the same setting key, the same section of the spec).

### Who decides to merge

Who decides to merge depends on the files the pull request changes.

| Files the pull request changes | Who decides to merge | Record of approval |
|---|---|---|
| At least one file listed in `.github/CODEOWNERS` | The code owner | Approval in a GitHub review, which the ruleset requires |
| Only other files | The worker entrusted with merging | An instruction in the chat |

`.github/CODEOWNERS` lists the files that affect what is published. These are the steps for building, signing and publishing a release, the release notes and the CHANGELOG, the contents of the packages, the bundled licenses, the catalog of models the app recommends downloading and the public pages (`site/` and the README). The authoritative list is `.github/CODEOWNERS`; this skill does not copy it.

Handle a pull request that changes code owner files as follows.

- Do not merge until the code owner has approved it on GitHub and the three conditions above are met. This holds even when you have been entrusted with merging. If the coordinator directing your work entrusts you with merging, that does not replace the code owner's approval.
- A push after the approval removes the approval. Get it approved again.
- Do not use an operation that merges past the ruleset (`gh pr merge --admin`, or merging in the web interface while ignoring the rules). Only the code owner does that.
- When the account that opened the pull request is the code owner's, GitHub does not request a review, and that account cannot approve it either. In that case the code owner merges past the ruleset. The worker says in the description and in the report that the pull request needs a code owner review, and stops.

Handle a pull request that changes only other files as follows.

- Merge only when you have been entrusted with merging. If you have not, report that the conditions are met and stop.
- The coordinator to whom the maintainer handed the directing of the work may decide whether to entrust merging. There is no need to ask the maintainer each time.
- An instruction in the chat takes the place of approval for the merge. Approval in a GitHub review is not required.

## 7. Stacked pull requests

A pull request that builds on the changes of another pull request (its prerequisite) states the order at the start of its description (for example, "This pull request is stacked on #676. Merge #676 first."). There are two ways to open it.

- Use the prerequisite's branch as the base (`gh pr create --base <prerequisite-branch>`). The diff shows only this pull request's changes.
- Use develop as the base and stack the commits on the prerequisite's branch. Until the prerequisite is merged, its changes also show in the diff, so list in the description the commits this pull request adds.

Follow these rules for the order.

- Merge in order, starting with the prerequisite. Do not merge a later pull request first.
- For a pull request based on the prerequisite's branch, change the base to develop before you merge the prerequisite (`gh pr edit <number> --base develop`). A merged branch is deleted, so a pull request based on it may be closed.
- When you push to the prerequisite, bring the changes into the stacked branch too (`git merge <prerequisite-branch>`).
- Because pull requests are merged with merge commits, the stacked branch's commits can be used as they are after the prerequisite is merged. No rebase is needed.

## 8. Hotfixes

When you fix a bug in a published version in a hurry and develop already holds work for the next version, cut `release/X.Y.Z` from `main`. The authoritative description is "Urgent fixes to a published version" in `docs/voice-stack/release-candidates.md`.

1. First merge the fix through a pull request to develop, as usual.
2. Cut a branch from `main` of the published version.

   ```sh
   git fetch origin
   git worktree add ../<repository-name>-release-<version> -b release/X.Y.Z origin/main
   ```

3. Bring in the commits of the develop pull request with `git cherry-pick -x <commit>`. Leave out the merge commits that brought develop into the pull request's branch. Bring in only the fix and the changes needed to build in the state of `main`.
4. Check with `git diff` that the files you brought in are the same as the result merged into develop.
5. For the version bump, the release notes, the pull request to main, publishing and the pull request that brings main back into develop, follow the release skill. In the description of the pull request to main, list the pull requests you brought in and why.

## 9. Clean up

After the merge, delete the worktree and the local branch. The merge deletes the remote branch.

```sh
git worktree remove <worktree-path>
git branch -d <branch>
git worktree list
```

---

# ブランチからdevelopへ（日本語版）

変更はすべてPRでdevelopに入れます。developとmainへ直接コミットやpushをしません。mainに入るのは、releaseブランチからのPRだけです（releaseスキル）。

## 1. 始める

1. ブランチ、HEAD、未コミットの差分を確かめます（`git status`、`git log -1`）。自分が作っていない変更は消したり戻したりしません。
2. `origin/develop`から自分の作業ツリーとブランチを作ります。

   ```sh
   git fetch origin
   git worktree add ../<リポジトリ名>-<話題> -b <種別>/<Issue番号>-<話題> origin/develop
   ```

   ブランチ名はコミットの種別と話題で付けます（`fix/quick-chat-focus`、`feat/614-settings-descriptions`、`docs/hotfix-release-path`）。
3. ほかの作業と同じcloneを使っているときは、ほかの作業ツリーのブランチを切り替えず、自分の作業ツリーだけで編集とコミットをします。コミットの直前に`git branch --show-current`を確かめます。`git stash`はすべての作業ツリーで1つの一覧を共有するので使いません。
4. 変える振る舞いに関係するADRを先に読みます（adrスキル）。

## 2. 検証とコミット

- 軽量チェック（`python tools/dev.py check`）と、変えた領域のスコープを実行します。スコープの選び方は`AGENTS.md`の「開発と検証の入口」の表に従います。
- 振る舞いを変えたら、試験を足すか直します。
- 文書を書いたり直したりしたら、軽量チェックに含まれる文章の検査（`tools/writing_gate/check.mjs`）を通します。PRの本文も、出す前に `node tools/writing_gate/check.mjs --file <本文のファイル>` で確かめます。形で確かめられない決まりは、`docs/writing/` のガイドラインの最後の確認の節で確かめ、本文の「確認したこと」に、通したことと結果を書きます。
- 画面のロジック（`src-ui/logics`、`src-ui/views`）かRustのクレートの`src/`を変えたら、`mise run mutation:changed`でミューテーションテストを回すことを勧めます（必須ではありません）。PRの本文の「確認したこと」に、SurvivedとNoCoverageの件数と、それを1件ずつ読んだかどうかを書きます。回さなかったときは、その理由を書きます。決まりの正本は`docs/development.md`の「ミューテーションテストを回す場面」です。
- 段階ごとにコミットします。1つのコミットには1つの理由で変えたものだけを入れます。
- コミットメッセージはConventional Commitsで、英語で書きます。種別、スコープ、フッターの決まりは`CONTRIBUTING.md`の「Commit messages」にあります。コミットする前に`cog verify "<メッセージ>"`で確かめ、まとめて`python tools/dev.py check --scope commits --base origin/develop`を通します。
- `fixup!`、`squash!`、`amend!`のコミットはCIが止めるので、PRを出す前にまとめます。
- 表示する文言は`locales/en.yml`と`locales/ja.yml`を同じPRで直します。
- 判断を記録するときは、adrスキルに従ってADRを足します。

## 3. 公開物に書かないこと

PR、Issue、コミット、リリースノート、文書は公開物です。本文、コメント、題のどれにも、次のことを書きません。

- 人の名前、担当者、誰が決めたか、どの作業者やセッションが行ったか
- 開発環境の情報。マシン名、ローカルのパス、作業フォルダーの名前、作業に使ったエージェントやエディターの名前、手元の機材の構成が当たります。
- 認識したテキスト、読み上げた文、チャットの内容、録音した音声の中身。ログや試験の出力を貼るときも、テキストと音声の中身を取り除きます。

結果の条件になる情報は書きます。OSの種類と版、配布形式、計測に使ったGPUの種類が当たります。

利用者向けの文面では利用者の環境を「このPC」と書きません。「お使いのPC」のように書きます。

投稿や更新の前に、本文を人の名前とローカルのパスで検索して確かめます。

## 4. developへのPRを開く

1. pushの直前に`git fetch origin`を実行し、衝突がないかを確かめます。

   ```sh
   git merge-tree --write-tree origin/develop HEAD
   ```

   developは並行する作業で頻繁に動きます。同じファイルや同じ話題のPRが先にマージされていないかも見ます（`gh pr list --state merged --search "<話題>"`）。同じものが先に入っていたら、そちらを使い、自分の重複を外します。
2. pushしてPRを開きます。題は代表するコミットと同じConventional Commitsの形の英語の一文にします。

   ```sh
   git push -u origin <ブランチ>
   gh pr create --base develop --title "<type>(<scope>): <summary>" --body-file <本文のファイル>
   ```

3. 本文は`.github/pull_request_template.md`に従い、文書の2か国語化と同じ分割形で書きます。前半に英語ですべての節を書き、`---`の区切り線のあとに同じ内容を日本語ですべての節に書きます。英語は`docs/writing/english-guideline.md`、日本語は`docs/writing/japanese-guideline.md`に従います。エージェントが書くIssueの本文とコメントも同じ形です（`AGENTS.md`）。

   | 英語の節 | 日本語の節 | 書くこと |
   |---|---|---|
   | `## Summary` | `## 概要` | 何をなぜ変えたか。Issueは`Refs #NNN`か`Fixes #NNN`でつなぐ |
   | `## Decisions needed` | `## 判断が要ること` | 5の形で、保守担当者が決める点を番号付きで並べる。両言語で同じ項目を同じ番号で書く。なければ省略するか「None」／「なし」 |
   | `## Verification` | `## 確認したこと` | 実行した検証と結果、実行しなかった検証と理由。成功、失敗、スキップ、未実行、環境不足を分ける。CIの成功は実機での確認に数えない |
   | `## Platforms` | `## 対応環境` | OSに依存する変更のとき。なければ「No platform impact」／「影響なし」 |
   | `## Checklist` | `## チェックリスト` | テンプレートの項目 |

   「判断が要ること」（`## Decisions needed`と`## 判断が要ること`）は、英語と日本語の両方で必ず同じ項目を同じ番号で書きます。

4. 変えたファイルが`.github/CODEOWNERS`の一覧に入るかを確かめます。一覧はルートからのパスだけで書いてあるので、次のコマンドで分かります。何も出なければ入っていません。

   ```sh
   git diff --name-only origin/develop...HEAD | awk '
     NR == FNR { if ($1 ~ /^\//) owned[substr($1, 2)]; next }
     { for (p in owned) if ($0 == p || (p ~ /\/$/ && index($0, p) == 1)) { print; break } }
   ' .github/CODEOWNERS -
   ```

   入っていれば、英語と日本語それぞれの冒頭に「This PR requires a code owner review」／「コードオーナーのレビューが要るPRです」と書き、出たファイルを挙げます。マージは6の「マージを決める人」に従います。

## 5. 判断が要ることを残す

自分で決められない点はPRの本文の`## Decisions needed`と`## 判断が要ること`に残課題として明記します。両言語で同じ項目を同じ番号で並べます。止めずに進められる点は仮の選択で進めてから書きます。データを消す操作や外部への公開のように、後から戻せない点は先に確かめます。

各項目には次を書きます。

- 何を決める必要があるか
- 選べる案と、それぞれで何が変わるか
- このPRでいま選んでいる案と、その理由
- 決まったあとにこのPRで直すところ

本文のほかの箇所から参照するときは「（判断が要ること 2）」のように番号で書きます。決まったら、その項目を消すか「決まったこと」に移し、PRの変更を合わせます。

## 6. CIとマージの条件

- `gh pr checks <番号>`でチェックを見ます。pushの直後は、チェックがまだ並ばないことがあります。
- 失敗したら、ログ（`gh run view <run-id> --log-failed`）を読んで直します。UIの試験はログの末尾が別の試験の出力で終わることがあります。失敗した試験の名前はチェックのannotationsで確かめます（`gh api repos/{owner}/{repo}/check-runs/<check-run-id>/annotations`）。

マージしてよいのは次の3つを確かめたときだけです。

1. チェックが最新のheadに対するものであること。
2. チェックの名前ごとに最も新しい結果を見て、すべてが`success`であること。再実行すると同じ名前の結果が複数並ぶので、古い結果では判断しません。`success`以外が1つでもあれば、理由を確かめるまでマージしません。
3. `mergeable`が`MERGEABLE`で、`mergeStateStatus`が`CLEAN`であること。

```sh
sha=$(gh pr view <番号> --json headRefOid --jq .headRefOid)
gh api "repos/{owner}/{repo}/commits/$sha/check-runs?per_page=100" --jq '
  .check_runs | group_by(.name) | map(max_by(.started_at))
  | .[] | "\(.conclusion // .status)\t\(.name)"'
gh pr view <番号> --json headRefOid,mergeable,mergeStateStatus
```

2つ目のコマンドの`headRefOid`が1つ目で使ったSHAと同じことも確かめます。違えば、確かめている間にpushがあったので最初からやり直します。GitHubが計算を終えていないと`mergeable`と`mergeStateStatus`は`UNKNOWN`になるので、そのときは時間をおいて読み直します。

- マージはマージコミットで行います（`gh pr merge <番号> --merge`）。squashとrebaseは使いません。
- マージの直前にdevelopが動いていたら、意味の上で衝突しないか（同じ設定のキー、同じ仕様の節）も確かめます。

### マージを決める人

誰がマージを決めるかは、PRが変えるファイルで分かれます。

| PRが変えるファイル | マージを決める人 | 承認の記録 |
|---|---|---|
| `.github/CODEOWNERS`に載っているファイルを1つでも含む | コードオーナー | GitHubのレビューでの承認。ルールセットが求める |
| それ以外のファイルだけ | マージを任された作業者 | チャットでの指示 |

`.github/CODEOWNERS`に載っているのは、公開に響くファイルです。リリースのビルドと署名と公開の手順、リリースノートとCHANGELOG、配布物の中身、同梱するライセンス、アプリが取得を勧めるモデルのカタログ、公開ページ（`site/`とREADME）が当たります。一覧の正本は`.github/CODEOWNERS`で、このスキルには書き写しません。

コードオーナーのファイルを変えるPRは、次のとおりに扱います。

- コードオーナーがGitHubで承認し、上の3つの条件がそろうまでマージしません。マージを任されていても同じです。指示役がマージを任せても、コードオーナーの承認の代わりにはなりません。
- 承認のあとにpushすると、承認は外れます。もう一度承認を受けます。
- ルールセットを越えてマージする操作（`gh pr merge --admin`や、画面でルールを無視してマージする操作）は使いません。これはコードオーナーだけが行います。
- PRを出したアカウントがコードオーナーと同じときは、GitHubはレビューを依頼せず、そのアカウントでは承認もできません。そのときはコードオーナーがルールセットを越えてマージします。作業者は、本文と報告でコードオーナーのレビューが要るPRであることを伝えて止まります。

それ以外のファイルだけを変えるPRは、次の運用で扱います。

- マージするのはマージを任されたときだけです。任されていなければ、条件がそろったことを報告して止まります。
- マージを任せるかは、保守担当者が作業の指示を任せた指示役が判断して構いません。保守担当者に毎回たずねる必要はありません。
- マージの承認はチャットでの指示で代えます。GitHubのレビューでの承認は必須にしません。

## 7. 積み重ねたPR

ほかのPRの変更を前提にするPRは、本文の冒頭に順序を書きます（例：「この PR は #676 の上に積んでいます。#676 を先にマージしてください。」）。出し方は2つあります。

- 前提のPRのブランチをbaseにします（`gh pr create --base <前提のブランチ>`）。差分にはこのPRの変更だけが出ます。
- developをbaseにし、前提のブランチの上にコミットを積みます。前提がマージされるまでは前提の変更も差分に出るので、このPRで足したコミットを本文に書きます。

順序の決まりは次のとおりです。

- 前提のPRから順にマージします。後のPRを先にマージしません。
- 前提のブランチをbaseにしたPRは、前提をマージする前にbaseをdevelopへ変えます（`gh pr edit <番号> --base develop`）。マージしたブランチは消えるので、そのブランチをbaseにしたPRが閉じることがあります。
- 前提のPRへpushしたら、積んだ側のブランチにも取り込みます（`git merge <前提のブランチ>`）。
- マージコミットで統合するので、前提がマージされたあとも積んだ側のコミットはそのまま使えます。rebaseは要りません。

## 8. ホットフィックス

公開済みの版の不具合を急いで直すときに、developにすでに次の版の作業が入っていれば、`main`から`release/X.Y.Z`を切ります。正本は`docs/voice-stack/release-candidates.md`の「公開済みの版を急いで直す」です。

1. 修正はまず通常どおりdevelopへのPRでマージします。
2. 公開済みの版の`main`からブランチを切ります。

   ```sh
   git fetch origin
   git worktree add ../<リポジトリ名>-release-<版> -b release/X.Y.Z origin/main
   ```

3. developのPRのコミットを`git cherry-pick -x <コミット>`で取り込みます。PRのブランチにdevelopを取り込んだマージのコミットは除きます。取り込むのは、その修正と、`main`の状態でビルドするのに要る変更だけです。
4. 取り込んだファイルがdevelopでマージした結果と同じかを`git diff`で確かめます。
5. 版上げ、リリースノート、mainへのPR、公開、mainをdevelopへ戻すPRはreleaseスキルに従います。mainへのPRの本文には取り込んだPRとその理由を書きます。

## 9. 片付け

マージしたら、作業ツリーとローカルのブランチを消します。リモートのブランチはマージで消えます。

```sh
git worktree remove <作業ツリーのパス>
git branch -d <ブランチ>
git worktree list
```
