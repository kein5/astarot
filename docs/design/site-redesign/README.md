# マニュアルサイトの再設計の提案

利用者向けのサイト（`site/`）の作りを見直す提案です。ガイドとマニュアルを1つのサイトにまとめ、見た目をアプリと同じASTAROTの配色にそろえ、部品をshadcn/uiの設計にならって作り直します。作り替えは8段に分け、1つの大きなPRにはしません。

- 状態: 提案（2026-11-19）。サイトの実装はまだ変えていません。決める必要のある点は[判断が要ること](#判断が要ること)に番号（S-01など）を付けて並べました。
- 前提: [棚卸し](inventory.md)。問題の番号（P-01など）は棚卸しの番号です。
- 関係: #371（マニュアルの新設）、#554（アプリの情報設計）、#680（部品をshadcn/uiに寄せる方針）、#673（0.6.0に向けたガイドの更新）、#690（サイトのVite）

## 決まっていること

- 土台はVitePressのままにします。日英の構成、検索、GitHub Pagesへの公開の仕組みを使い続けます。
- 部品は、shadcn/uiの設計を参考にした自前のVueの部品で作り直します。shadcn-vueは入れません。
- 色はASTAROTのブランドのトークンを使います。正本はDESIGN.mdと`docs/brand/`です。アプリの設定画面と見た目の言葉をそろえます。
- 動くマスコット（悪魔ペンギン）の新しいモデルは、別の作業で完成しています。サイトに組み込むのはこの設計が固まってからです。この文書には置き場の候補と組み込み方の方針だけを書きます。

## 提案の要点

1. ガイドとマニュアルを1つにします。本文の正本はガイドのページ（`/ja/`と`/en/`の下）にし、#371で承認したマニュアルのトップの構成をサイトのトップに移します。`/manual/`は転送のページにします（P-01、P-02、P-03、P-04）。
2. URLは変えません。ページのファイルの場所はそのままにし、サイドバーとナビゲーションだけを組み替えます。配布済みのアプリが開くURL（[棚卸し](inventory.md#外から参照されているurl)）はすべて同じ内容を開きます。
3. サイドバーのまとまりの名前を、アプリの設定のメニューのまとまり（#554）にそろえます（P-08）。
4. 色はDESIGN.mdのトークンを正本にします。ダークはアプリと同じ値にし、ライトは同じ規則で作った値にします。紺の配色はサイトから外します（P-05）。
5. 部品は`site/.vitepress/theme/ui/`に、shadcn/uiの部品と同じ名前と`data-slot`で作ります。2つずつある部品は1つにします（P-06）。
6. どの段も、その段だけで公開できる状態でマージします。developにマージした変更はそのまま公開されるためです。

## 1. 情報構成

### 1.1 方針

- 1つの事実は1つのページにだけ書きます。トップのページはほかのページの事実を写さず、要約とリンクを置きます（P-02）。
- URLと並び順を分けて扱います。URLは外から参照される約束なので動かしません。読み手に見せる並びはサイドバーで決めます。
- アプリと同じ言葉で並べます。アプリの設定と見比べる読み手が、同じまとまりの名前で機能を探せるようにします。
- 初めての読み手が最初のメッセージを送るまでのページを短くします。参考の表は、必要になったときに読む場所へ移します。

### 1.2 サイドバー

| まとまり（日本語／英語） | ページ（この順） | 今のまとまり |
|---|---|---|
| はじめに／Getting started | ASTAROTとは、インストール、最初の設定、やりたいことから探す、声と文字の流れ | はじめに、やりたいこと |
| 会話の基本／Conversation | 翻訳、音声認識（ASR）とリアルタイム字幕、字幕とVR、入力の小窓とホットキー | 声と文字の機能、画面と連携 |
| 声と読み取り／Voice and reading | テキスト読み上げ（TTS）、ボイスチェンジャー（RVC）、チャット読み取り（OCR） | 声と文字の機能 |
| 音声経路と連携／Audio routes and other apps | 入力と出力、Windowsの音声経路、Linuxの音声経路、OBSとWebSocket | 画面と連携、設定と運用 |
| モデル／Models | モデルの取得、自分のモデルを使う | 設定と運用、やりたいこと |
| 困ったときと資料／Help and reference | 困ったとき、動作環境と推奨スペック、対応環境と検証の範囲、プライバシー、ライセンスと謝辞 | はじめに、設定と運用 |

- 「会話の基本」「声と読み取り」は、アプリの設定のメニューのまとまりの名前です（DESIGN.mdの「Layout」）。アプリの「会話の基本」にはVRChatのページもあります。ガイドではOSCの設定を「最初の設定」に書いているので、このまとまりには入れません。
- アプリではホットキーの設定は「使い心地」のまとまりにあります。ガイドの「入力の小窓とホットキー」は、会話の途中で文章を送る小窓が中心なので、「会話の基本」に置きます。
- 動作環境と対応環境の表は「困ったときと資料」に移し、「インストール」の冒頭とトップからリンクします。初めての読み手は「ASTAROTとは」「インストール」「最初の設定」の3ページで、最初のメッセージを送れます。
- 「自分のモデルを使う」は「モデルの取得」と並べます。どちらもモデルのファイルを用意するページです。
- 音声経路のページは「入力と出力」と並べます。マニュアルの章「音声経路とVR」の考え方を引き継ぎます。

### 1.3 上部のバー

左から次の順に置きます。

1. ASTAROTのアイコンと名前（そのページの言語のトップへ）
2. 検索（パレットを開くボタン。`Ctrl`+`K`と`/`でも開く）
3. 「インストール」「やりたいことから探す」「困ったとき」
4. 「リリースノート」（GitHub Releasesへ。外のサイトへ移ることを印で示す）
5. 言語のメニュー（日本語、English）
6. GitHub

ダウンロードのボタンは、トップのヒーローに加えて「インストール」のページの冒頭にも置きます（P-09）。どちらも同じ部品（2.3の`DownloadButton`）です。狭い画面では、VitePressのメニューのボタンに3から6をまとめます。

### 1.4 トップのページ

`/ja/`と`/en/`のトップは、次の順に並べます。

| 順 | 節 | 中身 | 元にするもの |
|---|---|---|---|
| 1 | ヒーロー | アイコンとワードマーク、2文の紹介、ダウンロードのボタン、「最初の設定」へのボタン、改名の注記、マスコット | マニュアルのヒーロー（#371）、ガイドの`HomeActions` |
| 2 | アプリの画面 | メイン画面のスクリーンショット | ガイドの`HomeShot` |
| 3 | 3つの手順 | 「ダウンロードして入れる」「VRChatとつなぐ」「送ってみる」。各手順から「インストール」「最初の設定」「翻訳」へ | マニュアルのクイックスタート |
| 4 | できること | 5つの機能。各機能に動画、2文の説明、ページへのリンク | ガイドの`HomeShowcase` |
| 5 | 目次 | サイドバーの6つのまとまりをカードで並べ、各ページへのリンクを置く | マニュアルの10章の目次 |
| 6 | 調べたいとき | 動作環境、対応環境、困ったとき、不具合の報告、リリースノート、プライバシーへのリンク | マニュアルの「動作環境」と「サポート」 |

- 6の節には版の番号や条件の数字を書きません。数字は「動作環境と推奨スペック」と「対応環境と検証の範囲」にだけ書きます。マニュアルのトップが`content.mjs`に持っていた動作環境とファイルの7種類の一覧はなくします（P-02）。
- マニュアルのトップの「目次の絞り込み」はなくします。サイト全体の検索（パレット）が本文まで探せるためです（P-04）。
- マニュアルの「5つの柱」（サブタイトルの語ごとの説明）と「案内役とコールアウトの見かた」の扱いは、S-05とS-06で決めます。

`/`の言語を選ぶページは今の動きのまま、見た目だけを新しいトークンにそろえます。

### 1.5 `/manual/`の扱い

`/manual/`と10章のページは、ガイドの対応するページへ移す転送のページにします。GitHub Pagesではサーバーの転送を設定できないので、転送のページは次のように作ります。

- 移る先を指す`<link rel="canonical">`を持ちます。
- `<head>`のスクリプトが、`/`と同じ決め方で言語を選んで移ります（`theme/locale.ts`の`preferredLocale()`）。JavaScriptが動かないときは、`<noscript>`の中の`<meta http-equiv="refresh">`で日本語のページへ移ります。今のマニュアルのHTMLが日本語なので、同じ言語のページへ移すことになります。
- 移る先へのリンクを本文にも置きます。

| マニュアルのパス | 移る先（`/<言語>/`の下） |
|---|---|
| `/manual/` | トップ |
| `/manual/introduction` | `guide/introduction` |
| `/manual/install` | `guide/install` |
| `/manual/screens` | `guide/how-it-works` |
| `/manual/translation` | `features/translation` |
| `/manual/speech` | `features/transcription` |
| `/manual/voice` | `features/tts` |
| `/manual/chat-reading` | `features/chat-reading` |
| `/manual/audio-and-vr` | `features/io-flow` |
| `/manual/models` | `guide/models` |
| `/manual/help` | `guide/troubleshooting` |

`tools/check_site_manual.mjs`は、転送のページが上の表の先へ移ること、移る先のページが日英ともにビルドされていることを確かめる検査に書き換えます。転送のページをいつまで残すかはS-08で決めます。

### 1.6 ページの型

ページを4つの型に分け、型ごとに先頭と末尾に置くものをそろえます。本文の書き換えは機能ごとのPRで少しずつ進めます。この表は、そのときに合わせる形です。

| 型 | ページ | 先頭に置くもの | 末尾に置くもの |
|---|---|---|---|
| 手順 | インストール、最初の設定、Windowsの音声経路、Linuxの音声経路 | 必要なもの（`Alert`）、手順の一覧（`StepProgress`） | 次に読むページ |
| 機能 | `features/`の9ページ | 経路の帯（今は声と文字の機能の5ページにある）、必要なもの | うまくいかないときの確かめ方、関連するページ |
| 探す | やりたいことから探す、困ったとき | ページの中の目次 | — |
| 資料 | 動作環境と推奨スペック、対応環境と検証の範囲、プライバシー、ライセンスと謝辞 | 書いた日付と対象の版 | — |

## 2. 部品

### 2.1 作り方の決まり

- 置き場は`site/.vitepress/theme/ui/<部品>/`です。パーツを1つずつ`.vue`のファイルにし、フォルダーの`index.ts`がパーツを名前付きでexportします（`Card`、`CardHeader`、`CardTitle`など）。shadcn/uiの「1つの部品に1つのファイル、パーツは名前付きのexport」を、Vueの「1つのファイルに1つの部品」の形に読み替えたものです。
- 各パーツの根の要素に、shadcn/uiと同じ名前の`data-slot`を付けます（`card`、`card-header`など）。
- 見た目の種類は`variant`と`size`のpropsで受け、根の要素の`data-variant`と`data-size`に写します。CSSはこの属性で選びます。種類を組み立てるためのライブラリ（cvaなど）は入れません。
- スタイルは各部品の`<style scoped>`に書きます。色、角丸、余白、文字の大きさ、動きには3章のトークンだけを使います。部品のファイルに色の値を直接書いていないことを検査します。
- キーボードの操作（メニュー、タブ、吹き出し、ダイアログ）は自前のcomposableにまとめます。今の`useMenu.ts`、`OsTabs.vue`、`Term.vue`にある操作を出発点にします。先にネイティブの要素（`<button>`、`<dialog>`、`<details>`）を使います。ヘッドレスの部品のライブラリを入れるかはS-09で決めます。
- 部品の文言は`theme/i18n/ja.ts`と`theme/i18n/en.ts`に集め、日英のキーと補間の変数がそろっていることを検査します（P-12）。
- CSSの機能は、Baseline Widely availableのものをそのまま使い、それより新しいものは`@supports`と代わりの表示を付けたときだけ使います。AGENTS.mdのUIの決まりをサイトにも当てはめます。サイトは読み手のブラウザで開くので、Chrome、Edge、Firefox、Safariで読めることを前提にします。
- shadcn/uiの読み替えは、DESIGN.mdの「Components」の規則に従います。サイトの1 remはTailwindと同じ16 pxなので、shadcn/uiの長さはそのまま読めます（アプリの1 remは10 pxです）。色はshadcn/uiの値を使わず、3.2の対応表でASTAROTのトークンに置き換えます。shadcn/uiとDESIGN.mdの規則が違うところ（ボタンの役割、フォーカスの輪）は、DESIGN.mdに従います。
- NOTICE.mdのshadcn/uiの節は「アプリの部品」を対象に書いています。サイトの部品を寄せる最初のPRで、サイトの部品も対象だと書き足します。

### 2.2 基本の部品（`theme/ui/`）

| 部品 | 役割 | 参考にするshadcn/uiの部品 | 置き換えるもの |
|---|---|---|---|
| `Button` | 操作とリンクのボタン。見た目は`primary`、`plain`、`quiet`、`link`、大きさは`sm`、`default`、`lg`、`icon`。`href`を渡すと`<a>`で描く | Button。`asChild`の代わりに`href`で描き分ける | VitePressの`VPButton`（`HomeActions`）、マニュアルの`.secondary`と`.more` |
| `ButtonGroup` | 主のボタンとメニューを開くボタンを1つの組に見せる | Button Group | ダウンロードのボタンの組 |
| `Badge` | 短い状態の印（おすすめ、実験的機能） | Badge | マニュアルの目次の`.chip`、メニューの「おすすめ」 |
| `Kbd` | キーの名前 | Kbd、KbdGroup | 本文のキーの書き方、検索窓の`/` |
| `Card` | 枠で囲んだ1つのまとまり | Card（Header、Title、Description、Action、Content、Footer） | トップの機能と目次、マニュアルの関連するページと前後の章 |
| `Item` | 名前、1行の説明、行き先を並べる行 | Item（Media、Content、Title、Description、Actions）、ItemGroup | `{.feature-rows}`、サポートの一覧 |
| `Alert` | 本文の囲み | Alert（Title、Description） | VitePressのカスタムブロック、`ManualCallout`、`{.needs}` |
| `Separator` | 区切りの線 | Separator | h2の右の線、バーの区切り |
| `Spinner` | 読み込み中の印 | Spinner | ダウンロードのボタンの確認中の表示 |
| `DropdownMenu` | ボタンから開くメニュー | Dropdown Menu（Trigger、Content、Label、Group、Item、RadioGroup、RadioItem、Separator） | 2つのダウンロードのメニュー、`ManualLangMenu`、`useMenu` |
| `Tabs` | 同じ場所で中身を切り替える | Tabs（List、Trigger、Content） | `OsTabs`の切り替え |
| `Tooltip` | 用語の短い説明 | Tooltip。タップで開閉する動きはPopoverにならう | `Term`、`TermTooltip` |
| `Dialog` | 画面の上に開く窓 | Dialog | スクリーンショットの拡大、検索のパレットの枠 |
| `InputGroup` | 入力欄とアイコンやボタンを1つの枠にまとめる | Input Group（Addon、Button、Input） | `CopyText`、検索を開くボタン |
| `Command` | 検索のパレットの中身 | Command（Input、List、Empty、Group、Item、Shortcut） | `LocalSearchBox`の見た目 |
| `Empty` | 何もないときの表示 | Empty（Media、Title、Description、Content） | 検索の結果がないとき、404のページ |
| `Breadcrumb` | ページがどのまとまりにあるか | Breadcrumb | マニュアルの「目次へ戻る」 |
| `Collapsible` | 畳んだ補足 | Collapsible。ネイティブの`<details>`で描く | `::: details` |
| `Table` | 表 | Table。Markdownの表にスタイルを当てる | `.vp-doc`の表 |

`Alert`の種類と、Markdownでの書き方（今の`::: warning`を使い続けるか、GitHubの`> [!NOTE]`の形にするか）はS-06で決めます。どちらの書き方でも、Markdownを`Alert`で描くようにmarkdown-itのレンダラーを設定します。

### 2.3 サイトの部品（`theme/components/`）

| 部品 | 組み立て | 置き換えるもの |
|---|---|---|
| `DownloadButton` | `ButtonGroup`、`DropdownMenu`、`Badge`、`Spinner` | `DownloadButton.vue`と`ManualDownload.vue`。メニューには最新のリリースにあるファイルだけをOSごとに並べ、すべての版とインストールの手順へのリンクを付けます。マニュアルの固定の7つの枠はなくします（P-02） |
| `OsTabs` | `Tabs`と、全ページで共有するOSの選択（`os.ts`） | `OsTabs.vue`。両方の中身をページに残し、検索で見つかるようにする今の作りを保ちます |
| `Term` | `Tooltip` | `Term.vue`、`TermTooltip.vue` |
| `CopyText` | `InputGroup`、`Button` | `CopyText.vue` |
| `Callout` | `Alert`と、種類ごとのマスコットの表情（S-06） | `ManualCallout.vue`、カスタムブロック |
| `StepProgress` | 自前。shadcn/uiに当たる部品はありません | `StepProgress.vue`。色と動きをトークンに替えます |
| `RouteStrip` | 自前 | `RouteStrip.vue`。色の意味はS-04で決めます |
| `FeatureShowcase` | `Card`と動画 | `HomeShowcase.vue` |
| `QuickStart` | 番号付きの`Card` | マニュアルのクイックスタート |
| `ContentsGrid` | `Card`、`Item` | マニュアルの目次 |
| `MascotStage` | 自前（4章） | マニュアルのヒーローのマスコット |
| `ShotZoom` | `Dialog` | `theme/index.ts`の`zoom()` |
| `PagePager` | `Card`。shadcn/uiのPaginationの前後のリンクの形にならう | VitePressの前後のページのリンク、マニュアルの前後の章 |

### 2.4 VitePressの既定のテーマの部品

上部のバー、サイドバー、ページの中の目次、狭い画面のメニューは、VitePressの部品を使い続け、トークンと最小限のCSSで見た目を合わせます。参考にするshadcn/uiの部品は次のとおりです。

| VitePressの部品 | 参考にするshadcn/uiの部品 |
|---|---|
| `VPNav`（上部のバー） | Navigation Menu |
| `VPSidebar` | Sidebar（Group、GroupLabel、Menu、MenuButtonの選んだ状態） |
| `VPDocAsideOutline`（ページの中の目次） | Sidebarの小さい大きさ |
| `VPLocalNav`と`VPNavScreen`（狭い画面） | Sheet |

VitePressの部品を写して直す（フォークする）ことは、これ以上増やしません。写しはVitePressを上げるたびに合わせ直す必要があり、`LocalSearchBox.vue`はVitePress 2で約410行の差が出ています（P-11、#690）。`LocalSearchBox.vue`への変更は、見た目（`Command`にならうスタイル）と、今ある空の検索のときのページの一覧だけにとどめます。

## 3. 色と文字のトークン

### 3.1 層

トークンは3つの層で持ちます。

1. ブランドの色: Dark Plum `#261633`、Lilac `#A47AF5`、Off-White `#FAFAFC`、White（`docs/brand/README.md`）。
2. 役割のトークン: DESIGN.mdの`colors`の名前に`--a-`を付けたもの（`--a-canvas`、`--a-surface`など）。部品はこの層だけを使います。`--a-`は今のマニュアルのトークンの接頭辞です。
3. VitePressの変数（`--vp-c-*`）: 役割のトークンから値を引きます。VitePressの既定のテーマの部品は、この層を通して同じ配色になります。

ダークの値は、DESIGN.mdの`colors`をそのまま使います。DESIGN.mdから値を写すときに食い違いが起きないように、`tools/site_tokens.mjs`でDESIGN.mdのfront matterから`site/.vitepress/theme/tokens.css`のダークの値を書き出し、`--check`をPagesのワークフローで実行することを提案します（S-02）。

### 3.2 色の対応表

ライトの値は、DESIGN.mdの「Colors」の規則で作った案です。ブランドに役割に合う色があればそのまま使い、なければDark PlumかLilacの明度だけを変えています（OKLCHの色相の差は3°以内、彩度は元の色以下）。コントラストは2026-11-19に計算した値で、地（canvas）、面（surface）、レール（rail）に対するものです。

| DESIGN.mdの名前 | サイトのトークン | shadcn/uiの役割 | VitePressの変数 | ダーク（DESIGN.md） | ライト（案） |
|---|---|---|---|---|---|
| `canvas` | `--a-canvas` | `background` | `--vp-c-bg` | `#261633` | `#fafafc`（Off-White） |
| `rail` | `--a-rail` | `sidebar` | `--vp-c-bg-alt`、`--vp-sidebar-bg-color` | `#1c0f27` | `#f6f1fa`（Dark Plumを明るく） |
| `surface` | `--a-surface` | `card`、`popover` | `--vp-c-bg-elv`、`--vp-c-bg-soft` | `#332341` | `#ffffff`（White） |
| `border` | `--a-border` | `border` | `--vp-c-divider` | `#4e3d5d` | `#dfd7e8`（Dark Plumを明るく） |
| `field-border` | `--a-field-border` | `input` | `--vp-c-border` | `#877a94` | `#887995`（3.62〜4.03:1） |
| `text` | `--a-text` | `foreground` | `--vp-c-text-1` | `#fafafc` | `#261633`（Dark Plum、15.17〜16.87:1） |
| `secondary-text` | `--a-secondary-text` | — | `--vp-c-text-2` | `#cfc4d6` | `#544760`（7.72〜8.58:1） |
| `description-text` | `--a-description-text` | `muted-foreground` | `--vp-c-text-3` | `#aba0b5` | `#6a5d75`（5.50〜6.11:1） |
| `primary` | `--a-primary` | `primary` | `--vp-button-brand-bg` | `#a47af5` | `#a47af5`（Lilac。地に対して3.02:1） |
| （Lilacの上の文字） | `--a-on-primary` | `primary-foreground` | `--vp-button-brand-text` | `#261633` | `#261633`（5.37:1） |
| `primary-hover` | `--a-primary-hover` | `primary`を濃く | `--vp-button-brand-hover-bg` | `#b897f7` | `#9c72ed`（Lilacを暗く。上の文字は4.85:1） |
| `state-active` | `--a-state-active`、`--a-link` | — | `--vp-c-brand-1` | `#b797f8`（6.03〜7.67:1） | `#7046b6`（Lilacを暗く、5.83〜6.48:1） |
| `focus` | `--a-focus` | `ring` | — | `#d9c8fc` | `#7e55c7`（4.71〜5.24:1） |
| `state-warning` | `--a-state-warning` | — | `--vp-c-warning-1` | `#d4a162` | `#865813`（5.52〜6.14:1） |
| `state-failed` | `--a-state-failed` | `destructive` | `--vp-c-danger-1` | `#e4938e` | `#944a47`（5.67〜6.31:1） |
| `readout-rule` | `--a-readout-rule` | — | — | `#a47af5` | `#a47af5` |

- リンクの色（`--a-link`）は、ダークでもライトでも`state-active`と同じ値にします。DESIGN.mdはLilacを主な操作、選んだナビゲーション、フォーカスに使うとしています。リンクは行き先を選ぶ操作なので、Lilacの系統にします。
- ライトの`primary-hover`は、ダークと逆に暗くします。明るくするとボタンの地に対するコントラストが3:1を下回るためです。
- ライトの`state-warning`と`state-failed`は、DESIGN.mdのダークの作り方にならい、ライトの`state-active`と同じ明度（0.50）と低い彩度（0.10）にしました。
- マニュアルの今のライトの値のうち、`--a-link`（`#6a3fd2`）と`--a-trouble`（`#8a4a9e`）はこの規則に合いません（[棚卸し](inventory.md#3つの配色が並んでいる)）。上の表の値に置き換えます。
- 値は段2で、`brandPalette.test.js`と同じ基準の検査（色相、彩度、コントラスト）をサイトにも足してから確定します。

ライトとダークの切り替え方はS-01で決めます。

### 3.3 文字

| 役割 | 今のガイド | 提案 | DESIGN.mdとの対応 |
|---|---|---|---|
| 書体 | 読み手のPCの書体の並び（`custom.css`） | ガイドの今の並びに統一する。マニュアルの見出しのOutfitは使わない（S-07） | ウェブフォントを読み込まない（DESIGN.mdの「Do's and Don'ts」） |
| 本文 | 16 px | 16 px、行の高さ1.75 | 段の1.6 rem（`body-large`） |
| 小さい文字（表、注記の本文） | 15 px | 15 px | 段の1.5 rem |
| 補足の文字（キャプション、印） | — | 12 px | 段の1.2 rem（`description`） |
| h3 | 18 px | 18 px | 段の1.8 rem（`title`） |
| h2 | 22 px | 24 px。右へ細い線を引く今の形は残す | 段の2.4 rem。22 pxは段の間にあるので、h3の18 pxと見分けやすい24 pxへ移す。線は設定の`category-heading`の形 |
| h1 | 30 px | 30 px | アプリの段の外。読む面の見出しとして残す |

アプリの段（12、13、14、15、16、18、20、24 px）にない大きさは、24 pxより大きい見出しだけにします。トップの製品名は、マニュアルのヒーローと同じくアイコンとワードマークの画像で示します。文字で書く見出しの大きさは段5bで決めます。日本語の1行は今と同じく約40字（本文の列は640 px）にします。

### 3.4 角丸、余白、動き

| 種類 | 提案 | 今との違い |
|---|---|---|
| 角丸 | 2、4、8、12 pxの段（DESIGN.mdの`rounded`）。ボタンと入力欄は8 px、カードとダイアログは12 px、`Badge`は4 px | 段にない角丸（マニュアルの18 px、14 px、10 px、7 px、6 px、5 px、ガイドの部品の14 px、10 px、7 px、6 px、5 px）をなくす |
| 余白 | 4、8、16、24、40 pxの段（DESIGN.mdの`spacing`）に、ページの節の間の64 pxと96 pxを足す | — |
| 動き | 120 msと220 ms、`--a-ease`と`--a-ease-settle`（DESIGN.mdの「Motion」と同じ値）。動きを減らす設定では0 ms | ガイドの140 msと240 ms、マニュアルの140 msをそろえる |
| フォーカス | `--a-focus`の2 pxの輪を2 px離して描く | ガイドの部品に直接書いた`#a9ccff`をなくす |

## 判断が要ること

| 番号 | 決めること | 選べる案 | この提案で推す案と理由 |
|---|---|---|---|
| S-01 | ライトとダークの扱い | A: OSの設定に合わせ、切り替えのボタンも付ける。B: ダークだけ（今のガイド）。C: OSの設定に合わせ、ボタンは付けない（今のマニュアル） | A。#371で承認したマニュアルはライトとダークの両方に対応しています。読み手が明るい場所で長い文を読むときにライトを選べます。ダークはアプリと同じ値なので、アプリとの見た目はダークでそろいます |
| S-02 | ダークの値をDESIGN.mdから書き出すか | A: `tools/site_tokens.mjs`で書き出し、`--check`をCIで実行する。B: 手で写す | A。アプリの配色が変わったときに、サイトが古い値のまま残ることを防げます。紺のまま残った今の状態（P-05）がその例です |
| S-03 | サイドバーのまとまり（1.2） | A: アプリの設定のメニューの名前にそろえた6つ。B: 今の5つのまま並びだけ直す | A。アプリと同じ名前で探せます |
| S-04 | 経路の帯と図の色の意味 | A: 帯は方向で色分けせず、そのページの段だけをLilacで示す。方向は帯の名前（「自分から相手へ」）で示す。声と文字の流れの図は、アプリの「入力と出力」の図と同じ線の色（声、チャット、読み上げ）にする。B: 今のまま方向で色分けし、色だけをブランドに寄せる | A。Lilacは選んだもの（このページ）を示す色としてアプリと同じ意味になります。図はアプリの画面と同じ色の言葉で読めます。方向は今も帯の名前で書いてあるので、色を外しても意味は失われません |
| S-05 | マニュアルのトップの「5つの柱」と「案内役とコールアウトの見かた」をトップに残すか | A: どちらもトップから外す。サブタイトルはワードマークに残し、表情と囲みの見かたは「ASTAROTとは」の末尾に置く。B: トップに残す | A。トップを短くし、目次と機能の紹介を先に見せます。5つの柱は機能の紹介と内容が重なります |
| S-06 | 囲みの種類と表情 | A: GitHubの5種類（note、tip、important、warning、caution）と畳んだ補足。表情は種類ごとに付ける。B: マニュアルの6種類（うまくいかないときを含む）。C: 表情を付けない | A。VitePressがMarkdownで書ける種類と一致し、書き手が新しい書き方を覚えずに済みます。「うまくいかないとき」はページの型（1.6）の節で扱えます |
| S-07 | 見出しの書体 | A: 本文と同じ書体。B: Outfitが入っているPCだけOutfit | A。読み手のPCによって見出しの形が変わらなくなります。ブランドの書体はワードマーク（画像）で示せます |
| S-08 | `/manual/`の転送のページをいつまで残すか | A: 期限を決めずに残す。B: 1つの正式版のあいだ残し、その次の正式版で消す | A。リポジトリの中に`/manual/`へのリンクはありません（2026-11-19に確認）。ただし0.5.0から公開しているので、ブックマークや検索エンジンから来る読み手がいる可能性があります。転送のページは小さく、残しても手間が増えません |
| S-09 | 操作の部品の振る舞いを自前で書くか | A: 自前のcomposableとネイティブの要素。B: Reka UIなどのヘッドレスの部品を入れる | A。サイトに要る操作はメニュー、タブ、吹き出し、ダイアログの4つで、今のコードに土台があります。依存とライセンスの確認も増えません |
