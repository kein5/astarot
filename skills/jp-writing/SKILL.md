---
name: jp-writing
description: ASTAROTの開発者向け文書、利用者向け文面、PRとIssueの文面など、日本語の文章の執筆や推敲を頼まれたときに使う。短いメモや通常の返事は対象外。リリースノートは毎回このスキルを使う。
---

# ASTAROTの日本語文書を書く

1. 執筆や推敲を始める前に、[日本語の文章ルール](../../docs/writing/japanese-guideline.md)と[英語の文章ルール](../../docs/writing/english-guideline.md)を読みます。両方の言語を併記するときは英語、日本語の順に並べます。法的な文書は英語のみで書きます。リリースノートは[リリースノートの書式](../../docs/release-notes/README.md)も読みます。
2. 下書きは`~/.claude/skills/tsuzuri/SKILL.md`を読み、tsuzuriで要件定義、設計、一文ごとの執筆意図の記録を行ってから書きます。手元にtsuzuriがなく、導入する場合は`npx skills add MaryCache/tsuzuri`を使います。tsuzuriを使えない場合は、この工程を飛ばして理由を報告します。
3. 日本語の言い回しはyomiyasuで推敲します。日本語の文章ルールを優先します。
4. リポジトリのルートで`node tools/writing_gate/check.mjs`を実行します。PR本文などGitが追跡していない文章は`node tools/writing_gate/check.mjs --file <ファイル>`で検査し、利用者向け文面には`--user`を添えます。
5. 各文の読点を数え、日本語の文章ルールの「読点」に沿って一つずつ必要性を確かめます。「段落と論証」と「書式」に沿って段落ごとの話題、空行、改行位置を確認します。
