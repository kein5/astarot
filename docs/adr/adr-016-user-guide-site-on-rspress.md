---
date: 2026-11-20
status: accepted
era: rust-core
validity: current
implementation_status: pending
implementation_checked: 2026-11-20
evidence:
  - docs/adr/adr-016-user-guide-site-on-rspress.md
  - docs/design/site-redesign/README.md
  - docs/design/site-redesign/inventory.md
  - site/package.json
  - src-ui/logics/ui_configs.ts
---
# ADR-016: 利用者向けのサイトの土台を VitePress から Rspress（React）に替える

Status: 採用（2026-11-20）。サイトの再設計（PR #701）の決定のうち、「土台は VitePress のまま」と「部品は Vue で作る」だけを置き換える。ほかの決定は変えない。
Date: 2026-11-20
Decision owners: リポジトリの保守担当者
Related: PR #701、[サイトの再設計](../design/site-redesign/README.md)、[サイトの棚卸し](../design/site-redesign/inventory.md)、[ADR-010](adr-010-frontend-stack.md)、DESIGN.md の「Components」、Issue #680、PR #690

この ADR の「サイト」は、GitHub Pages で公開している利用者向けのガイドとマニュアル（`site/`）を指す。

## 1. Context（背景）

2026-11-19 の時点で、サイトは VitePress 1.6.4（Vue 3）で作っている。テーマには Vue の部品が約20あり、検索の画面は VitePress 1.6.4 の内部のファイルを import する写し（`LocalSearchBox.vue`、1,019 行）である。VitePress 1.6.4 は Vite 8 では各ページの `*.lean.js` を出さないので、サイトの Vite は 6 系に固定している（PR #690）。

PR #701 の再設計は、部品を shadcn/ui の設計にならった自前の部品で作り直し、色を DESIGN.md のトークンにそろえると決めた。そのときは土台を VitePress のままにし、部品を Vue で書く前提だった。

アプリの UI は React 18 で（ADR-010）、部品は shadcn/ui に寄せている（DESIGN.md の「Components」、Issue #680）。shadcn/ui は React で書かれている。サイトの部品を Vue で書くと、shadcn/ui の React のコードを Vue に読み替える手間が増え、部品の作り方の知見がアプリとサイトで別の枠組みに分かれる。

## 2. Decision（決定）

- サイトの土台を Rspress（React で書かれた静的サイトの生成器）に替える。2026-11-20 の時点の版は 2 系である。
- サイトの部品は React で書き、shadcn/ui の React のコードを DESIGN.md の読み替えの規則で写す。
- 次のことは変えない。PR #701 の決定と、外から参照される約束である。
  - 配布済みのアプリ、README、SUPPORT.md が開く URL（`/ja/…`、`/en/…` と節のアンカー。`src-ui/logics/ui_configs.ts`）
  - 日本語と英語の2言語、本文の全文検索、develop から GitHub Pages への公開
  - 色は DESIGN.md のトークンを使うこと、ガイドとマニュアルを1つにすること、`/manual/` を転送のページにすること、マスコットの素材の正本を `docs/brand/astarot/mascot/` に置くこと

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| VitePress のまま、部品を Vue で作る（PR #701 の前提） | 日英、検索、公開はそのまま使い、部品だけを Vue で作り直す | shadcn/ui の React のコードを Vue に読み替える手間が部品ごとに掛かり、アプリの部品の知見をサイトで使えない。Vite 8 に上げるには、別に VitePress 2（2026-11-19 の時点で alpha）への移行が要る |
| VitePress のまま、shadcn-vue を入れる | shadcn/ui の Vue 版の部品を入れる | 再設計を始めたときに入れないと決めていた。shadcn/ui そのものではなく、別の実装（Reka UI）の上の部品が正本になる |

## 4. Consequences（影響）

得るもの

- サイトの部品で、shadcn/ui の React の部品を直接の参考にでき、アプリの部品と同じ考え方で書ける。
- VitePress の検索の写しと、VitePress 1.6.4 による Vite の固定がなくなる。Rspress は Rsbuild（Rspack）でビルドする。

負担とリスク

- 移行の作業が要る。Vue の部品を React に書き直す。Rspress は `.md` の中の部品を描かないので、部品を使うページを `.mdx` にし、Vue の書き方（`v-slot`、`{.needs}`、`[[toc]]`）を置き換える。検索の検査（`tools/check_site_search.mjs`）を Rspress の索引で作り直す。
- Rspress は既定の言語のページを接頭辞なしで出す。`/ja/` と `/en/` を両方保つには、`/`（言語を選ぶページ）だけを受け持つ既定の言語を置く必要がある。2026-11-20 に Rspress 2.1.3 で、既定の言語を `mul` にすると `/ja/…` と `/en/…` がそのまま出ることを確かめた。
- 検索の画面は Rspress のものになる。今の写しが足した機能（何も入力していないときのページの一覧）はなくなる。
- React の版がアプリ（18）とサイト（Rspress 2 が求める 19）で違う。アプリの部品をそのままサイトで使うには、この差に加えて、スタイルの書き方（アプリは vanilla-extract）と rem の大きさ（アプリは 10px、サイトは 16px）の差を埋める必要がある。

移行の方針

- 土台の移行は1つの段にまとめ、URL、節のアンカー、日英、検索、公開を保ったまま替える。見た目と部品の作り直しは、サイトの再設計の段のとおり後の段で行う（[サイトの再設計](../design/site-redesign/README.md)の5章）。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

| 観点 | 確かめること | 方法 |
|---|---|---|
| URL | 配布済みのアプリ、README、SUPPORT.md が開く URL とアンカーが、移行の前と同じページと節を開く | ビルドした HTML のパスと見出しの id の一覧を移行の前と比べる。`tools/check_site_anchors.mjs` |
| 検索 | 日本語の文の途中の語と、英語の語で引ける | Rspress の索引を読む `tools/check_site_search.mjs` |
| 言語 | 各ページの `<html lang>` が `ja` か `en` で、日英のページが互いを `hreflang` で指す | ビルドした HTML |
| 公開 | develop へのマージで GitHub Pages に公開される | `.github/workflows/pages.yml` |

## 6. Revisit triggers（見直す条件）

- Rspress の開発が止まるか、GitHub Pages に置ける静的な出力を作れなくなったとき。
- 既定の言語を `/` だけに置く方法が、Rspress の版を上げて使えなくなったとき。
- アプリの UI が React から別の枠組みに移るとき（ADR-010 の見直し）。

## 7. 未決のこと

- 部品のスタイルの書き方（CSS Modules か vanilla-extract か）と、アプリの `src-ui/views/kit/` の部品をサイトと共有するか。サイトの再設計の段4で決める。
- 移行で使う Rspress の版、`/manual/` を移行の段で転送にするか、Markdown の囲みの書き方。移行の PR で決める。
