---
name: release
description: ASTAROTの版を出す手順。ベータ期間の変更凍結、release/X.Y.Zブランチ、版上げとCHANGELOG、リリースノート（docs/release-notes）、候補のビルド、「Prepare verified ASTAROT release draft」での下書き、公開前のtag_name・実機・テレメトリの確認、公開、公開後のlatest・Workerのlatest.json・資産の件数の確認、対応環境の表と検証の記録の更新、mainをdevelopへ戻す統合、問題が見つかったときの配信停止を扱う。リリース、版上げ、ベータ、正式版、ホットフィックスの版、下書き、公開、リリースノート、配信停止を頼まれたときに使う。Use when preparing, drafting, publishing, halting or checking a release, or writing its notes. 通常のPRはpull-requestスキル。
---

# 版を出す

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
2. `npm run changelog`で`CHANGELOG.md`にこの版の節を書きます。節を読み、分かりにくい行はファイルの上で直します。
3. 1と2を`chore(release): version X.Y.Z`の1つのコミットにします。
4. `python tools/changelog.py scaffold-notes`（`mise run changelog:notes`）で`docs/release-notes/X.Y.Z.md`の雛形を作り、9の書式で書き直します。`docs(release): add the X.Y.Z release notes`でコミットします。
5. mainへのPRを開きます（`gh pr create --base main`）。本文には、含める変更、確かめたこと、判断が要ることを書きます。
6. mainへのPRは保守担当者の確認を受けてからマージコミットで統合します。`CHANGELOG.md`の節が`release/X.Y.Z`のコミットへリンクしているので、squashとrebaseは使いません。

正式版では、mainへのPRをマージするまでに、ミューテーションテストの全体（画面側の全体と、Rustの主なクレートの一覧）を回し、結果を記録のIssue（いまは#550）にコメントします。コマンドと時間の目安は`docs/development.md`の「ミューテーションテストを回す場面」にあります。ベータでは回しません。

版上げのあとにコミットを足したときは、`python tools/changelog.py write --force`で節を書き直します。書き直す前に`python tools/changelog.py print`の結果と比べます。

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

1. 本文を`docs/release-notes/X.Y.Z.md`に差し替えます。ベータは下書きの本文（前のタグからのコミットの一覧）を読み、必要なら手で整えます。

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
4. 資産の件数と名前が候補の一覧と合うこと（期待する件数は「2 ×（2つの候補の`assets`の数の合計）+ 5」）

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

## 9. リリースノートの書式

正式版とプレリリースのノートは、毎回[jp-writingスキル](../jp-writing/SKILL.md)の手順で書きます。

正式版のノートは、1つのファイルに英語版を先に、日本語版をそのあとに置き、2つの版に同じことを書きます（2026-11-24の決定）。英語版は`docs/writing/english-guideline.md`の「User-facing text」に従います。食い違うときは英語版が正です。

正本は`docs/release-notes/README.md`です。正式版ごとに`docs/release-notes/<版>.md`を書き、GitHubのリリースの本文にします。

英語版と日本語版のそれぞれで、次の順に、題（`#`）のほかの見出しをすべて`##`で平らに並べます。

1. 序文。見出しを付けず、その版でいちばん大きな変更を2〜4文で書きます。プライバシーやセキュリティの修正があれば、序文でも触れてその節へ案内します。
2. 利用者に関係のある変更。項目ごとに「絵文字1つ＋短い題」の見出しを1つ作り（`## 🔄 アプリの中で更新する`）、本文は段落で書きます。絵文字は見出しの先頭にだけ置きます。
3. `## ⚠️ 更新するときの注意`と`## 🐞 既知の問題`。書くことがなければ節ごと省きます。
4. `## 🔧 内部の変更`。1項目を短い1行の箇条書きにし、末尾に変更を入れたPRの番号を付けます（`（#341）`）。節の最後に`CHANGELOG.md`へのリンクを置きます。

書くときは次を守ります。

- 対象は前の正式版のタグからリリースするコミットまでにマージしたPRです。漏れは`python tools/changelog.py print`と`git log --first-parent`のPRの一覧で確かめます。
- 画面の文言は`locales/ja.yml`の表記のまま引き、設定の場所は「設定」→「ページ」→「項目」の形で書きます。
- 人の名前、担当、開発に使った環境を書きません。
- 利用者のPCを「このPC」と書きません。「お使いのPC」のように書きます。
- 計測した値は条件とあわせて書きます。
- 日本語は`docs/writing/japanese-guideline.md`に従い、推敲してから出します。読点を減らし、1つの段落には話題を1つだけ入れます。
- `CHANGELOG.md`と食い違ったら、`CHANGELOG.md`を先に直してからノートを直します。

## 10. 問題が見つかったときの配信停止

公開した版で重大な不具合が見つかったときは、公開済みのリリースとタグを消さず、未更新の利用者への配信を前版へ戻して止めます。自動ダウングレードはせず、修正版を新しいパッチ版（`X.Y.(Z+1)`）として出し直します（ロールフォワード）。コマンドと詳しい注意は`release-candidates.md`の「問題が見つかったときに配信を止める」が正本です。

1. 直前の安全な安定版（`v<前版>`）のリリースへ`make_latest=true`をPATCHし、`releases/latest`、安定版Workerの`/latest.json`、公式サイトのダウンロード先を前版へ戻します。
2. ベータチャンネルへの配信も止めるときは、`updater-channels`ブランチの`beta/latest.json`を前版の`latest.json`で置き換えてpushします（`update-channels.yml`は自動で戻しません）。
3. 問題のある版のリリースノート先頭に、問題の内容、配信停止中であること、すでに更新した利用者向けの案内を書き足します。
4. 修正を`develop`へ入れたあと、ホットフィックス手順（`main`から`release/X.Y.(Z+1)`）で新しいパッチ版を公開します。
