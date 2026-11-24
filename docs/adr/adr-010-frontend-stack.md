---
date: 2026-11-15
status: accepted
era: python-sidecar
validity: current
implementation_status: partial
implementation_checked: 2026-11-23
implementation_note: src-ui の TypeScript への移行は第 7 段まで済み、JavaScript のファイルは残っていない（第 8 段の仕上げは未着手）。スタイルは vanilla-extract（.css.ts）に移り終わり、SCSS Modules のファイルは残っていない（#957）。Radix UI は @radix-ui/react-visually-hidden と @radix-ui/react-switch を使っている。
evidence:
  - docs/typescript-migration.md
  - package.json
  - src-ui/views
---
# ADR-010: Frontend stack (keep React and Vite, adopt TypeScript and vanilla-extract)

[日本語版](#adr-010-フロントエンドのスタックreact-と-vite-を維持しtypescript-と-vanilla-extract-を採用する日本語版)

Status: Accepted (2026-11-15). The migration is carried out in stages toward 0.5.0.
Date: 2026-11-15
Related: Issue #326 (startup skeleton), Issue #327 (main screen layout audit)

## 1. Background

src-ui is built with React + JavaScript (JSX), Vite and SCSS Modules. It is still the setup inherited from upstream, and the following points had come up for review.

- The main screen layout has problems such as components being cut off (audited in Issue #327, rework planned for 0.5.0).
- JavaScript has no types, and the contracts with the backend (setting keys, error codes, IPC endpoints) are protected by runtime shape checks (`initializationFields.js` and others).
- #285 changes the backend's connection surface, so the frontend needs a way to protect its side of the contracts and a safety net for large rewrites.

## 2. Decision

- **Keep React as the framework.**
- **Keep Vite for the build.** Vite+ is not adopted for now and is left for re-evaluation later (section 5).
- **Adopt TypeScript.** The migration is staged: types go first into logics (the boundary with the backend and the data layer), and views are migrated when they are touched for the 0.5.0 layout rework.
- **Move styles from SCSS Modules to vanilla-extract.** This keeps the current way of working with styles scoped per component, and adds types to class names and theme variables. The migration keeps pace with moving the views to TS.
- **Adopt Radix UI as the base for UI components.** Radix handles behavior and accessibility, and vanilla-extract holds the look (section 7).

## 3. Why keep React, and why not adopt the alternatives

- Every alternative (Solid, Svelte, Vue) means rewriting the views and also losing the base of about 1,000 UI tests. In a Tauri desktop app, the main advantages of the alternative frameworks (delivery size, first render) count for little.
- The layout problems come from the CSS and the structure, not from the framework, and changing the framework would not fix them.
- Preact is compatible with React, but its lightness gains little for this use, and exceptions to the compatibility would still have to be handled.
- The development sessions that do most of the implementation know React well, and the existing component assets (motion components and others) assume React.

## 4. Why adopt TypeScript

- The contracts with the backend already exist as the spec catalog. Mapping types to the catalog lets mistakes in key names and response shapes be caught at build time instead of at runtime. Runtime validation at the boundary stays (because the values the backend actually returns are a runtime matter).
- Large changes follow one after another (unifying the connection surface in #285, then the 0.5.0 layout rework), so a safety net that catches shape mistakes mechanically is needed.
- A staged migration (mixing through allowJs) is possible, so the work can go ahead without setting up a dedicated migration project.

## 5. Why keep Vite and not adopt Vite+

- Vite+ is VoidZero's unified toolchain (it bundles Vite 8, Vitest, Oxlint, Oxfmt and others under the `vp` command and a single configuration). Its 1.0 was released under the MIT license in September 2026.
- But the JS tooling in this repository is little more than Vite and the tests, so the problem Vite+ solves, "managing the configuration and versions of several tools", hardly exists here (the tests also run on Node's runner, not on Vitest).
- Rolldown, which is where the speedup actually comes from, is available in plain Vite 8 too.
- Condition for re-evaluation: when the 0.5.0 work builds out the lint / format / type-check tooling in earnest, consider Vite+ again as the place to bundle them.

## 6. Why choose vanilla-extract, and why not the alternatives

- vanilla-extract defines styles on the TypeScript side, gives types to class names and themes, and has no runtime. It fits best with adopting TS.
- Tailwind CSS is fast when a layout is rebuilt from the ground up, but the way styles are written changes everywhere, and it would need separate discipline around design tokens. It also gains little from types.
- Moving to plain CSS Modules (only dropping SCSS) is the smallest change, but brings no benefit from types.
- CSS-in-JS (the kind with a runtime) is passed over because of its runtime cost and the current trend.

## 7. The base for UI components

- A finished UI library that includes the look (MUI, Ant Design and others) is not adopted. This app's look is its own design and would clash with the library's design language.
- As headless components that provide only behavior and accessibility, **adopt Radix UI and combine it with vanilla-extract**. Replace first the components whose accessibility is hard to ensure when built in-house, such as modals, menus, tooltips and dropdowns.
- shadcn/ui is a component collection that assumes Tailwind, so it cannot be used as it is. Half of its value is the Radix UI underneath, and this setup uses that Radix directly.

## 8. Consequences

- The 0.5.0 layout rework is done with React + TypeScript + vanilla-extract.
- Moving to TS and to vanilla-extract is staged, and until it is finished, JS and SCSS Modules are mixed in. The conventions for the mixed period (new files are written in TS and vanilla-extract) are decided when the migration starts.
- UI changes in 0.4.0, such as the skeleton display in #326, are made with the current stack and are not part of the migration this decision covers.

---

# ADR-010: フロントエンドのスタック（React と Vite を維持し、TypeScript と vanilla-extract を採用する）（日本語版）

Status: 採用（2026-11-15）。移行は 0.5.0 に向けて段階実施。
Date: 2026-11-15
Related: Issue #326（起動スケルトン）、Issue #327（メイン画面レイアウト監査）

## 1. 背景

src-ui は React + JavaScript（JSX）、Vite、SCSS Modules で構成されている。上流から引き継いだ構成のままで、次が見直しの論点になっていた。

- メイン画面のレイアウトに、コンポーネントの見切れなどの問題がある（監査は Issue #327、見直しは 0.5.0 予定）。
- JavaScript には型がなく、バックエンドとの契約（設定キー、エラーコード、IPC エンドポイント）は実行時の形状チェック（`initializationFields.js` 等）で守っている。
- #285 でバックエンドの接続面が変わるため、フロント側の契約の守り方と、大改修時の安全網が要る。

## 2. 決定

- **フレームワークは React を維持する。**
- **ビルドは Vite を維持する。** Vite+ は現時点では採用せず、将来の再評価事項とする（5章）。
- **TypeScript を採用する。** 段階移行とし、logics（バックエンドとの境界とデータ層）から型を付け、views は 0.5.0 のレイアウト見直しで触る際に合わせて移行する。
- **スタイルは SCSS Modules から vanilla-extract へ移行する。** 部品単位のスコープという現在の運用感覚を保ちつつ、クラス名やテーマ変数に型を付ける。移行はビューの TS 化と歩調を合わせる。
- **UI 部品の土台として Radix UI を採用する。** 振る舞いとアクセシビリティは Radix に任せ、見た目は vanilla-extract で持つ（7章）。

## 3. React を維持する理由と、代替を見送る理由

- 代替（Solid、Svelte、Vue）はいずれもビューの書き換えに加え、約1,000件ある UI テストの土台の喪失を伴う。Tauri のデスクトップアプリでは、代替フレームワークの主な利点（配信サイズ、初回表示）は効きにくい。
- レイアウトの問題はフレームワークではなく CSS と構造の問題であり、フレームワークの交換では直らない。
- Preact は React 互換だが、軽さの利点がこの用途では小さく、互換の例外対応が残る。
- 実装の主体である開発セッションの習熟と、既存の部品資産（モーション部品等）が React 前提である。

## 4. TypeScript 採用の理由

- バックエンドとの契約は仕様カタログとして既に存在する。型をカタログと対応付けることで、キー名やレスポンス形状の誤りを実行時ではなくビルド時に検出できる。境界の実行時バリデーションは残す（バックエンドが実際に返す値は実行時の話であるため）。
- #285 の接続面の統合と、0.5.0 のレイアウト見直しという大きな変更が続くため、形状の誤りを機械的に検出する安全網が要る。
- 段階移行（allowJs による混在）が可能で、専用の移行プロジェクトを立てずに進められる。

## 5. Vite を維持し、Vite+ を見送る理由

- Vite+ は VoidZero の統合ツールチェーン（Vite 8、Vitest、Oxlint、Oxfmt 等を `vp` コマンドと単一の設定に束ねる）で、2026年9月に 1.0 が MIT ライセンスで公開された。
- ただし本リポジトリの JS ツールは Vite とテスト程度しかなく、Vite+ が解決する「複数ツールの設定とバージョンの管理」という問題がほぼ存在しない（テストも Vitest ではなく Node のランナーで動いている）。
- 高速化の実体である Rolldown は、素の Vite 8 でも得られる。
- 再評価の条件：0.5.0 の作業で lint / format / 型チェックの道具立てを本格化させるとき、その束ね先として Vite+ を改めて検討する。

## 6. vanilla-extract を選ぶ理由と、代替を見送る理由

- vanilla-extract は TypeScript 側でスタイルを定義し、クラス名とテーマに型が付く、ランタイムゼロの方式である。TS 採用との相性が最もよい。
- Tailwind CSS は、レイアウトを土台から作り直す場面では速いが、記述の流儀が全面に変わり、設計トークンの規律が別途必要になる。型の恩恵も薄い。
- 素の CSS Modules への移行（SCSS をやめるだけ）は最小変更だが、型の恩恵がない。
- CSS-in-JS（ランタイム型）は、実行時のコストと現在の潮流から見送る。

## 7. UI 部品の土台について

- 見た目まで含む完成品の UI ライブラリ（MUI、Ant Design 等）は採用しない。本アプリの見た目は独自の設計であり、ライブラリのデザイン言語と競合する。
- 振る舞いとアクセシビリティだけを提供するヘッドレス部品として **Radix UI を採用し、vanilla-extract と組み合わせる**。モーダル、メニュー、ツールチップ、ドロップダウン等、自作ではアクセシビリティの担保が難しい部品から置き換えていく。
- shadcn/ui は Tailwind 前提の部品集であるため、そのままでは使えない。その価値の半分は土台の Radix UI であり、本構成はその Radix を直接使う形になる。

## 8. 帰結

- 0.5.0 のレイアウト見直しは、React + TypeScript + vanilla-extract の構成で行う。
- TS 化と vanilla-extract 化は段階移行であり、完了までは JS / SCSS Modules と混在する。混在期の規約（新規ファイルは TS と vanilla-extract で書く）は移行開始時に決める。
- #326 のスケルトン表示など、0.4.0 の UI 変更は現行スタックで行い、本決定の移行対象には含めない。
