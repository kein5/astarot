---
name: release-notes
description: Steps for writing, revising and checking ASTAROT's release notes (docs/release-notes/<version>.md for a stable release, the prerelease body for a beta). Covers the pull requests in range, checking UI text and settings locations, the English and Japanese versions, wording for users (avoiding the developer's point of view), revising with jp-writing, and the prose check and updating the draft. Use when writing or revising notes for a stable release or a beta, preparing a beta's notes or checking the facts in notes. The version bump and publishing themselves are in the release skill. ASTAROTのリリースノート（正式版のdocs/release-notes/<版>.mdと、ベータ版のプレリリースの本文）を書き、推敲し、検査する手順。範囲のPRの集め方、画面の文言と設定の場所の確かめ方、英語版と日本語版の組み方、利用者向けの言い回し（開発者の視点の言葉を避ける）、jp-writingでの推敲、文章の検査と下書きへの反映を扱う。リリースノートを書く、直す、ベータのノートを用意する、ノートの事実を確かめるときに使う。版上げや公開の手順そのものはreleaseスキル。
---

# Writing release notes

[日本語版](#リリースノートを書く日本語版)

Release notes are the text users read to decide whether to update. [The release notes format](../../docs/release-notes/README.md) is the authoritative source for the format, and this skill covers only the steps for writing them. The steps for the version bump, the draft and publishing are in the [release skill](../release/SKILL.md). Write the Japanese version with the [jp-writing skill](../jp-writing/SKILL.md) every time.

## 1. Decide the range

1. Decide which pull requests the notes cover.
   - Stable release: the pull requests merged from the previous stable release's tag up to the commit being released
   - Beta: the pull requests merged from the previous beta's tag (for the first beta of a version, the previous stable release's tag) up to the commit being released
2. List the pull requests with `git log --first-parent --merges <previous tag>..<commit>`. For a stable release, also compare the list with `python tools/changelog.py print`.
3. The draft is made after the version bump pull request is merged. So when you wrote the notes earlier, add the pull requests that went in before the version bump pull request was merged, then put the notes in the draft.
4. Check where the notes go. For a stable release, write `docs/release-notes/<version>.md` on the release branch, and it becomes the body of the GitHub release. For a beta, write the notes neither in `docs/release-notes/` nor in `CHANGELOG.md`; they are only the body of the prerelease (the release skill).

## 2. Gather the facts

Do not write from the pull request descriptions alone. What a description plans can differ from the code that was merged. Check the following for each pull request.

- Whether users can see the change. If they cannot, move it to "Internal changes".
- What users can now do, or what was fixed. For a fix, also note what happened before.
- UI text. For each key in `locales/en.yml` and `locales/ja.yml`, note the wording in both languages. For an item that was renamed, also note its previous name from `locales` at the previous version's tag.
- Settings locations. Check in `src-ui` which item on which page it is. Also check whether it is inside the "More settings" fold (「詳細設定」 in the Japanese version).
- Conditions and limits: the supported OS, only while another setting is on, and what has not been checked.
- Data sent and consent: what is sent to outside services and when, and what users are asked to confirm.

When there are many pull requests, you may hand the listing of facts to another agent. Even then, have it check UI text by the keys in `locales` and settings locations in `src-ui`.

Do not write about a feature that is not implemented as if it were. When only the parts went in and there is no screen yet (such as Talk AI in 0.7.0-beta.1 and 0.7.0-beta.2), write what went in and what cannot be used yet.

## 3. Put the notes together

The structure follows the authoritative format. Only the main points are listed here.

