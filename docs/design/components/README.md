# 設定画面の部品の実験（#452）

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
| `SettingGroup` と `SettingRow` | 見出し付きのまとまりと、その中の 1 行 | — |

見本のページを開くには、`npx vite` を実行してから `http://localhost:1420/kit-lab.html` を開きます。設定の文言は `locales/` の実際の文言を使っています。日本語と英語の切り替えと、狭いウィンドウでの見え方を確かめられます。

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
| K-04 | 既存の部品（`_DropdownMenu`、`FormRow`、`mixins.scss` のトグル）をいつ消すか | 置き換えが終わったページから順に消す |
| K-05 | WebKitGTK でネイティブの選択欄の一覧がどう見えるか | Linux の実機で確かめる |
