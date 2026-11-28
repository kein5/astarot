---
name: jp-writing
description: Use when asked to write or revise Japanese text for ASTAROT, such as developer documents, text for users, and pull request and issue text. Not for short notes or ordinary replies. Use it every time for release notes. ASTAROTの開発者向け文書、利用者向け文面、PRとIssueの文面など、日本語の文章の執筆や推敲を頼まれたときに使う。短いメモや通常の返事は対象外。リリースノートは毎回このスキルを使う。
---

# Writing ASTAROT's Japanese documents

[日本語版](#astarotの日本語文書を書く日本語版)

1. Before you write or revise, read [the Japanese writing guideline](../../docs/writing/japanese-guideline.md) and [the English writing guideline](../../docs/writing/english-guideline.md). When you give both languages, put English first and Japanese second. Write legal texts in English only. For release notes, also read [the release notes format](../../docs/release-notes/README.md).
2. Before you write a draft, read `~/.claude/skills/tsuzuri/SKILL.md` and use tsuzuri to record the requirements, the design and the intent of each sentence. If tsuzuri is not installed and you install it, use `npx skills add MaryCache/tsuzuri`. If you cannot use tsuzuri, skip this step and report why.
3. Revise the Japanese wording with yomiyasu. The Japanese writing guideline takes precedence.
4. Run `node tools/writing_gate/check.mjs` at the root of the repository. Check text that Git does not track, such as a pull request description, with `node tools/writing_gate/check.mjs --file <file>`, and add `--user` for text meant for users.
5. Count the commas (読点) in each sentence, and check one at a time whether each is needed, following "Commas" in the Japanese writing guideline. Following "Paragraphs and arguments" and "Formatting", check the topic of each paragraph, the blank lines and where the lines break.

---

# ASTAROTの日本語文書を書く（日本語版）

1. 執筆や推敲を始める前に、[日本語の文章ルール](../../docs/writing/japanese-guideline.md)と[英語の文章ルール](../../docs/writing/english-guideline.md)を読みます。両方の言語を併記するときは英語、日本語の順に並べます。法的な文書は英語のみで書きます。リリースノートは[リリースノートの書式](../../docs/release-notes/README.md)も読みます。
2. 下書きは`~/.claude/skills/tsuzuri/SKILL.md`を読み、tsuzuriで要件定義、設計、一文ごとの執筆意図の記録を行ってから書きます。手元にtsuzuriがなく、導入する場合は`npx skills add MaryCache/tsuzuri`を使います。tsuzuriを使えない場合は、この工程を飛ばして理由を報告します。
3. 日本語の言い回しはyomiyasuで推敲します。日本語の文章ルールを優先します。
4. リポジトリのルートで`node tools/writing_gate/check.mjs`を実行します。PR本文などGitが追跡していない文章は`node tools/writing_gate/check.mjs --file <ファイル>`で検査し、利用者向け文面には`--user`を添えます。
5. 各文の読点を数え、日本語の文章ルールの「読点」に沿って一つずつ必要性を確かめます。「段落と論証」と「書式」に沿って段落ごとの話題、空行、改行位置を確認します。
