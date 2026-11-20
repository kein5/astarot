# 部品の棚卸し: shadcn/ui との照合

アプリの部品を shadcn/ui の部品と照らし合わせ、差分を一覧にした文書です。DESIGN.md の「Components」の節にある、部品を shadcn/ui に寄せる方針（#680）を進めるための下調べです。棚卸しの時点では、部品のコードを変えていませんでした。その後に寄せた差は、表の「扱い」の列に PR の番号を添えて「寄せた」と書いています。

- 状態: 棚卸し（2026-11-19）。寄せる作業は、判断の要らない差と、下の判断項目が決まった差から、段階的に PR にします。段 1（kit）は #684、段 2 のうち Select と入力欄は #691、ボタンは #694、検索欄は #695、チェックボックスとスライダーは #697、ツールチップは #721 で寄せました。
- 照合した shadcn/ui: [shadcn-ui/ui](https://github.com/shadcn-ui/ui) の `apps/v4/registry/new-york-v4/ui/`（`main` のコミット `968d8cb9dc`、2026-11-17）。MIT ライセンスです。どのスタイルに寄せるかは D-01 で決めます。
- 照合したアプリ: develop（#676 と #677 のマージ後）
- 関係する文書: [設定画面の部品の実験](README.md)（#452、`src-ui/views/kit/`）、[ADR-010](../../adr/adr-010-frontend-stack.md)

## 読み方

- 長さは DESIGN.md の読み替えの規則で比べます。Tailwind の 1rem は 16px、アプリの 1rem は 10px なので、shadcn/ui の `h-9`（36px）はアプリの `3.6rem` です。
- 色は shadcn/ui の値を使わず、下の対応表で ASTAROT のトークンに置き換えて比べます。
- 「扱い」の列は次の3つです。
  - 寄せる: DESIGN.md のほかの規則にも利用者の操作にも触れない差です。判断なしで寄せられます。
  - 判断（D-xx）: 寄せるかどうか、どう寄せるかに判断が要る差です。番号は下の「判断項目」の番号です。
  - 残す: アプリの制約（React 18、vanilla-extract、CSP）か、振る舞いや読みやすさのための DESIGN.md の規則で、寄せない差です。変えるなら判断が要ります。

## 全体にかかわる差

### 色のトークンの対応（案）

| shadcn/ui | ASTAROT（案） | 根拠 |
|---|---|---|
| `background` | `--vox_canvas` | 会話と設定の地 |
| `foreground` | `--dark_basic_text_color`（DESIGN.md の `text`） | 本文の文字 |
| `card`、`popover` | `--vox_surface` | 一段上がった面。選択欄の一覧も同じ面に開く（DESIGN.md） |
| `primary`、`primary-foreground` | `--primary_600_color`、`--vox_on_primary` | Lilac の塗りと、その上の Dark Plum の文字 |
| `secondary`、`secondary-foreground` | `--vox_surface`、`--dark_200_color` | kit の `plain` のボタン |
| `muted`、`muted-foreground` | `--dark_850_color`、`--vox_description_text` | 溝、骨組みの表示、説明の文字 |
| `accent`、`accent-foreground` | `--vox_secondary_hover`、`--dark_basic_text_color` | 一覧の行やボタンにポインタを載せたときの塗り |
| `destructive` | `--vox_state_failed` | 失敗の色 |
| `border` | `--vox_border` | 領域の間の細い線 |
| `input` | 枠は `--vox_field_border`、`bg-input/30` の塗りは `--vox_surface` | 入力欄の枠と塗り |
| `ring` | `--vox_focus` | フォーカスの輪 |

shadcn/ui は `input` を枠にも、薄めた塗りにも使います。アプリは入力欄の枠と塗りを別のトークンにしているので、2つに分けました。対応表は D-02 で確定します。

### 寸法と形

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 操作の高さ | ボタン、入力欄、選択欄は 4rem（DESIGN.md の 40px）。kit の `compact` は 3.2rem | 既定は `h-9`（3.6rem）、`sm` は `h-8`（3.2rem）、`lg` は `h-10`（4rem） | 判断（D-03）。`compact` は `sm` と同じ高さ |
| 角丸 | 2、4、8、12px の段。`--vox_radius` は 8px。ダイアログとメッセージの入力欄は 12px | `--radius` は 10px。`rounded-md` は 8px、`rounded-lg` は 10px、`rounded-xl` は 14px、`rounded-sm` は 6px、`rounded-xs` は 2px。チェックボックスは 4px | `rounded-md` は一致。`rounded-xl` は 12px に寄せる。`rounded-lg`（10px）と `rounded-sm`（6px）は段のちょうど中間なので判断（D-04） |
| 文字の大きさ | 1.2〜2.4rem の段 | `text-xs` 1.2rem、`text-sm` 1.4rem、`text-base` 1.6rem、`text-lg` 1.8rem | どれも段の上にある。寄せる |
| ボタンの文字の太さ | 500（kit は #684、画面の操作のボタンは #694）。前は、フォームのボタンとその写しが 600、ほかの操作のボタンが 400 だった | 500（`font-medium`） | 寄せた。既定の UI フォント（Yu Gothic UI）には 500 の字面がないので、500 をそのまま使うかは D-38 |
| 影 | 浮かぶものにだけ `--vox_shadow_overlay` | 入力欄と outline のボタンに `shadow-xs`、カードに `shadow-sm`、一覧に `shadow-md`、ダイアログに `shadow-lg` | 判断（D-05）。DESIGN.md「Elevation & Depth」は、普段のフォームに飾りの影を使わないとしている |

### 状態の表し方

| 状態 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| フォーカス | `--vox_focus` の `.2rem` の outline。kit は外に `.2rem` 離す。部品によって `.1rem`〜`.3rem` 離すもの、内側に引くもの（レール）がある | 枠が `ring` になり、外に 3px の `ring` の 50% の影が付く（離さない） | 判断（D-06）。50% の輪が地に対して 3:1 に届くか（`brandPalette.test.ts` の基準）を確かめてから決める。離す量の不ぞろいは D-06 のあとでそろえる |
| 値が正しくない | kit の `TextField` と `Select` は `invalid` で `aria-invalid` を付け、`[aria-invalid='true']` で枠を `--vox_state_failed` にする | `aria-invalid` で枠が `destructive` になる。フォーカス中は輪も赤みを帯びる | 枠は一致。フォーカス中の輪は D-06 |
| 使えない | kit、フォーム（`VoiceSettings.module.scss`。入力欄、選択欄、ボタンに共通の規則）、画面の操作のボタンは不透明度 .5（#684、#694。前は kit が .55、フォームと多くのボタンが .6、設定の上のバーの保存と取り消しが .45）。`_Entry` は文字の色だけを変える。チェックボックスは灰色にする filter。設定の Slider は `disabled` で .5（#697）。トグル、開閉のボタン、待ちの表示は .55〜.6 のまま | 不透明度 .5。ボタンは `pointer-events: none` | 不透明度は .5 に寄せる（操作のボタンとフォームは寄せた）。トグルは D-27、開閉のボタンは D-26 と一緒に扱う。`_Entry` は D-37。`pointer-events: none` は判断（D-07）。使えないスイッチや機能のボタンがツールチップで理由を示す規則（DESIGN.md「Layout」）とぶつかる |
| ホバーと押下 | 部品ごとに `dark_*` と `primary_*` の段を選ぶ | `accent` の塗り、または `primary/90` のように同じ色を薄める | 判断（D-08）。不透明度で薄める作り方は、明度だけを変えるアプリの色の作り方（DESIGN.md「Colors」）と違う |
| 開閉の動き | `--vox_motion`（220ms）と `--vox_ease_settle`。一覧は欄から落ちて落ち着き、行が続いて現れる | `fade-in`、`zoom-in-95`、出る向きからの slide-in | 判断（D-09）。DESIGN.md の「Motion」が一覧の開き方を決めている |

### 構造

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| ファイル | kit は部品ごとに `Name.tsx` と `Name.css.ts`。ほかは `Name.jsx` と `Name.module.scss` | 1つの部品を1つの `.tsx` に書く | 残す（vanilla-extract のスタイルは `.css.ts` に置く）。`.tsx` と `.css.ts` の組にそろえる |
| パーツ | ダイアログやカードはパーツに分けず、使う側がマークアップを書く | `DialogHeader`、`DialogTitle` のように、パーツを名前付きで export する | 寄せる。新しく作るときと置き換えるときにパーツに分ける |
| `data-slot` | kit の部品（#684、#691）、`_Entry` の入力欄（#691）、設定の検索の InputGroup のパーツと言語の一覧の検索欄、Empty（#695）、ツールチップの `tooltip-trigger` と `tooltip-content`（#721）。ほかはなし | すべてのパーツに付ける | 寄せる |
| variant | kit は `recipe()`（`button` の `tone` と `size`、`field` の `kind` と `mono`、`row` の `layout`） | `cva()`。`buttonVariants` のように部品の隣で export する | recipe は既にある。export の名前と variant の名前は、部品ごとの判断（ボタンは D-10）で決める |
| ref | kit は `forwardRef` | React 19 の `ref` の props | 残す（React 18） |
| Radix | `@radix-ui/react-switch` と `@radix-ui/react-visually-hidden` だけ | 多くの部品が Radix（統合パッケージの `radix-ui`） | パッケージは個別のまま（DESIGN.md）。どの部品を Radix にするかは、下の部品ごとの判断で決める |
| アイコン | アプリの SVG（`@images/*.svg?react`） | lucide-react | 判断（D-11） |
| クラスの結合 | `clsx` | `cn`（clsx と tailwind-merge の代わり） | 残す（tailwind-merge は Tailwind のクラスのためのもの） |

## 部品ごとの差

### Button

アプリ: kit の `Button`（実験で、画面ではまだ使っていない）。画面のボタンは部品になっておらず、モジュールごとの SCSS が描いています（`VoiceSettings.module.scss`、設定とメインの上のバー、`PagePointer` の `PageLinkButton`、`_DownloadButton` など）。アイコンだけのボタンも `ActionButton`、`reset_button`、`close_button` に分かれています。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| variant | `tone`: primary、plain（既定）、quiet、danger（DESIGN.md #474 の役割） | `variant`: default、secondary、outline、ghost、destructive、link | 判断（D-10） |
| size | `size`: regular（4rem）、compact（3.2rem）、icon（4rem の正方形、#694） | default（3.6rem）、xs、sm（3.2rem）、lg（4rem）、icon、icon-xs、icon-sm、icon-lg | 高さは D-03。kit に `icon` の size を足した（#694）。画面のアイコンだけのボタン（`ActionButton`、`reset_button`、`close_button`）をまとめるのは、kit を画面で使うと決めてから（K-01）。`icon-sm` などを足すかは D-03 と D-10 に含める |
| 別の要素で描く | なし（リンクのボタンは `<a>` を別に描く） | `asChild`（Radix の `Slot`） | 判断（D-12） |
| 余白 | `.8rem 1.6rem`。アイコンがあると左右は 1.2rem、compact では 1rem（#694） | default は `px-4 py-2`（1.6rem、.8rem）。アイコンがあると `px-3`。sm は `px-3`、アイコンがあると `px-2.5` | 一致。アイコン付きの余白は寄せた（#694） |
| 角丸 | 8px | `rounded-md`（8px） | 一致 |
| 文字 | 1.4rem、500（kit は #684、画面の操作のボタンは #694）。長い日本語は折り返す | `text-sm`（1.4rem）、500、`whitespace-nowrap` | 太さは寄せた（字面は D-38）。折り返しは残す（長い日本語の表示） |
| primary | Lilac の塗りに Dark Plum の文字。ホバーは `primary_550`、押下は `primary_700` | `bg-primary`、ホバーは `primary/90` | D-08 |
| danger | 塗らずに赤い文字と `--vox_field_border` の枠 | destructive は赤の塗り（暗い配色では 60%）に白い文字 | D-10 |

### Input と Textarea

アプリ: kit の `TextField`（`field` の recipe）、設定の行の `_Entry`（SCSS）、フォームの中の `input`、`select`、`textarea` をまとめて描く `VoiceSettings.module.scss`。検索欄（設定の検索、言語の絞り込み）とメッセージの入力欄は別に描いています。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 高さ | kit、フォーム、`_Entry` は 4rem 以上 | `h-9`（3.6rem）。textarea は最小 6.4rem（`min-h-16`） | D-03。`_Entry` は kit の高さに寄せた（#691） |
| 余白 | kit は `.8rem 1.2rem`。`_Entry` は `.6rem` | `px-3 py-1`（1.2rem、.4rem） | kit の左右は一致。上下は高さで決まる（D-03）。`_Entry` の左右は D-37 |
| 塗り | kit と `_Entry` は `--vox_surface` | 透明（暗い配色では `input/30`） | `--vox_surface`（D-02 の案）。`_Entry` は寄せた（#691） |
| 枠 | kit と `_Entry` は `.1rem` の `--vox_field_border` | 1px の `input` | `--vox_field_border`。`_Entry` は寄せた（#691。前の `dark_750` は自分の塗りの `dark_875` に対して 1.85:1 で、DESIGN.md の基準の 3.5:1 に届いていなかった） |
| 角丸 | kit と `_Entry` は 8px | 8px | 一致（`_Entry` は #691 で寄せた） |
| フォーカス | kit は輪と `primary_600` の枠。`_Entry` は全体の輪だけで、使っている間は `primary_400` の枠 | 枠が `ring`、3px の輪 | D-06 |
| 使えない | kit は全体を不透明度 .5 にする（#684）。`_Entry` は文字を `dark_500` にするだけで、待ち（`aria-busy`）のときも同じ見た目を使う | 不透明度 .5、`pointer-events: none` | 判断（D-37） |
| 文字 | 1.4rem | `text-base`（1.6rem）、幅 768px 以上で `text-sm`（1.4rem） | 残す（1.4rem。`text-base` はスマートフォンでの拡大を避けるためのもの） |
| textarea の高さ | フォームは最小 8rem、縦に伸ばせる（`resize: vertical`） | `field-sizing: content` で中身に合わせて伸びる | 判断（D-13）。`field-sizing` は Baseline Widely available ではない |
| 構造 | kit は `TextField` と `Select` が `Field.css.ts` を分け合う。textarea はない | `input.tsx`、`textarea.tsx`、`native-select.tsx` が別 | kit に `Textarea` を足すときは別の部品にする（寄せる） |

### Select

アプリ: kit の `Select`（ネイティブの `<select>`）、設定の行で主に使う自作の combobox の `_DropdownMenu`、フォームのネイティブの `select`（WebView2 では `appearance: base-select`）、VR パネルの `Picker`。

shadcn/ui には、Radix の Select と、ネイティブの `<select>` を包む NativeSelect の2つがあります。kit の `Select` は NativeSelect に当たります。

| 観点 | kit の `Select` | NativeSelect | 扱い |
|---|---|---|---|
| 土台 | ネイティブの `<select>` を `span` で包み、SVG のシェブロンを重ねる | ネイティブの `<select>` を `div` で包み、lucide のシェブロンを重ねる | 一致。アイコンは D-11 |
| `data-slot` | `native-select-wrapper`、`native-select`、`native-select-icon`（#684）。`native-select-option` と `native-select-optgroup` は `SelectOption` と `SelectOptGroup` のパーツに付けた（#691） | `native-select-wrapper`、`native-select`、`native-select-icon`、`native-select-option`、`native-select-optgroup` | 寄せた |
| size | なし（4rem） | `size`: default（3.6rem）、sm（3.2rem） | D-03 と D-10 に含める（kit のボタンは 3.2rem の大きさを `compact` と呼んでいる） |
| 右の余白とシェブロン | 右の余白は 3.6rem。シェブロンは 1.6rem で右から 1.4rem（#684）、`--vox_secondary_text`。フォームの選択欄も同じ形、大きさ、位置（#691）で、色は背景の画像に `#9daec6` を直に書いている | 右の余白は `pr-9`（3.6rem）。シェブロンは `size-4`（1.6rem）で右から 1.4rem、`muted-foreground` の 50% | 余白、シェブロンの大きさと位置は寄せた。色は D-02 |
| 使えない | kit は包む要素ごと不透明度 .5（#684）。フォームの選択欄はシェブロンが背景の画像なので一緒に薄くなり、不透明度はフォームに共通の .5（#694） | 包む要素ごと不透明度 .5 | 寄せた |
| 幅 | 列いっぱい（`width: 100%`） | `w-fit` | 残す（DESIGN.md の欄の幅の規則、#567） |
| 一覧の行の色 | `option` の地を `--vox_surface` にする | `bg-[Canvas] text-[CanvasText]`（システムの色） | 残す（一覧は欄と同じ面に開く。DESIGN.md「Components」） |

設定の行の `_DropdownMenu` と Radix Select の差は次のとおりです。

| 観点 | `_DropdownMenu` | Radix Select | 扱い |
|---|---|---|---|
| 土台 | 自作の ARIA combobox | Radix Select（Trigger、Content、Item、Group、Label、Separator、ScrollUpButton、ScrollDownButton） | 判断（D-14）。Radix Select は実行時に `<style>` を差し込むので、CSP の更新が要る（#452 で確認）。開いた一覧の操作も、OS と VR パネルのポインタで変わる |
| props | `_DropdownMenu` は `dropdown_id`、`list`（id から名前）、`selected_id`、`selectFunction`、`state`（読み込み中）、`is_disabled`、`label`、`secondary_label` | `value`、`onValueChange`、子の `SelectItem`、Trigger の `size` | D-14 に含める（props を寄せると、呼ぶ側がすべて変わる） |
| 開いている数 | 1つだけ（`dropdown_id` を atom に持つ） | Radix が管理する | D-14 に含める |
| トリガー | 4rem、余白 `.9rem 1.2rem`、`--vox_surface`、`--vox_field_border`、8px。ホバーで枠が `dark_500`、押下で `dark_900` | `h-9`（`sm` は `h-8`）、`px-3 py-2`、透明、`input` の枠、8px、`w-fit`。明るい配色ではホバーなし | 高さは D-03、色は D-02 |
| 一覧 | `--vox_surface`、`dark_600` の枠、8px、`--vox_shadow_overlay`、余白 .4rem、高さは最大 20rem。下に入らなければ上に開く | `popover`、`border`、8px、`shadow-md`。Viewport の余白は `p-1`（.4rem） | 余白は一致。影は D-05 |
| 行 | 余白 `.8rem 1.2rem`、4px。ホバーとキーボードで `dark_800`。選んだ行は `dark_900` の塗りと太い `primary_200` の文字 | `px-2 py-1.5`（.8rem、.6rem）、`rounded-sm`（6px）、`focus:bg-accent`。選んだ行は右にチェック | 判断（D-15）。角丸は D-04 |

### Combobox、Command、InputGroup

アプリ: 設定の検索（`SearchBar`。`role="combobox"` で結果の一覧を出し、一致した語を強調する。結果にはタブと前提の印が付く）と、言語の一覧の絞り込み（`LanguageSelector` の `type=search` の欄。Enter で最初の候補を選ぶ）。どちらも自作です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | 自作の ARIA combobox | Combobox は Base UI（`@base-ui/react`）、Command は cmdk で書かれている。new-york-v4 には、どちらも Radix で書いたものがない | 判断（D-36）。DESIGN.md は Radix で書いたものを読むとしているが、この2つにはそれがない |
| 検索欄の枠 | 設定の検索は、外側の要素が 4rem の枠（`--vox_surface`、`--vox_field_border` の枠、8px。#695 で `dark_875` と `dark_750` から寄せた）を持ち、中の入力欄は枠なし。虫眼鏡のアイコン（1.5rem、左の余白 .8rem）と消すボタン（✕）がある。入力欄の文字は 1.3rem。ホバーで枠が `dark_550`、中にフォーカスがあると `primary_400`。言語の一覧の検索欄は、塗りと枠が入力欄と同じ1つの入力欄 | InputGroup（`h-9`、`input` の枠。中の入力欄にフォーカスがあると輪が付く。アイコンやボタンは `InputGroupAddon` で左右に置く。アイコンは `size-4`、左の余白は `pl-3`、文字は `text-sm`） | 形は一致。`data-slot`（`input-group`、`input-group-control`、`input-group-addon`。言語の一覧は `input`）と、塗りと枠のトークン（D-02 の案）は寄せた（#695）。高さは D-03、輪は D-06。アイコンの大きさ、左の余白、文字の大きさは D-40 |
| 結果の一覧 | `--vox_surface`（#695 で `dark_900` から寄せた）、`dark_750` の枠、8px、影。行はホバー中と選択中に `dark_800`。結果がないときは Empty（#695） | Command の一覧は `popover`。行は `px-2 py-1.5`、`rounded-sm`、選択中は `accent`。見出しは `text-xs` の `muted-foreground`。結果がないときは CommandEmpty（`py-6 text-center text-sm`） | 地は寄せた（#695）。選択中の `dark_800` は `accent`（`--vox_secondary_hover`）と同じ値。角丸は D-04。結果がないときは下の Empty の行 |

### Checkbox

アプリ: `common_components/checkbox` の `Checkbox`（SCSS。ネイティブの input を見えなくして隣に箱を描く）。DESIGN.md（#436）で、設定のオンとオフに使う部品です。フォームの中はネイティブのチェックボックス（`accent-color`）です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの input | Radix Checkbox（`button role="checkbox"`、`data-state`） | 判断（D-16）。Radix にすると input がなくなり、フォームと試験の書き方が変わる |
| props | `label`、`variable`（`state`、`data`）、`is_available`、`toggleFunction`、`show_label`、`size`、`borderWidth`、`padding` | `checked`、`onCheckedChange`、`disabled` | D-16 に含める |
| 大きさ | 2.8rem の箱、`.2rem` の枠、まわりの余白 1.8rem | `size-4`（1.6rem）、1px の枠、4px の角丸 | 判断（D-17） |
| オンの塗り | `primary_600` の塗りに、`--vox_on_primary`（Dark Plum）のチェック（#697。前は `--dark_basic_text_color` で、塗りに対して 3.1:1） | `primary` の塗りに `primary-foreground` のチェック | 寄せた（#697）。Lilac の塗りの上は Dark Plum という DESIGN.md の規則とも合う |
| 枠 | オフは `dark_700`、ホバーで `primary_600` | `input` の枠。ホバーなし | D-02、D-08 |
| 待ち | 枠を `primary_800` にし、スピナーと `aria-busy` を出す | なし | 残す（エンジンを待つ操作は、押した直後に待ちの状態を示す。DESIGN.md） |

### RadioGroup

アプリ: `RadioButton`（SCSS、ネイティブのラジオ）。種類ごとにまとめた選択肢（`groups`）も扱います。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの radio。`role="radiogroup"` を入れ子にし、`name` を共有する | Radix RadioGroup（Root は `grid gap-3`、Item、Indicator） | 判断（D-16）。種類をまたいで矢印キーで動き、Tab で1回だけ止まる規則（DESIGN.md）を Radix で保てるかを確かめる |
| 点 | 2rem、`dark_600` の `.3rem` の輪。選ぶと `primary_400` の `.6rem` の輪 | `size-4`（1.6rem）、`input` の枠。選ぶと中に `primary` の点（`size-2`）が付き、枠は変わらない | D-17 |
| 行 | 余白 `.6rem .8rem`、4px。ホバーで `dark_850` | 行の塗りなし | D-17 に含める |
| 待ち | `aria-disabled` にして、フォーカスは残す | なし | 残す（DESIGN.md） |

### Switch

アプリ: kit の `Switch`（Radix）、`ToggleSwitch`（SCSS。フォーカスを受けない `div`）、メインの機能の `SwitchContainer`（行全体が `role="switch"`）、VR パネルの `ToggleRow`、トレイのコンパニオンの `switchRow`。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 大きさ | kit は 4.4×2.4rem、つまみ 1.8rem。`ToggleSwitch` は 4×1.6rem（メインの機能では 3.6×1.4rem） | default は 3.2×1.84rem（`w-8 h-[1.15rem]`）、つまみ 1.6rem。`sm` は 2.4×1.4rem | D-17 |
| 溝の縁 | オフは `dark_850` に `--vox_field_border` の縁 | 縁なし。オフは `input`（暗い配色では 80%） | 判断（D-18）。DESIGN.md は溝の縁を `field-border` にして 3:1 を満たしている |
| オンとつまみ | オンは `primary_600`。つまみは `dark_300`、オンで Dark Plum | オンは `primary`。つまみは暗い配色で、オフが `foreground`、オンが `primary-foreground` | オンの色とオンのつまみは一致。オフのつまみは D-02 |
| size | kit にはない | `size`: default、sm | D-17 に含める（既定の大きさが決まってから足す） |
| 土台 | `ToggleSwitch` は自作で、行（`SwitchContainer`）が `role="switch"` を持つ | Radix Switch | 判断（D-19） |

VR パネルは px の段で描く別の画面（DESIGN.md「Typography」）なので、照合の外にしました。

### Slider

アプリ: `slider` の `Slider`（自作の `role="slider"`、MUI に似た API）、しきい値の部品、フォームの `input[type=range]`。VR パネルはステッパーです。しきい値の部品は、音量のメーターに幅 .4rem、高さ 4rem のつまみだけを重ねたもので、溝と満ちた部分の代わりにメーターがあります。共通の Slider には寄せず、メーターと一体のアプリだけの部品として照合の外にしました（D-41、2026-11-19 に決定）。下の表には入れていません。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | 自作 | Radix Slider（Root、Track、Range、Thumb） | 判断（D-20） |
| props | `variable`、`setterFunction`、`setter_timing`、`debounce_ms`、`min`、`max`、`step`、`marks_step`、`show_label_values`、`orientation`、`valueLabelDisplay`、`valueLabelDisplayLocation`、`valueLabelFormat`、`valueLabelFunction`、`track`、`no_padding` | `value`、`onValueChange`、`min`、`max`、`step`、`orientation` | D-20 に含める。値の吹き出しと目盛りは shadcn/ui にない |
| 溝 | `.6rem`、`dark_825`。満ちた部分は `primary_600`（#697。前は `.4rem` で、満ちた部分の色はコメントアウトされていて見えなかった）。フォームの `input[type=range]` も同じ形で、値の割合を `--range-fill` で渡して溝に塗る（#697） | `h-1.5`（.6rem）、`muted`。満ちた部分（Range）は `primary` | 満ちた部分と溝の .6rem は寄せた（#697）。溝の色は D-02 |
| つまみ | 1.8rem、`primary_600`。ホバーとドラッグで `.8rem` の薄い輪 | 1.6rem、白の塗り（`bg-white` で固定）に `primary` の枠。ホバーとフォーカスで 4px の `ring/50` | 大きさは D-17、輪は D-06。白の塗りは D-02 |
| 使えない | `disabled` で不透明度 .5。つまみはタブの順から外れて `aria-disabled` になり、ポインタとキーで動かない（#697。まだ渡している箇所はない）。フォームの `input[type=range]` はフォーム共通の .5（#694） | 不透明度 .5 | 寄せた（#697） |

### Tooltip

アプリ: `common_components/tooltip`（SCSS。ポータルなし、`role="tooltip"` なし。使っているのは再送のボタンだけ）。#676 と #677 で入った `Hint`（設定の説明の吹き出し）。メインの画面と設定の多くの部品にあるネイティブの `title` 属性。VR パネルの `VrTooltip`（Python 側が描く）。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | CSS の hover と focus で開く。`Hint` は `:has(:focus-visible)` で開き、`aria-describedby` で読まれる | Radix Tooltip（Provider、Trigger、Content、Arrow。ポータルに描く） | 判断（D-21）。ADR-010 が Radix に置き換える候補に挙げている部品 |
| 開くまで | `Tooltip` は .1 秒待って .15 秒で現れる。`Hint` は 120ms で現れる | `delayDuration` は 0 | D-21 に含める |
| 見た目 | `Tooltip` と `Hint` は1つの見た目（`common_css/mixins.scss` の `tooltip_content`。#721）。`dark_700` の塗りに明るい文字、1.2rem/500、行の高さ 1.6、余白 `.6rem 1.2rem`、8px、言葉の幅で最大 36rem、文の改行を保つ。前は `Tooltip` が余白 `.4rem .8rem` と 4px の1行（中の段落は `root.css` で折り返すので、ボタンの幅の中で数文字ずつに折れていた）、`Hint` が `.8rem 1.2rem`。矢印なし | `foreground` の塗りに `background` の文字（色が反転）、`text-xs`（1.2rem、行の高さ 1.33）、太さの指定なし、`px-3 py-1.5`（1.2rem、.6rem）、8px、`text-balance`。矢印あり | 余白と角丸は寄せ、`Tooltip` と `Hint` の見た目を1つにした（#721）。色の反転と矢印は判断（D-22）。文字の太さ、行の高さ、`text-balance` は今のまま（D-42、2026-11-19 に決定） |

### Dialog と AlertDialog

アプリ: ネイティブの `<dialog>` を `showModal()` で開きます（`useConsentDialog.ts`）。見た目は `VoiceSettings.module.scss` と `LegacyModelDownloadDialog.module.scss` の `dialog` の規則で決まり、`Topbar.tsx`、`Translation.tsx`、`useSettingsDraft.tsx` が同じ見た目を写しています。クイック設定のモーダル（`ModalController.tsx`）は別です。起動の失敗は、モーダルでない `<dialog open role="alertdialog">`（`StartupFailedDialog.tsx`）です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの `<dialog>` | Radix Dialog と AlertDialog（Portal、Overlay、Content、Header、Footer、Title、Description、Close） | 判断（D-23）。ネイティブの `<dialog>` は Baseline で、フォーカスの閉じ込めと Esc を持つ。Radix Dialog はスクロールを止めるために `<style>` を差し込む見込みがあり、入れる前に CSP への影響を確かめる |
| パーツ | なし（ダイアログごとに書く） | Header、Footer、Title、Description | 寄せる。ネイティブの `<dialog>` のままでもパーツの部品は作れる |
| 幅、余白、間 | `min(51.2rem, 100vw − 2.4rem)`、余白 2.4rem、部品の間 1.6rem。同意と確認のダイアログでは、見出しと本文の段落が1つの部品で、その中の段落の間は .8rem | `max-w-[calc(100%-2rem)]`、`sm:max-w-lg`（51.2rem）、余白 `p-6`（2.4rem）、間 `gap-4`（1.6rem） | 一致（寄せた。一覧の 9） |
| 角丸 | 12px（DESIGN.md の `rounded.dialog`） | `rounded-lg`（10px） | D-04 |
| 地、枠、影 | `dark_875` の地、`dark_600` の `.1rem` の枠、影なし | `background` の地、`border`、`shadow-lg` | 判断（D-05、D-02）。ダイアログの地 `dark_875` は、DESIGN.md の 3:1 の基準に入っている |
| 背景 | `#00000080`（50% の黒）。クイック設定のモーダルは別（淡い色とぼかし） | `bg-black/50` | 一致（寄せた。一覧の 9） |
| 見出し | `h3`、1.8rem | Title は `text-lg`（1.8rem）、600 | 一致 |
| ボタンの並び | `.actions` の行 | Footer は狭いと縦に逆順、広いと右寄せ | 判断（D-24）。ボタンの置き方（DESIGN.md #473）とのかね合い |
| 閉じるボタン | なし（操作のボタンで閉じる） | 右上の X（`sr-only` の "Close" は英語で固定） | D-24 に含める。足すなら文言は `locales/` に置く |
| AlertDialog | 起動の失敗はモーダルにしない | AlertDialog はモーダル | 残す（起動の失敗は、タイトルバーを使えるようにモーダルにしない。DESIGN.md） |

### Popover と DropdownMenu

アプリ: クイック設定のメニュー（`QuickSettingsMenu`、`role="group"` のパネル）と、色を選ぶポップオーバー（`ColorEntryWithSaveButton`）。翻訳エンジンの選択とログの設定は、レールの中で開きます。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | 自作（Esc、外を押す、フォーカスが外に出ると閉じる） | Radix Popover、Radix DropdownMenu | 判断（D-25）。クイック設定は `aria-pressed` のトグルの集まりで、メニュー（`role="menu"`）ではない |
| パネル | `--vox_surface`、`--vox_border`、8px、`--vox_shadow_overlay`、余白 .4rem | Popover は `w-72`（28.8rem）、余白 `p-4`（1.6rem）、`shadow-md`。DropdownMenu は余白 `p-1`（.4rem）、最小幅 12.8rem | DropdownMenu とは余白が一致。影は D-05 |
| 色のポップオーバー | `dark_950`、8px、影 | Popover（`popover` の地） | 地を `--vox_surface` にするのは寄せる |

### Collapsible と Accordion

アプリ: `SetupSection` と `AdvancedSection`（ネイティブの `<details>`。要約の行に状態を出す）、`Description`（最初の文のあとを「詳細」に畳む）。ほかに `aria-expanded` のボタンで開くもの（`UsagePresetSelector`、「ほかの機能」、単語の一覧、VR パネルの `Disclosure`）があります。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの `<details>` | Radix Collapsible、Radix Accordion | 判断（D-26）。`<details>` は、設定の検索で行を見つけたときに開く仕組みや、保存していない行を示す印（`data-unsaved-inside`）とつながっている |
| 見た目 | 要約の行は余白 `.8rem 0`、1.5rem/600。状態は 1.3rem | Accordion の Trigger は `py-4`（1.6rem）、`text-sm`（1.4rem）、500、ホバーで下線、右に回るシェブロン。項目の間に線 | D-26 に含める |
| Collapsible | — | 見た目なし（振る舞いだけ） | `aria-expanded` のボタンで開くものを Radix Collapsible にそろえるかは D-26 に含める |

### Tabs、ToggleGroup、Toggle

アプリ: 設定のメニュー（`aria-current="page"` のボタンを並べた `nav`）、プリセットの切り替え（`PresetTabSelector`）、翻訳エンジンの箱、ミュート、VR パネルの `SegmentRow`、`VolumeCheckButton`。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 設定のメニュー | ページを切り替えるナビゲーション | Tabs は同じページの中のパネルを切り替える | 残す（ページの移動なので、`nav` と `aria-current` が合う）。shadcn/ui では Sidebar の `SidebarMenuButton`（`data-active`）が近い（D-35） |
| プリセットの切り替え | 3つの `div role="button"` に `aria-pressed`、2.8rem。選んだものは `dark_750` | ToggleGroup（`type="single"`）か Tabs。List は `bg-muted` で余白 3px、選んだものは `background` の塗りと影 | 判断（D-27）。`div role="button"` を `button` にするのは寄せる |
| 押したままのボタン | ミュート、翻訳エンジン、音量の確認が、それぞれ `aria-pressed` を自分で描く | Toggle（`data-state="on"` で `accent` の塗り）。variant は default、outline。size は default、sm、lg | D-27 に含める。ミュートの押した状態は、今は琥珀色で描いている |

### Card

アプリ: `VoiceSettings.module.scss` の `.card`（1つのモデルやエンジン）。パーツは `.card_head` と `.facts`（`dl`）です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 余白と間 | 余白 `1.2rem 1.6rem` | 上下 `py-6`（2.4rem）、パーツの左右 `px-6`（2.4rem）、間 `gap-6`（2.4rem） | 判断（D-28）。設定のページに多く並ぶので、詰まり具合が変わる |
| 塗り、角丸、影 | 塗りなし、`dark_800` の `.1rem` の枠、8px、影なし | `bg-card`、`border`、`rounded-xl`（14px）、`shadow-sm` | 判断（D-05、D-28）。DESIGN.md は重いカードを使わず、枠は1つのサーバーやエンジンのような実際の単位にだけ使うとしている |
| パーツ | `.card_head`、`.facts` | Header、Title、Description、Action、Content、Footer | パーツの部品を作るのは寄せる |

### Badge

アプリ: `VoiceSettings` の `.badge`（`data-tone`。枠だけ、4px、1.2rem/500）、上のバーの数（Lilac の丸）とミュートの印（琥珀色）、設定の検索の結果の印、既定の印。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 形 | 4px の角、枠だけ | `rounded-full`（丸い端）、余白 `px-2 py-0.5`（.8rem、.2rem）、`text-xs`（1.2rem）/500 | 判断（D-29）。DESIGN.md は、角丸の段の外に棒と溝の丸い端だけを認めている |
| variant | `data-tone` が13種類（推奨、使用中、接続済み、準備完了、取得済み、動作中、確認中、未接続、変更あり、URL が正しくない、見つからない、自分で足したもの（点線）、ハードウェアの注意） | default、secondary、destructive、outline、ghost、link | D-29 に含める。アプリの印は状態を言葉で示すもので、色の variant より数が多い |
| 構造 | クラスと `data-tone`。印が5か所に分かれている | `Badge` 部品と `badgeVariants` | `Badge` 部品にまとめるのは寄せる（見た目は D-29 が決まるまで今のまま） |

### Alert

アプリ: `EnvReadout`（環境の読み出し）、`VoiceSettings` の `[role=alert]`、`.hardware_warning`、`.restriction`、`ChatboxLengthWarning`。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 環境の読み出し | `--vox_surface`、左に 3px の状態の色の線、8px、1.3rem/500、等幅の数字 | `rounded-lg`、全体の枠、`px-4 py-3`（1.6rem、1.2rem）、`text-sm`、アイコンの列 | 残す（DESIGN.md「Roles in settings」が環境の読み出しの形を決めている） |
| variant | `tone`: neutral、active、warning、failed。`live` で `role="status"` | default、destructive。常に `role="alert"` | 残す（状態は言葉で示し、色は言葉を繰り返すだけ。読み上げの強さも状態ごとに選んでいる） |
| 注意の箱 | 琥珀色の枠の箱、琥珀色の左の線、`--vox_warning_tint` の塗りの3通り | Alert の1つの形 | 判断（D-30） |

### Separator

アプリ: 共通の部品はありません。大見出しの右の細い線（`--vox_border`）、`Templates` の行の下の線（`dark_800`）、kit の行の間の線（`--vox_border`）がそれぞれの CSS にあります。`dark_800` と `--vox_border` は同じ値です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 構造 | 線をそれぞれの CSS で描く | Radix Separator（既定で `decorative`、`h-px`、`bg-border`） | `Separator` 部品にまとめるのは寄せる。Radix のパッケージを足すかは D-12 |

### Skeleton、Spinner、Progress

| 部品 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| Skeleton | `[data-skeleton]` を `MainPage.css.ts` の全体のスタイルで描く。`--vox_skeleton`、4px、1.8 秒のゆっくりした明滅 | `Skeleton` 部品、`animate-pulse`、`bg-accent`、8px | 判断（D-31）。DESIGN.md は明滅をゆっくり薄くと決めている。属性で描く今の形は、値が届くまで実際の部品の大きさを保つためのもの |
| Spinner | `mixins.scss` の `loader`（2色の弧、0.6 秒）、SVG の `CircularProgress`、`EnvReadout` の印 | `Spinner`（lucide の `Loader2Icon`、`role="status"`、`aria-label="Loading"` は英語で固定） | 1つの部品にまとめるのは寄せる。読み上げる名前は英語で固定せず、`locales/` の文言にする（残す）。アイコンは D-11 |
| Progress | ネイティブの `<progress>`（.6rem、`dark_825` の溝、`primary_500`、丸い端）、`CircularProgress` | Radix Progress（`h-2`（.8rem）、`rounded-full`、溝は `primary/20`） | 判断（D-32）。溝の `primary/20` は、明度だけを変える色の作り方から外れる |

### Toast

アプリ: `SnackbarController`（react-toastify 11）。`dark_950`、8px、最小の高さ 6.4rem、1.4rem。種類ごとのアイコンと、`.4rem` の残り時間の線があります。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | react-toastify | sonner（`Toaster`。`next-themes` の `useTheme()` を使う） | 判断（D-33）。依存の入れ替えになる。通知が操作を覆わない置き方（DESIGN.md「Layout」）を sonner で保てるかを確かめる |
| 見た目 | `dark_950` | `popover`、`border`、`--radius` | D-02 |

### Field と Label

アプリ: kit の `SettingGroup` と `SettingRow`、`FormRow`、`_templates/Templates.tsx` の約20種類の `*Container`、`LabelComponent`、`SectionLabelComponent`、`Description`、`Hint`。#676 と #677 で、説明を吹き出し（`Hint`）に入れるページが増えました。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 構造 | 名前、説明、操作する部品を1つの行の部品にまとめ、`id` と `aria-describedby` を操作する部品に渡す（`SettingRow` は render prop、`FormRow` は子を複製する） | Field、FieldLabel、FieldDescription、FieldError、FieldGroup、FieldSet、FieldLegend、FieldContent、FieldTitle、FieldSeparator を組み合わせる。`aria-*` は使う側が付ける | 判断（D-34）。パーツに分けると、`id` を結び付ける仕事が使う側に移る |
| 並び | 名前 1fr と操作 1.6fr の2列、間 1.6rem。内容の幅が 42rem 未満か、ウィンドウが 700px 未満で縦に積む（DESIGN.md #567） | `orientation`: vertical（既定）、horizontal、responsive | 列の幅と積む条件は残す（DESIGN.md の欄の幅の規則と `test_settings_fields_follow_the_width_rule`）。kit の `layout` を `orientation` の名前にするかは D-34 に含める |
| 名前 | 1.4rem/500 | Label は `text-sm`（1.4rem）、500 | 一致 |
| 説明 | 1.2rem、`--vox_description_text`。#614 を当てたページでは吹き出しに入れる | `text-sm`（1.4rem）、`muted-foreground` | 残す（DESIGN.md「Roles in settings」の一般的な説明は 1.2rem） |
| エラー | 行ごとの注意（`add_warnings`） | FieldError（`role="alert"`、赤い文字） | D-34 に含める |
| 行の区切り | `Templates` は行の下の線、kit は行の間の線 | 線なし（間 `gap-7`、2.8rem） | 設定画面の部品の実験の残課題 K-03 と同じ問い |

### Empty と Sidebar

| 部品 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| Empty | 会話の空の画面（`EmptyState.tsx`）、試験的な機能の点線の枠、検索の「結果なし」。設定の検索と言語の一覧の「結果なし」は、`common_components` の `Empty` と `EmptyDescription`（中央寄せ、余白 2.4rem、1.4rem の説明の色の文、#695） | Empty（中央寄せ、`p-6`、幅 768px 以上で `md:p-12`、Header、Media、Title、Description、Content） | 会話の空の画面は残す（DESIGN.md「Layout」が位置と出し方を決めている）。ほかの「結果なし」を Empty の形にそろえるのは寄せる（検索の2か所は #695 で寄せた。`md:p-12` は D-39） |
| Sidebar | メインのレール（24rem。狭いと 7.2rem のアイコンのレール、さらに狭いと会話に重なる）と設定のレール（5.6rem。ホバーとフォーカスで広がる） | Sidebar（25.6rem、アイコンだけで 4.8rem。`collapsible`: offcanvas、icon、none。Ctrl/Cmd+B で開閉し、状態を Cookie に保存） | 幅と振る舞いは残す（DESIGN.md「Layout」が決めている。小さいレールの好みは設定に保存する）。狭いウィンドウで会話に重なるレールは Sheet（Radix Dialog）に近いが、これも残す。メニューの行の高さと選んだ行の表し方は判断（D-35） |

### そのほか

- Kbd: アプリにありません。ホットキーの欄は、入力欄の中に「Ctrl + Q」のように文字で出しています。キーを示す場所ができたら寄せます。
- ScrollArea: アプリは `root.css` でスクロールバーを全体に描いています。Radix ScrollArea はネイティブのスクロールバーを隠すために `<style>` を差し込む見込みがあるので、今は寄せません。
- Table: `GpuCheck` の表だけです。shadcn/ui の Table は Radix を使わないので、表に手を入れるときに寄せます。
- Item: 初期設定（#557）の「いまの状態」を、Item の形（ItemGroup、Item、ItemMedia、ItemContent、ItemTitle、ItemDescription、ItemActions）にそろえ、同じ名前の `data-slot` を付けました。部品にはまだ分けていません（初期設定の `FirstRunSetupController.css.ts`）。shadcn/ui との違いは3つです。行の操作は、行の右端ではなく説明の下に置きます。説明が1〜2文の日本語で、右端に置くと説明の列が狭くなり、4行に折り返したためです。行の印（ItemMedia）は、状態を4通りの印で示します。対応が要る行は、ほかの行の前に、琥珀色の線と地を持つ1枚ずつのカードとして置き、ほかの行は1つの枠の中に小さくまとめます。文を読む前に、配置と形と大きさと色で対応が要るかが分かるようにするためです（DESIGN.md「Components」、#614）。
- アプリだけのもの: `FileDropZone`、保存バー、コンパニオンの取っ手、VR パネル（px の段で描く別の画面）、字幕のオーバーレイ、しきい値の部品（音量のメーターと一体。D-41）。照合の外にしました。

## 判断項目

決まった項目は、下の[決まった判断](#決まった判断)にあります。この表は問いの記録として、決まったあとも書き換えません。

| ID | 問い | 関係する部品 |
|---|---|---|
| D-01 | shadcn/ui のどのスタイルに寄せるか。`new-york-v4` はいまは legacy の扱いで、新しいスタイル（vega、nova など）は Radix の部品とは別の CSS からクラスを組み立てる。この文書は `new-york-v4` で照合した | すべて |
| D-02 | 色のトークンの対応表（上の案）を確定するか。特に `secondary`、`accent`、`input` の塗り、スライダーのつまみの白、トーストとダイアログの地 | すべて |
| D-03 | 操作の高さを 4rem（shadcn/ui の `lg`）のままにするか、3.6rem（既定）にするか。DESIGN.md の front matter は 40px | Button、Input、Select |
| D-04 | `rounded-lg`（10px）を 8px と 12px のどちらに、`rounded-sm`（6px）を 4px と 8px のどちらに寄せるか | Dialog、Select の行、Alert、Card |
| D-05 | 影を足すか（入力欄と outline のボタンに `shadow-xs`、カードに `shadow-sm`、一覧に `shadow-md`、ダイアログに `shadow-lg`）。DESIGN.md は普段のフォームに飾りの影を使わない | Button、Input、Select、Card、Dialog、Popover |
| D-06 | フォーカスの輪を、外に離した `.2rem` の線のままにするか、shadcn/ui の 3px の `ring/50` にするか。後者は 3:1 を確かめてから | すべての操作する部品 |
| D-07 | 使えないボタンに `pointer-events: none` を付けるか。使えない理由をツールチップで示す規則とぶつかる | Button |
| D-08 | ホバーと押下の色を、明度を変えた段（今）にするか、不透明度（`/90`、`/80`）にするか | Button、Checkbox |
| D-09 | 開閉の動きを、今の「落ちて落ち着く」にするか、shadcn/ui の `fade` と `zoom-in-95` にするか | Select、Popover、Dialog、Tooltip |
| D-10 | ボタンの variant の名前と対応。#474 の役割（primary、plain、quiet、danger）と shadcn/ui（default、secondary、outline、ghost、destructive、link）。shadcn/ui の destructive は赤の塗りで、アプリの danger は塗らない | Button |
| D-11 | アイコンに lucide-react を足すか、アプリの SVG のままにするか | Select、Checkbox、Spinner、Dialog |
| D-12 | 見た目のための Radix のパッケージ（Slot、Separator、Label）を足すか。足すならライセンス台帳と `NOTICE.md` に載せる | Button、Separator、Field |
| D-13 | textarea に `field-sizing: content`（Baseline Widely available ではない）を、機能の検出と代わりの表示を付けて使うか | Textarea |
| D-14 | 設定の行の選択欄（自作の combobox の `_DropdownMenu`）を、NativeSelect（kit の `Select`）にそろえるか、Radix Select にするか。Radix Select は CSP の更新が要り、開いた一覧の操作が OS と VR パネルのポインタで変わる（K-05） | Select |
| D-15 | 一覧の選んだ行を、色と太さ（今）で示すか、右のチェック（shadcn/ui）で示すか | Select |
| D-16 | チェックボックスとラジオの土台を、ネイティブの input（今）にするか、Radix にするか | Checkbox、RadioGroup |
| D-17 | 小さい操作部品の大きさ。チェックボックス 2.8rem から 1.6rem、ラジオ 2rem から 1.6rem、スイッチ 4.4×2.4rem から 3.2×1.84rem、スライダーのつまみ 1.8rem から 1.6rem。押せる範囲を行全体にするかとあわせて決める | Checkbox、RadioGroup、Switch、Slider |
| D-18 | スイッチの溝の縁をなくすか。なくすなら、DESIGN.md の 3:1 を別の形で満たす | Switch |
| D-19 | メインの機能のスイッチ（行全体が `role="switch"`）を Radix Switch で作り直すか | Switch |
| D-20 | スライダーを Radix Slider に置き換えるか。値の吹き出しと目盛りは shadcn/ui にない | Slider |
| D-21 | ツールチップを Radix Tooltip に置き換えるか。`title` 属性と `Hint` も含めるか。開くまでの待ち時間をどうするか | Tooltip |
| D-22 | ツールチップの色を反転（明るい地に暗い文字）させ、矢印を付けるか | Tooltip |
| D-23 | ダイアログの土台を、ネイティブの `<dialog>` のままにするか、Radix Dialog にするか（CSP） | Dialog |
| D-24 | ダイアログのボタンの並び（狭いと縦、広いと右寄せ）と、右上の閉じるボタンを取り入れるか | Dialog |
| D-25 | クイック設定のメニューを、Popover にするか DropdownMenu にするか | Popover、DropdownMenu |
| D-26 | 畳みの土台を `<details>` のままにするか、Radix Collapsible や Accordion にするか。見た目をどちらに寄せるか | Collapsible、Accordion |
| D-27 | プリセットの切り替えと押したままのボタンを、ToggleGroup と Toggle（Radix）にするか | ToggleGroup、Toggle |
| D-28 | カードの余白と間を 2.4rem にし、塗りと角丸を寄せるか | Card |
| D-29 | 印（Badge）の形を丸い端にするか。variant をどう切るか | Badge |
| D-30 | 注意の見た目（3通り）を Alert の1つの形にそろえるか | Alert |
| D-31 | 骨組みの表示を `Skeleton` 部品にするか | Skeleton |
| D-32 | 進み具合の溝を `primary/20` にするか | Progress |
| D-33 | トーストを react-toastify から sonner に替えるか | Toast |
| D-34 | 設定の行を Field のパーツに分けるか。`id` と `aria-describedby` を結び付ける場所、`orientation` の名前、エラーの出し方 | Field |
| D-35 | レールのメニューの行の高さ（`h-8`）と、選んだ行の表し方（`data-active`）を寄せるか | Sidebar、設定のメニュー |
| D-36 | 設定の検索と言語の一覧を、Combobox（Base UI）や Command（cmdk）にするか、自作のまま見た目だけを寄せるか。どちらにも Radix で書いたものがない | Combobox、Command |
| D-37 | `_Entry` に残った kit との差をどうするか。左右の余白は .6rem で、kit と DESIGN.md の `input` は 1.2rem。1.2rem にすると、幅 6rem のしきい値の欄では文字の入る幅が 4.6rem から 3.4rem に減る。使えない状態は文字の色だけを変え、kit は全体を .5 に薄くする。待ちの状態も同じ見た目を使うので、待ちの表し方（DESIGN.md）とあわせて決める | Input |
| D-38 | ボタンの文字を 500 のままにするか。既定の UI フォントの Yu Gothic UI と、選べる Meiryo UI には 500 の字面がなく、CSS の字面の選び方では 400 で描かれる見込み（Windows では確かめていない）。フォームのボタンは 600 から 500 にしたので、それらのフォントでは太字が標準の太さに変わる | Button |
| D-39 | Empty の広い画面での余白（`md:p-12`、4.8rem）を取り入れるか。shadcn/ui はウィンドウの幅 768px 以上で 2.4rem から 4.8rem に広げる。アプリの Empty は検索の結果の一覧や言語の一覧の中に開くので、2.4rem のままにした | Empty |
| D-40 | 設定の検索欄の中身を InputGroup に寄せるか。虫眼鏡のアイコンは 1.5rem で `size-4`（1.6rem）より小さく、左の余白は .8rem で `pl-3`（1.2rem）より狭く、文字は 1.3rem で入力欄の 1.4rem より小さい。広いウィンドウの検索欄は設定のレールの幅（20.8rem）から左右の余白を引いた 17.6rem で、文字を大きくすると入る文字が減る | Combobox、InputGroup |
| D-41 | しきい値の部品（音量のメーターに重ねた細いつまみ）を Slider に寄せるか、メーターと一体のアプリだけの部品として照合の外にするか。寄せるなら、つまみの形（幅 .4rem、高さ 4rem）とメーターの色をどう扱うかも決める | Slider |
| D-42 | ツールチップの文字の細部を寄せるか。アプリは 500 の太さで行の高さ 1.6、shadcn/ui は太さの指定がなく（400）、`text-xs` の行の高さは 1.33 で、`text-balance` で行の長さを釣り合わせる。`Hint` は複数行の説明を出すので、行の高さは DESIGN.md の説明の 1.6 にそろえた | Tooltip |

ほかに、#680 の判断項目（寄せる先を本家の shadcn/ui にすること、ADR-010 の7章への注記、ライセンスの記録の範囲）と、設定画面の部品の実験の残課題 K-01（kit を本採用するか）が、この棚卸しに関係します。

## 決まった判断

上の判断項目のうち、決まったものです。

| ID | 決定 | 決めた日 | 文書と実装への反映 |
|---|---|---|---|
| D-41 | しきい値の部品（音量のメーターに重ねた細いつまみ）は、共通の Slider に寄せない。メーターと一体のアプリだけの部品として、照合の外にする | 2026-11-19 | 実装は変えない。Slider の節と「そのほか」に照合の外と書いた |
| D-42 | ツールチップの文字の細部は今のままにする。太さは 500、行の高さは 1.6 で、`text-balance` は付けない。`Hint` は複数行の説明を出すので、行の高さは DESIGN.md の説明の 1.6 を保つ | 2026-11-19 | 実装の値は変えない（`common_css/mixins.scss` の `tooltip_content`、#721 のまま）。その値の横に決定をコメントで書いた。Tooltip の節の「見た目」の行と、一覧の 10 の注記にも書いた |

## 判断なしで寄せられる差

上の表で「寄せる」とした差です。

kit（画面ではまだ使っていない部品）:

1. `Button`、`TextField`、`Select`、`Switch` のパーツに `data-slot` を付ける。名前は shadcn/ui の部品（button、input、native-select、switch）に合わせる（#684。`Select` の `option` と `optgroup` のパーツは #691）。
2. `Select` を NativeSelect にそろえる。シェブロンを 1.6rem にして右から 1.4rem に置き、使えないときは包む要素ごと薄くする（#684）。
3. `Button` の文字の太さを 500 にし、使えない状態の不透明度を .5 にする（#684）。

画面で使っている部品:

4. ボタンの文字の太さを 500 に、使えない状態の不透明度を .5 にそろえる。フォーム（`VoiceSettings.module.scss`）の `:disabled` は入力欄と選択欄にも共通の規則なので、一緒に .5 になる（#694。対象は、言葉があり塗りか枠のある操作のボタン。トグル、開閉のボタン、ナビゲーション、一覧の行、待ちの表示、照合の外の画面は含めていない）。
5. チェックボックスのチェックの線を `--vox_on_primary` にする（#697）。
6. スライダーの満ちた部分を描き、溝を .6rem にし、使えない状態を足す（#697。共通の `Slider` とフォームの `input[type=range]`。しきい値の部品は照合の外。D-41）。
7. `_Entry` の塗り、枠、角丸、高さを kit の入力欄にそろえる（#691。左右の余白と使えない状態は D-37）。
8. 色のポップオーバーと、設定の検索の結果の一覧の地を `--vox_surface` にする（設定の検索の結果の一覧は #695。色のポップオーバーは残っている）。
9. ダイアログの間を 1.6rem、最大幅を 51.2rem、背景を 50% の黒にする。ダイアログのパーツ（Header、Footer、Title、Description）の部品を作る。間と最大幅は、クイック設定のモーダルと起動の失敗を除くすべてのダイアログにそろえた（初期設定（#557）は #759、ほかは #759 の判断項目 4 による）。見出しと本文の段落が平らに並んでいた同意と確認のダイアログでは、それらを1つの部品（`VoiceSettings.module.scss` の `.dialog_text`。翻訳のライセンスの確認は `Translation.module.scss` の `.license_text`）にまとめ、その中の段落の間は .8rem のままにした。パーツの `data-slot` は初期設定のダイアログにだけ付けている。背景は、クイック設定のモーダルを除くダイアログで 50% の黒にした（#764 の判断項目 2 による）。パーツの部品は、次にダイアログを作り直すときにまとめて置き換える（#764 の判断項目 3 による）。
10. ツールチップの余白と角丸をそろえ、`Tooltip` と `Hint` の見た目を1つにする（#721。文字の細部は今のまま。D-42）。
11. プリセットの切り替えの `div role="button"` を `button` にする。
12. `Separator`、`Badge`、`Spinner` をそれぞれ1つの部品にまとめる（見た目は今のまま）。
13. 検索の「結果なし」を Empty の形にそろえる（設定の検索と言語の一覧は #695。`Empty` の部品を `common_components` に作った）。
14. フォームの選択欄のシェブロンを、kit の `Select` と同じ形、大きさ、位置にする（#691。色は D-02）。

kit の差で、表では「寄せる」にしていたのにこの一覧から漏れていたもの:

15. `Button` に、アイコンだけのボタンの `icon` の size を足す（#694。高さは D-03）。
16. アイコンの付いた `Button` の左右の余白を、regular で 1.2rem（`px-3`）、compact で 1rem（sm の `px-2.5`）にする（#694）。

画面の差で、表では「寄せる」にしていたのにこの一覧から漏れていたもの:

17. 設定の検索欄の塗りと枠を入力欄のトークン（`--vox_surface`、`--vox_field_border`）にし、InputGroup の `data-slot` を付ける。言語の一覧の検索欄に Input の `data-slot` を付ける（#695）。

## 段階の案

1. 段 1: kit をそろえる（上の 1〜3。一覧から漏れていた 15 と 16 は #694 で寄せた）。kit は画面でまだ使っていないので、画面は変わりません。最初に寄せる部品の PR なので、ライセンス台帳と `NOTICE.md` に shadcn/ui を載せます（#680）。
2. 段 2: 画面で使っている部品のうち、判断の要らない見た目の差（上の 4〜14 と 17）。部品ごとに PR を分けます。
3. 段 3: 判断項目が決まったものから。Radix への置き換え（D-14、D-16、D-19〜D-21、D-23、D-25〜D-27）は、ADR-010 の順（自作ではアクセシビリティを保ちにくい部品から）で進めます。CSP に触れる部品は、入れる前に `<style>` を差し込むかを確かめます。
4. 設定の行（D-34）は、#554 の情報設計で設定画面を組み直すときに合わせます。
