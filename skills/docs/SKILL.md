---
name: docs
description: ASTAROTの文書（ルートの*.md、docs/、機能仕様書docs/spec、ADR、利用者向けマニュアルsite/）を、変更に合わせて直す手順。どの変更でどの文書を直すか、生成する文書の作り直し、英語版と日本語版を1つのファイルに載せる形、日付付きの記録と古いADRの扱い、マニュアルの日英のページと写真、文書の検査とPRの分け方を扱う。機能や設定、画面の文言、開発の手順、配布物を変えたあとで文書を直すとき、文書だけを直すとき、文書と実装の食い違いを見つけたときに使う。リリースノートはrelease-notesスキル、ADRの書き方はadrスキル。Use when updating ASTAROT's documentation or user guide after a change, or fixing documentation on its own.
---

# 文書を直す

文書は変えた動きと同じPRで直します。どの文書に何を書くかの正本は、[AGENTS.md](../../AGENTS.md)の「変更の対象ごとに読む資料」の表と、[機能仕様書の入口](../../docs/spec/README.md)です。このスキルには変更から直す文書を決めて直すまでの手順を書きます。リリースノートは[release-notesスキル](../release-notes/SKILL.md)、設計判断の記録は[adrスキル](../adr/SKILL.md)にあります。

## 1. 直す文書を決める

変えたものから、直す文書を決めます。1つの変更で複数の文書にかかることがよくあります。

| 変えたもの | 直す文書 |
|---|---|
| 中核のエンドポイント、通知、エラーコード、設定のキー | `mise run spec`で`docs/spec/reference/`の一覧を作り直す。動きは`docs/spec/`の手書きの文書（設定の保存なら`cross-cutting.md`と`data-and-persistence.md`、外とのやりとりなら`external-interfaces.md`、流れなら`use-cases.md`と`sequences.md`） |
| 変えてはいけない約束（停止、ミュート、同意など） | `docs/spec/contracts.md`と、それを確かめる試験 |
| 画面の文言 | `locales/en.yml`と`locales/ja.yml`の両方。利用者の操作が変わるならマニュアル（`site/en`と`site/ja`の同じページ） |
| 画面の見た目と操作 | `DESIGN.md`。マニュアルの写真が古くなるなら撮り直す（5を見る） |
| 製品の目的、守る機能、利用者の使い方 | `PRODUCT.md` |
| 開発の環境、検証のコマンド、検査の道具 | `docs/development.md` |
| ビルド、CI、配布の候補とリリースの手順 | `docs/readme_build.md`、`docs/voice-stack/release-candidates.md` |
| 依存、同梱物、モデル | `NOTICE.md`、`docs/voice-stack/licensing.md`。取得できるモデルはカタログ（AGENTS.mdの「既存の重要な境界」） |
| 名前、識別子、保存先 | `docs/voice-stack/project-rename.md` |
| 対応する環境と実機の確認 | `docs/voice-stack/platform-verification.md`と、マニュアルの対応環境の表（`site/*/guide/support.md`、releaseスキルの7） |
| 設計の選択 | `docs/adr/`（adrスキル） |

- 1つの文書には1つの機能のことを書き、同じことを2か所に書かず、リンクでつなぎます（機能仕様書の「Update rules」）。
- 文書と実装が食い違っていたら、どちらかを機械的に正しいと決めません。説明が古いだけか、実装が方針を破っているかを確かめます。決められないときは`docs/spec/open-issues.md`かIssueに書きます。
- ファイルや関数の場所は、行番号ではなくファイル名と名前で示します。

## 2. 生成する文書を手で直さない

次の文書は道具が作ります。手で直さず、道具で作り直してから、同じPRに入れます。

| 文書 | 作り直すコマンド | 古いと落ちる検査 |
|---|---|---|
| `docs/spec/reference/`の3つの一覧 | `mise run spec`（中核のJSONを書き出す試験と`python tools/spec_catalog.py --write`） | `native/core/tests/spec_catalog.rs`、`tests/devtools/test_spec_catalog.py` |
| `docs/adr/README.md`の索引の表 | `python tools/adr_catalog.py --write` | `check`の`tooling`（`--check`） |
| `CHANGELOG.md` | `tools/changelog.py`（正式版のリリースの準備のときだけ。releaseスキル） | なし |
| `site/theme/tokens.css` | `node tools/site_tokens.mjs` | Pagesのワークフローの`--check` |