- Put the English version first, with a link to the Japanese version under the title. Put the Japanese version after the divider (`---`). Give the two versions the same headings in the same order, with the same emoji. Where they differ, the English version is right.
- A beta's notes also carry both the English and the Japanese versions, as a stable release's notes do (decision of 2026-11-25).
- Write the opening paragraph without a heading, in 2 to 4 sentences, about the biggest change in the version. If there is a privacy or security fix, mention it in the opening paragraph too.
- For each change that matters to users, make a heading of "one emoji + a short title" and write the body in paragraphs. Use a list only when you list three or more things.
- Put `## ⚠️ When you update` and `## 🐞 Known issues` after the other items and before the internal changes. If there is nothing to write, leave out the whole section. Put what could not be checked before publishing (on real machines, with headsets and so on) under known issues.
- Under `## 🔧 Internal changes`, make each item one short line and end it with the pull request numbers. Write the numbers as `(#1, #2)` in the English version and `（#1, #2）` in the Japanese version, and combine consecutive numbers as in `#1121〜#1123`. Items in the Japanese version are short lines in the plain form (常体) (the 0.6.0 notes).
- At the end of the section, a stable release puts a link to this version's section of `CHANGELOG.md`. A beta puts a note that it is not in `CHANGELOG.md` and a link to the page that compares it with the previous version's tag.

In a beta's notes, write these three things in the paragraph after the opening paragraph.

- That bugs may remain, because it is a beta
- How to get it (that it arrives through the in-app update from the previous beta, that it does not arrive on the stable channel and how to switch "Update channel")
- Where to report bugs (Issues)

## 4. Write for users

Readers have no knowledge of audio processing or programming. The English version follows "User-facing text" in `docs/writing/english-guideline.md`, and the Japanese version follows "User-facing text" in `docs/writing/japanese-guideline.md` and its "Words to replace" table. In particular, keep to the following.

- Do not use words from the developer's point of view. Do not call the user's PC "this PC" or "the host"; write "your PC". Mention names such as crates, endpoints and sidecars only when they affect what users do.
- Name who acts. When you can write "ASTAROT saves" instead of "the settings are saved", write that.
- Quote UI text exactly as `locales` has it. Write a settings location in the form "Settings" → "page" → "item", and include "More settings" when it is inside the fold.
- Be specific about what cannot be done, the data that is sent and consent.
- Give measured values with their conditions. Do not write that every PC gets the same result.
- Do not write people's names, who was in charge or the environment used for development. Do not write the maintainer's nickname either. Refer to a decision by its date, as in "by the decision of 2026-11-24".
- Write "not verified" or "expected" for what has not been checked. Do not make a statement more certain than it is.

## 5. Revise

Write the Japanese version with the steps of the jp-writing skill.

1. Record the requirements, the design and the intent of each sentence with tsuzuri, then write. tsuzuri's output breaks the line after each sentence, so join each paragraph into one line when you put it in the notes.
2. Revise with yomiyasu. When it flags the emoji at the start of a heading (part of the format) or the word 版 ("version", a terminology rule), keep them, because the format and the Japanese writing guideline take precedence.
3. Count the commas (読点) and the line breaks (step 5 of the jp-writing skill). In release notes, the prose check in section 6 also checks the form of commas and line breaks. Put a comma only to separate a condition, a reason or parallel items, and where it prevents a misreading. Delete a comma that only adds a pause after a short topic at the start of a sentence (「Windowsでは、」). Turn a sentence that lists many things with commas into a list, or split it ("Sentence structure" in the Japanese writing guideline). Keep each paragraph on one line, with one blank line between paragraphs.

Revise the English version with the English writing guideline, and check it against the Japanese version for the same facts, conditions and UI names.

## 6. Check

1. Pass the prose check with `--user`. The check treats a file as release notes only when its path starts with `docs/release-notes/`: it then allows emoji in headings and also checks the form of commas and line breaks (`tools/writing_gate/release_notes.mjs`).

   ```sh
   node tools/writing_gate/check.mjs --file docs/release-notes/<version>.md --user
   ```

   A beta's notes are not kept in the repository, so copy them into `docs/release-notes/` in the worktree for the check and delete them right after. Do not commit them.
2. Check that the text the notes quote in 「」 and "" is in `locales/ja.yml` and `locales/en.yml` exactly as written. Check names from before a change in `locales` at the previous version's tag.
3. For a stable release, check the links with `python tools/dev.py check --scope links`. Some links to the comparison page and to the release cannot be opened until the release is published.

## 7. Put the notes into the draft

When the notes are ready, replace the body of the draft with the steps in section 4 of the release skill ("Before publishing").

```sh
gh api -X PATCH repos/{owner}/{repo}/releases/<id> -F body=@<notes file>
```

