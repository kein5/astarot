---
name: release
description: ASTAROTの版を出す手順。release/X.Y.Zブランチ、版上げとCHANGELOG、リリースノート（docs/release-notes）、候補のビルド、「Prepare verified ASTAROT release draft」での下書き、公開前のtag_nameの確認、公開、公開後のlatest・Workerのlatest.json・資産の件数の確認、mainをdevelopへ戻す統合を扱う。リリース、版上げ、ベータ、正式版、ホットフィックスの版、下書き、公開、リリースノートを頼まれたときに使う。Use when preparing, drafting, publishing or checking a release, or writing its notes. 通常のPRはpull-requestスキル。
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

1. releaseブランチ
2. 候補のビルド
3. 下書き
4. 公開の前の確認（tag_nameを明示してPATCHし、読み直す）
5. 公開
6. 公開の後の確認（make_latest、releases/latest、Workerのlatest.json、資産の件数）
7. mainをdevelopへ戻す統合

## 1. releaseブランチ

正式版は`origin/develop`から、ホットフィックスは`origin/main`から切ります。ホットフィックスで修正を取り込む手順は、pull-requestスキルの「ホットフィックス」にあります。

```sh
git fetch origin --tags
git worktree add ../<リポジトリ名>-release-<版> -b release/X.Y.Z origin/develop
```

1. `package.json`の`version`を`X.Y.Z`にし、`npm run update-version`で各ファイルへ反映します。
2. `npm run changelog`で`CHANGELOG.md`にこの版の節を書きます。節を読み、分かりにくい行はファイルの上で直します。
3. 1と2を`chore(release): version X.Y.Z`の1つのコミットにします。
4. `python tools/changelog.py scaffold-notes`（`mise run changelog:notes`）で`docs/release-notes/X.Y.Z.md`の雛形を作り、8の書式で書き直します。`docs(release): add the X.Y.Z release notes`でコミットします。
5. mainへのPRを開きます（`gh pr create --base main`）。本文には、含める変更、確かめたこと、判断が要ることを書きます。
6. mainへのPRは保守担当者の確認を受けてからマージコミットで統合します。`CHANGELOG.md`の節が`release/X.Y.Z`のコミットへリンクしているので、squashとrebaseは使いません。

版上げのあとにコミットを足したときは、`python tools/changelog.py write --force`で節を書き直します。書き直す前に`python tools/changelog.py print`の結果と比べます。

ベータは`release/`を切りません。developからのブランチで`package.json`を`X.Y.Z-beta.N`にして`npm run update-version`を実行し、`chore(release): version X.Y.Z-beta.N`をdevelopへのPRで入れます。ベータは`CHANGELOG.md`にも`docs/release-notes/`にも書きません。変更はプレリリースのノートに載せます。

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

2. `tag_name`を明示してPATCHし、読み直して確かめます。下書きのあいだはタグがまだなく、公開したときに`tag_name`と`target_commitish`からタグができます。ワークフローが入れた値をそのまま信じず、版と候補のコミットを書いて上書きします。

   ```sh
   git ls-remote --tags origin vX.Y.Z   # 何も出ないこと
   gh api -X PATCH repos/{owner}/{repo}/releases/<id> \
     -f tag_name=vX.Y.Z -f target_commitish=<候補を作ったコミットの40桁のSHA>
   gh api repos/{owner}/{repo}/releases/<id> \
     --jq '{tag_name, target_commitish, draft, prerelease, name}'
   ```

   読み直した結果で、`tag_name`が`vX.Y.Z`、`target_commitish`が候補を作ったコミット、`draft`が`true`であることを確かめます。`prerelease`は正式版で`false`、ベータで`true`です。同じ名前のタグがすでにあったら止めて、保守担当者に伝えます。
3. 実機での確認を済ませます。Windowsは`release-candidates.md`の「公開前にWindowsのパッケージを起動して確かめる」、Linuxは「公開前にLinuxのデスクトップで確かめる」の手順です。確かめられなかったことは、リリースノートの`## 🐞 既知の問題`に書きます。
4. 公開の準備ができたことを報告し、保守担当者の確認を待ちます。

## 5. 公開

公開は保守担当者が行います。公開を任されたときは、次のPATCHで公開します。`make_latest`は文字列の`"true"`か`"false"`で明示します。