## 3. 文書の形をそろえる

- ルートの`*.md`と`docs/`の文書は、1つのファイルに英語版と日本語版を載せます（2026-11-24の決定、#1080〜#1084）。英語版を先に置き、題のすぐ下に日本語版へのリンクを1行置き、区切り（`---`）のあとに`# <題>（日本語版）`で日本語版を続けます。2つの版には同じことを書き、食い違うときは英語版が正です。
- 片方の版だけを直しません。英語版を直したら日本語版も、日本語版を直したら英語版も同じPRで直します。
- マニュアルは言語ごとのフォルダー（`site/en/`と`site/ja/`）に同じ名前のページを置きます。片方のページだけを足したり消したりしません。
- `skills/`のスキルは日本語で書いています。
- 既存の文書を直すときは、その文書の文体に合わせます。`docs/spec/`の日本語版は常体です。
- 両方の言語を並べる見出しは英語を先に書きます（「Summary / 概要」。2026-11-23の決定）。

## 4. 書く

- 日本語は[jp-writingスキル](../jp-writing/SKILL.md)、英語は`docs/writing/english-guideline.md`に従います。利用者向けの文書（マニュアル、画面の文言、リリースノート）は、それぞれの「利用者向け」の決まりにも従います。
- 事実はコードと照らして書きます。画面の文言は`locales`のまま引き、設定の場所は「設定」→「ページ」→「項目」の形にします。
- `docs/voice-stack/`には日付付きの検証の記録や提案が残っています。「未公開」「次工程」「今回」などは書いた時点の状態です。記録の本文は書き換えず、今の状態は別の文書か注記で示します。
- 古いADRの本文は書き換えません。変わったことはfront matter、注記、後続のADRで示します（adrスキル）。
- 消したファイルに、日付付きの記録からリンクしていたときは、消す前のコミットに固定したGitHubのリンクに置き換えます。
- 公開する文書に、人の名前、担当、作業に使った環境を書きません。

## 5. マニュアルを直す

- 組み方とデザインは`DESIGN.md`の「The user guide (site/)」に従います。機能の名前はメインのスイッチと設定のページ、ホットキー、マニュアルで同じものにします（`DESIGN.md`）。
- 画面が変わってマニュアルの写真が古くなったら、`tools/docs_screenshots.py`で撮り直します。道具は結合テストの画面を使い、`site/public/screenshots/ja/`と`site/public/screenshots/en/`に両方の言語の写真を書き出します。結合テストの準備（`python tools/dev.py setup --scope ui`と`--scope integration`）が要ります。

  ```sh
  uv run --no-project --with pillow==13.0.0 python tools/docs_screenshots.py
  ```

- サイトはdevelopから公開されます。まだ公開していない版の動きをマニュアルに書くと、利用者が使っている版と食い違います。対応環境の表のように、版を公開したあとにマージするPRもあります（releaseスキルの7）。
- 手元で確かめるときは、Pagesのワークフローと同じ順に流します。

  ```sh
  node tools/site_tokens.mjs --check
  (cd site && npm ci --ignore-scripts && npm run build)
  node tools/check_site_search.mjs site/dist
  node tools/check_site_anchors.mjs site/dist
  node tools/check_site_downloads.mjs
  node tools/check_site_manual.mjs site/dist
  ```

## 6. 検査とPR

1. `python tools/dev.py check`で、文章の検査（`tools/writing_gate`）、画面の文言の検査（`tools/i18n_gate`）、ADRと仕様の一覧の検査を通します。
2. `python tools/dev.py check --scope links`で、Markdownのファイルどうしのリンクと見出しへのリンクを確かめます。マニュアルのページどうしのリンクは、サイトのビルドのあとの`check_site_anchors.mjs`が確かめます。
3. 文書だけを直したときは、検証もそれに見合った範囲で構いません（AGENTS.md）。実行しなかった検証は、理由と一緒にPRの本文に書きます。
4. ファイルの移動やメタデータだけの変更は、内容を変える変更と別のPRにします。
5. コードオーナーの一覧（`.github/CODEOWNERS`）にあるファイル（`site/`、`README.md`、`CHANGELOG.md`、`docs/release-notes/`、`docs/voice-stack/release-candidates.md`など）を含むPRは、保守担当者がマージします（pull-requestスキル）。
