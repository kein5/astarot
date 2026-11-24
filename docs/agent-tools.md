# Tools agents use

[日本語版](#エージェントが使う道具日本語版)

This document lists which tools the agents working in this repository use, and in which situations. Each entry gives only three things: what the tool does, when to use it and the authoritative source for its rules. The rules themselves are in those sources and are not copied here. When a source and this document disagree, follow the source.

The tools fall into two groups.

- Recommended: tools with a track record, used whenever the work calls for them
- On trial: tools that have been tried, where full adoption is not yet decided

How to install the tools and how to set up their connections differ from one working environment to another, so this document does not cover them.

## Recommended

### impeccable for UI audits

- What it does: audits and critiques the UI. It finds problems in the look, the operation and the accessibility.
- When to use it: when you build, fix or finish screens (`src-ui/`) or the user-facing site. Audit the current state before a change, and critique the result after it.
- Source: [DESIGN.md](../DESIGN.md) and the `.impeccable/` settings (`config.json` holds the detection exclusions, `design.json` the design system). When you exclude something from detection, write the reason in `config.json`.

### unslop for removing an AI-made look

- What it does: finds and removes a look that seems AI-made. Targets include purple gradients, glows, gradient text, emoji labels and uneven spacing.
- When to use it: to finish UI work, together with the impeccable audit.
- Source: [DESIGN.md](../DESIGN.md). When unslop's suggestions and DESIGN.md disagree, follow DESIGN.md.

### Nielsen's 10 usability heuristics

- What it is: Jakob Nielsen's 10 usability heuristics (the system status is visible, users can undo an action, and so on). One of the viewpoints for evaluating a UI.
- When to use it: in a UI audit, as a viewpoint alongside impeccable. Say which heuristic each finding falls under.
- Source: the rules for operation and behavior are in [DESIGN.md](../DESIGN.md) and [PRODUCT.md](../PRODUCT.md). The heuristics are a viewpoint and do not replace those rules.

### humanizer and yomiyasu

- What they do: revise text. Use humanizer for English and yomiyasu for Japanese.
- When to use them: when you finish writing text that people read, such as documents, UI text, release notes and pull request descriptions.
- Source: [docs/writing/english-guideline.md](writing/english-guideline.md) for English and [docs/writing/japanese-guideline.md](writing/japanese-guideline.md) for Japanese. When a tool's findings and the writing rules disagree, follow the writing rules.

### Cua Driver on a real Windows machine

- What it does: on a real Windows machine, reads the structure of the app's screens (the accessibility tree) and operates it. It can read setting values and what is shown without bringing the window to the front or taking the focus.
- When to use it: in verification on the real app, to confirm that setting values take effect and what the screens show. It is not for the inside of the VR UI.
- Source: no document yet collects the steps for tests on a real Windows machine. Report as "Verification and completion reports" in [AGENTS.md](../AGENTS.md) says. GUI tests on a real Linux machine are covered in [docs/voice-stack/linux-build-pipeline.md](voice-stack/linux-build-pipeline.md). Do not copy conversation text or audio content that you read into records or reports.

### Mermaid diagrams

- What it is: diagrams written inside Markdown. GitHub shows them as they are.
- When to use it: when you present a proposed or actual change to the architecture as the connections between components or as the flow of processing.
- Source: follow the style of the diagrams in the developer specification ([docs/spec/overview.md](spec/overview.md), [docs/spec/sequences.md](spec/sequences.md)). How to choose a diagram for the specification is in [docs/spec/README.md](spec/README.md).

### Mutation testing

- What it does: puts small deliberate changes (mutants) into the code and checks whether the tests fail. It measures whether the tests do find defects. The UI side uses [@mizchi/mutator](https://www.npmjs.com/package/@mizchi/mutator), and the Rust side uses [cargo-mutants](https://mutants.rs/).
- When to use it: for a pull request that changes UI logic or the `src/` of a Rust crate, running `mise run mutation:changed` (which runs only what you changed) is recommended but not required. Run the whole set before a stable release. CI does not run it.
- Source: when to run it, how to write it up in a pull request and where to keep the results are in "When to run mutation testing" (ミューテーションテストを回す場面) in [docs/development.md](development.md). The steps and how to read the results are in the sections "Mutation testing for the UI" (UIのミューテーションテスト), "Rust coverage and mutation testing" (Rustのカバレッジとミューテーションテスト) and "Mutation testing for changed code" (変えた所のミューテーションテスト) of the same document. The background is in [Issue #550](https://github.com/kein5/astarot/issues/550). When you report results, give the scope covered and the conditions of the measurement, and do not present the score as a guarantee of quality.

## On trial

None at the moment.

---

# エージェントが使う道具（日本語版）

このリポジトリで作業するエージェントが、どの場面でどの道具を使うかをまとめます。どの項目も「何をする道具か」「いつ使うか」「決まりの正本」の3点だけを書きます。決まりそのものは正本にあり、ここには写しません。正本とこの文書が食い違うときは、正本に従います。

道具は2つに分けます。

- 推奨: 使った実績があり、該当する作業では使うもの
- 試行中: 試した実績はあるが、本格的に導入するかは決まっていないもの

道具の導入方法や接続の設定は、作業する環境ごとに違うので、ここには書きません。

## 推奨

### impeccable

- 何をする: UIの監査と批評。見た目、操作、アクセシビリティの問題を洗い出す。
- いつ使う: 画面（`src-ui/`）や利用者向けのサイトを作る、直す、仕上げるとき。変更の前に現状を監査し、変更の後に批評する。
- 正本: [DESIGN.md](../DESIGN.md)と`.impeccable/`の設定（`config.json`は検出の除外、`design.json`はデザインシステム）。検出を除外するときは、`config.json`に理由を書く。

### unslop

- 何をする: AIが作ったように見える見た目を見つけて取り除く。紫のグラデーション、光彩（グロー）、グラデーションの文字、絵文字のラベル、不ぞろいな余白などが対象。
- いつ使う: UIの作業の仕上げ。impeccableの監査と併せて使う。
- 正本: [DESIGN.md](../DESIGN.md)。unslopの提案とDESIGN.mdが食い違うときは、DESIGN.mdに従う。

### ニールセンのユーザビリティ10原則

- 何をする: ヤコブ・ニールセンのユーザビリティの10原則（システムの状態が見える、利用者が操作を取り消せる、など）。UIを評価する観点のひとつ。
- いつ使う: UIの監査で、impeccableと併せて観点として使う。指摘にはどの原則に当たるかを添える。
- 正本: 操作と振る舞いの決まりは[DESIGN.md](../DESIGN.md)と[PRODUCT.md](../PRODUCT.md)。原則は観点で、決まりの代わりにはしない。

### humanizer と yomiyasu

- 何をする: 文章の推敲。英語はhumanizer、日本語はyomiyasuを使う。
- いつ使う: 文書、UIの文言、リリースノート、PRの説明など、人が読む文章を書き終えたとき。
- 正本: 英語は[docs/writing/english-guideline.md](writing/english-guideline.md)、日本語は[docs/writing/japanese-guideline.md](writing/japanese-guideline.md)。道具の指摘と文章の決まりが食い違うときは、文章の決まりに従う。

### Cua Driver

- 何をする: Windowsの実機で、アプリの画面の構造（アクセシビリティツリー）を読み取り、操作する。設定値や表示を、画面を前面に出さず、フォーカスを奪わずに読める。
- いつ使う: 実機のアプリで、設定値の反映や表示を確かめる検証。VRパネルの中は対象にしない。
- 正本: Windowsの実機での試験の手順をまとめた文書はまだない。報告の仕方は[AGENTS.md](../AGENTS.md)の「検証と完了の報告」に従う。Linuxの実機でのGUIの試験は[docs/voice-stack/linux-build-pipeline.md](voice-stack/linux-build-pipeline.md)にある。読み取った会話の文章や音声の内容は、記録や報告に写さない。

### Mermaid

- 何をする: Markdownの中に書く図。GitHubでそのまま表示される。
- いつ使う: アーキテクチャの提案や変更を、構成要素のつながりや処理の流れで示すとき。
- 正本: 書き方は開発者向けの仕様書の図に合わせる（[docs/spec/overview.md](spec/overview.md)、[docs/spec/sequences.md](spec/sequences.md)）。仕様書の図の選び方は[docs/spec/README.md](spec/README.md)にある。

### ミューテーションテスト

- 何をする: コードにわざと小さな変更（ミュータント）を入れ、テストが失敗するかを見る。テストが実際に不具合を見つけられるかを測る。画面側は[@mizchi/mutator](https://www.npmjs.com/package/@mizchi/mutator)、Rust側は[cargo-mutants](https://mutants.rs/)を使う。
- いつ使う: 画面のロジックかRustのクレートの`src/`を変えたPRでは、`mise run mutation:changed`（変えた所だけを回す）を回すことを勧める（必須ではない）。正式版の前には全体を回す。CIでは回さない。
- 正本: 回す場面、PRへの書き方、結果の置き場は[docs/development.md](development.md)の「ミューテーションテストを回す場面」にある。手順と結果の読み方は、同じ文書の「UIのミューテーションテスト」「Rustのカバレッジとミューテーションテスト」「変えた所のミューテーションテスト」にある。経緯は[Issue #550](https://github.com/kein5/astarot/issues/550)。結果を報告するときは、対象の範囲と計測した条件を添え、スコアを品質の保証としては書かない。

## 試行中

いまはありません。
