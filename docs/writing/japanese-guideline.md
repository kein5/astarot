# Japanese writing guideline

[日本語版](#日本語の文章ルール日本語版)

These are the rules for Japanese written in this repository. They apply to AI agents and to human developers alike. This document is the reference for how to write Japanese; other documents link to it instead of copying its content.

Each reference has its own role here ([References](#references)). The orthography rules are based on 「公用文作成の考え方」 by the Council for Cultural Affairs (文化審議会), and sentence craft and the pattern of revision on 「日本語技術文書の文章規範」. From "japanese-tech-writing", only the points those two lack were taken (how to write paragraphs and arguments, translationese metaphors). Where the sources disagree, this document takes the option that fits ASTAROT's UI and documents as they are, and gives the reason. Every rule was written from scratch for ASTAROT.

## Scope

### What these rules cover

| Kind of document | Examples | Sections that apply |
|---|---|---|
| Developer documents | `docs/`, `AGENTS.md`, the Japanese parts of `PRODUCT.md`, `DESIGN.md` and `CONTRIBUTING.md`, the text of pull requests and issues and the comments on them, Japanese comments in code | [General rules](#general-rules), [Developer documents](#developer-documents) |
| User-facing text | `locales/ja.yml`, `site/ja/`, `docs/readmes/README.ja.md`, release notes | [General rules](#general-rules), [User-facing text](#user-facing-text) |
| Agent reports | Work reports, the verification part of a pull request body, review results | [General rules](#general-rules), [Agent reports](#agent-reports) |

A pull request body counts as both a developer document and a report. Both sections apply to it.

### What they do not cover

- Quoted text, and files taken from elsewhere (such as the original text of a license)
- Generated files (`docs/spec/reference/`, `CHANGELOG.md`)
- What is written in English (commit messages, English documents, `locales/en.yml`). English follows the [English writing guideline](english-guideline.md).
- Points where a document-specific rule decides differently from this document ([Precedence of document-specific rules](#precedence-of-document-specific-rules))

### Precedence of document-specific rules

When a kind of document has its own writing rules, those rules take precedence. The rules in this document apply as far as they do not contradict the document-specific ones.

- Where a document-specific rule decides a point, follow it. Do not rewrite the document-specific rule, even where it differs from this document.
- Where a document-specific rule says nothing, apply this document.
- A document-specific rule added later takes precedence in the same way, even if it is not in the table below.

The emoji at the start of release note headings is an example of what this precedence takes out of scope. This document says not to use emoji, but [the release notes format](../release-notes/README.md) puts an emoji at the start of a heading, so release notes follow the format. In the body of release notes, this document applies wherever the format says nothing.

These are the document-specific rules in force now.

| Document-specific rule | Where it takes precedence |
|---|---|
| [The release notes format](../release-notes/README.md) | Structure, headings and emoji of release notes, and how they describe internal changes |
| [`DESIGN.md`](../../DESIGN.md), "The user guide (site/)" | How the user guide is laid out |
| [Spec update rules](../spec/README.md#更新の決まり) | How the files in `docs/spec/` are split and written |
| `CONTRIBUTING.md` and the i18n quality gate (#515) | UI string keys, matching Japanese and English, placeholder checks |
| `AGENTS.md`, "検証と完了の報告" | What a report has to contain |

When you find a conflict between this document and a document-specific rule, resolve it by adding an exception to this document.

### Applying the rules to existing documents

Existing documents still contain wording that does not follow these rules. What a pattern can catch is recorded in the baseline (`baseline.json`) of the writing gate (`tools/writing_gate/`), and it is fixed area by area, in a separate pull request for each area (decision of 2026-11-23). After a fix, `--update-baseline` lowers the baseline. Apply the rules from the start to new text and to the parts you revise. While you revise, you may also bring the orthography of the same paragraph into line.

## General rules

### The document's role and sentence endings

Before you start writing a document, decide its role.

| Role | Example documents | Example endings |
|---|---|---|
| Rule | Conventions, procedures, this document | 「〜します」 ("does"), 「〜しません」 ("does not") |
| Explanation | Designs, research records, specifications | 「〜です」 ("is"), 「〜します」 ("does") |
| Guidance | Manuals, explanations of the UI, release notes | 「〜できます」 ("can"), 「〜してください」 ("please do") |

- Do not mix the polite form (です・ます) and the plain form (である・する) in one document.
- When you revise an existing document, match its style. `docs/spec/` is written in the plain form.
- Avoid endings that attach 「です」 to an adjective, such as 「難しいです」 ("is difficult") and 「早いです」 ("is quick"). Use a verb, as in 「難しくなります」 and 「早く終わります」, or rebuild the sentence.
- Do not rewrite an ending that suits the document's role into the form of another role. A guidance document that lists its steps with 「〜します」 can stay as it is.

### Sentence structure

- Put the conclusion first, and follow it with the reasons and details.
- Put only one topic in a sentence. Split a sentence that has grown long.
- Use a bulleted list for three or more items. Number the items only when their order means something, as in a procedure.
- Say who does what. Do not leave a sentence in which the reader cannot tell whether the actor is the user, the app or a developer.
- Keep demonstratives such as 「これ」 ("this") and 「その」 ("that") close to what they point to. When they would end up far from it, write the noun instead.
- Avoid double negatives (「〜しないわけではない」, "it is not that it does not").
- Use the passive only when you need it. 「ASTAROTが設定を保存します」 ("ASTAROT saves the settings") makes the actor clearer than 「設定が保存されます」 ("the settings are saved").
- Use 「など」 ("and so on") only after you have given typical examples before it.
- Give degrees and times as numbers. Write 「30秒待つ」 ("wait 30 seconds") rather than 「しばらく待つ」 ("wait a while"). When the number is unknown, do not make one up; write that it is unknown.

### Paragraphs and arguments

- Open each paragraph with a sentence that states its topic. Keep one topic per paragraph.
- Move the argument in one direction. Deal with opposing views and limits first, and state the conclusion once.
- Show how a paragraph follows from the one before with a connective such as 「しかし」 ("but") or 「そのため」 ("so").
- Do not lump different things together as 「同じ」 ("the same"). Do not reduce an event with several causes to one cause.
- When you state a cause, add one sentence on how it works. Write 「停止すると世代番号が進み、それより前の世代の読み上げは鳴らしません」 ("Stopping advances the generation number, and speech from earlier generations is not played") rather than 「停止すると古い読み上げは鳴りません」 ("Stopping keeps old speech from playing").
- Keep a claim within what the examples you give support. State detection and guarantees together with the conditions under which they hold.

### Commas

Put a comma (読点, 「、」) to mark off a condition, a reason or items in a series, and where it prevents a misreading. Do not put a comma only to make a pause.

| Comma to leave out | Corrected |
|---|---|
| Windowsでは、仮想ケーブルを使います。 | Windowsでは仮想ケーブルを使います。 |
| 確認してから、もう一度開始してください。 | 確認してからもう一度開始してください。 |
| 字幕は、VRの視界に出ます。 | 字幕はVRの視界に出ます。 |

### Revising

When you revise text, someone else's or your own, keep these four things as they were:

- The claim: what is said and how its logic connects
- The weight: what is treated as major and what as minor. This includes the order in which things are listed and which options were rejected and which were adopted.
- The strength: the degree of assertion, conjecture or possibility. Do not turn 「おそれがあります」 ("there is a risk that") into 「問題ありません」 ("there is no problem"), and do not turn a conjecture into an assertion.
- The function: what the sentence does, such as explaining, requesting, warning or announcing a plan

If you notice while revising that one of these four would have to change, do not rewrite the text; tell the author.

Do not add information that is not in the original text or in facts you checked. This covers actors, numbers, examples, causes and conditions. When the code and records do not settle a point, do not fill it with a guess; write 「確かめていません」 ("not verified") or 「分かっていません」 ("unknown"). When you give a measured value, add the environment and conditions it was measured under.

Revise with [yomiyasu](https://github.com/nanaism/yomiyasu). yomiyasu is the tool that carries out the revision; its rules are not copied into this document. When yomiyasu's suggestions and this document disagree, follow this document.

### Expressions to avoid

<!-- writing-exempt-start: lists the forms to avoid as bad examples -->

#### Stock phrases and exaggeration

| Avoid | How to fix |
|---|---|
| 「さて、」「それでは見ていきましょう」「以下で説明します」 ("Now,", "Let us take a look", "This is explained below") | Delete the sentence that announces what is coming, and start with the subject itself. |
| 「ポイントは3つあります」 ("There are three points") | Do not announce the count first; use a bulleted list. |
| 「重要なのは〜です」「注目すべきは〜です」 ("What matters is ...", "What deserves attention is ...") | Instead of saying that it matters, write the content itself first. |
| 「〜と言えるでしょう」「〜に他なりません」 ("it could be said that ...", "is nothing other than ...") | Write a checked fact as 「〜です」. Write a guess in a form that shows it is a guess. |
| 「いかがでしょうか」「お役に立てば幸いです」 ("What do you think?", "I hope this helps") | Do not write them. |
| Ending a paragraph with 「これで〜できるようになりました！」 ("Now you can ...!") | Do not write a closing sentence. Put what changed in the body. |
| 「単なるAではなくBです」 ("not just A but B") | If no reader would take it for A, write only B. |
| 「シームレスに」「強力な」「革新的な」「劇的に」 ("seamlessly", "powerful", "innovative", "dramatically") | Say concretely what it does, and show the effect with numbers and conditions. |

#### Metaphor and personification

Rewrite these with words whose meaning is fixed: metaphorical verbs, metaphors translated word for word from English idioms, and wording that gives a thing a will or knowledge.

| Avoid | Corrected |
|---|---|
| 静かに失敗する ("fails silently") | エラーを出さずに失敗する ("fails without raising an error") |
| 例外を握りつぶす ("swallows the exception") | 例外を捕まえて通知せずに捨てる ("catches the exception and discards it without reporting it") |
| 要求を蹴る ("kicks the request") | 要求を拒否する ("rejects the request") |
| メモリを食う ("eats memory") | メモリを多く使う ("uses a lot of memory") |
| アプリが落ちる ("the app goes down") | アプリが異常終了する ("the app terminates abnormally") |
| APIを叩く ("hits the API") | APIを呼び出す ("calls the API") |
| 既定を〜側に倒す ("tips the default toward ...") | 既定を〜にする ("sets the default to ...") |
| この問題は開かれています ("this issue is open") | この問題は未解決です ("this issue is unresolved") |
| ログが語っています ("the log tells us") | ログから分かります ("the log shows") |
| モデルは日本語を知っています ("the model knows Japanese") | モデルは日本語を認識できます ("the model can recognize Japanese") |
| この修正が効きます、刺さります ("this fix works", "this fix hits the spot") | Say what this fix changes and how. |

- When in doubt, check whether a reader might picture the literal action, and whether you can restate the actor and the object in concrete words. A sentence you cannot restate makes no definite claim, so delete or rewrite it.
- Keep what the metaphor implied after you fix it. If 「静かに」 ("silently") meant 「利用者が気づかないうちに」 ("before the user notices"), write that.
- Long-established idioms such as 「手間がかかる」 ("takes effort") and phrases that have settled as programming terms such as 「例外を投げる」 ("throw an exception") can stay as they are.

#### Roundabout wording and translationese

| Avoid | Corrected |
|---|---|
| 保存することができます | 保存できます ("can save") |
| 確認を実施します、保存を行います | 確認します、保存します ("checks", "saves") |
| 再起動することによって直ります | 再起動すると直ります ("restarting fixes it") |
| Linuxにおいては | Linuxでは ("on Linux") |
| ログに関しては | ログは ("as for the log") |
| 原因はドライバーとなります | 原因はドライバーです ("the cause is the driver") |
| 削除させていただきます | 削除します ("deletes it") |

#### Formatting

- Bold at most one place in a paragraph. Bold only the text inside the corner brackets 「」, and keep the full stop outside the bold (for example, 「**保存**」を押します).
- Do not use emoji.
- Do not use the exclamation mark (！). Use the question mark (？) only in a sentence that asks the user something in a UI confirmation (「〜を削除しますか？」).
- Do not join sentences with a dash (——). Split the sentence, or put the aside in parentheses.
- Word a heading so that it shows the content. Avoid a heading that is only 「概要」 ("Overview") or 「その他」 ("Other").
- A heading that gives both languages puts English first ("Summary / 概要"; decision of 2026-11-23).
- Do not end a line with a full-width colon (：) and continue on the next line.
- Write code, commands, file paths and setting keys in code formatting (`` ` ``). Put several lines in a code block.
- Do not indent the first character of a paragraph. In Markdown, separate paragraphs with a blank line.

<!-- writing-exempt-end -->

### Orthography

#### Kanji and kana

Use the kanji in the official list of kanji for general use (常用漢字表). Write the following words in kana even where a kanji exists for them.

<!-- writing-exempt-start: lists the forms to avoid as bad examples -->

| Write in kana | Do not write | When to write the kanji |
|---|---|---|
| こと、とき、ところ、もの | 事、時、所、物 | When it refers to an actual time or place, or to a thing you can hold (「起動した時刻」) |
| とおり（次のとおり） | 通り | The name of a street (大通り) |
| ため、よう、わけ | 為、様、訳 | |
| ほか（ほかのアプリ） | 他、外 | When it is part of a word, as in 「他社」 |
| できる、いる、なる、ある、ない | 出来る、居る、成る、有る、無い | 「出来が良い」「有無」 |
| 〜ていく、〜てくる、〜てみる、〜ておく、〜てください | 〜て行く、〜て来る、〜て見る、〜て置く、〜て下さい | When the verb keeps its literal sense of moving or looking (「VRChatで見る」) |
| および、または、ただし、さらに | 及び、又は、但し、更に | |
| など | 等 | |

Official documents (公用文) write 「及び」 and 「又は」 in kanji. ASTAROT writes them in kana in developer documents as well, to match the user-facing text.

<!-- writing-exempt-end -->

#### Okurigana

Do not drop okurigana (the kana written after a kanji stem). Write them in nouns the same way as in verbs.

- 切り替え、取り消し、読み込み、書き込み、割り当て、問い合わせ、受け付け、取り扱い、引き継ぎ

Official documents drop them in some words, as in 「取扱い」. The official rules also allow the full form in explanations and publicity aimed at the general public. ASTAROT uses the full form in every kind of document. <!-- writing-exempt: quotes a form to avoid as a bad example -->

#### Loanwords

- Use loanwords that are established in Japanese as they are (ファイル、ボタン、スイッチ、モデル、ログ).
- Replace a loanword that is not established with a Japanese word, or explain it where it first appears.
- Write the long-vowel mark 「ー」 where the long vowel stands for the English ending -er, -or or -ar (サーバー、フォルダー、ユーザー、ドライバー、ブラウザー、パラメーター、エンコーダー、インストーラー、プレイヤー).
- Do not write 「ー」 where the long vowel stands for the English ending -y (メモリ、セキュリティ、ディレクトリ、プロパティ、ライブラリ、リポジトリ). The official rules take the form with 「ー」 as the principle. ASTAROT follows the form without 「ー」, because the Japanese UI of Windows and `locales/ja.yml` use it.
- Do not use 「ヴ」; write the kana of the ba row (バ行) instead (ボイスチェンジャー). Write 「ウィンドウ」 with 「ウィ」. <!-- writing-exempt: quotes a form to avoid as a bad example -->
- Write product and service names as their providers write them (VRChat, SteamVR, speech.cpp, ONNX Runtime, PipeWire, OBS).
- Where an abbreviation first appears, add its full name or an explanation. When a feature name in the UI contains the abbreviation, write it in that form (「テキスト読み上げ（TTS）」).

#### Numbers and units

- Write numbers in half-width Arabic numerals.
- Separate quantities of four or more digits with a comma every three digits (12,000件). Do not separate port numbers, versions or years (65535, 0.5.0, 2026年).
- Write counts in Arabic numerals (1つ、2か所、3か月). Official documents write 「一つ」 in kanji numerals, but `locales/ja.yml` and the ASTAROT documents consistently use Arabic numerals, so follow them.
- Write words that do not count anything, and approximate numbers, in kanji numerals (一時停止、一度、数十件).
- Put a half-width space between a number and a unit symbol (4 GiB, 120 ms, 48 kHz). No space before 「%」 (25%). No space before Japanese units such as 「秒」 and 「件」 (5秒, 3件). When you revise an existing document, follow how that document writes them.
- Show a range with 「〜」 (1〜3).
- Write dates as 「2026年11月17日」 in user-facing text and as 「2026-11-17」 in developer documents.

#### Punctuation and symbols

- Use 「。」 as the full stop (句点) and 「、」 as the comma (読点).
- In Japanese text, use full-width parentheses （）. Write alphanumerics inside them in half-width.
- Put asides in （）. Put UI text, quotations and words referred to as words in 「」. When you need brackets inside 「」, use 「」 there too.
- Put an aside at the end of a sentence before the full stop (「…直しました（#341）。」).
- Separate items in a series with 「、」. Use the middle dot (・) only when two words are treated as one pair (停止・ミュート).
- Write a place in the UI in the form 「設定」→「ページ」→「項目」 ("Settings" → "page" → "item").

#### Spacing between Japanese and alphanumerics

| Document | How to write |
|---|---|
| User-facing text | No space between Japanese and alphanumerics (お使いのPCで動きます). |
| New files of developer documents | No space. |
| Existing files of developer documents | Follow how that file does it. `AGENTS.md` puts a space. |

Between a number and a unit symbol, follow the rules in [Numbers and units](#numbers-and-units).

### Terminology

`locales/ja.yml` is the reference for the names shown in the UI. The mapping between UI words and code names is in [the glossary](../spec/glossary.md). The table in this section gives only the rules for choosing words in documents.

<!-- writing-exempt-start: lists the forms to avoid as bad examples -->

| Use | Do not use | Note |
|---|---|---|
| ASTAROT | VRCT-VOX (as the app's name) | The repository name is `kein5/astarot`. For the executable name, the app ID and storage locations, use the forms in [Names and identifiers](../voice-stack/project-rename.md). |
| 利用者 ("user") | ユーザー (when it means a person) | Keep the word as it is when it is part of the name of an outside mechanism, as in 「ユーザー名」 ("user name") and 「ユーザーサービス」 ("user service"). |
| テキスト読み上げ（TTS） ("Text to speech (TTS)") | 音声合成 ("speech synthesis") | The feature's name in the UI. From the second mention on, write 「読み上げ」 or 「TTS」. |
| 音声認識（ASR） ("Speech recognition (ASR)") | | The feature's name in the UI. The UI also has 「文字起こし」 ("transcription"). Use 「音声認識」 in new text. |
| ボイスチェンジャー（RVC） ("Voice changer (RVC)") | 声質変換 ("voice conversion"; in user-facing text) | The feature's name in the UI. Developer documents also use 「声質変換」. |
| チャット読み取り（OCR） ("Chat reading (OCR)") | | The feature's name in the UI. |
| 字幕オーバーレイ ("Subtitle overlay") | | The display that shows the conversation in the VR view. |
| VR UI | VRパネル ("VR panel") | The name in the glossary. The UI has both. |
| チャット入力の小窓 ("small chat input window") | クイックチャット ("Quick Chat" in katakana) | Developer documents also use Quick Chat. |
| ホットキー ("hotkey") | ショートカット ("shortcut") | Use 「ショートカット」 only for the desktop environment's feature (the GlobalShortcuts portal). |
| 既定、既定値 ("default", "default value") | デフォルト | When you quote UI text such as 「初期値に戻す」 ("Reset to default"), write it as it is. |
| ダウンロード ("download") | | The act of bringing a file in from the internet. |
| 取得 ("fetch") | | Getting something, as a whole. Use it when consent or checks are part of it besides the download. |
| オンにする、オフにする ("turn on", "turn off") | 有効化する、無効化する ("enable", "disable"; for a switch) | Use 「有効にする」 when you quote an item whose UI text says 「有効にする」. |
| 押す ("press") | クリックする、タップする ("click", "tap") | It also makes sense to people who operate with a keyboard or a VR controller. |
| 選ぶ ("choose") | 選択する ("select"; as the predicate of a sentence) | The noun 「選択」 is fine. |
| 停止、ミュート ("stop", "mute") | | These words are tied to the product's commitments (`PRODUCT.md`), so do not paraphrase them. |
| マイク、スピーカー ("microphone", "speaker") | | The feature that picks up the other person's voice is 「スピーカー」. |
| 仮想マイク、仮想ケーブル ("virtual microphone", "virtual cable") | | |

<!-- writing-exempt-end -->

## Developer documents

- Decide the role before you write. Design decisions (ADRs), verification records and procedures have different roles, so do not mix them in one document.
- Put the date of writing in a dated record. Avoid words that depend on when they were written, such as 「今回」 ("this time"), 「最新」 ("latest") and 「次工程」 ("the next step"), and write a date or a version instead.
- Explain a technical term where it first appears, or link to [the glossary](../spec/glossary.md). When you coin a term, add it to the glossary.
- Do not write the same thing in two places. Choose one reference and link to it from the others.
- Point to files and functions by file name and name. Do not give line numbers, because they change.
- Keep adopted policies apart from proposals and options under consideration. ADRs show this in their status field.
- Write pull request and issue text in this order: purpose, change, verification, remaining issues. Leave out people's names, who is in charge and the environment used for the work.
- Code comments give the reason and the constraints, and do not repeat what reading the code tells you.

## User-facing text

The reader has no background in audio processing or programming. The aim is that after reading, they know what to do next.

- Write in the です・ます form. Do not use 「ございます」, 「いたします」 or 「申し上げます」 (very formal, humble forms).
- Quote UI text in 「」 exactly as `locales/ja.yml` writes it.
- Do not refer to the reader's PC from the developer's side, as in 「このPC」 ("this PC"). Write 「お使いのPC」 ("your PC"), 「ASTAROTを動かしているPC」 ("the PC running ASTAROT") or 「同じPC」 ("the same PC").
- Mention names from the internal implementation (crates, libraries, endpoints, functions) only when they matter to what the user does.
- Be specific about what is not possible, the data that is sent, and the size and license of the files that are fetched.
- Give speed and required memory together with the conditions they were measured under. Do not write that every PC gets the same result.

### Words to replace

In user-facing text, replace development terms as follows.

| Development term | User-facing term |
|---|---|
| このPC、手元のPC ("this PC", "the PC at hand") | お使いのPC、ASTAROTを動かしているPC ("your PC", "the PC running ASTAROT") |
| サイドカー、Rustの中核、バックエンド ("sidecar", "Rust core", "backend") | ASTAROTの処理部分 ("the part of ASTAROT that does the processing") |
| VRAM | GPUのメモリ ("GPU memory") |
| 推論 ("inference") | 認識、変換、読み上げ ("recognition", "conversion", "reading aloud"; choose by what it does) |
| レイテンシ ("latency") | 遅れ、遅延 ("lag", "delay") |
| フォールバックする ("fall back") | 代わりに〜を使う ("use ... instead") |
| トグル ("toggle") | スイッチ ("switch") |
| プロセス ("process") | プログラム ("program") |
| クラッシュする、落ちる ("crash", "go down") | 異常終了する ("terminate abnormally") |
| 重み、weights | モデル、モデルのファイル ("model", "model file") |
| エンドポイント、IPC、要求、通知 ("endpoint", "IPC", "request", "notification") | Do not write them. When they matter to what the user does, describe them as operations in the UI. |
| `config.json` | 設定ファイル ("settings file"; add `config.json` only when the reader has to open the file) |

### UI strings (locales/ja.yml)

- When you add or change a string, update both `locales/en.yml` and `locales/ja.yml`.
- Keep placeholders (such as `{{name}}`) the same in Japanese and English. Changing the word order must not drop or add one.
- Do not fill an untranslatable string with a guess. Do not translate proper nouns, protocol identifiers or what the user typed.
- Where the i18n quality gate (#515) checks something, its rules apply. This document does not add rules that contradict it.
- Labels for buttons and switches are short words that say what happens when you press them. Keep the same form within one screen.
- Write errors and notices in this order: what happened, its cause when known, and what the user can do.
  - Example: 「GPUのメモリが足りず、AI翻訳を開始できませんでした。設定の「翻訳」で処理デバイスをCPUにするか、ほかのGPUアプリを止めてください。」 (the English UI has "Not enough GPU memory to start AI translation. Choose CPU as the device under Settings → Translation, or close other GPU apps.")
- A confirmation first states the question and what happens if the user goes ahead. When it cannot be undone, say so, and leave a way to back out.
- Check that long Japanese text and narrow windows do not break the layout (`DESIGN.md`).

### Release notes

[The release notes format](../release-notes/README.md) is the reference for the structure, headings, emoji and how internal changes are written. The emoji at the start of headings is outside the scope of this document. The body follows this document's general rules and its rules for user-facing text. Use fewer commas, and give each topic its own paragraph.

### User guide (site/ja)

The layout follows `DESIGN.md`, "The user guide (site/)". The text follows the rules of this section.

## Agent reports

`AGENTS.md`, "検証と完了の報告", decides what a report contains. This section decides how to write it.

- Put the outcome in the first one or two sentences. Make it clear from the start whether the work is done, stopped or waiting for a decision.
- Keep what you verified apart from what you infer. Do not settle something you did not verify with 「〜のはずです」 ("it should be ..."); write 「確かめていません」 ("not verified") and give the reason.
- Write 「完了しました」 ("done") or 「直りました」 ("fixed") only after a check confirmed it.
- Do not write stock openers and closers (「承知しました」 "Understood", 「いかがでしょうか」 "What do you think?", 「ほかに何かあればお知らせください」 "Let me know if there is anything else"). <!-- writing-exempt: quotes the forms to avoid as bad examples -->
- Quote only the relevant lines of command output, in a code block. Do not paste long logs as they are.
- Give counts, file names and pull request or issue numbers that you counted or checked.
- When you ask for a decision, give the options, the effect of each and the one you recommend. Do not ask questions the decision does not need.
- Do not put people's names, who is in charge or the environment used for the work in public text (pull requests, issues, comments, release notes).
- Do not leave relative words such as 「今回」 ("this time") and 「先ほど」 ("a moment ago") in public text. Write a date, a version or a pull request number.

## Checks after writing

When you finish writing, revise with yomiyasu, then check the points below. The writing gate (`tools/writing_gate/check.mjs`) checks the rules a pattern can catch: some of the expressions to avoid, orthography, punctuation and terms ([the development guide](../development.md#文章の検査docswriting)). Of the points below, a person checks the document's role, the conclusion, the argument and the revision.

1. The document's role is decided, and its sentence endings are consistent.
2. The conclusion comes first, and the first sentence of each paragraph shows its topic.
3. Different things are not lumped together as the same. Causes come with how they work, and claims stay within what the examples support.
4. No [expressions to avoid](#expressions-to-avoid) and no commas that only make a pause are left.
5. Kana, okurigana, long-vowel marks, numbers and the spacing between Japanese and alphanumerics are consistent within the document, and UI text matches `locales/ja.yml`.
6. Revising kept the claim, weight, strength and function of each sentence, and added no information that the original did not have.
7. Public text contains no people's names, who was in charge or the environment used for the work.

## References

- Council for Cultural Affairs (文化審議会), 「公用文作成の考え方（建議）」 (an approach to writing official documents, a proposal), 2022-01-07. <https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/93651301_01.pdf> (accessed 2026-11-17)
  - The basis for orthography: kanji for general use and okurigana, loanwords, numbers and symbols, and how to replace and explain terms.
- c-modernization-kit, 「日本語技術文書の文章規範」 (writing standards for Japanese technical documents). <https://hondarer.github.io/c-modernization-kit/ja-details/html/docsfw/japanese-technical-writing-guideline.html> (accessed 2026-11-17)
  - The basis for sentence craft and the pattern of revision: a document's role and consistent sentence endings, the stock phrases and metaphorical verbs common in AI-written text, revising without changing the meaning, and not adding information.
- "japanese-tech-writing" (GitHub Gist, Unlicense). <https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d> (accessed 2026-11-17)
  - Only the points the two above lack were taken from it: how to write paragraphs (state the topic at the start of a paragraph, move the argument in one direction), rigor in argument (do not call different things the same, add how a cause works, keep a claim within the examples) and translationese metaphor and personification.

---

# 日本語の文章ルール（日本語版）

このリポジトリで書く日本語の決まりです。AIエージェントにも人の開発者にも当てはめます。日本語の書き方はこの文書を正本とし、ほかの文書には内容を写さずにこの文書へのリンクを置きます。

参考資料は役割を分けて使っています（[参考文献](#参考文献)）。表記は文化審議会の「公用文作成の考え方」を、文の作法と推敲の型は「日本語技術文書の文章規範」を基にしています。「japanese-tech-writing」からは、この2つにない点（段落と論証の書き方、翻訳調の比喩）だけを取り入れました。資料どうしが食い違う点はASTAROTの画面と文書の実態に合う方を採り、理由を添えています。どれもASTAROT向けに書き起こしました。

## 適用範囲

### 対象にする文章

| 文書の種類 | 例 | 当てはめる章 |
|---|---|---|
| 開発者向け文書 | `docs/`、`AGENTS.md`、`PRODUCT.md`・`DESIGN.md`・`CONTRIBUTING.md`の日本語の部分、PRとIssueの本文とコメント、コードの日本語のコメント | [共通の決まり](#共通の決まり)、[開発者向け文書](#開発者向け文書) |
| 利用者向け文書 | `locales/ja.yml`、`site/ja/`、`docs/readmes/README.ja.md`、リリースノート | [共通の決まり](#共通の決まり)、[利用者向け文書](#利用者向け文書) |
| エージェントの報告文 | 作業の報告、PRの本文の検証の欄、レビューの結果 | [共通の決まり](#共通の決まり)、[エージェントの報告文](#エージェントの報告文) |

PRの本文は開発者向け文書と報告文の両方に当たります。両方の章を当てはめます。

### 対象にしないもの

- 引用した文章と、外部から持ってきたファイル（ライセンスの原文など）
- 生成するファイル（`docs/spec/reference/`、`CHANGELOG.md`）
- 英語で書くもの（コミットメッセージ、英語の文書、`locales/en.yml`）。英語は[英語の文章ルール](english-guideline.md)に従います。
- 個別のルールがこの文書と違う決め方をしている点（[個別のルールとの優先関係](#個別のルールとの優先関係)）

### 個別のルールとの優先関係

文書の種類ごとに個別の文章ルールが定められているときは、個別のルールを優先します。この文書の決まりは個別のルールと矛盾しない範囲で当てはめます。

- 個別のルールが決めている点は、個別のルールに従います。この文書の決まりと食い違っていても、個別のルールを書き換えません。
- 個別のルールが決めていない点には、この文書の決まりを当てはめます。
- 下の表にない個別のルールが新しく定められたときも、同じように個別のルールを優先します。

リリースノートの見出しの先頭の絵文字は、この優先関係で対象外になる例です。この文書は絵文字を使わない決まりですが、[リリースノートの書式](../release-notes/README.md)が見出しの先頭に絵文字を置くと定めているので、そちらに従います。リリースノートの本文のうち、書式が決めていない点には、この文書の決まりを当てはめます。

いま定められている個別のルールは次のとおりです。

| 個別のルール | 優先する範囲 |
|---|---|
| [リリースノートの書式](../release-notes/README.md) | リリースノートの構成、見出し、絵文字、内部の変更の書き方 |
| [`DESIGN.md`](../../DESIGN.md)の「The user guide (site/)」 | 利用者向けマニュアルの組み方 |
| [機能仕様書の更新の決まり](../spec/README.md#更新の決まり) | `docs/spec/`の文書の分け方と書き方 |
| `CONTRIBUTING.md`と、i18nの品質ゲート（#515） | 画面の文言のキー、日英の対応、補間変数の検査 |
| `AGENTS.md`の「検証と完了の報告」 | 報告に書く項目 |

この文書と個別のルールの食い違いに気づいたら、この文書の側に例外を書き足して解消します。

### 既存の文書への当てはめ方

既存の文書には、この文書の決まりに合わない書き方が残っています。そのうち形で確かめられるものは、文章の検査（`tools/writing_gate/`）の基準（`baseline.json`）に記録してあり、場所ごとに別のPRで直していきます（2026-11-23の決定）。直したら`--update-baseline`で基準を減らします。新しく書く文章と改訂する箇所には、はじめからこの決まりを当てはめます。改訂のついでに同じ段落の表記をそろえるのは構いません。

## 共通の決まり

### 文書の立場と文末

文書を書き始める前に、その文書の立場を決めます。

| 立場 | 文書の例 | 文末の例 |
|---|---|---|
| 決まり | 規約、手順、この文書 | 「〜します」「〜しません」 |
| 説明 | 設計、調査の記録、仕様 | 「〜です」「〜します」 |
| 案内 | マニュアル、画面の説明、リリースノート | 「〜できます」「〜してください」 |

- 1つの文書の中では敬体（です・ます）と常体（である・する）を混ぜません。
- 既存の文書を改訂するときは、その文書の文体に合わせます。`docs/spec/`は常体で書いています。
- 「難しいです」「早いです」のような形容詞に「です」を付けた文末を避けます。「難しくなります」「早く終わります」のように動詞を使うか、文を組み立て直します。
- 立場に合った文末を、ほかの立場の形に書き換えません。手順を「〜します」と並べた案内の文書は、そのままで構いません。

### 文の組み立て

- 結論を先に書き、理由と詳しい内容をあとに続けます。
- 1つの文には話題を1つだけ入れます。長くなった文は分けます。
- 3つ以上のものを並べるときは箇条書きにします。手順のように順番に意味があるときだけ番号を付けます。
- 誰が何をするのかを書きます。動作の主が利用者か、アプリか、開発者かが分からない文を残しません。
- 「これ」「その」などの指示語は指すものの近くに置きます。離れるときは名詞で書き直します。
- 二重否定（「〜しないわけではない」）を避けます。
- 受け身を必要なときだけ使います。「設定が保存されます」より「ASTAROTが設定を保存します」のほうが動作の主がはっきりします。
- 「など」は代表的な例を前に挙げてから使います。
- 程度や時期は数で書きます。「しばらく待つ」より「30秒待つ」と書きます。数が分からないときは数を作らず、分からないと書きます。

### 段落と論証

- 段落の最初の文で、その段落の話題を示します。1つの段落には話題を1つだけ入れます。
- 論は一方向に進めます。反対の見方や制約を先に扱い、結論は1回だけ書きます。
- 前の段落とのつながりは「しかし」「そのため」のようなつなぎの語で示します。
- 違うものを「同じ」とまとめません。原因が複数あるできごとを、1つの原因にまとめません。
- 因果を書くときは、どういう仕組みでそうなるかを1文で添えます。「停止すると古い読み上げは鳴りません」より「停止すると世代番号が進み、それより前の世代の読み上げは鳴らしません」と書きます。
- 主張は、示した例が支える範囲に絞ります。検出や保証は、成り立つ条件と一緒に書きます。

### 読点

読点は条件、理由、並列の区切りと、読み誤りを防ぐ箇所に打ちます。間を置くためだけの読点は打ちません。

| 打たない例 | 直した例 |
|---|---|
| Windowsでは、仮想ケーブルを使います。 | Windowsでは仮想ケーブルを使います。 |
| 確認してから、もう一度開始してください。 | 確認してからもう一度開始してください。 |
| 字幕は、VRの視界に出ます。 | 字幕はVRの視界に出ます。 |

### 推敲

他人や自分が書いた文章を推敲するときは、次の4つを変えません。

- 主張：何を言っているか、論理の関係
- 比重：どれを重く扱い、どれを軽く扱っているか。並べる順位や、退けた案と採った案の区別も含みます。
- 言い切りの強さ：断定、推量、可能性の程度。「おそれがあります」を「問題ありません」に変えたり、推量を断定に変えたりしません。
- 文の働き：説明、依頼、警告、予定などの働き

推敲で上の4つを変える必要があると気づいたら、書き換えずに書き手へ伝えます。

元の文章や確かめた事実にない情報を足しません。動作の主、数値、例、原因、条件が対象です。コードや記録を調べても分からないことは、推測で埋めずに「確かめていません」「分かっていません」と書きます。計測した値を書くときは、計測した環境と条件を添えます。

推敲は[yomiyasu](https://github.com/nanaism/yomiyasu)で行います。yomiyasuは推敲を実行する道具で、その決まりはこの文書に写しません。yomiyasuの指摘とこの文書が食い違うときは、この文書に従います。

### 避ける表現

<!-- writing-exempt-start: 悪い例として避ける形を挙げている -->

#### 定型句と誇張

| 避ける表現 | 直し方 |
|---|---|
| 「さて、」「それでは見ていきましょう」「以下で説明します」 | 予告の文を消し、本題から書き始めます。 |
| 「ポイントは3つあります」 | 数を先に宣言せず、箇条書きにします。 |
| 「重要なのは〜です」「注目すべきは〜です」 | 重要だと言う代わりに、その内容を先に書きます。 |
| 「〜と言えるでしょう」「〜に他なりません」 | 確かめた事実は「〜です」と書きます。推測は推測と分かる形で書きます。 |
| 「いかがでしょうか」「お役に立てば幸いです」 | 書きません。 |
| 「これで〜できるようになりました！」で段落を締める | 締めの一文を書きません。変わったことは本文に書きます。 |
| 「単なるAではなくBです」 | Aと取り違える読み手がいないなら、Bだけを書きます。 |
| 「シームレスに」「強力な」「革新的な」「劇的に」 | 何ができるかを具体的に書き、効果は数値と条件で示します。 |

#### 比喩と擬人化

比喩の動詞、英語の慣用句を直訳した比喩、物に意志や知識を持たせた書き方を、意味の決まった言葉に直します。

| 避ける表現 | 直した例 |
|---|---|
| 静かに失敗する | エラーを出さずに失敗する |
| 例外を握りつぶす | 例外を捕まえて通知せずに捨てる |
| 要求を蹴る | 要求を拒否する |
| メモリを食う | メモリを多く使う |
| アプリが落ちる | アプリが異常終了する |
| APIを叩く | APIを呼び出す |
| 既定を〜側に倒す | 既定を〜にする |
| この問題は開かれています | この問題は未解決です |
| ログが語っています | ログから分かります |
| モデルは日本語を知っています | モデルは日本語を認識できます |
| この修正が効きます、刺さります | この修正で何がどう変わるかを書きます |

- 迷ったときは、読み手が文字どおりの動作を思い浮かべないか、動作の主と対象を具体的な言葉で言い直せるかを確かめます。言い直せない文には決まった主張がないので、消すか書き直します。
- 比喩が持っていた含みは、直したあとも残します。「静かに」が「利用者が気づかないうちに」という意味を持っていたなら、そう書きます。
- 「手間がかかる」のように昔から人が使う慣用句と、「例外を投げる」のようにプログラミングの用語として定着した言い方は、そのままで構いません。

#### 回りくどい言い方と翻訳調

| 避ける表現 | 直した例 |
|---|---|
| 保存することができます | 保存できます |
| 確認を実施します、保存を行います | 確認します、保存します |
| 再起動することによって直ります | 再起動すると直ります |
| Linuxにおいては | Linuxでは |
| ログに関しては | ログは |
| 原因はドライバーとなります | 原因はドライバーです |
| 削除させていただきます | 削除します |

#### 書式

- 太字は1つの段落に1か所までにします。かぎ括弧の内側だけを太字にし、句点は太字の外に置きます（例：「**保存**」を押します）。
- 絵文字を使いません。
- 感嘆符（！）を使いません。疑問符（？）は、画面の確認で利用者に尋ねる文（「〜を削除しますか？」）にだけ使います。
- ダッシュ（——）で文をつなぎません。文を分けるか、括弧で補足します。
- 見出しは中身が分かる言葉にします。「概要」「その他」だけの見出しを避けます。
- 両方の言語を並べる見出しは、英語を先に書きます（「Summary / 概要」。2026-11-23の決定）。
- 行末を全角のコロン（：）で終えて次の行に続ける書き方をしません。
- コード、コマンド、ファイルのパス、設定のキーはコードの書式（`` ` ``）で書きます。複数行はコードブロックに入れます。
- 段落の先頭を1字下げしません。Markdownでは段落を空行で分けます。

<!-- writing-exempt-end -->

### 表記

#### 漢字と仮名

常用漢字表にある漢字を使います。次の語は、漢字があっても仮名で書きます。

<!-- writing-exempt-start: 悪い例として避ける形を挙げている -->

| 仮名で書く | 書かない | 漢字で書く場合 |
|---|---|---|
| こと、とき、ところ、もの | 事、時、所、物 | 実際の時刻や場所、手に取れる物を指すとき（「起動した時刻」） |
| とおり（次のとおり） | 通り | 道の名前（大通り） |
| ため、よう、わけ | 為、様、訳 | |
| ほか（ほかのアプリ） | 他、外 | 「他社」のように語の一部になっているとき |
| できる、いる、なる、ある、ない | 出来る、居る、成る、有る、無い | 「出来が良い」「有無」 |
| 〜ていく、〜てくる、〜てみる、〜ておく、〜てください | 〜て行く、〜て来る、〜て見る、〜て置く、〜て下さい | 実際に移動する、見るとき（「VRChatで見る」） |
| および、または、ただし、さらに | 及び、又は、但し、更に | |
| など | 等 | |

公用文では「及び」「又は」を漢字で書きます。ASTAROTでは利用者向け文書に合わせて、開発者向け文書でも仮名で書きます。

<!-- writing-exempt-end -->

#### 送り仮名

送り仮名を省きません。名詞でも動詞と同じように送ります。

- 切り替え、取り消し、読み込み、書き込み、割り当て、問い合わせ、受け付け、取り扱い、引き継ぎ

公用文では「取扱い」のように省く語があります。一般の人に向けた解説や広報では省かずに書くことも認めています。ASTAROTでは文書の種類によらず省かない形にそろえます。 <!-- writing-exempt: 悪い例として避ける形を挙げている -->

#### 外来語

- 日本語に定着した外来語はそのまま使います（ファイル、ボタン、スイッチ、モデル、ログ）。
- 定着していない外来語は日本語に言い換えるか、初めて出たところで説明を添えます。
- 英語の語末の-er、-or、-arに当たる長音は「ー」を書きます（サーバー、フォルダー、ユーザー、ドライバー、ブラウザー、パラメーター、エンコーダー、インストーラー、プレイヤー）。
- 英語の語末の-yに当たる長音は「ー」を書きません（メモリ、セキュリティ、ディレクトリ、プロパティ、ライブラリ、リポジトリ）。公用文は「ー」を書く形を原則にしています。ASTAROTでは、Windowsの日本語表示と`locales/ja.yml`が「ー」を書かない形を使っているので、そちらに合わせます。
- 「ヴ」を使わず「バ行」で書きます（ボイスチェンジャー）。「ウィンドウ」は「ウィ」と書きます。 <!-- writing-exempt: 悪い例として避ける形を挙げている -->
- 製品名とサービス名は提供元の表記のまま書きます（VRChat、SteamVR、speech.cpp、ONNX Runtime、PipeWire、OBS）。
- 略語は初めて出たところで正式な名前か説明を添えます。画面の機能名に略語が入っているときは、その形で書きます（「テキスト読み上げ（TTS）」）。

#### 数字と単位

- 数字は半角の算用数字で書きます。
- 量を表す4桁以上の数は3桁ごとにコンマで区切ります（12,000件）。ポート番号、版、年は区切りません（65535、0.5.0、2026年）。
- 個数は算用数字で書きます（1つ、2か所、3か月）。公用文は「一つ」と漢数字で書きますが、`locales/ja.yml`とASTAROTの文書は算用数字にそろっているので、そちらに合わせます。
- 数を数えていない語と概数は漢数字で書きます（一時停止、一度、数十件）。
- 数字と単位の記号の間は半角スペースを空けます（4 GiB、120 ms、48 kHz）。「%」は空けません（25%）。「秒」「件」のような日本語の単位は空けません（5秒、3件）。既存の文書を改訂するときは、その文書の書き方に合わせます。
- 範囲は「〜」で示します（1〜3）。
- 日付は利用者向け文書では「2026年11月17日」、開発者向け文書では「2026-11-17」と書きます。

#### 符号

- 句点は「。」、読点は「、」を使います。
- 和文の中の括弧は全角の（）を使います。括弧の中の英数字は半角で書きます。
- 補足は（）に入れます。画面の文言、引用、言葉そのものを指すときは「」に入れます。「」の中でさらに括弧が要るときも「」を使います。
- 文末の補足は句点の前に置きます（「…直しました（#341）。」）。
- 並べるときは「、」を使います。中点（・）は2つの語を1組として扱うとき（停止・ミュート）にだけ使います。
- 画面の場所は「設定」→「ページ」→「項目」の形で書きます。

#### 和文と英数字の間

| 文書 | 書き方 |
|---|---|
| 利用者向け文書 | 和文と英数字の間を空けません（お使いのPCで動きます）。 |
| 開発者向け文書の新しいファイル | 空けません。 |
| 開発者向け文書の既存のファイル | そのファイルの書き方に合わせます。`AGENTS.md`は空ける書き方です。 |

数字と単位の記号の間は、[数字と単位](#数字と単位)の決まりに従います。

### 用語

画面に出る名前は`locales/ja.yml`が正本です。画面の言葉とコードの名前の対応は[用語集](../spec/glossary.md)にあります。この節の表は文書で言葉を選ぶときの決まりだけを書きます。

<!-- writing-exempt-start: 悪い例として避ける形を挙げている -->

| 使う言葉 | 使わない言葉 | 補足 |
|---|---|---|
| ASTAROT | VRCT-VOX（アプリの名前として） | リポジトリ名は `kein5/astarot` です。実行ファイル名、アプリID、保存先は[名称と識別子](../voice-stack/project-rename.md)の表記を使います。 |
| 利用者 | ユーザー（人を指すとき） | 「ユーザー名」「ユーザーサービス」のように外部の仕組みの名前に入っている語はそのまま書きます。 |
| テキスト読み上げ（TTS） | 音声合成 | 画面の機能名です。2回目からは「読み上げ」か「TTS」と書きます。 |
| 音声認識（ASR） | | 画面の機能名です。画面には「文字起こし」もあります。新しく書く文章では「音声認識」を使います。 |
| ボイスチェンジャー（RVC） | 声質変換（利用者向け文書で） | 画面の機能名です。開発者向け文書では「声質変換」も使います。 |
| チャット読み取り（OCR） | | 画面の機能名です。 |
| 字幕オーバーレイ | | VRの視界に会話を出す表示です。 |
| VR UI | VRパネル | 用語集の名前です。画面には両方があります。 |
| チャット入力の小窓 | クイックチャット | 開発者向け文書ではQuick Chatも使います。 |
| ホットキー | ショートカット | 「ショートカット」は、デスクトップ環境の機能（GlobalShortcuts portal）を指すときだけ使います。 |
| 既定、既定値 | デフォルト | 画面の「初期値に戻す」のような文言を引くときはそのまま書きます。 |
| ダウンロード | | インターネットからファイルを持ってくる操作を指します。 |
| 取得 | | 手に入れること全体を指します。ダウンロードのほかに、同意や検査を含むときに使います。 |
| オンにする、オフにする | 有効化する、無効化する（スイッチに対して） | 「有効にする」は、画面の文言が「有効にする」になっている項目を引くときに使います。 |
| 押す | クリックする、タップする | キーボードやVRのコントローラーで操作する人にも通じるからです。 |
| 選ぶ | 選択する（文の述語として） | 名詞の「選択」は使います。 |
| 停止、ミュート | | 製品の約束（`PRODUCT.md`）に関わる言葉なので言い換えません。 |
| マイク、スピーカー | | 相手の声を聞き取る機能は「スピーカー」です。 |
| 仮想マイク、仮想ケーブル | | |

<!-- writing-exempt-end -->

## 開発者向け文書

- 立場を決めてから書きます。設計の判断（ADR）、検証の記録、手順書は立場が違うので、1つの文書に混ぜません。
- 日付のある記録には書いた日付を入れます。「今回」「最新」「次工程」のような、書いた時点に頼る言葉を避け、日付か版で書きます。
- 専門用語は初めて出たところで説明するか、[用語集](../spec/glossary.md)へリンクします。用語を新しく作ったら用語集に足します。
- 同じことを2か所に書きません。正本を1つに決め、ほかからはリンクします。
- ファイルや関数の場所は、ファイル名と名前で書きます。行番号は変わるので書きません。
- 採用した方針と、提案や検討中の案を区別して書きます。ADRは状態の欄で示します。
- PRとIssueの本文は、目的、変更、検証、残っている課題の順に書きます。人の名前、担当、作業に使った環境は書きません。
- コードのコメントは、コードを読めば分かることを繰り返さず、理由と制約を書きます。

## 利用者向け文書

読み手は音声処理やプログラムの知識を持っていない人です。その人が読んで次に何をすればよいか分かることを目指します。

- です・ます体で書きます。「ございます」「いたします」「申し上げます」は使いません。
- 画面の文言は`locales/ja.yml`の表記のまま「」で引きます。
- 読み手のPCを「このPC」のように開発者の側から指しません。「お使いのPC」「ASTAROTを動かしているPC」「同じPC」と書きます。
- 内部の実装の名前（クレート、ライブラリ、エンドポイント、関数）は、利用者がすることに関わるときだけ書きます。
- できないこと、送るデータ、取得するファイルの大きさとライセンスは、具体的に書きます。
- 動作の速さや必要なメモリは、測った条件と一緒に書きます。どのPCでも同じ結果になるとは書きません。

### 言い換え表

利用者向け文書では、開発の言葉を次のように言い換えます。

| 開発の言葉 | 利用者向けの言葉 |
|---|---|
| このPC、手元のPC | お使いのPC、ASTAROTを動かしているPC |
| サイドカー、Rustの中核、バックエンド | ASTAROTの処理部分 |
| VRAM | GPUのメモリ |
| 推論 | 認識、変換、読み上げ（何をするかで選びます） |
| レイテンシ | 遅れ、遅延 |
| フォールバックする | 代わりに〜を使う |
| トグル | スイッチ |
| プロセス | プログラム |
| クラッシュする、落ちる | 異常終了する |
| 重み、weights | モデル、モデルのファイル |
| エンドポイント、IPC、要求、通知 | 書きません。利用者がすることに関わるときは画面の操作として書きます。 |
| `config.json` | 設定ファイル（ファイルを開く必要があるときだけ`config.json`と添えます） |

### 画面の文言（locales/ja.yml）

- 文言を足したり変えたりしたら、`locales/en.yml`と`locales/ja.yml`の両方を直します。
- 補間変数（`{{name}}`など）は日英で同じにします。語順を変えても、変数を消したり足したりしません。
- 訳せない文言を推測で埋めません。固有名詞、プロトコルの識別子、利用者が入力した文字は訳しません。
- i18nの品質ゲート（#515）が検査する項目は、そちらの決まりに従います。この文書はそれと食い違う決まりを足しません。
- ボタンとスイッチのラベルは、押すと何が起きるかが分かる短い言葉にします。同じ画面の中では形をそろえます。
- エラーとお知らせは起きたこと、分かるときはその原因、利用者がすることの順に書きます。
  - 例：「GPUのメモリが足りず、AI翻訳を開始できませんでした。設定の「翻訳」で処理デバイスをCPUにするか、ほかのGPUアプリを止めてください。」
- 確認の画面は尋ねることと、それをするとどうなるかを先に書きます。元に戻せないときはそう書き、やめる方法を残します。
- 長い日本語と狭いウィンドウで表示が崩れないかを確かめます（`DESIGN.md`）。

### リリースノート

構成、見出し、絵文字、内部の変更の書き方は[リリースノートの書式](../release-notes/README.md)が正本です。見出しの先頭の絵文字はこの文書の対象外です。本文にはこの文書の共通の決まりと利用者向けの決まりを当てはめます。読点を減らし、話題ごとに段落を分けます。

### 利用者向けのマニュアル（site/ja）

組み方は`DESIGN.md`の「The user guide (site/)」に従います。文章にはこの章の決まりを当てはめます。

## エージェントの報告文

報告に書く項目は`AGENTS.md`の「検証と完了の報告」が正本です。この章はその書き方を決めます。

- 結論を最初の1〜2文に書きます。終わったのか、止まっているのか、判断を待っているのかが最初に分かるようにします。
- 確かめたことと推測を分けて書きます。確かめていないことを「〜のはずです」で済ませず、「確かめていません」と書いて理由を添えます。
- 「完了しました」「直りました」は検証で確かめたときだけ書きます。
- 前置きと締めの定型（「承知しました」「いかがでしょうか」「ほかに何かあればお知らせください」）を書きません。 <!-- writing-exempt: 悪い例として避ける形を挙げている -->
- コマンドの出力は要点だけをコードブロックで引用します。長いログをそのまま貼りません。
- 件数、ファイル名、PRやIssueの番号は、数えたり確かめたりした結果を書きます。
- 判断を頼むときは、選択肢、それぞれの影響、推す案を添えます。判断に要らない質問はしません。
- 公開される文章（PR、Issue、コメント、リリースノート）には、人の名前、担当、作業に使った環境を書きません。
- 「今回」「先ほど」のような相対の言葉を公開される文章に残しません。日付、版、PRの番号で書きます。

## 書いたあとの確認

書き終えたらyomiyasuで推敲し、次の点を確かめます。形で確かめられる決まり（避ける表現の一部、表記、符号、用語）は、文章の検査（`tools/writing_gate/check.mjs`）が確かめます（[開発の手順](../development.md#文章の検査docswriting)）。次の点のうち、文書の立場、結論、論証、推敲の確かめは人が行います。

1. 文書の立場が決まっていて、文末がそろっているか
2. 結論が先にあり、段落の最初の文で話題が分かるか
3. 違うものを同じとまとめていないか。因果に仕組みを添え、主張が例の支える範囲に収まっているか
4. [避ける表現](#避ける表現)と、間を置くためだけの読点が残っていないか
5. 仮名、送り仮名、長音、数字、和文と英数字の間の書き方が文書の中でそろい、画面の文言が`locales/ja.yml`のとおりか
6. 推敲で主張、比重、言い切りの強さ、文の働きを変えていないか。元にない情報を足していないか
7. 公開される文章に、人の名前、担当、作業に使った環境が入っていないか

## 参考文献

- 文化審議会「公用文作成の考え方（建議）」2022-01-07。<https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/93651301_01.pdf>（2026-11-17参照）
  - 表記の基にしました。常用漢字と送り仮名、外来語、数字と符号、用語の言い換えと説明の付け方です。
- c-modernization-kit「日本語技術文書の文章規範」。<https://hondarer.github.io/c-modernization-kit/ja-details/html/docsfw/japanese-technical-writing-guideline.html>（2026-11-17参照）
  - 文の作法と推敲の型の基にしました。文書の立場と文末の統一、AIが書く文章に多い定型句と比喩の動詞、意味を変えない推敲、情報を書き足さないことです。
- 「japanese-tech-writing」（GitHub Gist、Unlicense）。<https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d>（2026-11-17参照）
  - 上の2つにない点だけを取り入れました。段落の書き方（段落の先頭で話題を示し、論を一方向に進める）、論証の厳密さ（違うものを同じとまとめない、因果に仕組みを添える、主張を例の範囲に絞る）、翻訳調の比喩と擬人化です。
