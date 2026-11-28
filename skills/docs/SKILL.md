---
name: docs
description: Steps for updating ASTAROT's documents (the root *.md, docs/, the spec in docs/spec, ADRs and the user guide in site/) after a change: which documents to update, regenerating generated ones, keeping the English (authoritative) and Japanese versions in one file, dated records and old ADRs, the user guide's pages and screenshots in both languages, and the checks and how to split pull requests. Use when updating documentation or the user guide after changing a feature, a setting, UI text, the development steps or the packages, when fixing documentation on its own, or when a document and the implementation disagree. Not for release notes (release-notes skill) or how to write an ADR (adr skill). ASTAROTの文書（ルートの*.md、docs/、機能仕様書docs/spec、ADR、利用者向けマニュアルsite/）を、変更に合わせて直す手順。どの変更でどの文書を直すか、生成する文書の作り直し、英語版を正本として日本語版と1つのファイルに載せる形、日付付きの記録と古いADRの扱い、マニュアルの日英のページと写真、文書の検査とPRの分け方を扱う。リリースノートはrelease-notesスキル、ADRの書き方はadrスキル。
---

# Updating documents

[日本語版](#文書を直す日本語版)

Update the documents in the same pull request as the behavior you changed. What goes in which document is set by the table "What to read for each kind of change" in [AGENTS.md](../../AGENTS.md) and by [the entry point of the feature spec](../../docs/spec/README.md). This skill covers the steps from a change to updating the documents it affects. Release notes are in the [release-notes skill](../release-notes/SKILL.md), and design decision records in the [adr skill](../adr/SKILL.md).

## 1. Decide which documents to update

Decide from what you changed. One change often reaches several documents.

| What you changed | Documents to update |
|---|---|
| The core's endpoints, notifications, error codes or setting keys | Regenerate the lists in `docs/spec/reference/` with `mise run spec`. Describe the behavior in the hand-written documents in `docs/spec/` (`cross-cutting.md` and `data-and-persistence.md` for saving settings, `external-interfaces.md` for exchanges with the outside, `use-cases.md` and `sequences.md` for flows) |
| Promises that must not change (stop, mute, consent and the like) | `docs/spec/contracts.md` and the tests that check them |
| UI text | Both `locales/en.yml` and `locales/ja.yml`. If what users do changes, the user guide too (the same page in `site/en` and `site/ja`) |
| The look and operation of screens | `DESIGN.md`. If the user guide's screenshots go out of date, retake them (see 5) |
| The product's purpose, the features it must keep, how users use it | `PRODUCT.md` |
| The development environment, verification commands, check tools | `docs/development.md` |
| Builds, CI, release candidates and the release steps | `docs/readme_build.md`, `docs/voice-stack/release-candidates.md` |
| Dependencies, bundled components, models | `NOTICE.md`, `docs/voice-stack/licensing.md`. Models offered for download go in the catalog ("Important existing boundaries" in AGENTS.md) |
| Names, identifiers, storage locations | `docs/voice-stack/project-rename.md` |
| Supported environments and checks on real machines | `docs/voice-stack/platform-verification.md` and the user guide's table of supported environments (`site/*/guide/support.md`; section 7 of the release skill) |
| Design choices | `docs/adr/` (the adr skill) |

- Keep one document to one feature. Do not write the same thing in two places; connect them with links (the spec's "Update rules").
- When a document and the implementation disagree, do not decide mechanically that one of them is right. Find out whether the description is only out of date or the implementation breaks a policy. If you cannot decide, write it in `docs/spec/open-issues.md` or in an issue.
- Point to a file or a function by the file name and its name, not by line number.

## 2. Do not edit generated documents by hand

Tools write the documents below. Do not edit them by hand. Regenerate them with the tool, then put them in the same pull request.

| Document | Command that regenerates it | Check that fails when it is out of date |
|---|---|---|
| The three lists in `docs/spec/reference/` | `mise run spec` (the test that writes the core's JSON, then `python tools/spec_catalog.py --write`) | `native/core/tests/spec_catalog.rs`, `tests/devtools/test_spec_catalog.py` |
| The index table in `docs/adr/README.md` | `python tools/adr_catalog.py --write` | `tooling` in `check` (`--check`) |
| `CHANGELOG.md` | `tools/changelog.py` (only when preparing a stable release; the release skill) | None |
| `site/theme/tokens.css` | `node tools/site_tokens.mjs` | `--check` in the Pages workflow |

## 3. Keep the documents in one form

- The English version is authoritative, and the Japanese version is made from it. Where the two differ, the English prevails. The rule, what it covers, the order of the work and what is out of scope are in "English and Japanese" in [AGENTS.md](../../AGENTS.md#english-and-japanese).
- The root `*.md`, the documents in `docs/` and the skills in `skills/` carry the English and Japanese versions in one file (decision of 2026-11-24, #1080 to #1084; the skills from #1367). Put the English version first, with one line that links to the Japanese version right under the title. After the divider (`---`), the Japanese version follows under `# <title>（日本語版）`. Give the two versions the same headings in the same order.
- Make a change in the English version first, and bring the Japanese version in line in the same pull request. A pull request that changes only the Japanese version is acceptable only as a translation fix that brings the Japanese in line with the English.
- `python tools/bilingual_docs.py --check` (`tooling` in `check`) checks that both versions exist and that their headings match. It does not check that they mean the same, so read the two versions side by side before you open the pull request. Files outside this form (legal texts, generated lists, the README pair and others) are listed in the tool with their reasons.
- The user guide keeps a page of the same name in each language's folder (`site/en/` and `site/ja/`). Do not add or remove a page on one side only.
- When you edit an existing document, follow its style. The Japanese version of `docs/spec/` is written in the plain form (常体).
- A heading that gives both languages puts English first ("Summary / 概要"; decision of 2026-11-23).

## 4. Write

- Follow the [jp-writing skill](../jp-writing/SKILL.md) for Japanese and `docs/writing/english-guideline.md` for English. Documents for users (the user guide, UI text, release notes) also follow each guideline's rules for user-facing text.
- Write facts after checking them against the code. Quote UI text as `locales` has it, and write a settings location in the form "Settings" → "page" → "item".
- `docs/voice-stack/` holds dated verification records and proposals. Words such as "unreleased" (未公開), "next step" (次工程) and "this time" (今回) describe the state at the time of writing. Do not rewrite the body of a record. Show the current state in another document or in a note.
- Do not rewrite the body of an old ADR. Show what changed in the front matter, in a note or in a later ADR (the adr skill).
- When a dated record linked to a file you delete, replace the link with a GitHub link pinned to the commit before the deletion.
- Do not write people's names, who was in charge or the environment used for the work in a published document.

## 5. Update the user guide

- Follow "The user guide (site/)" in `DESIGN.md` for its layout and design. Give a feature the same name on its main switch, its settings page, its hotkey and in the user guide (`DESIGN.md`).
- When a screen changes and the user guide's screenshots go out of date, retake them with `tools/docs_screenshots.py`. The tool uses the screens of the integration tests and writes screenshots in both languages to `site/public/screenshots/ja/` and `site/public/screenshots/en/`. It needs the integration tests set up (`python tools/dev.py setup --scope ui` and `--scope integration`).

  ```sh
  uv run --no-project --with pillow==13.0.0 python tools/docs_screenshots.py
  ```

- The site is published from develop. If the user guide describes the behavior of a version that is not released yet, it disagrees with the version users have. Some pull requests, such as the table of supported environments, are merged after the version is released (section 7 of the release skill).
- To check locally, run the steps in the same order as the Pages workflow.

  ```sh
  node tools/site_tokens.mjs --check
  (cd site && npm ci --ignore-scripts && npm run build)
  node tools/check_site_search.mjs site/dist
  node tools/check_site_anchors.mjs site/dist
  node tools/check_site_downloads.mjs
  node tools/check_site_manual.mjs site/dist
  ```

## 6. Checks and pull requests

1. With `python tools/dev.py check`, pass the prose check (`tools/writing_gate`), the UI text check (`tools/i18n_gate`), the bilingual document check (`tools/bilingual_docs.py`) and the checks of the ADR and spec lists.
2. With `python tools/dev.py check --scope links`, check the links between Markdown files and the links to headings. The links between the user guide's pages are checked by `check_site_anchors.mjs` after the site build.
3. When you changed only documents, the verification may be scaled to match (AGENTS.md). Write the verification you did not run in the pull request description, with the reason.
4. Put moves of files and metadata-only changes in a separate pull request from changes to content.
5. A pull request that includes a file in the code owners' list (`.github/CODEOWNERS`: `site/`, `README.md`, `CHANGELOG.md`, `docs/release-notes/`, `docs/voice-stack/release-candidates.md` and others) is merged by a maintainer (the pull-request skill).

---

# 文書を直す（日本語版）

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

- 英語版を正本とし、日本語版は英語版から作ります。食い違うときは英語版が優先します。決まり、対象、作業の順、対象外は[AGENTS.md](../../AGENTS.md#英語と日本語)の「英語と日本語」にあります。
- ルートの`*.md`、`docs/`の文書、`skills/`のスキルは、1つのファイルに英語版と日本語版を載せます（2026-11-24の決定、#1080〜#1084。スキルは#1367から）。英語版を先に置き、題のすぐ下に日本語版へのリンクを1行置きます。区切り（`---`）のあとに、`# <題>（日本語版）`で日本語版を続けます。2つの版には同じ見出しを同じ順に並べます。
- 変更はまず英語版に入れ、日本語版を同じPRで英語版に合わせます。日本語版だけを変えるPRは、日本語を英語に合わせる翻訳の修正のときに限ります。
- `python tools/bilingual_docs.py --check`（`check`の`tooling`）が、両方の版があることと見出しが一致することを確かめます。意味が同じかは確かめないので、PRを出す前に2つの版を読み比べます。この形の外にあるファイル（法的な文書、生成する一覧、READMEの対など）は、理由と一緒に道具の中に挙げてあります。
- マニュアルは言語ごとのフォルダー（`site/en/`と`site/ja/`）に同じ名前のページを置きます。片方のページだけを足したり消したりしません。
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

1. `python tools/dev.py check`で、文章の検査（`tools/writing_gate`）、画面の文言の検査（`tools/i18n_gate`）、2か国語の文書の検査（`tools/bilingual_docs.py`）、ADRと仕様の一覧の検査を通します。
2. `python tools/dev.py check --scope links`で、Markdownのファイルどうしのリンクと見出しへのリンクを確かめます。マニュアルのページどうしのリンクは、サイトのビルドのあとの`check_site_anchors.mjs`が確かめます。
3. 文書だけを直したときは、検証もそれに見合った範囲で構いません（AGENTS.md）。実行しなかった検証は、理由と一緒にPRの本文に書きます。
4. ファイルの移動やメタデータだけの変更は、内容を変える変更と別のPRにします。
5. コードオーナーの一覧（`.github/CODEOWNERS`）にあるファイル（`site/`、`README.md`、`CHANGELOG.md`、`docs/release-notes/`、`docs/voice-stack/release-candidates.md`など）を含むPRは、保守担当者がマージします（pull-requestスキル）。