After replacing it, read the body again and check that the title, the link to the Japanese version, the divider and the numbers in the internal changes are all in place. A maintainer checks the release before it is published.

---

# リリースノートを書く（日本語版）

リリースノートは利用者が更新するかどうかを決めるための文章です。書式の正本は[リリースノートの書式](../../docs/release-notes/README.md)で、このスキルには書く手順だけを書きます。版上げ、下書き、公開の手順は[releaseスキル](../release/SKILL.md)にあります。日本語版は毎回[jp-writingスキル](../jp-writing/SKILL.md)で書きます。

## 1. 範囲を決める

1. 対象のPRを決めます。
   - 正式版：前の正式版のタグから、リリースするコミットまでにマージしたPR
   - ベータ版：前のベータ版のタグ（その版の最初のベータなら前の正式版のタグ）から、リリースするコミットまでにマージしたPR
2. PRの一覧は`git log --first-parent --merges <前のタグ>..<コミット>`で出します。正式版は`python tools/changelog.py print`とも突き合わせます。
3. 下書きは版上げのPRのマージのあとに作るので、ノートを先に書いたときは、版上げのPRのマージまでに入ったPRを足してから下書きに入れます。
4. 置き場所を確かめます。正式版は`docs/release-notes/<版>.md`をreleaseブランチで書き、GitHubのリリースの本文にします。ベータ版は`docs/release-notes/`にも`CHANGELOG.md`にも書かず、プレリリースの本文だけにします（releaseスキル）。

## 2. 事実を集める

PRの本文だけを読んで書きません。PRの本文の予定と、マージしたコードが違うことがあります。PRごとに次を確かめます。

- 利用者に見える変更か。見えなければ「内部の変更」に回します。
- 何ができるようになったか、何が直ったか。直したものは前に何が起きていたかも控えます。
- 画面の文言。`locales/en.yml`と`locales/ja.yml`のキーごとに、両方の言語の表記を控えます。名前を変えた項目は前の版のタグの`locales`で前の名前も控えます。
- 設定の場所。どのページのどの項目かを`src-ui`で確かめます。「詳細設定」（英語版では"More settings"）の折りたたみの中にあるかも確かめます。
- 条件と制限。対応するOS、ほかの設定がオンのときだけ、確かめていないこと。
- 送るデータと同意。外のサービスへ何をいつ送るか、利用者に何を確かめるか。

PRが多いときは、事実の書き出しを別のエージェントに任せてもかまいません。そのときも、画面の文言は`locales`のキーで、設定の場所は`src-ui`で確かめさせます。

実装されていない機能を、実装したように書きません。部品だけが入って画面がないとき（0.7.0-beta.1と0.7.0-beta.2のおしゃべりAIなど）は、何が入って何がまだ使えないかを書きます。

## 3. 組み立てる

構成は書式の正本のとおりです。要点だけを挙げます。

- 英語版を先に置き、題の下に日本語版へのリンクを置きます。区切り（`---`）のあとに日本語版を置きます。2つの版は同じ見出しを同じ順に、同じ絵文字で並べます。食い違うときは英語版が正です。
- ベータ版のノートも、正式版と同じく英語版と日本語版の両方を載せます（2026-11-25の決定）。
- 序文は見出しを付けずに2〜4文で、その版でいちばん大きな変更を書きます。プライバシーやセキュリティの修正があれば、序文でも触れます。
- 利用者に関係のある変更は、項目ごとに「絵文字1つ＋短い題」の見出しを作り、本文は段落で書きます。3つ以上を並べるときだけ箇条書きにします。
- `## ⚠️ 更新するときの注意`と`## 🐞 既知の問題`はほかの項目のあと、内部の変更の前に置きます。書くことがなければ節ごと省きます。公開の前に確かめられなかったこと（実機、ヘッドセットなど）は既知の問題に書きます。
- `## 🔧 内部の変更`は1項目を短い1行にし、末尾にPRの番号を付けます。番号は英語版で`(#1, #2)`、日本語版で`（#1, #2）`の形にし、続く番号は`#1121〜#1123`のようにまとめます。日本語版の項目は常体の短い1行です（0.6.0のノート）。
- 節の最後に、正式版は`CHANGELOG.md`のこの版の節へのリンクを置きます。ベータ版は`CHANGELOG.md`に載せないことと、前の版のタグとの比較のページへのリンクを置きます。

