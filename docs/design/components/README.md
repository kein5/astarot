# Settings screen component experiment (#452)

[日本語版](#設定画面の部品の実験452日本語版)

This is the record of an experiment that rebuilds the settings screen's components in the ASTAROT design. It covers only the layer of components and their look. What goes where (the layer of how information is placed) is decided in #554 and in the [information architecture document](../information-architecture/README.md).

- Status: experiment (not used on the app's screens yet; whether to adopt it is decided after seeing the results)
- Components: `src-ui/views/kit/`
- Sample page: `src-ui/kit-lab.html` (opens only on the development server; it is not included in the build)
- Related issues: #436 (the list of components to unify), #474 (button looks), #554 (information architecture)

## Components built

| Component | What it has | Where its behavior comes from |
|---|---|---|
| `Button` | 4 looks (primary, plain, quiet, danger) and 3 sizes (regular, compact and icon, the last for icon-only buttons) | The native `<button>`. Defaults to `type="button"` |
| `TextField` | A text field. `invalid` gives it a red border when the value is not valid. Addresses and ports use `mono` for a monospaced font | The native `<input>` |
| `Select` | A select field in the same frame as the text field. The arrow is an SVG. Options are written with `SelectOption` and `SelectOptGroup` | The native `<select>`, `<option>` and `<optgroup>` |
| `Switch` | On and off. When on, a Dark Plum thumb sits on a Lilac track | Radix UI's Switch |
| `Dialog` and its parts `DialogHeader`, `DialogFooter`, `DialogTitle` and `DialogDescription` | A modal dialog. The title and the description become the dialog's accessible name and description. Its owner decides whether it is open, through `open` and `onOpenChange` | The native `<dialog>` (`showModal()`) |
| `SettingGroup` and `SettingRow` | A group with a heading, and one row in it | — |

To open the sample page, run `npx vite` and then open `http://localhost:1420/kit-lab.html`. The settings text is the real text from `locales/`. You can check switching between English and Japanese, and how the page looks in a narrow window.

## Separating items (a #452 requirement)

The feedback was that "it is not clear where one item ends". The experiment answers it with separation at 3 levels.

1. Groups are separated by a subheading and 3.2rem of space. This follows the rule in DESIGN.md that groups are "separated by space and a subheading, not by nested borders".
2. Rows in the same group are separated by a thin line in the border color (`--vox_border`).
3. Inside a row, the label and the description form one block, and the control sits beside it.

A row with unsaved changes gets a short Lilac rule outside its left edge. It follows the same rule as the save bar.

In a narrow column (under 35.6rem, or a window under 700px wide), text fields and select fields move under the label. Switches do not move and stay at the right end of the row, so that a switch is not separated from the words that say what it turns on.

Which rows go in which group, and where on which page they are placed, will be applied once the classification in #554 is decided.

## References

The references were [Macaw UI](https://github.com/saleor/macaw-ui) (Saleor, CC BY 4.0) and [OptiAxiom](https://github.com/optimizely-axiom/optiaxiom) (Optimizely, Apache-2.0). No code was copied from either. Only their ideas about how to build components were taken, so there is nothing to add to the license register (`docs/voice-stack/licensing.md`).

| Idea taken | Source | Form in ASTAROT |
|---|---|---|
| Express differences in look as variants of a vanilla-extract `recipe` | Macaw UI's `Button.css.ts` (`variant` and `size`) | `tone` and `size` of `button`, `kind` and `mono` of `field`, `layout` of `row` |
| Refer to theme variables through a typed contract | Macaw UI's theme | Uses the existing `src-ui/views/theme/vars.css.ts` as it is |
| Leave behavior to Radix and add only the look | Both | `Switch` |
| Tie the label, the description and the control together in one component | OptiAxiom's `field` | `SettingRow` passes `id` and `aria-describedby` to the control |

## What was kept as ASTAROT's own

- Colors and type all come from the existing tokens (`variables.css`). Component files do not write colors directly (`kit.test.ts` checks this). The color systems of the reference projects were not taken in.
- The button roles from DESIGN.md (#474) are unchanged. The primary button is for the action a form or dialog exists for, and the quiet button is used paired with a filled button.
- Text on Lilac is Dark Plum (`--vox_on_primary`). White reaches only 3.1:1.
- The select field uses the native `<select>`. Radix Select inserts a `<style>` element into its Viewport at run time (checked in 2.2.6). The app's CSP allows inserted styles by hash, so adding it would need a CSP update. For operating the open list as well, it was judged safer to keep the handling by the OS and by the VR panel's pointer as it is now.
- Macaw UI's `sprinkles` (a mechanism that sets spacing and colors through attributes) were not taken in. The app today writes styles per component, and ADR-010 also assumes that form.

## Aligned with shadcn/ui (2026-11-19)

The "Components" section of DESIGN.md set the policy of aligning the design, look and structure of components with shadcn/ui (#680). In the kit, the following differences, which needed no decision, were aligned. The other differences and the decision items are in the inventory document (#683).

- Each component's parts got the same `data-slot` values as the same component in shadcn/ui (`button`, `input`, `native-select-wrapper`, `native-select`, `native-select-icon`, `switch`, `switch-thumb`).
- `Select` got parts for its options that correspond to shadcn/ui's `NativeSelectOption` and `NativeSelectOptGroup` (`SelectOption` and `SelectOptGroup`), carrying `native-select-option` and `native-select-optgroup` (#691).
- `Select` corresponds to shadcn/ui's NativeSelect. The chevron is 1.6rem and sits 1.4rem from the right, and when the field is disabled, the whole wrapper is dimmed.
- Button text weight is now 500, and the opacity of the disabled state is .5.
- `Button` got the `icon` size for icon-only buttons (a 4rem square). A button with an icon has 1.2rem of padding on each side at regular and 1rem at compact (#694).
- shadcn/ui's Dialog parts (`Dialog`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`) were built on top of the native `<dialog>`. The width, the padding, the space between parts and the backdrop (50% black) follow shadcn/ui; the corner radius, the ground, the border and the absence of a shadow stay as in the app's dialogs. The button layout (D-24) and the details (D-43) are decision items in the inventory (#775).

Code is not copied as it is: Tailwind classes are translated into vanilla-extract. The shadcn/ui (MIT) notice is in `NOTICE.md` and in the license register.

## What was checked

The sample page was opened in Chromium (Playwright) to check the following. It has not been checked yet on real WebView2 and WebKitGTK.

- At widths of 1280px and 400px, nothing overflows sideways.
- The Space key toggles a switch. Pressing its label also toggles it.
- A switch's accessible name is the row's label, and its description is linked through `aria-describedby`.
- Moving focus with the keyboard shows a pale Lilac ring (`--vox_focus`).
- A disabled switch cannot be pressed. The field with an invalid port gets `aria-invalid="true"`.

The contrast of the color combinations is checked by `src-ui/views/theme/brandPalette.test.ts`.

## Open questions

| ID | Question | Proposal in this experiment |
|---|---|---|
| K-01 | Whether to adopt these components, and if so, which page to replace first | Replace the pages that stages 1 and 2 of #554 rebuild, when they rebuild the settings screen |
| K-02 | Whether to make every on/off setting a switch (item 1 of #436) | Make them switches. Keep checkboxes only for confirming consent |
| K-03 | Whether to use the thin lines between rows on every page, or only space on pages with few items | Use them on every page |
| K-04 | When to remove the existing components (`_DropdownMenu`, `FormRow`, the toggle in `mixins.ts`) | Remove them page by page, as each page's replacement is finished |
| K-05 | How the native select field's list looks in WebKitGTK | Check on a real Linux machine |

---

# 設定画面の部品の実験（#452）（日本語版）

設定画面の部品を ASTAROT のデザインで作り直す実験の記録です。部品と見た目の層だけを扱います。何をどこに置くか（情報の置き方の層）は #554 と [情報設計の文書](../information-architecture/README.md) で決めます。

- 状態: 実験（アプリの画面ではまだ使っていません。本採用は結果を見て決めます）
- 部品: `src-ui/views/kit/`
- 見本のページ: `src-ui/kit-lab.html`（開発サーバーでだけ開けます。ビルドには入りません）
- 関係する Issue: #436（統一する部品の一覧）、#474（ボタンの見た目）、#554（情報設計）

## 作った部品

| 部品 | 中身 | 振る舞いの出どころ |
|---|---|---|
| `Button` | 4 つの見た目（primary、plain、quiet、danger）と 3 つの大きさ（regular、compact、アイコンだけの icon） | ネイティブの `<button>`。既定は `type="button"` |
| `TextField` | 入力欄。値が正しくないときは `invalid` で赤い枠。住所やポートは `mono` で等幅 | ネイティブの `<input>` |
| `Select` | 入力欄と同じ枠の選択欄。矢印は SVG。選択肢は `SelectOption` と `SelectOptGroup` で書く | ネイティブの `<select>`、`<option>`、`<optgroup>` |
| `Switch` | オンとオフ。オンでは Lilac の溝に Dark Plum のつまみ | Radix UI の Switch |
| `Dialog` と、そのパーツの `DialogHeader`、`DialogFooter`、`DialogTitle`、`DialogDescription` | モーダルのダイアログ。題名と説明がダイアログの名前と説明になる。開くかどうかは `open` と `onOpenChange` で持ち主が決める | ネイティブの `<dialog>`（`showModal()`） |
| `SettingGroup` と `SettingRow` | 見出し付きのまとまりと、その中の 1 行 | — |

見本のページを開くには、`npx vite` を実行してから `http://localhost:1420/kit-lab.html` を開きます。設定の文言は `locales/` の実際の文言を使っています。英語と日本語の切り替えと、狭いウィンドウでの見え方を確かめられます。

## 項目の区切り（#452 の要件）

「どこまでが一つの項目か分からない」という指摘に、3 段階の区切りで応えます。

1. **まとまりの間**: 小見出しと 3.2rem の余白で区切ります。DESIGN.md の「区切りには余白と小見出しを使い、枠を入れ子にしない」に従っています。
2. **行の間**: 同じまとまりの中の行と行の間に、境界の色（`--vox_border`）の細い線を引きます。
3. **行の中**: 名前と説明を一つにまとめ、操作する部品をその横に置きます。

保存していない変更がある行は、行の左外に短い Lilac の線が付きます。保存バーと同じ規則です。

狭い列（35.6rem 未満、またはウィンドウの幅が 700px 未満）では、入力欄と選択欄が名前の下に移ります。スイッチは移さず、行の右端に残します。スイッチと、それが何をオンにするかの文言が離れないようにするためです。

どの行がどのまとまりに入り、どのページのどこに置かれるかは、#554 の分類が決まってから反映します。

## 参考にしたもの

参考にしたのは [Macaw UI](https://github.com/saleor/macaw-ui)（Saleor、CC BY 4.0）と [OptiAxiom](https://github.com/optimizely-axiom/optiaxiom)（Optimizely、Apache-2.0）です。どちらのコードも写していません。作り方の考え方だけを取り入れたので、ライセンス台帳（`docs/voice-stack/licensing.md`）に足す項目はありません。

| 取り入れた考え方 | 参考元 | ASTAROT での形 |
|---|---|---|
| 見た目の違いを vanilla-extract の `recipe` の変種で表す | Macaw UI の `Button.css.ts`（`variant` と `size`） | `button` の `tone` と `size`、`field` の `kind` と `mono`、`row` の `layout` |
| テーマの変数を型付きの契約で参照する | Macaw UI のテーマ | 既存の `src-ui/views/theme/vars.css.ts` をそのまま使う |
| 振る舞いは Radix に任せ、見た目だけを付ける | 両方 | `Switch` |
| 名前、説明、操作する部品を 1 つの部品で結び付ける | OptiAxiom の `field` | `SettingRow` が `id` と `aria-describedby` を操作する部品に渡す |

## ASTAROT 独自のものとして保ったもの

- **色と書体**: すべて既存のトークン（`variables.css`）から取ります。部品のファイルには色を直接書きません（`kit.test.ts` が検査します）。参考元の色の体系は取り入れていません。
- **ボタンの役割**: DESIGN.md（#474）の役割を変えていません。primary はフォームやダイアログの目的の操作で、quiet は塗りのあるボタンと組にして使います。
- **Lilac の上の文字**: Dark Plum（`--vox_on_primary`）を使います。白では 3.1:1 にしかなりません。
- **選択欄**: ネイティブの `<select>` を使います。Radix Select は Viewport に `<style>` 要素を実行時に差し込みます（2.2.6 で確認）。アプリの CSP は差し込まれるスタイルをハッシュで許可しているため、足すと CSP の更新が要ります。開いた一覧の操作も、OS と VR パネルのポインタでの扱いが今と変わらないほうが安全と判断しました。
- **Macaw UI の `sprinkles`（属性で余白や色を指定する仕組み）**: 取り入れていません。今のアプリは部品ごとのスタイルの書き方で、ADR-010 もその形を前提にしているためです。

## shadcn/ui に寄せたこと（2026-11-19）

DESIGN.md の「Components」で、部品の設計、見た目、構造を shadcn/ui に寄せる方針になりました（#680）。kit では、判断の要らない次の差を寄せました。ほかの差と判断項目は、棚卸しの文書（#683）にあります。

- 各部品のパーツに、shadcn/ui の同じ部品と同じ `data-slot` を付けました（`button`、`input`、`native-select-wrapper`、`native-select`、`native-select-icon`、`switch`、`switch-thumb`）。
- `Select` の選択肢に、shadcn/ui の `NativeSelectOption` と `NativeSelectOptGroup` に当たるパーツ（`SelectOption` と `SelectOptGroup`）を足し、`native-select-option` と `native-select-optgroup` を付けました（#691）。
- `Select` は shadcn/ui の NativeSelect に当たります。シェブロンを 1.6rem にして右から 1.4rem に置き、使えないときは包む要素ごと薄くします。
- ボタンの文字の太さを 500 に、使えない状態の不透明度を .5 にしました。
- `Button` に、アイコンだけのボタンの `icon` の大きさ（4rem の正方形）を足しました。アイコンの付いたボタンは、左右の余白を regular で 1.2rem、compact で 1rem にします（#694）。
- shadcn/ui の Dialog のパーツ（`Dialog`、`DialogHeader`、`DialogFooter`、`DialogTitle`、`DialogDescription`）を、ネイティブの `<dialog>` の上に作りました。幅、余白、部品の間、背景（50% の黒）は shadcn/ui、角丸、地、枠、影がないことはアプリのダイアログのままです。ボタンの並び（D-24）と細部（D-43）は棚卸しの判断項目にあります（#775）。

コードはそのまま写さず、Tailwind のクラスを vanilla-extract に読み替えています。shadcn/ui（MIT）の表示は `NOTICE.md` とライセンス台帳に載せました。

## 確かめたこと

見本のページを Chromium（Playwright）で開いて、次のことを確かめました。WebView2 と WebKitGTK の実機では、まだ確かめていません。

- 幅 1280px と 400px で、横にはみ出しません。
- スペースキーでスイッチが切り替わります。名前を押してもスイッチが切り替わります。
- スイッチの名前は行の名前になり、説明は `aria-describedby` で結び付いています。
- キーボードでフォーカスを移すと、薄い Lilac の輪（`--vox_focus`）が表示されます。
- 使えないスイッチは押せません。正しくないポートの欄は `aria-invalid="true"` になります。

色の組み合わせのコントラストは `src-ui/views/theme/brandPalette.test.ts` が検査します。

## 残課題

| ID | 問い | この実験での案 |
|---|---|---|
| K-01 | この部品を本採用するか。するなら、どのページから置き換えるか | #554 の段 1・段 2 で設定画面を組み直すときに、そのページから置き換える |
| K-02 | 設定のオンとオフをすべてスイッチにそろえるか（#436 の 1） | スイッチにそろえる。チェックボックスは同意の確認だけに残す |
| K-03 | 行の間の細い線は、すべてのページで使うか。項目が少ないページでは余白だけにするか | すべてのページで使う |
| K-04 | 既存の部品（`_DropdownMenu`、`FormRow`、`mixins.ts` のトグル）をいつ消すか | 置き換えが終わったページから順に消す |
| K-05 | WebKitGTK でネイティブの選択欄の一覧がどう見えるか | Linux の実機で確かめる |
