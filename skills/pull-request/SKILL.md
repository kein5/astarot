---
name: pull-request
description: ASTAROTの変更をブランチからdevelopへ入れる手順。作業ツリーとブランチ、検証、コミット、developへのPR、PRの本文と「判断が要ること」、公開物に書かないこと、CI、マージの条件とマージを決める人（コードオーナーのレビューが要るPR）、積み重ねたPRの順序、mainから切るホットフィックス、片付けを扱う。PRを出す、PRの本文を書く、CIを待つ、マージできるか確かめる、マージする、PRを積む、ホットフィックスのブランチを作るときに使う。Use when starting a change, committing, opening, checking or merging a pull request, stacking pull requests or cutting a hotfix branch. 版上げ、下書き、公開はreleaseスキル、ADRはadrスキル。
---

# ブランチからdevelopへ

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

3. 本文は`.github/pull_request_template.md`の節に沿って書きます。日本語でも英語でも構いません。日本語は`docs/writing/japanese-guideline.md`に従います。

   | 節 | 書くこと |
   |---|---|
   | `## Summary / 概要` | 何をなぜ変えたか。Issueは`Refs #NNN`か`Fixes #NNN`でつなぐ |
   | `## 判断が要ること` | 5の形で、保守担当者が決める点を番号つきで並べる |
   | `## Verification / 確認したこと` | 実行した検証と結果、実行しなかった検証と理由。成功、失敗、スキップ、未実行、環境不足を分ける。CIの成功は実機での確認に数えない |
   | `## Platforms / 対応環境` | OSに依存する変更のとき。なければ「No platform impact」 |
   | `## Checklist` | テンプレートの項目 |

4. 変えたファイルが`.github/CODEOWNERS`の一覧に入るかを確かめます。一覧はルートからのパスだけで書いてあるので、次のコマンドで分かります。何も出なければ入っていません。

   ```sh
   git diff --name-only origin/develop...HEAD | awk '
     NR == FNR { if ($1 ~ /^\//) owned[substr($1, 2)]; next }
     { for (p in owned) if ($0 == p || (p ~ /\/$/ && index($0, p) == 1)) { print; break } }
   ' .github/CODEOWNERS -
   ```

   入っていれば、本文の冒頭に「コードオーナーのレビューが要るPRです」と書き、出たファイルを挙げます。マージは6の「マージを決める人」に従います。

## 5. 判断が要ることを残す

自分で決められない点はPRの本文の`## 判断が要ること`に残課題として明記します。止めずに進められる点は仮の選択で進めてから書きます。データを消す操作や外部への公開のように、後から戻せない点は先に確かめます。

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
