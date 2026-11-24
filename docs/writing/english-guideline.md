# English writing guideline

[日本語版](#英語の文章ルール日本語版)

These are the rules for English written in this repository, by AI agents and by people. This file is the reference for how to write English here; other documents link to it instead of repeating it. Japanese has its own rules in [japanese-guideline.md](japanese-guideline.md), because most Japanese rules do not carry over to English.

The main aim is to keep out the habits that make text read as machine-written: filler, unsupported praise, patterned lists and contrasts, and dashes everywhere. The list of habits draws on the Wikipedia guide "Signs of AI writing" ([References](#references)), rewritten for ASTAROT. That guide describes signs, not proof. A sentence is not wrong because an AI might have written it, and deleting the signs does not fix a text that says nothing. Rewrite for content: say what happens, to whom, under which conditions.

## Scope

### What these rules cover

| Kind of text | Examples | Sections that apply |
|---|---|---|
| Developer documents | `CONTRIBUTING.md`, `DESIGN.md`, `PRODUCT.md`, `README.md`, `SECURITY.md`, English files in `docs/`, code comments, pull request and issue text written in English | [General rules](#general-rules), [Developer documents](#developer-documents) |
| User-facing text | `locales/en.yml`, `site/en/`, the English README files | [General rules](#general-rules), [User-facing text](#user-facing-text) |
| Commit messages | Conventional Commits summaries and bodies | [General rules](#general-rules), within the format in `CONTRIBUTING.md` |
| Agent reports in English | Work reports, the verification part of a pull request, review results | [General rules](#general-rules), [Agent reports](#agent-reports) |

### What they do not cover

- Quoted text and files taken from elsewhere (license texts, upstream notices)
- Generated files (`docs/spec/reference/`, `CHANGELOG.md`; the changelog takes its wording from commit summaries, which these rules do cover)
- Japanese text, which follows [japanese-guideline.md](japanese-guideline.md)
- Points where a document-specific rule decides differently ([Precedence of document-specific rules](#precedence-of-document-specific-rules))

### Precedence of document-specific rules

When a kind of document has its own writing rules, those rules win. The general rules in this file apply only where they do not contradict the document-specific ones.

- Where a document-specific rule decides a point, follow it, even if this file says otherwise. Do not rewrite the document-specific rule to match this file.
- Where a document-specific rule says nothing, apply this file.
- A document-specific rule added later takes precedence in the same way, even if it is not in the table below.

Commit summaries are an example. This file asks for sentence case, but `CONTRIBUTING.md` says a commit summary starts in lower case with no period, so commit summaries follow `CONTRIBUTING.md`. The rest of this file still applies to their wording.

The document-specific rules in force today:

| Document-specific rule | What it decides |
|---|---|
| `CONTRIBUTING.md`, "Commit messages" | Form of commit messages: type, scope, imperative summary in lower case, footers |
| `CONTRIBUTING.md`, "Changelog and releases", and [the release notes format](../release-notes/README.md) | Structure of the changelog and release notes, including the emoji at the start of release note headings |
| [`DESIGN.md`](../../DESIGN.md), "The user guide (site/)" | Layout of the user guide |
| [Spec update rules](../spec/README.md#更新の決まり) | How files in `docs/spec/` are split and written |
| `CONTRIBUTING.md` and the i18n quality gate (#515) | UI string keys, matching English and Japanese, placeholder checks |
| `AGENTS.md`, "検証と完了の報告" | What a report has to contain |

When you find a conflict between this file and a document-specific rule, add the exception to this file.

### Existing documents

Existing documents still hold text that breaks these rules. What a pattern can catch is recorded in the baseline of the writing gate (`tools/writing_gate/baseline.json`) and fixed area by area, one pull request per area (decision of 2026-11-23); after a fix, `--update-baseline` lowers the baseline. Apply the rules from the start to new text and to the parts you revise.

## General rules

### Structure

- Put the point first, then the reasons and details.
- One idea per sentence. Split a sentence that carries two.
- Use a list for three or more parallel items that a reader will scan. Number a list only when order matters.
- Name who acts. Prefer "ASTAROT saves the settings" to "the settings are saved" when the actor matters.
- State quantities and times as numbers ("wait 30 seconds", not "wait a while"). If the number is unknown, say so instead of inventing one.

### Paragraphs and arguments

- Open each paragraph with a sentence that states its topic. Keep one topic per paragraph.
- Move the argument in one direction. Deal with objections and limits first, and state the conclusion once.
- Show how a paragraph follows from the one before with a connective such as "but" or "so".
- Do not call different things "the same". Do not reduce an event with several causes to one cause.
- When you state a cause, add one sentence on how it works. Write "Stopping advances the generation number, and speech from earlier generations is not played" rather than "Stopping keeps old speech from playing".
- Keep a claim within what your examples support. State detection and guarantees together with the conditions under which they hold.

### Revising without changing the meaning

When you edit text, yours or someone else's, keep these four things as they were:

- The claim: what is said and how the parts relate
- The weight: what is treated as major or minor, the order of options, and which option was rejected
- The strength: certainty, possibility, permission, obligation. Do not turn "may fail" into "fails", and do not add "always" or "guarantees".
- The function: description, request, warning, plan, or report of something already done

If an edit would change one of these, leave the text and raise it with the author.

### Adding nothing

Do not add facts that the source text or a checked record does not contain: actors, numbers, examples, causes, or conditions. If the code and records do not settle a point, write "not verified" or "unknown" instead of guessing. Give measured values with the environment and conditions they were measured under.

### Revision tool

Revise English text with [humanizer](https://github.com/blader/humanizer). It is the tool that carries out the revision; its rules are not copied into this file. When humanizer's suggestions and this file disagree, follow this file.

### Habits to remove

<!-- writing-exempt-start: examples of what to avoid -->

#### Filler openers and transitions

| Remove | Instead |
|---|---|
| "It's important to note that", "It's worth noting that", "Note that" in front of every caveat | State the caveat. Keep "Note" only for a real warning the reader could miss. |
| "In today's fast-paced world", "When it comes to", "Let's dive in", "Here's the thing" | Start with the subject. |
| "There are three key reasons", announcing a count before a list | Give the list. |
| "In conclusion", "Overall", "In summary" before a restatement | Delete the restatement. Keep a summary only in a long document or where one was asked for. |
| A chain of "Additionally", "Furthermore", "Moreover" | Keep a connective only when it says how two sentences relate. |

#### Chatbot leftovers

"Certainly!", "Great question!", "You're absolutely right", "I hope this helps", "Let me know if you have any questions", "As an AI", "based on available information", and statements about a knowledge cutoff do not belong in documents, pull requests, or commit messages. Delete them.

#### Unsupported emphasis and promotional words

Do not describe ASTAROT or a change with words that praise instead of inform: robust, seamless, cutting-edge, state-of-the-art, powerful, comprehensive, effortless, blazing fast, game-changing, world-class, best-in-class. Intensifiers without a number (truly, incredibly, significantly, dramatically) go the same way. Say what the feature does, and show an effect with a measured number and its conditions.

| Instead of | Write |
|---|---|
| "a robust, seamless voice pipeline" | "speech goes from the microphone to VRChat without a restart when you change the device" (only if that is what happens) |
| "significantly faster startup" | the measured startup time before and after, with the OS, hardware, and conditions of the measurement |
| "cutting-edge speech recognition" | the model's name and what it recognizes |

"Always" and "guarantee" are fine when they are true.

#### AI vocabulary

These words are not wrong, but piled up they mark a text as generated. Use the plain word.

| Avoid | Plain word |
|---|---|
| delve into | look at, examine |
| leverage, utilize, harness | use |
| underscore, highlight (as a claim about meaning) | show, or state the point |
| showcase | show |
| foster, empower, elevate | name the effect |
| streamline | simplify, shorten (say what got shorter) |
| landscape, realm, tapestry | the actual field or set of things |
| testament to | shows |
| pivotal, crucial, vital | needed, or explain why it matters |
| intricate | complex, or describe the parts |
| navigate (anything that is not moving through a UI) | handle, deal with |

#### Avoiding "is" and "has"

Write "is" and "has" where they fit. "Serves as", "stands as", "acts as", "boasts", and "features" in place of them add nothing.

- "The settings page serves as the central hub for configuration" → "Settings holds all configuration"
- "The model boasts 30 languages" → "The model recognizes 30 languages"

#### Trailing "-ing" commentary

A clause such as ", ensuring a smooth experience", ", highlighting the importance of", or ", making it ideal for streamers" at the end of a sentence adds an unsupported judgment. Delete it, or make it a separate claim with its evidence.

#### Patterned lists and contrasts

- Rule of three: do not pad a list to three items or cut a real list to three. List what is there.
- "Not just X, but Y", "It's not X, it's Y", "Y rather than X": use them only when a reader is likely to believe X. Otherwise state Y. A contrast that corrects a real mistake stays: "The cause was the GPU driver, not the model."
- "From X to Y" for things that are not a range ("from beginners to streamers"): name who or what is meant.

#### Dashes

Use the em dash (—) rarely: at most one pair in a paragraph, and none in UI strings. A comma, a colon, parentheses, or a new sentence usually does the job. Do not use the en dash (–) or a spaced hyphen as a dash. An en dash is fine in a number range in prose, but "to" is clearer ("1 to 3").

#### Vague attribution and stacked hedges

"Experts say", "many users find", "it is widely believed", "some may argue": name the source or delete the claim. Do not stack hedges ("may potentially", "could possibly"). Use one, at the strength the facts support.

#### Synonyms for variety

Do not switch between words for the same thing to avoid repetition ("model", "engine", "backend" for one component). A reader takes a new word as a new thing. See [Terminology](#terminology).

#### Formatting

- Headings use sentence case ("Voice changer settings", not "Voice Changer Settings"). Product and UI names keep their own capitals.
- Bold at most one phrase in a paragraph. Do not start every bullet with a bold label followed by a colon; write the item as a sentence, or use a table.
- No emoji, except where a document-specific rule asks for them.
- No exclamation marks. A question mark only in a UI confirmation that asks the user something ("Delete this model?").
- Straight quotes and apostrophes (" and ') in Markdown, code, and `en.yml`, not curly ones.
- Code, commands, paths, and setting keys go in code formatting; several lines go in a code block.
- One level-1 heading per document.
- A heading that gives both languages puts English first: "Summary / 概要" (decision of 2026-11-23).

### Plain verbs and wording

| Avoid | Use |
|---|---|
| utilize | use |
| facilitate | help, let |
| commence, initiate | start |
| terminate | stop, end |
| obtain | get |
| prior to | before |
| subsequently | then, later |
| in order to | to |
| perform a check, carry out an update | check, update |
| a number of | some, or the number |
| approximately | about |
| additional | more, other |
| in the event that | if |
| due to the fact that | because |

"Implement", "configure", and "initialize" are fine in developer documents when they are the precise word.

<!-- writing-exempt-end -->

### Spelling and mechanics

- American spelling: color, license (noun and verb), behavior, analyze. "Cancelled" keeps the double l, as `locales/en.yml` does.
- No serial comma ("speech recognition, translation and TTS"), as most existing English text does. Add one only where a list would otherwise be misread.
- Use full forms ("does not", "cannot"), as most existing English text does.
- Numbers: digits for counts and measurements. A space between a number and a unit symbol (4 GiB, 120 ms, 48 kHz); none before % (25%).
- Dates: ISO 8601 in developer documents (2026-11-17); "November 17, 2026" in user-facing text.
- "For example" and "that is" in user-facing text, rather than "e.g." and "i.e.".
- Expand an abbreviation the first time it appears, unless the UI name already contains it ("Text to speech (TTS)").
- Product and service names keep their owners' spelling: VRChat, SteamVR, speech.cpp, ONNX Runtime, PipeWire, OBS.

### Terminology

UI names come from `locales/en.yml`. The mapping between UI words and code names is in [the glossary](../spec/glossary.md). Use one term for one thing in a document. The table below covers choices that come up often.

| Use | Avoid | Note |
|---|---|---|
| ASTAROT | VRCT-VOX (as the app's name) | The repository is `kein5/astarot`. For executables, the app ID and storage paths, use the [documented identifiers](../voice-stack/project-rename.md). |
| Text to speech (TTS) | speech synthesis (user-facing) | UI name. "TTS" after the first mention. |
| Speech recognition (ASR) | transcription (as the feature's name) | UI name. |
| Voice changer (RVC) | voice conversion (user-facing) | UI name. Developer documents may say voice conversion. |
| Chat reading (OCR) | | UI name. |
| Quick Chat | chat input window | UI name. |
| VR UI | VR panel | Glossary name; the UI still has both. |
| hotkey | shortcut | Use "shortcut" only for the desktop's own feature (the GlobalShortcuts portal). |
| your PC, the PC running ASTAROT, another PC | this PC, this machine, the host | User-facing text speaks to the reader's PC from the reader's side. |
| turn on, turn off | enable, disable (for a switch) | Use "enable" when quoting a label that says so. |
| press | click, tap, hit | Works for mouse, keyboard, and VR controllers. |
| download | fetch (user-facing) | Developer documents may say fetch. |
| folder | directory (user-facing) | Developer documents may say directory. |
| stop, mute | | Product guarantees in `PRODUCT.md`; do not paraphrase them. |

## Developer documents

- Decide what the document is (a rule, a design decision, a record, a how-to) and keep to it.
- Date records. Write a date or a version instead of "currently", "recently", "latest", or "this time", which go stale.
- Define a term at first use or link to [the glossary](../spec/glossary.md). Add new terms to the glossary.
- Say a thing in one place and link to it from others.
- Point to code by file and name, not line number.
- Keep adopted decisions and proposals apart. ADRs show this in their status field.
- Pull request and issue text: purpose, change, verification, open questions, in that order. Leave out people's names, who is in charge, and the machine the work was done on.
- Code comments say why and under which constraint, not what the next line does.
- Commit messages follow the format in `CONTRIBUTING.md`. Within it, use plain verbs and say what changed for the person affected; "massively improve audio" says nothing.

## User-facing text

The reader has no background in audio processing or programming. After reading, they should know what to do next.

- Address the reader as "you". Use active voice and the present tense.
- Quote UI text exactly as `locales/en.yml` has it. Write a settings path as Settings → page → item.
- Do not call the reader's PC "this PC"; write "your PC".
- Mention internal names (crates, libraries, endpoints, functions) only when the reader has to act on them.
- Be specific about what ASTAROT cannot do, what data it sends, and the size and license of what it downloads.
- Give speed and memory figures with the conditions they were measured under. Do not promise the same result on every PC.

### Translation between English and Japanese

English and Japanese UI text say the same thing with the same facts, conditions, and placeholders. The English is not a word-for-word copy of the Japanese. Write each in its own language's natural form.

### UI strings (locales/en.yml)

- When you add or change a string, update both `locales/en.yml` and `locales/ja.yml`.
- Keep placeholders (`{{name}}`) the same in both languages. Reordering a sentence must not drop or add one.
- Do not fill an untranslatable string with a guess. Do not translate proper nouns, protocol identifiers, or what the user typed.
- Where the i18n quality gate (#515) checks something, its rules apply; this file does not add rules that contradict it.
- Labels for buttons and switches are short, in sentence case, and say what happens. Keep the same form across one screen.
- Errors and notices: what happened, the cause if known, then what the user can do. Example: "Chat reading needs recognition models. Download them under Settings → Chat reading (OCR)."
- Confirmations: ask the question and say what will happen. Say when it cannot be undone, and leave a way out.
- No em dash in UI strings. Use a colon or a new sentence: "Save failed. Your edits are kept."
- Check that long text and narrow windows still display correctly (`DESIGN.md`).

### User guide (site/en)

Layout follows `DESIGN.md`, "The user guide (site/)". The text follows this section.

## Agent reports

`AGENTS.md`, "検証と完了の報告", decides what a report contains. This section decides how to write it.

- Put the outcome in the first sentence or two: done, blocked, or waiting for a decision.
- Keep what you verified apart from what you infer. Write "not verified" and the reason instead of "this should work".
- Write "done" or "fixed" only after a check confirmed it.
- No openers or closers ("Sure!", "Great question", "Let me know if you need anything else"). <!-- writing-exempt: examples of what to avoid -->
- Quote only the relevant lines of command output, in a code block.
- Give counts, file names, and issue or pull request numbers that you counted or looked up.
- When you ask for a decision, give the options, their effects, and your recommendation. Do not ask what you can find out yourself.
- Public text (pull requests, issues, comments, release notes) carries no people's names, no one's role in the work, and nothing about the machine it was done on.
- Replace relative time ("earlier", "this time") with a date, version, or pull request number in public text.

## Checklist

When you finish, revise with humanizer, then check these points. The writing gate (`tools/writing_gate/check.mjs`, see [the development guide](../development.md#文章の検査docswriting)) checks the rules a pattern can catch: some of the habits, spelling, quotes, dashes and terms. The rest, such as putting the point first, the argument and keeping the meaning when you revise, stays with you.

1. The point comes first, and each sentence carries one idea.
2. Each paragraph opens with its topic. Different things are not called the same, causes come with how they work, and claims stay within the examples.
3. None of the [habits to remove](#habits-to-remove) are left: filler, chatbot phrases, promotional words, AI vocabulary, "serves as", trailing "-ing" clauses, padded triplets, needless contrasts, dashes. <!-- writing-exempt: examples of what to avoid -->
4. One term per thing, matching `locales/en.yml` and the glossary.
5. Spelling, numbers, dates, and quotes follow [Spelling and mechanics](#spelling-and-mechanics).
6. Editing kept the claim, weight, strength, and function, and added no facts.
7. Public text has no people's names, roles, or details of the machine used.

## References

- Wikipedia contributors, "Wikipedia:Signs of AI writing". <https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing> (accessed 2026-11-17)
  - Used for the catalogue of habits: filler and chatbot phrases, promotional language, AI vocabulary, copula avoidance, trailing "-ing" analyses, the rule of three, negative parallelisms, vague attribution, elegant variation, and formatting signs such as title case, bold inline headers, emoji, and curly quotes. Also for its caveat that the signs are descriptive, not proof, and that removing them is not the same as fixing the text. <!-- writing-exempt: examples of what to avoid -->
- [japanese-guideline.md](japanese-guideline.md), the Japanese counterpart. Its sections on paragraphs and arguments, on meaning-preserving revision, and on adding nothing are mirrored here.

---

# 英語の文章ルール（日本語版）

このリポジトリで書く英語の決まりです。AIエージェントにも人にも当てはめます。英語の書き方はこの文書を正本とし、ほかの文書には内容を写さずにこの文書へのリンクを置きます。日本語の決まりは[japanese-guideline.md](japanese-guideline.md)に別にあります。日本語の決まりの多くは英語に当てはまらないからです。

主な狙いは、機械が書いたように読める癖を文章に入れないことです。中身のない言葉、裏付けのない褒め言葉、型にはまった列挙と対比、どこにでも置くダッシュがその癖です。癖の一覧はWikipediaの手引き「Signs of AI writing」（[参考文献](#参考文献)）を基にし、ASTAROT向けに書き直しました。この手引きが挙げるのは兆候であって証拠ではありません。AIが書いたかもしれないというだけで文が誤りになるわけではありません。また兆候を消しても、何も言っていない文章は直りません。書き直すときは中身を直します。何が、誰に、どの条件で起きるのかを書きます。

## 適用範囲

### 対象にする文章

| 文章の種類 | 例 | 当てはめる章 |
|---|---|---|
| 開発者向け文書 | `CONTRIBUTING.md`、`DESIGN.md`、`PRODUCT.md`、`README.md`、`SECURITY.md`、`docs/`の英語のファイル、コードのコメント、英語で書くPRとIssueの文面 | [共通の決まり](#共通の決まり)、[開発者向け文書](#開発者向け文書) |
| 利用者向け文書 | `locales/en.yml`、`site/en/`、英語のREADMEのファイル | [共通の決まり](#共通の決まり)、[利用者向け文書](#利用者向け文書) |
| コミットメッセージ | Conventional Commitsの要約と本文 | [共通の決まり](#共通の決まり)（`CONTRIBUTING.md`の形式の範囲で） |
| 英語で書くエージェントの報告文 | 作業の報告、PRのうち検証の部分、レビューの結果 | [共通の決まり](#共通の決まり)、[エージェントの報告文](#エージェントの報告文) |

### 対象にしないもの

- 引用した文章と、ほかから持ってきたファイル（ライセンスの原文、上流の告知文）
- 生成するファイル（`docs/spec/reference/`、`CHANGELOG.md`）。変更履歴は文言をコミットの要約から取り、要約のほうはこの決まりの対象です。
- 日本語の文章。[japanese-guideline.md](japanese-guideline.md)に従います。
- 個別のルールがこの文書と違う決め方をしている点（[個別のルールとの優先関係](#個別のルールとの優先関係)）

### 個別のルールとの優先関係

文書の種類ごとに個別の文章ルールが定められているときは、個別のルールを優先します。この文書の決まりは個別のルールと矛盾しない範囲でだけ当てはめます。

- 個別のルールが決めている点は、この文書に違うことが書いてあっても個別のルールに従います。個別のルールをこの文書に合わせて書き換えません。
- 個別のルールが決めていない点には、この文書を当てはめます。
- あとから定められた個別のルールも、下の表になくても同じように優先します。

コミットの要約がその例です。この文書は文頭だけを大文字にする書き方（sentence case）を求めます。しかし`CONTRIBUTING.md`はコミットの要約を小文字で始めてピリオドを付けないと定めているので、要約はそちらに従います。要約の言葉選びにはこの文書のほかの決まりをそのまま当てはめます。

いま定められている個別のルールは次のとおりです。

| 個別のルール | 決めていること |
|---|---|
| `CONTRIBUTING.md`の「Commit messages」 | コミットメッセージの形（種別、スコープ、小文字で始める命令形の要約、フッター） |
| `CONTRIBUTING.md`の「Changelog and releases」と[リリースノートの書式](../release-notes/README.md) | 変更履歴とリリースノートの構成（リリースノートの見出しの先頭に置く絵文字を含む） |
| [`DESIGN.md`](../../DESIGN.md)の「The user guide (site/)」 | 利用者向けマニュアルの組み方 |
| [機能仕様書の更新の決まり](../spec/README.md#更新の決まり) | `docs/spec/`の文書の分け方と書き方 |
| `CONTRIBUTING.md`とi18nの品質ゲート（#515） | 画面の文言のキー、英語と日本語の対応、補間変数の検査 |
| `AGENTS.md`の「検証と完了の報告」 | 報告に書かなければならないこと |

この文書と個別のルールの食い違いに気づいたら、その例外をこの文書に書き足します。

### 既存の文書への当てはめ方

既存の文書にはこの決まりに合わない文章がまだ残っています。そのうち形で確かめられるものは文章の検査の基準（`tools/writing_gate/baseline.json`）に記録してあり、場所ごとに1つのPRで直していきます（2026-11-23の決定）。直したら`--update-baseline`で基準を下げます。新しく書く文章と改訂する箇所には、はじめからこの決まりを当てはめます。

## 共通の決まり

### 文の組み立て

- 結論を先に書き、理由と詳しい内容をあとに続けます。
- 1つの文には考えを1つだけ入れます。2つ入った文は分けます。
- 読み手が拾い読みする並列の項目が3つ以上あるときは箇条書きにします。順番に意味があるときだけ番号を付けます。
- 誰が動作するのかを書きます。動作の主が大事なときは「the settings are saved」より「ASTAROT saves the settings」と書きます。
- 量と時間は数で書きます（「wait a while」ではなく「wait 30 seconds」）。数が分からないときは数を作らず、分からないと書きます。

### 段落と論証

- 段落の最初の文でその段落の話題を示します。1つの段落には話題を1つだけ入れます。
- 論は一方向に進めます。反対の見方や制約を先に扱い、結論は1回だけ書きます。
- 前の段落とのつながりは「but」や「so」のようなつなぎの語で示します。
- 違うものを「the same」とまとめません。原因が複数あるできごとを1つの原因にまとめません。
- 因果を書くときは、どういう仕組みでそうなるかを1文で添えます。「Stopping keeps old speech from playing」より「Stopping advances the generation number, and speech from earlier generations is not played」と書きます。
- 主張は示した例が支える範囲に絞ります。検出や保証は成り立つ条件と一緒に書きます。

### 意味を変えない推敲

自分や他人が書いた文章に手を入れるときは、次の4つを変えません。

- 主張：何を言っているか、論理の関係
- 比重：どれを重く扱い、どれを軽く扱っているか。選択肢の順序とどの案を退けたかも含みます。
- 言い切りの強さ：確実さ、可能性、許可、義務。「may fail」を「fails」に変えたり、「always」や「guarantees」を足したりしません。
- 文の働き：説明、依頼、警告、予定、すでにしたことの報告

書き直すと上の4つのどれかが変わるときは、書き換えずに書き手へ伝えます。

### 情報を足さない

元の文章や確かめた記録にない事実を足しません。動作の主、数値、例、原因、条件が対象です。コードや記録を調べても決まらない点は、推測で埋めずに「not verified」か「unknown」と書きます。計測した値を書くときは、計測した環境と条件を添えます。

### 推敲の道具

英語の文章は[humanizer](https://github.com/blader/humanizer)で推敲します。humanizerは推敲を実行する道具で、その決まりはこの文書に写しません。humanizerの指摘とこの文書が食い違うときは、この文書に従います。

### 取り除く書き癖

<!-- writing-exempt-start: 悪い例として避ける形を挙げている -->

#### 前置きとつなぎの定型句

| 取り除くもの | 代わりにすること |
|---|---|
| 注意書きのたびに前に付ける「It's important to note that」「It's worth noting that」「Note that」 | 注意書きの中身をそのまま書きます。「Note」は読み手が見落としかねない本当の警告にだけ残します。 |
| 「In today's fast-paced world」「When it comes to」「Let's dive in」「Here's the thing」 | 主題から書き始めます。 |
| 「There are three key reasons」のように、箇条書きの前で数を予告する書き方 | 数を予告せずに箇条書きを書きます。 |
| 言い直しの前に置く「In conclusion」「Overall」「In summary」 | 言い直しを消します。まとめは長い文書か、まとめを頼まれたところにだけ残します。 |
| 「Additionally」「Furthermore」「Moreover」を続けて並べる書き方 | つなぎの語は、2つの文がどう関係するかを示すときだけ残します。 |

#### チャットボットの名残

「Certainly!」「Great question!」「You're absolutely right」「I hope this helps」「Let me know if you have any questions」「As an AI」「based on available information」と、学習した知識の期限（knowledge cutoff）に触れる文は、文書、PR、コミットメッセージに入れません。見つけたら消します。

#### 裏付けのない強調と宣伝の言葉

ASTAROTや変更を説明するときに、情報を伝えず褒めるだけの言葉を使いません。robust、seamless、cutting-edge、state-of-the-art、powerful、comprehensive、effortless、blazing fast、game-changing、world-class、best-in-classがそれに当たります。数を伴わない強調の語（truly、incredibly、significantly、dramatically）も同じく使いません。機能が何をするかを書き、効果は計測した数値とその条件で示します。

| 避ける書き方 | 代わりに書くこと |
|---|---|
| 「a robust, seamless voice pipeline」 | 「speech goes from the microphone to VRChat without a restart when you change the device」（実際にそう動くときだけ） |
| 「significantly faster startup」 | 変更前後に計測した起動時間と、計測したOS、ハードウェア、条件 |
| 「cutting-edge speech recognition」 | モデルの名前と、そのモデルが何を認識するか |

「Always」と「guarantee」は内容が正しければ使って構いません。

#### AIに多い語彙

次の語は間違いではありません。しかし積み重なると、AIが生成した文章だという印になります。平易な語を使います。

| 避ける語 | 平易な語 |
|---|---|
| delve into | look at, examine |
| leverage, utilize, harness | use |
| underscore, highlight（意味についての主張として使うとき） | show、または要点をそのまま書きます |
| showcase | show |
| foster, empower, elevate | 効果を具体的に書きます |
| streamline | simplify, shorten（何が短くなったかを書きます） |
| landscape, realm, tapestry | 実際の分野、または実際のものの集まり |
| testament to | shows |
| pivotal, crucial, vital | needed、またはなぜ大事なのかを説明します |
| intricate | complex、または部分ごとに説明します |
| navigate（UIの中を移動すること以外） | handle, deal with |

#### 「is」と「has」を避ける書き方

「is」と「has」が合うところではそのまま書きます。その代わりに「serves as」「stands as」「acts as」「boasts」「features」を置いても、意味は何も増えません。

- 「The settings page serves as the central hub for configuration」→「Settings holds all configuration」
- 「The model boasts 30 languages」→「The model recognizes 30 languages」

#### 文末に足す「-ing」の論評

文末に付ける「, ensuring a smooth experience」「, highlighting the importance of」「, making it ideal for streamers」のような節は、裏付けのない評価を足します。消すか、根拠を添えた別の主張にします。

#### 型にはまった列挙と対比

- 3つ組（rule of three）：3つにするために項目を水増ししたり、実際にある項目を3つに削ったりしません。あるものをそのまま並べます。
- 「Not just X, but Y」「It's not X, it's Y」「Y rather than X」は、読み手がXを信じていそうなときだけ使います。そうでなければYだけを書きます。本当の誤りを正す対比は残します（「The cause was the GPU driver, not the model.」）。
- 範囲でないものに「From X to Y」を使いません（「from beginners to streamers」）。誰を指すのか、何を指すのかを書きます。

#### ダッシュ

エムダッシュ（—）はめったに使いません。1つの段落に1組までとし、画面の文言には使いません。たいていはコンマ、コロン、括弧、または文を分けることで足ります。エンダッシュ（–）や前後を空けたハイフンをダッシュとして使いません。本文で数の範囲を示すエンダッシュは構いませんが、「to」のほうが分かりやすくなります（「1 to 3」）。

#### あいまいな出典と重ねたぼかし

「Experts say」「many users find」「it is widely believed」「some may argue」のような書き方では、出典を名指しするか、その主張を消します。ぼかしの言葉を重ねません（「may potentially」「could possibly」）。事実が支える強さのものを1つだけ使います。

#### 変化をつけるための言い換え

繰り返しを避けるために、同じものを別の言葉に言い換えません（1つの部品を「model」「engine」「backend」と呼び分けるような書き方）。読み手は新しい言葉を新しいものと受け取ります。言葉の選び方は[用語](#用語)にあります。

#### 書式

- 見出しはsentence caseで書きます（「Voice Changer Settings」ではなく「Voice changer settings」）。製品名と画面の名前はそれぞれの大文字の使い方を保ちます。
- 太字は1つの段落に1か所までにします。すべての箇条書きを太字のラベルとコロンで始める書き方をしません。項目を文として書くか、表にします。
- 個別のルールが求める場所を除き、絵文字を使いません。
- 感嘆符を使いません。疑問符は利用者に何かを尋ねる画面の確認の文（「Delete this model?」）にだけ使います。
- Markdown、コード、`en.yml`では引用符とアポストロフィをまっすぐな形（"と'）で書きます。曲がった形は使いません。
- コード、コマンド、パス、設定のキーはコードの書式で書きます。複数行はコードブロックに入れます。
- 1つの文書にレベル1の見出しは1つだけ置きます。
- 両方の言語を並べる見出しは英語を先に書きます（「Summary / 概要」。2026-11-23の決定）。

### 平易な動詞と言い回し

| 避ける | 使う |
|---|---|
| utilize | use |
| facilitate | help, let |
| commence, initiate | start |
| terminate | stop, end |
| obtain | get |
| prior to | before |
| subsequently | then, later |
| in order to | to |
| perform a check, carry out an update | check, update |
| a number of | some、または具体的な数 |
| approximately | about |
| additional | more, other |
| in the event that | if |
| due to the fact that | because |

開発者向け文書では「implement」「configure」「initialize」が正確な語であれば使って構いません。

<!-- writing-exempt-end -->

### 綴りと表記

- アメリカ式の綴りで書きます（color、license、behavior、analyze）。licenseは名詞でも動詞でもこの綴りです。「Cancelled」は`locales/en.yml`と同じくlを2つ重ねます。
- 3つ以上を並べるときの最後の「and」の前のコンマ（serial comma）を付けません（「speech recognition, translation and TTS」）。既存の英語の文章の多くがこの書き方です。付けないと並びを読み誤るところにだけ付けます。
- 短縮しない形（「does not」「cannot」）で書きます。既存の英語の文章の多くがこの形です。
- 数：個数と計測値は数字で書きます。数と単位の記号の間には空白を入れます（4 GiB、120 ms、48 kHz）。「%」の前には入れません（25%）。
- 日付：開発者向け文書ではISO 8601（2026-11-17）、利用者向け文書では「November 17, 2026」と書きます。
- 利用者向け文書では「e.g.」「i.e.」ではなく「for example」「that is」と書きます。
- 略語は初めて出たところで正式な形に展開します。ただし、画面の名前にすでに略語が入っているときはその名前のまま書きます（「Text to speech (TTS)」）。
- 製品名とサービス名は提供元の綴りのまま書きます（VRChat、SteamVR、speech.cpp、ONNX Runtime、PipeWire、OBS）。

### 用語

画面の名前は`locales/en.yml`から取ります。画面の言葉とコードの名前の対応は[用語集](../spec/glossary.md)にあります。1つの文書では1つのものに1つの言葉を使います。下の表はよく迷う言葉の選び方をまとめています。

| 使う言葉 | 使わない言葉 | 補足 |
|---|---|---|
| ASTAROT | VRCT-VOX（アプリの名前として） | リポジトリは`kein5/astarot`です。実行ファイル、アプリID、保存先のパスには[記録してある識別子](../voice-stack/project-rename.md)を使います。 |
| Text to speech (TTS) | speech synthesis（利用者向け文書で） | 画面の名前です。2回目からは「TTS」と書きます。 |
| Speech recognition (ASR) | transcription（機能の名前として） | 画面の名前です。 |
| Voice changer (RVC) | voice conversion（利用者向け文書で） | 画面の名前です。開発者向け文書ではvoice conversionと書いても構いません。 |
| Chat reading (OCR) | | 画面の名前です。 |
| Quick Chat | chat input window | 画面の名前です。 |
| VR UI | VR panel | 用語集での名前です。画面にはまだ両方があります。 |
| hotkey | shortcut | 「shortcut」はデスクトップ環境の機能（GlobalShortcuts portal）を指すときだけ使います。 |
| your PC, the PC running ASTAROT, another PC | this PC, this machine, the host | 利用者向け文書では読み手のPCを読み手の側から呼びます。 |
| turn on, turn off | enable, disable（スイッチに対して） | 「enable」と書いてあるラベルを引くときは「enable」を使います。 |
| press | click, tap, hit | マウスでもキーボードでもVRのコントローラーでも通じます。 |
| download | fetch（利用者向け文書で） | 開発者向け文書ではfetchと書いても構いません。 |
| folder | directory（利用者向け文書で） | 開発者向け文書ではdirectoryと書いても構いません。 |
| stop, mute | | `PRODUCT.md`にある製品の約束の言葉です。言い換えません。 |

## 開発者向け文書

- 文書が何であるか（決まり、設計の判断、記録、手順書）を決め、それから外れずに書きます。
- 記録には日付を入れます。「currently」「recently」「latest」「this time」は古くなるので、代わりに日付か版を書きます。
- 用語は初めて使うところで定義するか、[用語集](../spec/glossary.md)へリンクします。新しい用語は用語集に足します。
- 1つのことは1か所に書き、ほかからはそこへリンクします。
- コードは行番号ではなくファイルと名前で示します。
- 採用した決定と提案を分けて書きます。ADRは状態の欄でこれを示します。
- PRとIssueの文面は目的、変更、検証、未解決の問いの順に書きます。人の名前、誰が担当しているか、作業に使ったマシンは書きません。
- コードのコメントには、次の行が何をするかではなく理由と制約を書きます。
- コミットメッセージは`CONTRIBUTING.md`の形式に従います。その中では平易な動詞を使い、影響を受ける人にとって何が変わったかを書きます。「massively improve audio」では何も伝わりません。

## 利用者向け文書

読み手は音声処理やプログラムの知識を持っていない人です。読み終えたら次に何をすればよいかが分かるようにします。

- 読み手を「you」と呼びます。能動態と現在形で書きます。
- 画面の文言は`locales/en.yml`の表記のまま引きます。設定の場所は「Settings → page → item」の形で書きます。
- 読み手のPCを「this PC」と呼ばず、「your PC」と書きます。
- 内部の名前（クレート、ライブラリ、エンドポイント、関数）は、読み手が扱う必要があるときだけ書きます。
- ASTAROTにできないこと、送るデータ、ダウンロードするものの大きさとライセンスを具体的に書きます。
- 速さとメモリの数値は計測した条件と一緒に書きます。どのPCでも同じ結果になるとは約束しません。

### 英語と日本語の翻訳

英語と日本語の画面の文言は、同じ事実、条件、補間変数で同じことを伝えます。英語は日本語を一語ずつ写したものではありません。それぞれの言語の自然な形で書きます。

### 画面の文言（locales/en.yml）

- 文言を足したり変えたりしたら、`locales/en.yml`と`locales/ja.yml`の両方を直します。
- 補間変数（`{{name}}`）は両方の言語で同じにします。文の語順を変えても、変数を消したり足したりしません。
- 訳せない文言を推測で埋めません。固有名詞、プロトコルの識別子、利用者が入力した文字は訳しません。
- i18nの品質ゲート（#515）が検査する項目は、そちらの決まりに従います。この文書はそれと食い違う決まりを足しません。
- ボタンとスイッチのラベルはsentence caseの短い言葉にし、押すと何が起きるかを示します。同じ画面の中では形をそろえます。
- エラーとお知らせは起きたこと、分かるときはその原因、利用者にできることの順に書きます。例：「Chat reading needs recognition models. Download them under Settings → Chat reading (OCR).」
- 確認の文では問いかけと、その操作で何が起きるかを書きます。元に戻せないときはそう書き、やめる方法を残します。
- 画面の文言にはエムダッシュを使いません。コロンを使うか文を分けます（「Save failed. Your edits are kept.」）。
- 長い文言と狭いウィンドウでも正しく表示されるかを確かめます（`DESIGN.md`）。

### 利用者向けのマニュアル（site/en）

組み方は`DESIGN.md`の「The user guide (site/)」に従います。文章はこの章の決まりに従います。

## エージェントの報告文

報告に書く項目は`AGENTS.md`の「検証と完了の報告」が決めます。この章はその書き方を決めます。

- 結果を最初の1〜2文に書きます。終わったのか、止まっているのか、判断を待っているのかを書きます。
- 確かめたことと推測を分けて書きます。「this should work」で済ませず、「not verified」と書いて理由を添えます。
- 「done」や「fixed」は検証で確かめたあとにだけ書きます。
- 前置きと締めの定型（「Sure!」「Great question」「Let me know if you need anything else」）を書きません。 <!-- writing-exempt: 悪い例として避ける形を挙げている -->
- コマンドの出力は関係する行だけをコードブロックで引用します。
- 件数、ファイル名、IssueやPRの番号は自分で数えたり調べたりした値を書きます。
- 判断を頼むときは選択肢、それぞれの影響、推す案を示します。自分で調べられることは尋ねません。
- 公開される文章（PR、Issue、コメント、リリースノート）には、人の名前、作業の中での誰かの役割、作業に使ったマシンのことを書きません。
- 公開される文章では相対的な時の言葉（「earlier」「this time」）を日付、版、PRの番号に置き換えます。

## 書いたあとの確認

書き終えたらhumanizerで推敲し、次の点を確かめます。形で確かめられる決まり（取り除く書き癖の一部、綴り、引用符、ダッシュ、用語）は、文章の検査（`tools/writing_gate/check.mjs`。[開発の手順](../development.md#文章の検査docswriting)を参照）が確かめます。残りの点は書き手が確かめます。結論を先に書くこと、論証、推敲で意味を保つことなどです。

1. 結論が先にあり、1つの文に考えが1つだけ入っているか
2. 段落の最初の文で話題が分かるか。違うものを同じとまとめず、因果に仕組みを添え、主張が例の範囲に収まっているか
3. [取り除く書き癖](#取り除く書き癖)が残っていないか（中身のない言葉、チャットボットの決まり文句、宣伝の言葉、AIに多い語彙、「serves as」、文末の「-ing」の節、水増しした3つ組、要らない対比、ダッシュ） <!-- writing-exempt: 悪い例として避ける形を挙げている -->
4. 1つのものに1つの言葉を使い、`locales/en.yml`と用語集に合っているか
5. 綴り、数、日付、引用符が[綴りと表記](#綴りと表記)に従っているか
6. 推敲で主張、比重、言い切りの強さ、文の働きを変えていないか。事実を足していないか
7. 公開される文章に、人の名前、役割、使ったマシンの詳細が入っていないか

## 参考文献

- Wikipedia contributors「Wikipedia:Signs of AI writing」。<https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing>（2026-11-17参照）
  - 癖の一覧の基にしました。中身のない言葉とチャットボットの決まり文句、宣伝の言葉、AIに多い語彙、「is」を避ける言い換え（copula avoidance）、文末の「-ing」による分析、3つ組（rule of three）、否定を使った対比（negative parallelism）、あいまいな出典、変化のための言い換え（elegant variation）、書式の兆候です。書式の兆候にはtitle case、行内の太字の見出し、絵文字、曲がった引用符があります。兆候は記述的なものであって証拠ではないこと、兆候を消すのは文章を直すことと同じではないことも、この資料から取りました。 <!-- writing-exempt: 悪い例として避ける形を挙げている -->
- [japanese-guideline.md](japanese-guideline.md)。日本語の側の対になる文書です。その中の段落と論証、意味を変えない推敲、情報を足さないことの節は、この文書にも同じ内容を載せています。
