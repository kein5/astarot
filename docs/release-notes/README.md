# Release notes format

[日本語版](#リリースノートの書式日本語版)

The notes that become the body of a GitHub release go in `docs/release-notes/<version>.md`, one file per version. Notes are written in this format from 0.5.0. Notes up to 0.4.0 are not reworked into this format. Each note carries both languages in one file, the English version first and then the Japanese version (decision of 2026-11-24). Where the two versions differ, the English is right.

`CHANGELOG.md` is the record that lists every change from the commits (`tools/changelog.py`). The release notes are text for deciding whether to update, and they are written by hand. When the two disagree, fix `CHANGELOG.md` first, then the notes.

## Overall shape

Put the English version first and the Japanese version after it:

1. The title `# ASTAROT X.Y.Z`, with a link to the Japanese version right under it
2. The English version
3. A separator (`---`)
4. The title `# ASTAROT X.Y.Z（日本語版）` and the Japanese version

Each version puts its parts in this order:

1. Opening paragraph
2. Changes that matter to users (one heading per item)
3. `## 🔧 Internal changes` (only one, at the end)

Apart from the two titles, make every heading `##` and keep them flat. Do not add a parent heading called "Changes that matter to users". The two versions have the same headings in the same order, with the same emoji.

```markdown
# ASTAROT 0.5.0

[日本語版](#astarot-050日本語版)

In ASTAROT 0.5.0, (the biggest change). (What users can do with it.)

## 🎙️ (Short title)

(Paragraph)

## ⚠️ When you update

(Paragraphs, and a list if needed)

## 🔧 Internal changes

- (Item) (#123)

---

# ASTAROT 0.5.0（日本語版）

ASTAROT 0.5.0では、（いちばん大きな変更）。（それで利用者に何ができるか）。

## 🎙️ （短い題）

（段落）

## ⚠️ 更新するときの注意

（段落と、必要なら箇条書き）

## 🔧 内部の変更

- （項目）（#123）
```

## Opening paragraph

Put it at the top of the notes, without a heading. In 2 to 4 sentences, briefly tell readers the biggest change in that version. If there is a privacy or security fix, mention it in the opening paragraph too and point to its section.

## Changes that matter to users

Write about new features, usability improvements, bug fixes, changes in compatibility and what users do when they update.

- Make one heading per item. A heading has the form "one emoji + a short title" (for example `## 🔄 Update in the app`). Put the emoji only at the start of the heading, and do not use emoji in the body.
- Write the body in paragraphs. Use a list only for things that are easier to read as a list, such as steps, options and conditions.
- Write in plain words: the English version follows "User-facing text" in `docs/writing/english-guideline.md`, and the Japanese version follows the rules for user-facing text in `docs/writing/japanese-guideline.md`. Mention the names of the internal implementation (crates, libraries, endpoints and so on) only when they affect what users do.
- Quote UI text as the UI writes it in each language: `locales/en.yml` in the English version and `locales/ja.yml` in the Japanese version. Write a settings location in the form "Settings" → "page" → "item".
- When an internal change shows up in a way users can see (for example, data goes to a different place), write the visible part here.
- Put what users do when they update from the previous stable release, and what is no longer compatible, under `## ⚠️ When you update` (`## ⚠️ 更新するときの注意` in the Japanese version). Put limitations, and what could not be checked before publishing, under `## 🐞 Known issues` (`## 🐞 既知の問題`). Place both after the other items and before the internal changes. If there is nothing to write, leave out the whole section.

## Internal changes

Collect replaced implementations, dependency updates, development infrastructure and work on licenses and documentation under the last heading, `## 🔧 Internal changes` (`## 🔧 内部の変更` in the Japanese version).

- Use a list, with each item as one short line.
- Technical terms are fine as they are.
- End each item with the pull request number (for example `(#341)`, and `（#341）` in the Japanese version). It is the number of the pull request that brought in the change, not the issue number.
- At the end of the section, put a link to this version's section of `CHANGELOG.md`: the English section from the English version, and the Japanese section from the Japanese version.

## Starting from the scaffold

Running `python tools/changelog.py scaffold-notes` (`mise run changelog:notes`) creates a scaffold of the release notes for the version in `package.json` at `docs/release-notes/<version>.md`. Pass a different version with `--version`. The scaffold lays out both versions, the English one first, each with its sections in the order of this format; the opening paragraph and the changes that matter to users are left blank. "⚠️ When you update" and "🐞 Known issues" (and their Japanese counterparts) have empty placeholders. If there is nothing to write, delete the whole section.

Under "🔧 Internal changes" and "🔧 内部の変更", the scaffold lists the pull requests merged after the previous stable release's tag, with their numbers. It reads the same commits as `python tools/changelog.py print`, and its categories are the same as in `CHANGELOG.md`. Each pull request goes into one of three groups, following the category of its most user-facing commit: changes that alter compatibility, user-facing changes and internal-only changes. Rewrite the pull requests that matter to users as a heading and a paragraph and move them to the sections above, and rewrite the rest as one short line each. A commit that came in without a pull request carries its short hash in place of a pull request number.

At the end of each version is a link to this version's section of `CHANGELOG.md` in the same language. If the section has not been written yet, the link uses the date the scaffold was made, so check the date after `write`. If a file with the same name already exists, the tool stops without overwriting it, to protect what was written by hand. No scaffold is made for a beta.

## Things to watch when writing

- The notes cover the pull requests merged from the previous stable release's tag up to the commit being released. Check that nothing is missing against the output of `python tools/changelog.py print` and the list of pull requests in `git log --first-parent`.
- Do not write people's names, who was in charge, or the PC environment used for development.
- Do not refer to the reader's PC from the developer's side, as in "this PC".
- Give measured values together with their conditions.
- Even if a rule for revising Japanese removes emoji, keep the emoji at the start of headings as part of this format.

## How this relates to the release draft

The body of the draft that "Prepare verified ASTAROT release draft" creates is the skeleton from `tools/changelog.py` (Highlights, Upgrade Notes, Known Issues and the list of changes). Before publishing, replace the body with the whole notes file in this format, both versions. The steps are in [CONTRIBUTING.md](../../CONTRIBUTING.md#changelog-and-releases) and [ASTAROT release candidates and release drafts](../voice-stack/release-candidates.md).

---

# リリースノートの書式（日本語版）

GitHub のリリースの本文にするノートを、バージョンごとに `docs/release-notes/<バージョン>.md` に置きます。0.5.0 からこの書式で書きます。0.4.0 までのノートは、この書式に組み替えません。どのノートも1つのファイルに両方の言語を載せ、英語版を先に、日本語版をそのあとに置きます（2026-11-24 の決定）。2つの版が食い違うときは、英語版が正です。

`CHANGELOG.md` は、コミットからすべての変更を並べる記録です（`tools/changelog.py`）。リリースノートは、更新するかどうかを決めるための文章で、手で書きます。両方が食い違ったときは、`CHANGELOG.md` を先に直してから、ノートを直します。

## 全体の形

英語版を先に、日本語版をそのあとに置きます。

1. 題 `# ASTAROT X.Y.Z` と、そのすぐ下の日本語版へのリンク
2. 英語版
3. 区切り（`---`）
4. 題 `# ASTAROT X.Y.Z（日本語版）` と日本語版

どちらの版も、次の順に並べます。

1. 序文
2. 利用者に関係のある変更（項目ごとに1つの見出し）
3. `## 🔧 内部の変更`（最後に1つだけ）

2つの題のほかは、見出しをどれも `##` にして、平らに並べます。「利用者に関係のある変更」という大見出しは置きません。2つの版は、同じ絵文字の同じ見出しを同じ順に並べます。

```markdown
# ASTAROT 0.5.0

[日本語版](#astarot-050日本語版)

In ASTAROT 0.5.0, (the biggest change). (What users can do with it.)

## 🎙️ (Short title)

(Paragraph)

## ⚠️ When you update

(Paragraphs, and a list if needed)

## 🔧 Internal changes

- (Item) (#123)

---

# ASTAROT 0.5.0（日本語版）

ASTAROT 0.5.0では、（いちばん大きな変更）。（それで利用者に何ができるか）。

## 🎙️ （短い題）

（段落）

## ⚠️ 更新するときの注意

（段落と、必要なら箇条書き）

## 🔧 内部の変更

- （項目）（#123）
```

## 序文

ノートの先頭に、見出しを付けずに置きます。そのバージョンでいちばん大きな変更を、2〜4文で短く伝えます。プライバシーやセキュリティの修正があれば、序文でも触れて、その節へ案内します。

## 利用者に関係のある変更

新しい機能、使い勝手の改善、不具合の修正、互換性の変化、更新するときに利用者がすることを書きます。

- 項目ごとに見出しを1つ作ります。見出しは「絵文字1つ＋短い題」の形にします（例：`## 🔄 アプリの中で更新する`）。絵文字は見出しの先頭にだけ置き、本文には使いません。
- 本文は段落で書きます。手順、選択肢、条件のように並べると読みやすいものだけを箇条書きにします。
- 平易な言葉で書きます。英語版は `docs/writing/english-guideline.md` の「User-facing text」に、日本語版は `docs/writing/japanese-guideline.md` の利用者向けの決まりに従います。内部の実装の名前（クレート、ライブラリ、エンドポイントなど）は、利用者がすることに関わるときだけ書きます。
- 画面の文言は、それぞれの言語の画面の表記のまま引きます。英語版は `locales/en.yml`、日本語版は `locales/ja.yml` です。設定の場所は「設定」→「ページ」→「項目」の形で書きます。
- 内部の変更が利用者に見える形で現れるとき（データの送り先が変わるなど）は、見える部分をこちらに書きます。
- 前の正式版から更新するときにすることと、互換性がなくなった点は、`## ⚠️ 更新するときの注意`（英語版では `## ⚠️ When you update`）にまとめます。制限と、公開する前に確かめられなかったことは、`## 🐞 既知の問題`（`## 🐞 Known issues`）にまとめます。どちらも、ほかの項目のあと、内部の変更の前に置きます。書くことがなければ節ごと省きます。

## 内部の変更

実装の置き換え、依存の更新、開発の基盤、ライセンスやドキュメントの整備を、最後の `## 🔧 内部の変更`（英語版では `## 🔧 Internal changes`）にまとめます。

- 箇条書きで、1項目を短い1行にします。
- 専門用語のままで構いません。
- 各項目の末尾に PR の番号を付けます（例：`（#341）`。英語版では `(#341)`）。Issue の番号ではなく、変更を入れた PR の番号です。
- 節の最後に、`CHANGELOG.md` のこの版の節へのリンクを置きます。英語版からは英語の節へ、日本語版からは日本語の節へつなぎます。

## 雛形から書き始める

`python tools/changelog.py scaffold-notes`（`mise run changelog:notes`）を実行すると、`package.json`の版のリリースノートの雛形が`docs/release-notes/<バージョン>.md`にできます。別の版は`--version`で指定します。雛形は英語版を先にして両方の版を並べ、それぞれの節をこの書式の順に置いたもので、序文と利用者に関係のある変更は空欄です。「⚠️ 更新するときの注意」と「🐞 既知の問題」（英語版では「⚠️ When you update」と「🐞 Known issues」）には空の置き場所があります。書くことがなければ節ごと消します。

「🔧 Internal changes」と「🔧 内部の変更」には前の正式版のタグのあとにマージしたPRを番号付きで並べます。もとにするコミットは`python tools/changelog.py print`と同じで、分類も`CHANGELOG.md`と同じです。各PRは含むコミットのうち最も利用者に近いものの分類に従って、互換性が変わるもの、利用者に関係のあるもの、内部だけのものの3つに分かれます。利用者に関係のあるPRは見出しと段落に書き直して上の節へ移し、残りは短い1行に書き直します。PRを通らずに入ったコミットには、PRの番号の代わりに短いハッシュが付きます。

それぞれの版の末尾には、同じ言語の`CHANGELOG.md`のこの版の節へのリンクがあります。節をまだ書いていないときは雛形を作った日の日付でリンクを作るので、`write`のあとで日付を確かめます。同じ名前のファイルがすでにあるときは、手で書いた内容を守るために上書きせずに止まります。ベータ版の雛形は作りません。

## 書くときの注意

- 対象は、前の正式版のタグから、リリースするコミットまでにマージした PR です。漏れがないかは、`python tools/changelog.py print` の結果と、`git log --first-parent` の PR の一覧で確かめます。
- 人の名前、担当、開発に使った PC の環境は書きません。
- 読み手の PC を「この PC」のように開発者の側から指す言い方はしません。
- 計測した値は、条件とあわせて書きます。
- 日本語の推敲で絵文字を外す決まりがあっても、見出しの先頭の絵文字はこの書式の一部として残します。

## リリースの下書きとの関係

「Prepare verified ASTAROT release draft」が作る下書きの本文は、`tools/changelog.py` の骨組み（Highlights、Upgrade Notes、Known Issues と変更の一覧）です。公開する前に、本文をこの書式のノートのファイル全体（両方の版）に差し替えます。手順は [CONTRIBUTING.md](../../CONTRIBUTING.md#changelog-and-releases) と [配布候補とリリース下書き](../voice-stack/release-candidates.md) にあります。