```sh
# 正式版
gh api -X PATCH repos/{owner}/{repo}/releases/<id> -F draft=false -f make_latest=true
# ベータ
gh api -X PATCH repos/{owner}/{repo}/releases/<id> -F draft=false -f make_latest=false
```

## 6. 公開の後

1. リリースとタグを読み直します。タグのコミットが候補を作ったコミットと同じことを確かめます。

   ```sh
   gh api repos/{owner}/{repo}/releases/tags/vX.Y.Z \
     --jq '{tag_name, draft, prerelease, target_commitish, published_at}'
   git fetch origin --tags && git rev-parse 'vX.Y.Z^{commit}'
   ```

2. make_latestの結果を`releases/latest`で確かめます。正式版なら`vX.Y.Z`、ベータなら前の正式版のままです。違うときは`make_latest`をPATCHし直します。

   ```sh
   gh api repos/{owner}/{repo}/releases/latest --jq .tag_name
   ```

3. Workerの`latest.json`を確かめます。安定版のアプリは`src-tauri/tauri.conf.json`の`plugins.updater.endpoints`にあるWorkerを読み、Workerは`releases/latest`の`latest.json`へ302で転送します（`docs/spec/external-interfaces.md`の「アプリの更新」）。正式版なら`X.Y.Z`、ベータなら前の正式版の版が出ることを確かめます。

   ```sh
   url=$(jq -r '.plugins.updater.endpoints[0]' src-tauri/tauri.conf.json)
   curl -sI "$url" | grep -i '^location'
   curl -sL "$url" | jq -r .version
   ```

4. 資産の件数と名前を確かめます。下書きの資産は各候補の`candidate-<platform>.json`にある資産とその`.sha256`、プラットフォームごとの`candidate-<platform>.json`と`SHA256SUMS-<platform>`、`latest.json`です（`tools/prepare_release.py`と`prepare-release.yml`）。期待する件数は「2 ×（2つの候補の`assets`の数の合計）+ 5」です。

   ```sh
   d=$(mktemp -d)
   gh release download vX.Y.Z -p 'candidate-*.json' -D "$d"
   gh api repos/{owner}/{repo}/releases/tags/vX.Y.Z --jq '[.assets[].name]' > "$d/published.json"
   jq -s --slurpfile pub "$d/published.json" '
     ([.[] | .assets[].name | ., . + ".sha256"]
      + [.[] | "candidate-\(.platform).json", "SHA256SUMS-\(.platform)"]
      + ["latest.json"]) as $want
     | {want: ($want | length), published: ($pub[0] | length),
        missing: ($want - $pub[0]), extra: ($pub[0] - $want)}' "$d"/candidate-*.json
   ```

   `want`と`published`が同じで、`missing`と`extra`が空であることを確かめます。前の版と件数が違うときは、配布物の増減（なくした配布物、名前を変えた配布物）で説明がつくかを確かめます。下書きを作る手順が資産の組み方を変えたら、この式も直します。

## 7. mainをdevelopへ戻す

正式版を公開すると、「Open ASTAROT back-merge pull request」（`release-back-merge.yml`）が`chore/merge-main-back-X.Y.Z`からdevelopへのPRを開きます。題は`chore(release): merge main (X.Y.Z) back into develop`です。ベータでは開きません。

1. このPRはActionsのトークンで開くので、チェックが自動では動きません。PRを一度閉じて開き直します（`gh pr close <番号> && gh pr reopen <番号>`）。
2. 衝突したら、そのブランチの上で解きます。developの版を先に次の`-beta.N`へ進めていたときは、版の行はdevelopの側を残します。
3. pull-requestスキルの「CIとマージの条件」を確かめ、マージコミットで統合します。
4. developを次の`-beta.N`へ進めます（1のベータの手順）。

PRが開かなかったときは、ジョブのSummaryにあるリンクから人がPRを開きます。リポジトリの設定でActionsにPRの作成を許していないと、ジョブはブランチを作ったところで止まります。

## 8. リリースノートの書式

正本は`docs/release-notes/README.md`です。正式版ごとに`docs/release-notes/<版>.md`を書き、GitHubのリリースの本文にします。

次の順に、見出しをすべて`##`で平らに並べます。

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
