# English writing guideline

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

Do not rewrite existing documents to these rules in one sweep. Apply them to new text and to the parts you revise.

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
