---
name: adr
description: Steps for writing, reading, updating and superseding ASTAROT's architecture decision records (ADRs, docs/adr). Use when a design choice has been made ("A or B?" → "B"), when you decide to drop an option, when a change disagrees with an ADR, when asked to "make this an ADR" or "record what we decided", when fixing an ADR's status, validity or implementation_status, or when superseding an ADR. Not for the reason behind one piece of code (a comment), a feature's spec (docs/spec), work steps (a skill) or the rules for all work (AGENTS.md). ASTAROTの設計判断の記録（ADR、docs/adr）を書く、読む、更新する、置き換える手順。設計の選択が決まったとき（「AとBどっちにする？」→「Bで」）、ある案をやめると決めたとき、変更がADRと食い違うとき、「ADRにして」「決めたことを記録して」と頼まれたとき、ADRのstatus・validity・implementation_statusを直すとき、ADRを置き換える（supersede）ときに使う。1つのコードの理由（コメント）、機能の仕様（docs/spec）、作業の手順（スキル）、すべての作業の決まり（AGENTS.md）には使わない。
---

# Design decision records (ADRs)

[日本語版](#設計判断の記録adr日本語版)

An ADR records the reasons for a decision that reading the code does not reveal. It says what was decided, which other options there were and why they were not taken. The authoritative copies are in `docs/adr/` only, and the index is `docs/adr/README.md`. The authority on the meanings of the fields and values is "Fields and values" in the index, and this skill covers only the steps.

ADRs are published. Do not write people's names, who was in charge or details of the development environment. Write who decided by role, as in `Decision owners: the repository maintainers`.

## 1. Decide whether it needs an ADR

Write an ADR when all three of the following hold.

- The decision is hard to reverse. Reversing it changes the formats of settings or files, the IPC and OSC contracts, storage locations or identifiers, the release package, how licenses are handled or the behavior of several features.
- Someone who does not know the reason would want to change it. This covers decisions where a person who reads only the code would likely think another form is better.
- It is a choice that was actually made. There were other options, and they were compared.

A decision not to do something is also an ADR (ADR-009 decides not to bundle a virtual microphone driver). Write what does not meet the conditions in these places.

| Content | Where to write it |
|---|---|
| The reason for one piece of code, a library's quirks | A comment in that code |
| How a feature behaves, the IPC and OSC contracts, data formats | `docs/spec/` |
| The look and operation of screens | `DESIGN.md` |
| The product's purpose and the features it must keep | `PRODUCT.md` |
| Work steps | A skill (`skills/`) |
| Rules that all work follows | `AGENTS.md` |
| Records of research and verification, implementation plans | Issues, pull requests, the records in `docs/voice-stack/` |

When a decision made in the conversation meets the conditions, say that you will write it as an ADR, then write it. Put a decision made before the implementation in a pull request with only the ADR, and a decision made together with the implementation in the same pull request as the implementation.

## 2. Write a new ADR

1. Look up the last number in the index's list and use the next one. Numbers are never reused. If a parallel branch takes the same number, `--check` stops it, so change the number on the side that is not merged yet.
2. Copy `docs/adr/TEMPLATE.md` to create `docs/adr/adr-NNN-<short English name>.md`. For the name, join English words that tell what was decided with hyphens (`adr-013-secret-store.md`). Do not rename the file after it is merged.
3. Make the heading `# ADR-NNN: <the decision in one sentence>`, and delete the quote on how to use the template.
4. Fill in the front matter.
   - Set `date` and `implementation_checked` to the day you write it.
   - `era` is the setup at the time of writing. For an ADR written now, it is `rust-core`.
   - Set `status` to `proposed`. When the maintainers decide to adopt it, set `accepted`, and write the date of the decision and where it was made (such as the record of the decision in an issue) in the Status line of the body.
   - Set `validity` to `current`.
   - Keep `implementation_status` at `pending` or `unknown` until you have checked the implementation. Do not set `implemented` just because you set `accepted`.
   - In `evidence`, list this ADR's own path and the files that support the values.
   - Set any value you have not checked to `unknown`, and do not fill it in with a guess.
5. Write the body in the template's sections (Context, Decision, Alternatives considered, Consequences, Verification / Acceptance criteria, Revisit triggers, Open questions). For the rules of the text (where references go, facts and evidence, how fine-grained a decision is, writing), follow the [ADR authoring guideline](../../docs/adr/authoring.md).
6. Regenerate the index table with `python tools/adr_catalog.py --write` (`mise run adr`), and add one paragraph to "Summary of each ADR" in the index.
7. Run `python tools/dev.py check` and confirm that `adr_catalog.py --check` in `tooling` passes. It checks for duplicate numbers, the fields and values, the `evidence` paths, links and a stale index.

## 3. Keep one decision per file, and keep it short

- Write only one decision in a file. If there are two or more decisions, split them into separate ADRs.
- Write only what the code does not tell. Do not write lists of files, implementation steps, how pull requests are split, copies of APIs or the course of research. Put those in issues, pull requests, `docs/spec/` and `docs/voice-stack/`, and link to them from the ADR.
- Under the alternatives considered, list only the options that were actually compared. Do not list an option that was only named in a conversation. For why an option was not taken, give reasons that still hold.
- Write the premises at the time of writing (version, OS, backend layout) in the body. This lets later readers tell which period the decision belongs to.
- Give measured values with the conditions of the measurement (model, OS, kind of GPU, date).
- Summarize what can be summarized, to keep it short. Of the background and how the options were considered, keep only the facts that are reasons for the decision.
- If it grows long, check whether two decisions are mixed in, or whether it contains steps or records.

## 4. Update the state

The body is a record of the time of writing, so do not rewrite it. Show what changed later in the front matter and in a dated note added at the top of the body. For the form of the note, see the "Status note" in ADR-003.

`status` and `validity` are separate axes. `status` says whether the decision was adopted, and `validity` says whether the decision still holds. ADR-003 has `validity: replaced` while it stays at `status: accepted`.

| What changed | What to update |
|---|---|
| The implementation moved forward, or you checked the implementation | `implementation_status`, `implementation_checked` (the day you checked), `evidence` (the files you checked). For `partial`, write what remains in `implementation_note` |
| The principle of the decision holds, but how it is implemented (language, process layout, APIs and so on) changed | `validity: implementation_changed` and `validity_note` |
| The maintainers decided to adopt, reject or deprecate it | Set `status` to `accepted`, `rejected` or `deprecated`, and add a note at the top of the body |
| A later ADR replaced the decision | The steps in 5 |

Change `status` only when the maintainers have decided so. After a change, regenerate the index with `python tools/adr_catalog.py --write`.

## 5. Replace a decision (supersede)

To change a decision, write a new ADR and do not rewrite the old one. Put the new ADR and the old ADR's front matter and note in the same pull request.

1. Write the new ADR by the steps in 2. In `Related` and in the context of the body, write the old ADR it replaces, and what changes and why.
2. Update the old ADR's front matter.
   - Set `validity: replaced`.
   - Under `superseded_by:`, write the new ADR in the form `  - ADR-NNN`.
   - In `validity_note`, write what changed and what the new ADR took over.
   - Set `status: superseded` only when the maintainers have decided to replace the old decision. When a later ADR has only taken over the decision in practice, do not change `status` (ADR-003 is an example).
3. Add a dated note at the top of the old ADR's body, and link it to the new ADR. Do not rewrite the body below the note.
4. Regenerate the index with `python tools/adr_catalog.py --write`. `--check` checks how `superseded_by` is written and that the ADRs it names exist.
5. If `AGENTS.md`, `docs/spec/` or a skill cites the old ADR as its basis, point it to the new ADR in the same pull request.

How to write a replacement of only part of a decision has not been decided yet. In that case, write it in "Decisions needed" in the pull request, and have the maintainers decide.

## 6. Read ADRs

- Before you change behavior, look for the related ADRs in the index's list. When you read one, look at the era (時代, `era`) and the validity (有効性, `validity`) first.
- If `validity` is `replaced`, read the ADR in `superseded_by`.
- An ADR with `status: proposed` is not an adopted decision.
- An ADR with `era: python-sidecar` may describe the implementation by Python module names or `src-python/` paths. `src-python/` was removed in 0.6.0, so read those paths at a 0.5.x tag. Look up the current implementation in the mapping table in the README of each crate in `native/`.
- When a change disagrees with an ADR that has `status: accepted` and a `validity` of `current` or `implementation_changed`, tell the maintainers which decision of which ADR it disagrees with before you go on. When you go on in a pull request, write it in "Decisions needed" in the description.

## 7. Fixes that do not change a decision

Put changes that do not change the substance of a decision, such as moving files, correcting the front matter or fixing links, in a separate pull request from changes that do.

---

# 設計判断の記録（ADR）（日本語版）

ADRはコードを読んでも分からない判断の理由を残す記録です。何を決めたか、ほかにどの案があり、なぜ採らなかったかを書きます。正本は`docs/adr/`だけにあり、索引は`docs/adr/README.md`です。項目と値の意味は索引の「項目と値」が正本で、このスキルには手順だけを書きます。

ADRは公開物です。人の名前、担当者、開発環境の情報を書きません。決めた人は`Decision owners: リポジトリの保守担当者`のように役割で書きます。

## 1. ADRにするかを決める

次の3つがそろうときにADRを書きます。

- 戻しにくい判断です。戻すと、設定やファイルの形式、IPCとOSCの契約、保存先や識別子、配布物、ライセンスの扱い、複数の機能の動きが変わります。
- 理由を知らないと直したくなる判断です。コードだけを読んだ人が別の形のほうがよいと考えそうなものが当たります。
- 実際に選んだ判断です。ほかの案があり、比べています。

「やらない」と決めたこともADRになります（ADR-009は仮想マイクのドライバーを同梱しないと決めています）。条件がそろわないものは次の場所に書きます。

| 中身 | 書く場所 |
|---|---|
| 1つのコードの理由、ライブラリの癖 | そのコードのコメント |
| 機能の振る舞い、IPCとOSCの契約、データ形式 | `docs/spec/` |
| 画面の見た目と操作 | `DESIGN.md` |
| 製品の目的と守る機能 | `PRODUCT.md` |
| 作業の手順 | スキル（`skills/`） |
| すべての作業が守る決まり | `AGENTS.md` |
| 調査や検証の記録、実装の計画 | Issue、PR、`docs/voice-stack/`の記録 |

会話の中で決まった判断が条件に当たるときは、ADRに書くことを伝えてから書きます。実装より前に決まった判断はADRだけのPRにし、実装と一緒に決まった判断は実装と同じPRに入れます。

## 2. 新しいADRを書く

1. 索引の一覧で最後の番号を見て、その次の番号を使います。番号は使い直しません。並行するブランチと番号が重なったら`--check`が止めるので、まだマージしていない側の番号を変えます。
2. `docs/adr/TEMPLATE.md`を写して`docs/adr/adr-NNN-<英語の短い名前>.md`を作ります。名前は決めたことが分かる英語の語をハイフンでつなぎます（`adr-013-secret-store.md`）。マージしたあとはファイル名を変えません。
3. 見出しを`# ADR-NNN: <決めたことを一文で>`にし、テンプレートの使い方の引用を消します。
4. front matterを埋めます。
   - `date`と`implementation_checked`は書いた日にします。
   - `era`は書いた時点の構成です。いまのADRは`rust-core`です。
   - `status`は`proposed`にします。保守担当者が採用を決めたら`accepted`にし、本文のStatus行に決めた日と決めた場所（Issueの決定の記録など）を書きます。
   - `validity`は`current`にします。
   - `implementation_status`は実装を確かめるまで`pending`か`unknown`にします。`accepted`にしただけで`implemented`にしません。
   - `evidence`にはこのADR自身のパスと、値の裏付けにしたファイルを書きます。
   - 確かめていない値は`unknown`にし、推測で埋めません。
5. 本文はテンプレートの節で書きます（背景、決定、検討した案、影響、検証と受け入れの条件、見直す条件、未決のこと）。文面の規約（参照の置き場所、事実と根拠、決定の粒度、表記）は[ADRの執筆ガイドライン](../../docs/adr/authoring.md)に従います。
6. `python tools/adr_catalog.py --write`（`mise run adr`）で一覧の表を作り直し、索引の「各 ADR の要約」に1段落を足します。
7. `python tools/dev.py check`を実行し、`tooling`の`adr_catalog.py --check`が通ることを確かめます。番号の重複、項目と値、`evidence`のパス、リンク、一覧の古さを調べます。

## 3. 1件1ファイルで短く保つ

- 1つのファイルには判断を1つだけ書きます。判断が2つ以上あるなら、ADRを分けます。
- 書くのはコードから分からないことだけです。ファイルの一覧、実装の手順、PRの分け方、APIの写し、調査の経過は書きません。それらはIssue、PR、`docs/spec/`、`docs/voice-stack/`に置き、ADRからリンクします。
- 検討した案には実際に比べた案だけを書きます。会話で名前が出ただけの案は書きません。採らなかった理由にはいまも変わらない理由を書きます。
- 書いた時点の前提（版、OS、バックエンドの構成）を本文に書きます。後から読む人がどの時期の判断かを判別できるようにするためです。
- 計測した値には計測の条件（モデル、OS、GPUの種類、日付）を添えます。
- 要約できるところは要約して短くします。背景や検討した案の経過は、判断の理由になる事実だけを残します。
- 長くなったら、判断が2つ混ざっていないか、手順や記録が入っていないかを見直します。

## 4. 状態を更新する

本文は書いた時点の記録なので書き換えません。後から変わったことは、front matterと、本文の冒頭に足す日付つきの注記で示します。注記の形はADR-003の「状態の注記」を見ます。

`status`と`validity`は別の軸です。`status`は判断を採用したかどうか、`validity`はその判断がいまも当てはまるかを表します。ADR-003は`status: accepted`のまま`validity: replaced`になっています。

| 変わったこと | 直すところ |
|---|---|
| 実装が進んだ、実装を確かめた | `implementation_status`、`implementation_checked`（確かめた日）、`evidence`（確かめたファイル）。`partial`なら`implementation_note`に残りを書く |
| 判断の原則は有効で、実装の方式（言語、プロセスの構成、APIなど）が変わった | `validity: implementation_changed`と`validity_note` |
| 保守担当者が採用、不採用、廃止を決めた | `status`を`accepted`、`rejected`、`deprecated`にし、本文の冒頭に注記を足す |
| 後続のADRが判断を置き換えた | 5の手順 |

`status`を変えるのは保守担当者がそう決めたときだけです。直したら`python tools/adr_catalog.py --write`で一覧を作り直します。

## 5. 判断を置き換える（supersede）

判断を変えるときは、古いADRを書き換えずに新しいADRを書きます。新しいADRと、古いADRのfront matterと注記は同じPRに入れます。

1. 新しいADRを2の手順で書きます。本文の`Related`と背景に、置き換える古いADRと、何をなぜ変えるかを書きます。
2. 古いADRのfront matterを直します。
   - `validity: replaced`にします。
   - `superseded_by:`の下に、新しいADRを`  - ADR-NNN`の形で書きます。
   - `validity_note`に、何が変わり、新しいADRが何を引き継いだかを書きます。
   - 保守担当者が古い判断を置き換えると決めたときだけ`status: superseded`にします。後続のADRが判断を実際に引き継いだだけのときは`status`を変えません（ADR-003がこの例）。
3. 古いADRの本文の冒頭に日付つきの注記を足し、新しいADRへリンクします。注記の下の本文は書き換えません。
4. `python tools/adr_catalog.py --write`で一覧を作り直します。`--check`は、`superseded_by`の書き方と、名前を挙げたADRがあることを確かめます。
5. `AGENTS.md`、`docs/spec/`、スキルが古いADRを根拠に書いていたら、同じPRで新しいADRへ直します。

判断の一部だけを置き換えるときの書き方はまだ決まっていません。そのときはPRの「判断が要ること」に書いて、保守担当者に決めてもらいます。

## 6. ADRを読む

- 振る舞いを変える前に、索引の一覧で関係するADRを探します。読むときは先に「時代」（`era`）と「有効性」（`validity`）を見ます。
- `validity`が`replaced`なら、`superseded_by`のADRを読みます。
- `status: proposed`のADRは採用した判断ではありません。
- `era: python-sidecar`のADRは実装をPythonのモジュール名や`src-python/`のパスで書いていることがあります。`src-python/`は0.6.0で消したので、そのパスは0.5.xのタグで読みます。いまの実装は`native/`の各クレートのREADMEにある対応表で引きます。
- 変更が、`status: accepted`で`validity`が`current`か`implementation_changed`のADRと食い違うときは、進める前に、どのADRのどの判断と食い違うかを保守担当者に伝えます。PRで進めるときは、本文の「判断が要ること」に書きます。

## 7. 判断を変えない修正

ファイルの移動、front matterの訂正、リンクの修正のように判断の内容を変えない変更は、判断の内容を変える変更とは別のPRにします。
