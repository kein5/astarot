# Release notes format

[日本語版](#リリースノートの書式日本語版)

The notes that become the body of a GitHub release go in `docs/release-notes/<version>.md`, one file per version. Notes are written in this format from 0.5.0. Notes up to 0.4.0 are not reworked into this format.

`CHANGELOG.md` is the record that lists every change from the commits (`tools/changelog.py`). The release notes are text for deciding whether to update, and they are written by hand. When the two disagree, fix `CHANGELOG.md` first, then the notes.

## Overall shape

Put the parts in this order:

1. Opening paragraph
2. Changes that matter to users (one heading per item)
3. `## 🔧 Internal changes` (only one, at the end)

Make every heading `##` and keep them flat. Do not add a parent heading called "Changes that matter to users".

```markdown
In ASTAROT 0.5.0, (the biggest change). (What users can do with it.)

## 🎙️ (Short title)

(Paragraph)

## ⚠️ When you update

(Paragraphs, and a list if needed)

## 🔧 Internal changes

- (Item) (#123)
```

## Opening paragraph

Put it at the top of the notes, without a heading. In 2 to 4 sentences, briefly tell readers the biggest change in that version. If there is a privacy or security fix, mention it in the opening paragraph too and point to its section.

## Changes that matter to users

Write about new features, usability improvements, bug fixes, changes in compatibility and what users do when they update.

- Make one heading per item. A heading has the form "one emoji + a short title" (for example `## 🔄 Update in the app`). Put the emoji only at the start of the heading, and do not use emoji in the body.
- Write the body in paragraphs. Use a list only for things that are easier to read as a list, such as steps, options and conditions.
- Write in plain Japanese. Mention the names of the internal implementation (crates, libraries, endpoints and so on) only when they affect what users do.
- Quote UI text as `locales/ja.yml` writes it. Write a settings location in the form "Settings" → "page" → "item".
- When an internal change shows up in a way users can see (for example, data goes to a different place), write the visible part here.
- Put what users do when they update from the previous stable release, and what is no longer compatible, under `## ⚠️ When you update`. Put limitations, and what could not be checked before publishing, under `## 🐞 Known issues`. Place both after the other items and before the internal changes. If there is nothing to write, leave out the whole section.

## Internal changes

Collect replaced implementations, dependency updates, development infrastructure and work on licenses and documentation under the last heading, `## 🔧 Internal changes`.

- Use a list, with each item as one short line.
- Technical terms are fine as they are.
- End each item with the pull request number (for example `(#341)`). It is the number of the pull request that brought in the change, not the issue number.
- At the end of the section, put a link to `CHANGELOG.md`.

## Starting from the scaffold

Running `python tools/changelog.py scaffold-notes` (`mise run changelog:notes`) creates a scaffold of the release notes for the version in `package.json` at `docs/release-notes/<version>.md`. Pass a different version with `--version`. The scaffold lays out the sections in the order of this format, and the opening paragraph and the changes that matter to users are left blank. "⚠️ 更新するときの注意" (When you update) and "🐞 既知の問題" (Known issues) have empty placeholders. If there is nothing to write, delete the whole section.

Under "🔧 内部の変更" (Internal changes), the scaffold lists the pull requests merged after the previous stable release's tag, with their numbers. It reads the same commits as `python tools/changelog.py print`, and its categories are the same as in `CHANGELOG.md`. Each pull request goes into one of three groups, following the category of its most user-facing commit: changes that alter compatibility, user-facing changes and internal-only changes. Rewrite the pull requests that matter to users as a heading and a paragraph and move them to the sections above, and rewrite the rest as one short line each. A commit that came in without a pull request carries its short hash in place of a pull request number.

At the end is a link to this version's section of `CHANGELOG.md`. If the section has not been written yet, the link uses the date the scaffold was made, so check the date after `write`. If a file with the same name already exists, the tool stops without overwriting it, to protect what was written by hand. No scaffold is made for a beta.

## Things to watch when writing

- The notes cover the pull requests merged from the previous stable release's tag up to the commit being released. Check that nothing is missing against the output of `python tools/changelog.py print` and the list of pull requests in `git log --first-parent`.
- Do not write people's names, who was in charge, or the PC environment used for development.
- Do not refer to the reader's PC from the developer's side, as in "this PC".
- Give measured values together with their conditions.
- Even if a rule for revising Japanese removes emoji, keep the emoji at the start of headings as part of this format.

## How this relates to the release draft

The body of the draft that "Prepare verified ASTAROT release draft" creates is the skeleton from `tools/changelog.py` (Highlights, Upgrade Notes, Known Issues and the list of changes). Before publishing, replace the body with notes in this format. The steps are in [CONTRIBUTING.md](../../CONTRIBUTING.md#changelog-and-releases) and [ASTAROT release candidates and release drafts](../voice-stack/release-candidates.md).

---

# リリースノートの書式（日本語版）

GitHub のリリースの本文にするノートを、バージョンごとに `docs/release-notes/<バージョン>.md` に置きます。0.5.0 からこの書式で書きます。0.4.0 までのノートは、この書式に組み替えません。

`CHANGELOG.md` は、コミットからすべての変更を並べる記録です（`tools/changelog.py`）。リリースノートは、更新するかどうかを決めるための文章で、手で書きます。両方が食い違ったときは、`CHANGELOG.md` を先に直してから、ノートを直します。

## 全体の形

次の順に並べます。

1. 序文
2. 利用者に関係のある変更（項目ごとに1つの見出し）
3. `## 🔧 内部の変更`（最後に1つだけ）

見出しはどれも `##` にして、平らに並べます。「利用者に関係のある変更」という大見出しは置きません。

```markdown
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
- 平易な日本語で書きます。内部の実装の名前（クレート、ライブラリ、エンドポイントなど）は、利用者がすることに関わるときだけ書きます。
- 画面の文言は `locales/ja.yml` の表記のまま引きます。設定の場所は「設定」→「ページ」→「項目」の形で書きます。
- 内部の変更が利用者に見える形で現れるとき（データの送り先が変わるなど）は、見える部分をこちらに書きます。
- 前の正式版から更新するときにすることと、互換性がなくなった点は、`## ⚠️ 更新するときの注意` にまとめます。制限と、公開する前に確かめられなかったことは、`## 🐞 既知の問題` にまとめます。どちらも、ほかの項目のあと、内部の変更の前に置きます。書くことがなければ節ごと省きます。

## 内部の変更

実装の置き換え、依存の更新、開発の基盤、ライセンスやドキュメントの整備を、最後の `## 🔧 内部の変更` にまとめます。

- 箇条書きで、1項目を短い1行にします。
- 専門用語のままで構いません。
- 各項目の末尾に PR の番号を付けます（例：`（#341）`）。Issue の番号ではなく、変更を入れた PR の番号です。
- 節の最後に、`CHANGELOG.md` へのリンクを置きます。

## 雛形から書き始める

`python tools/changelog.py scaffold-notes`（`mise run changelog:notes`）を実行すると、`package.json`の版のリリースノートの雛形が`docs/release-notes/<バージョン>.md`にできます。別の版は`--version`で指定します。雛形はこの書式の順に節を並べたもので、序文と利用者に関係のある変更は空欄です。「⚠️ 更新するときの注意」と「🐞 既知の問題」には空の置き場所があります。書くことがなければ節ごと消します。

「🔧 内部の変更」には前の正式版のタグのあとにマージしたPRを番号付きで並べます。もとにするコミットは`python tools/changelog.py print`と同じで、分類も`CHANGELOG.md`と同じです。各PRは含むコミットのうち最も利用者に近いものの分類に従って、互換性が変わるもの、利用者に関係のあるもの、内部だけのものの3つに分かれます。利用者に関係のあるPRは見出しと段落に書き直して上の節へ移し、残りは短い1行に書き直します。PRを通らずに入ったコミットには、PRの番号の代わりに短いハッシュが付きます。

末尾には`CHANGELOG.md`のこの版の節へのリンクがあります。節をまだ書いていないときは雛形を作った日の日付でリンクを作るので、`write`のあとで日付を確かめます。同じ名前のファイルがすでにあるときは、手で書いた内容を守るために上書きせずに止まります。ベータ版の雛形は作りません。

## 書くときの注意

- 対象は、前の正式版のタグから、リリースするコミットまでにマージした PR です。漏れがないかは、`python tools/changelog.py print` の結果と、`git log --first-parent` の PR の一覧で確かめます。
- 人の名前、担当、開発に使った PC の環境は書きません。
- 読み手の PC を「この PC」のように開発者の側から指す言い方はしません。
- 計測した値は、条件とあわせて書きます。
- 日本語の推敲で絵文字を外す決まりがあっても、見出しの先頭の絵文字はこの書式の一部として残します。

## リリースの下書きとの関係

「Prepare verified ASTAROT release draft」が作る下書きの本文は、`tools/changelog.py` の骨組み（Highlights、Upgrade Notes、Known Issues と変更の一覧）です。公開する前に、本文をこの書式のノートに差し替えます。手順は [CONTRIBUTING.md](../../CONTRIBUTING.md#changelog-and-releases) と [配布候補とリリース下書き](../voice-stack/release-candidates.md) にあります。
