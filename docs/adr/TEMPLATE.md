---
date: 2026-01-01
status: proposed
era: rust-core
validity: current
implementation_status: pending
implementation_checked: 2026-01-01
evidence:
  - docs/adr/TEMPLATE.md
---
# ADR-NNN: 決めたことを一文で書いた題名

Decision owners: リポジトリの保守担当者
Related: Issue、プルリクエスト、関係する ADR と文書へのリンク

> **このテンプレートの使い方**（ADR を作ったら、この引用ごと消す）
>
> - ファイルは `docs/adr/adr-NNN-<英語の短い名前>.md`。番号は[一覧](README.md)の最後の次にする。見出しの番号もそろえる。
> - front matter の `date` と `implementation_checked` は書いた日にする。`evidence` には、この ADR 自身のパスと、値の裏付けにしたファイルを書く。
> - `status` は採用を決めるまで `proposed` にする。採用したら `accepted` にし、`implementation_status` は実装を確かめてから変える。採用しただけで `implemented` にしない。
> - 確かめていない値は `unknown` にし、推測で埋めない。項目と値の意味は[索引](README.md#項目と値)にある。
> - 書き終えたら `python tools/adr_catalog.py --write` で一覧を作り直す。
> - 本文には、書いた時点の前提（版、OS、ランタイム、バックエンドの構成）を書く。後から読む人が、どの時期の判断かを判別できるようにする。

## 1. Context（背景）

何が問題で、なぜいま決めるのか。前提にした構成と、その時点の実装を書く。

## 2. Decision（決定）

決めたこと。守る性質や、変えないものも書く。

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| | | |

## 4. Consequences（影響）

得るもの、負担とリスク、移行の方針。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

| 観点 | 確かめること | 方法 |
|---|---|---|
| | | |

## 6. Revisit triggers（見直す条件）

この判断を見直すとき。

## 7. 未決のこと

決めていないことと、決める場所。
