# ADR authoring guideline

[日本語版](#adr-執筆ガイドライン日本語版)

These are the rules for writing an ADR in `docs/adr/` of ASTAROT. They take the method of the source article (Zenn, tokium_dev's ADR authoring guideline) and adjust it to ASTAROT's existing practice.

## Purpose of this guideline

An ADR records the reasons for a decision that reading the code does not tell you. ADRs are often written by AI sessions, and without one place that sets the standard for their text, the same comments come back in review again and again.

This guideline gives the people who write and the people who review the same standard to refer to. Each rule has an ID and a strength. There are two strengths: MUST (the rule has to be met) and SHOULD (the rule is met as a principle; when it is not, the reason can be explained).

## A. Where references go

- A-1 (MUST): Gather references to issues, pull requests, related ADRs and related documents in Related at the top and in `evidence` in the front matter. Do not list references in the flow of the body.

- A-2 (MUST): When the body points to a decision of another ADR, give the item number and the section title together, in the form "ADR-012, Decision, item 6.1 (section title)". Do not point with a line number or with "above" or "as mentioned earlier" alone.

- A-3 (SHOULD): When the body mentions an issue or a pull request, add a few words on what it is, not only its number. A number alone means nothing where the link cannot be followed.

## B. Facts and evidence

- B-1 (MUST): Check the facts that Context takes as given against primary sources, such as the actual code, official documents and measurement records, and write them so that their source and the date they were checked can be traced. Do not rest them only on what was confirmed in a conversation or a meeting.

- B-2 (MUST): Make an ADR readable on its own. In Context, write the problem that actually occurs in this project and why the decision is made now. Do not end in general, hypothetical terms.

- B-3 (MUST): Do not fill an unchecked value with a guess. Use `unknown`, as the existing rule for the front matter says, and say in the body too that it has not been checked.

## C. How fine-grained a decision is

- C-1 (MUST): Do not write migration plans, work progress, task tables or the state of each ticket in an ADR. They go in issues, pull requests and the records in `docs/voice-stack/`. What an ADR keeps goes as far as the properties that have to hold during a migration.

- C-2 (MUST): Keep the Decision at a grain that leaves the implementation free. The question to ask is: "If the chosen way of implementing it were replaced by another, would the ADR's text have to be rewritten?" A statement that would have to be rewritten belongs in a specification or a pull request description. Do not write method names, environment variable names, or steps of matching and normalizing in an ADR.

- C-3 (SHOULD): Write the scope the decision applies to and, when there are exceptions, the conditions under which they lapse. This is needed especially in an exception ADR such as ADR-019.

- C-4 (MUST): Put what has not been decided in the template's "7. Open questions", and name where it will be decided. Do not name a place to hand it to that does not exist.

- C-5 (SHOULD): When Context lists the current implementation, keep the list to what the decision needs as a premise. The authoritative inventory of the implementation is the records in `docs/voice-stack/`.

## D. Consistency between ADRs and with the index

- D-1 (MUST): Show changes of state in the front matter and the index, and do not rewrite the body (a restatement of the existing rule). When a decision changes, write a new ADR and update `validity` and `superseded_by` of the old ADR.

- D-2 (MUST): When you finish writing, regenerate the index and pass the ADR check (as in the existing steps).

## E. Writing

- E-1 (MUST): The title states what was decided in one sentence (the template's existing rule). English is the authoritative version, and the Japanese version comes after it.

- E-2 (MUST): An ADR is public. Do not write people's names, who was in charge or details of the development environment. Write who decided by role (a restatement of the existing rule).

- E-3 (SHOULD): Do not put information that goes stale quickly, such as the date of the last update, in the body. The authoritative dates are `date` and `implementation_checked` in the front matter.

## Examples of OK and NG (all made up)

An example for C-1.

NG (the body holds progress that goes stale once it is done):

```
- [x] Added it to the test build
- [ ] Bring it into the packages by next week
```

OK:

```
During the migration, both the old format and the new format must be readable.
```

An example for C-2.

NG (it takes on the details of the implementation):

```
The check sits in `ConfigStore.save()`, and compares with the list given in the environment
variable `APP_XXX` (comma-separated) after normalizing both with trim and lower case.
```

OK:

```
When a setting is missing, fall on the side that stops, not on the side that runs.
```

---

# ADR 執筆ガイドライン（日本語版）

ASTAROT の `docs/adr/` に ADR を書くときの規約です。元記事（Zenn、tokium_dev の ADR authoring guideline）の方法を取り入れ、ASTAROT の既存運用に合わせて直しました。

## このガイドラインの目的

ADR は、コードを読んでも分からない判断の理由を残す記録です。書き手が AI セッションであることが多いため、文面の基準が 1 か所に無いと、レビューで同じ指摘が繰り返されます。

このガイドラインは、書く側とレビューする側が同じ基準を参照できる状態を作るためのものです。規約には ID と強度を付けます。強度は MUST（満たさなければならない）と SHOULD（原則として満たす。外す場合は理由を説明できる状態にする）の 2 段階です。

## A. 参照の置き場所

- A-1（MUST）: Issue、PR、関連 ADR、関連文書への参照は、冒頭の Related と front matter の evidence に集約する。本文の流れの中で参照先を列挙しない。

- A-2（MUST）: ほかの ADR の決定を本文で指すときは「ADR-012 の Decision 項 6.1（章題）」の形で、項番号と章題を併記する。行番号や「上記の」「前述の」だけで指さない。

- A-3（SHOULD）: 本文で Issue や PR に触れるときは、番号だけでなく内容を一言添える。番号だけでは、リンク先が読めない環境で意味が取れないためです。

## B. 事実と根拠

- B-1（MUST）: Context に書く前提事実は、実コード、公式文書、計測記録などの一次資料と照合し、出典と確認日が追える形にする。会話や会議で確認したことだけを根拠にしない。

- B-2（MUST）: ADR 単体で読めるようにする。Context には、このプロジェクトで実際に起きている問題と、なぜ今決めるのかを書く。一般論の仮定形で終わらせない。

- B-3（MUST）: 確かめていない値は推測で埋めない。front matter の既存ルールどおり unknown とし、本文でも未確認であることを明記する。

## C. 決定の粒度

- C-1（MUST）: 移行計画、作業の進捗、タスク表、チケットごとの状態を ADR に書かない。それらは Issue と PR と `docs/voice-stack/` の記録に置く。ADR に残すのは、移行期間中に守る必要がある性質までです。

- C-2（MUST）: Decision を、実装の自由度を奪わない粒度にする。判定の問いは「決めた実現方式を別の方式へ置き換えたとき、ADR 本文を書き換える必要があるか」です。書き換えが必要になる記述は、仕様書か PR の説明に属します。メソッド名、環境変数名、照合や正規化の手順は ADR に書かない。

- C-3（SHOULD）: 決定の適用範囲と、例外がある場合はその失効条件を書く。ADR-019 のような例外の ADR では特に必要です。

- C-4（MUST）: 決めていないことは、テンプレートの「7. Open questions」に置き、どこで決めるかを名指しする。名指しした委譲先が実在しない書き方をしない。

- C-5（SHOULD）: Context に現行実装の一覧を書くときは、決定の前提として要る範囲に絞る。実装の棚卸し自体は `docs/voice-stack/` の記録が正本です。

## D. ADR 同士と索引の整合

- D-1（MUST）: 状態の変化は front matter と索引で表し、本文は書き換えない（既存ルールの再確認）。決定が変わったら新しい ADR を書き、古い ADR の validity と superseded_by を更新する。

- D-2（MUST）: 書き終えたら索引を作り直し、adr のチェックを通す（既存手順どおり）。

## E. 表記

- E-1（MUST）: 題名は、決めたことを一文で表す（テンプレートの既存ルール）。英語を正本とし、日本語版を後ろに置く。

- E-2（MUST）: ADR は公開物です。人の名前、担当者、開発環境の情報を書かない。決めた人は役割で書く（既存ルールの再確認）。

- E-3（SHOULD）: 最終更新日のような、陳腐化しやすい情報を本文に置かない。日付は front matter の date と implementation_checked が正本です。

## OK／NG 例（すべて作例）

C-1 の例です。

NG（完了すれば陳腐化する進捗を本文に持つ）:

```
- [x] 試験ビルドへ導入した
- [ ] 来週までに配布物へ反映する
```

OK:

```
移行期間中は、旧形式と新形式の両方を読める必要がある。
```

C-2 の例です。

NG（実装の詳細まで抱え込む）:

```
判定は `ConfigStore.save()` に置き、環境変数 `APP_XXX`（カンマ区切り）で
与えられた一覧と、trim と小文字化で正規化してから照合する。
```

OK:

```
設定漏れのときは、動く側ではなく止まる側に倒す。
```