ベータ版のノートでは序文の次の段落に次の3つを書きます。

- ベータ版なので不具合が残っていることがあること
- 受け取り方（前のベータ版からはアプリの中の更新で届くこと、安定版のチャンネルでは届かないこと、「アップデートのチャンネル」の切り替え方）
- 不具合の知らせ先（Issues）

## 4. 利用者に向けて書く

読み手は音声処理やプログラムの知識を持っていない人です。英語版は`docs/writing/english-guideline.md`の「User-facing text」、日本語版は`docs/writing/japanese-guideline.md`の「利用者向け文書」と言い換え表に従います。とくに次を守ります。

- 開発者の視点の言葉を使いません。利用者のPCを「このPC」「ホスト」と書かず、「お使いのPC」と書きます。クレート、エンドポイント、サイドカーなどの名前は、利用者がすることに関わるときだけ書きます。
- 動作の主を書きます。「設定が保存されます」より「ASTAROTが保存します」と書けるときはそう書きます。
- 画面の文言は`locales`の表記のまま引きます。設定の場所は「設定」→「ページ」→「項目」の形で、折りたたみの中なら「詳細設定」も入れます。
- できないこと、送るデータ、同意は具体的に書きます。
- 計測した値は条件と一緒に書きます。どのPCでも同じ結果になるとは書きません。
- 人の名前、担当、開発に使った環境を書きません。保守担当者の呼び名も書きません。決定は「2026-11-24の決定で」のように日付で示します。
- 確かめていないことは「確かめていません」「見込みです」と書きます。言い切りを強めません。

## 5. 推敲する

日本語版はjp-writingスキルの手順で書きます。

1. tsuzuriで要件定義書、設計書、一文ごとの執筆意図を記録してから書きます。tsuzuriの書き出しは1文ごとに改行するので、ノートには段落を1行につなげて入れます。
2. yomiyasuで推敲します。見出しの先頭の絵文字（書式の一部）と「版」（用語の決まり）への指摘は、書式と日本語の文章ルールを優先して残します。
3. 読点と改行を数えます（jp-writingの手順5）。6の文章の検査が、リリースノートでは読点と改行の形も確かめます。読点は条件、理由、並列の区切りと、読み誤りを防ぐ箇所にだけ打ちます。文の頭の短い主題のあと（「Windowsでは、」）の間を置くだけの読点を消します。読点で多くのものを並べた文は、箇条書きにするか文を分けます（日本語の文章ルールの「文の組み立て」）。段落は1行で、段落の間の空行は1つにします。

英語版は英語の文章ルールで推敲し、日本語版と同じ事実、条件、画面の名前になっているかを突き合わせます。

## 6. 検査する

1. 文章の検査を`--user`で通します。検査はパスが`docs/release-notes/`で始まるときだけリリースノートとして扱い、見出しの絵文字を許し、読点と改行の形も確かめます（`tools/writing_gate/release_notes.mjs`）。

   ```sh
   node tools/writing_gate/check.mjs --file docs/release-notes/<版>.md --user
   ```

   ベータ版のノートはリポジトリに置かないので、作業ツリーの`docs/release-notes/`に一時的にコピーして検査し、すぐに消します。コミットはしません。
2. ノートで「」と""で引いた文言が、`locales/ja.yml`と`locales/en.yml`にそのままあるかを照らし合わせます。変える前の名前は前の版のタグの`locales`で確かめます。
3. 正式版は`python tools/dev.py check --scope links`でリンクを確かめます。比較のページとリリースのリンクは、公開するまで開けないものがあります。

## 7. 下書きに入れる

ノートができたら、releaseスキルの「4. 公開の前」の手順で、下書きの本文を差し替えます。

```sh
gh api -X PATCH repos/{owner}/{repo}/releases/<id> -F body=@<ノートのファイル>
```

差し替えたあとで本文を読み直し、題と日本語版へのリンク、区切り、内部の変更の番号がそろっているかを確かめます。公開は保守担当者が確認してから行います。
