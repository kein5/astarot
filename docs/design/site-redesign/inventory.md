# マニュアルサイトの棚卸し（2026-11-19）

利用者向けのサイト（`site/`）の今の作りを記録した文書です。[再設計の提案](README.md)の前提にします。棚卸しは`develop`（`3d0acb57`）のファイルから作りました。サイトのコードは変えていません。

- 対象: `site/`のページ、`site/.vitepress/`のテーマ、`site/public/`の画像と動画、`site/motion/`
- 対象外: ページの文章の正しさ（機能の説明が今のアプリと合っているか）。文章の更新は機能ごとのPRで進んでいます（例: #673）。

## 公開の仕組み

| 項目 | 今の作り |
|---|---|
| 土台 | VitePress 1.6.4。`vite`は`site/package.json`の`overrides`で6.4.6に固定しています。VitePress 1.6.4のままVite 8に上げると、各ページの`*.lean.js`が出力されず、公開したページのJavaScriptが動かなくなります（#690） |
| 公開先 | `https://kein5.github.io/astarot/`（`base: '/astarot/'`、`cleanUrls: true`） |
| 公開の流れ | `.github/workflows/pages.yml`。`site/`に触れるPRではビルドと検査だけを行い、developへのpushで公開します |
| ビルド後の検査 | `tools/check_site_search.mjs`（日本語の文中の語で検索できるか）、`tools/check_site_anchors.mjs`（見出しへのリンクが見出しを見つけるか）、`tools/check_site_downloads.mjs`（リリースのファイルを正しく読み分けるか）、`tools/check_site_manual.mjs`（マニュアルの日英の語、章のページ、画像） |
| ビルドの対象外 | `site/motion/`。Remotionのプロジェクトで、`srcExclude`でビルドから外しています。書き出した動画だけを`site/public/motion/`に置きます |

developにマージした変更は、そのまま公開されます。そのため、再設計の各段は、その段だけで公開できる状態にしてからマージする必要があります。

## ページの構成

サイトには入口が3つあります。

| パス | 中身 | 作り |
|---|---|---|
| `/` | 言語を選ぶページ | `site/index.md`。`<head>`のスクリプトが、保存した言語かブラウザの言語で`/ja/`か`/en/`へ移します。JavaScriptがないときは、両方の言語へのリンクとGitHub Releasesへのリンクを出します |
| `/ja/`、`/en/` | ガイドのトップ | VitePressの`home`のレイアウト。ヒーロー、ダウンロードのボタン、メイン画面のスクリーンショット、5つの機能と動画、モデルの取得の注記 |
| `/ja/guide/*`、`/ja/features/*`（`/en/`も同じ） | ガイドの本文 | 言語ごとに23ページ。VitePressの`doc`のレイアウトで、左にサイドバー、右にページ内の目次 |
| `/manual/` | ASTAROTユーザーマニュアルのトップ | `layout: false`、`search: false`。テーマの外枠を使わず、`ManualShell.vue`が自分の外枠を描きます（#371、#372） |
| `/manual/<章>` | マニュアルの章 | 10章。本文はまだなく、どの章も「準備中」の注記と、同じ内容のガイドのページへのリンクだけを出します |

### ガイドの23ページ

サイドバーは5つのまとまりに分かれています（`site/.vitepress/config.mts`の`sidebarJa()`と`sidebarEn()`）。行数は日本語のページのものです。英語のページも同じ構成です。

| まとまり | ページ | 行数 | 使っている部品と記法 |
|---|---|---|---|
| はじめに | ASTAROTとは（`guide/introduction`） | 30 | `{.feature-rows}` |
| | インストール（`guide/install`） | 137 | `CopyText`×5、`Term`×2 |
| | 動作環境と推奨スペック（`guide/requirements`） | 97 | `Term`×2 |
| | 対応環境と検証の範囲（`guide/support`） | 88 | 表 |
| | 最初の設定（`guide/first-setup`） | 79 | `StepProgress`、`CopyText`×2、画像×2 |
| | 声と文字の流れ（`guide/how-it-works`） | 69 | `OsTabs`、図（SVG）×2 |
| やりたいこと | やりたいことから探す（`guide/tasks`） | 109 | `[[toc]]`、`{.needs}`×8 |
| | 自分のモデルを使う（`guide/custom-models`） | 144 | `Term` |
| 声と文字の機能 | 翻訳（`features/translation`） | 55 | 経路の帯 |
| | 音声認識（ASR）とリアルタイム字幕（`features/transcription`） | 130 | 経路の帯、画像×2 |
| | テキスト読み上げ（TTS）（`features/tts`） | 105 | 経路の帯、`OsTabs`、`Term` |
| | ボイスチェンジャー（RVC）（`features/voice-conversion`） | 109 | 経路の帯、`OsTabs` |
| | チャット読み取り（OCR）（`features/chat-reading`） | 69 | 経路の帯 |
| 画面と連携 | 字幕とVR（`features/vr`） | 59 | 画像×3 |
| | 入力と出力（`features/io-flow`） | 72 | 画像×3 |
| | 入力の小窓とホットキー（`features/quick-chat`） | 40 | 画像 |
| | OBSとWebSocket（`features/integrations`） | 47 | 画像×2 |
| 設定と運用 | モデルの取得（`guide/models`） | 97 | `CopyText`×2 |
| | Windowsの音声経路（`guide/windows-audio`） | 50 | 経路の帯 |
| | Linuxの音声経路（`guide/linux-audio`） | 47 | 経路の帯、`CopyText` |
| | 困ったとき（`guide/troubleshooting`） | 98 | `CopyText`、`Term`×2 |
| | プライバシー（`guide/privacy`） | 69 | 画像 |
| | ライセンスと謝辞（`guide/license`） | 29 | — |

注記にはVitePressのカスタムブロック（`::: info`、`::: tip`、`::: warning`、`::: details`）を使っています。日本語のページでは13ページにあり、全体で`warning`が8個、`details`が6個、`info`が4個、`tip`が1個あります。`danger`は使っていません。上部のナビゲーションは「ガイド」「インストール」「困ったとき」の3つです。

### マニュアルの10章

章の一覧は`site/.vitepress/theme/manual/content.mjs`の`CHAPTERS`にあります。各章はガイドのページへのリンクを持ち、状態は`guide`（ガイドで読める）が9章、`pending`（準備中）が1章（画面と操作）です。

| 章 | リンクしているガイドのページ |
|---|---|
| はじめに | ASTAROTとは、動作環境と推奨スペック、対応環境と検証の範囲 |
| インストールと最初の設定 | インストール、最初の設定 |
| 画面と操作（準備中） | 声と文字の流れ、入力の小窓とホットキー |
| 翻訳 | 翻訳 |
| 音声認識と字幕 | 音声認識（ASR）とリアルタイム字幕 |
| 読み上げと声の変換 | テキスト読み上げ（TTS）、ボイスチェンジャー（RVC） |
| チャット読み取り | チャット読み取り（OCR） |
| 音声経路とVR | 入力と出力、Windowsの音声経路、Linuxの音声経路、字幕とVR |
| モデルとほかのアプリとの連携 | モデルの取得、自分のモデルを使う、OBSとWebSocket |
| 困ったときは | 困ったとき、プライバシー、ライセンスと謝辞 |

どの章からもリンクしていないガイドのページは「やりたいことから探す」だけです。

マニュアルのページは日本語でビルドし、スクリプトが動いたあとで、その場で英語に切り替えます（`manual/locale.ts`）。言語は`?lang=`、保存した言語、ブラウザの言語の順に決めます。

### 外から参照されているURL

次のURLは、配布済みのアプリ、README、SUPPORT.mdが開くか、公開してから時間がたっているものです。配布済みのアプリは書き換えられないので、再設計のあとも同じURLで同じ内容を開く必要があります。

| URL（`https://kein5.github.io/astarot`の下） | 参照しているところ |
|---|---|
| `/ja/`、`/en/` | アプリ（`src-ui/logics/ui_configs.ts`の`vrct_document_home_url`）、SUPPORT.md |
| `/<言語>/guide/troubleshooting` | アプリ（`vrct_document_url_chunk_faq`）、SUPPORT.md |
| `/<言語>/guide/first-setup` | アプリ（`vrct_document_url_chunk_ui_guide`） |
| `/<言語>/guide/custom-models`と`#tts`、`#asr`、`#whisper-server`、`#rvc`、`#seed-vc`、`#translation` | アプリの各モデルの欄（`vrct_document_url_chunk_custom_models`） |
| `/<言語>/guide/requirements`、`/<言語>/guide/support` | README.md、`docs/readmes/README.ja.md` |
| `/manual/`、`/manual/<章>` | リポジトリの中からのリンクはありません。0.5.0から公開しているので（#372）、ブックマークや検索エンジンから来る読み手がいる可能性があります |

アプリが外部のURLを開けるのは`https://kein5.github.io/astarot/**`だけです（`src-tauri/capabilities/vrct_capability.json`）。

## テーマのカスタマイズ（`site/.vitepress`）

### 設定（`config.mts`）

- 日英の`locales`、サイドバー、上部のナビゲーション、フッター、404ページの文言
- ローカル検索。`searchTokenize.mjs`で日本語の文中の語を切り出し、索引を作るときと検索するときに同じ切り方を使います
- 見出しのid（`slugify.mjs`）。濁点を分解しないので、日本語の見出しへのリンクが見つかります
- 画像の描画の上書き。ページの画像にはすべて`data-zoom`を付け、押すと大きく表示します
- `appearance: 'force-dark'`。ダークだけで、ライトの配色はありません
- `transformPageData`でマニュアルのページだけタイトルとfaviconを替え、`transformHead`で言語の転送のスクリプトと`hreflang`を足します
- Viteのaliasで、VitePressの`VPLocalSearchBox.vue`を自前の`LocalSearchBox.vue`に差し替えます

### テーマ（`theme/index.ts`）

VitePressの既定のテーマ（`vitepress/theme-without-fonts`。同梱のInterを外したもの）を広げ、レイアウトのスロットに自前の部品を差し込んでいます。

| スロット | 差し込む部品 |
|---|---|
| `home-hero-info-after` | `HomeActions`（ダウンロードのボタンともう1つのボタン） |
| `home-hero-after` | `HomeShot`（メイン画面のスクリーンショット） |
| `home-features-before` | `HomeShowcase`（5つの機能と動画） |
| `doc-before` | `RouteStrip`（機能のページの先頭の経路の帯） |
| `layout-bottom` | `TermTooltip`（ページの`Term`が共有する吹き出し） |

Markdownから使える部品として`StepProgress`、`OsTabs`、`CopyText`、`Term`、`ManualCallout`を登録しています。ほかに、画像を大きく表示するダイアログと、ナビゲーションの言語メニューで選んだ言語を保存する処理を、文書全体のイベントで受けています。

## 部品の一覧

行数は`.vue`のファイル全体（スクリプト、テンプレート、スタイル）です。

### ガイドの部品

| 部品 | 行数 | 役割 | 使っているところ |
|---|---|---|---|
| `HomeActions.vue` | 52 | ヒーローのボタンの列。`DownloadButton`とVitePressの`VPButton`を並べる | トップ |
| `HomeShot.vue` | 14 | ヒーローの下のスクリーンショット | トップ |
| `HomeShowcase.vue` | 180 | 5つの機能と動画。画面に入っている間だけ再生し、動きを減らす設定では静止画を出す | トップ |
| `RouteStrip.vue`（と`routes.ts`） | 137 | 機能のページの先頭に、声と文字が通る経路を出し、そのページの段を光らせる。「自分から相手へ」を青、「相手から自分へ」を紫で描く | 7ページ |
| `components/DownloadButton.vue` | 502 | OSに合うファイルを最新のリリースから選ぶボタンと、すべてのファイル、すべての版、ソースコードを並べたメニュー | トップ |
| `components/StepProgress.vue` | 352 | 番号付きの手順の見出しから手順の一覧を作り、スクロールすると細いバーにして上に残す | 最初の設定 |
| `components/OsTabs.vue` | 165 | WindowsとLinuxで違う手順を切り替える。選んだOSは全ページで共有し、保存する | 3ページ |
| `components/CopyText.vue` | 148 | フォルダーやアドレスにコピーのボタンを付ける | 5ページ |
| `components/Term.vue`、`TermTooltip.vue`（と`tooltip.ts`） | 108、127 | 用語に短い説明の吹き出しを付ける。マウス、フォーカス、タップで開く | 5ページ |
| `components/LocalSearchBox.vue` | 1,019 | VitePress 1.6.4の`VPLocalSearchBox.vue`を写して直した検索のパレット。何も入力していないときはサイドバーのページを並べる | 全ページ |

### マニュアルの部品

| 部品 | 行数 | 役割 |
|---|---|---|
| `manual/ManualShell.vue` | 309 | マニュアルの外枠。上のバー（名前、目次の絞り込み、言語、GitHub）、本文、フッター |
| `manual/ManualHome.vue` | 828 | トップ。ヒーローとマスコット、3つの手順、10章の目次、5つの柱、案内役の8つの表情とコールアウトの凡例、動作環境とサポート |
| `manual/ManualChapter.vue` | 215 | 章のページ。準備中の注記、関連するガイドのページ、前後の章 |
| `manual/ManualCallout.vue` | 81 | 6種類の囲み（補足、ヒント、大事、注意、警告、うまくいかないとき）。種類ごとにマスコットの表情を付ける。使っているのはトップの凡例だけで、本文のページでは使っていません |
| `manual/ManualDownload.vue` | 342 | ダウンロードのボタンと、7種類の配布形式を固定の枠で並べるメニュー |
| `manual/ManualLangMenu.vue` | 176 | 言語のメニュー。ページを移らずに文言を切り替える |
| `manual/useMenu.ts` | 80 | メニューのボタンのキーボード操作（矢印、Home、End、Esc） |
| `manual/content.mjs` | 486 | マニュアルの日英の文言と章の一覧 |

### 共有しているモジュール

`releases.mjs`（配布ファイルの読み分け）と`latestRelease.ts`（最新のリリースの取得）は、2つのダウンロードのボタンが共有しています。`locale.ts`（`/`が開く言語）はガイドとマニュアルが共有しています。

## 色、文字、動きの現状

### 3つの配色が並んでいる

| 場所 | 配色 | 定義しているところ |
|---|---|---|
| ガイド（`/ja/`、`/en/`） | 紺と青。地は`#111b2c`、ボタンは`#2865dc`、リンクは`#80acff`。ダークだけ | `theme/custom.css`の`--vp-c-*`と`--vox-*` |
| マニュアル（`/manual/`） | Dark Plum、Lilac、Off-White。OSの設定に合わせてライトとダークを切り替える | `theme/manual/manual.css`の`--a-*` |
| アプリ | Dark Plum、Lilac、Off-White。ダークだけ | DESIGN.mdの`colors`、`src-ui/views/app/_index_css/variables.css` |

アプリの配色は2026-11-18に紺からDark PlumとLilacに移りました（DESIGN.mdの「Overview」）。ガイドの配色は2026-11-15に「アプリと同じDark Studio」として決めたもので（DESIGN.mdの「The user guide (site/)」）、アプリが移ったあとも紺のままです。同じ紺は`site/motion/src/theme.ts`（動画）と`site/public/diagrams/`（声と文字の流れの図）にもあります。スクリーンショット（`site/public/screenshots/`）も紺の画面を撮ったものです。

OKLCHの色相で比べると、ガイドの地とボタンは約261°、Dark Plumは308°、Lilacは297°です。

マニュアルのライトの配色は、DESIGN.mdの「Colors」の規則（ブランドの色から明度だけを変え、色相の差は3°以内、彩度は元の色を超えない）で作ったものではありません。2026-11-19に計算した結果は次のとおりです。

| トークン | 値 | 規則との差 |
|---|---|---|
| `--a-link`（リンク、重要の囲み） | `#6a3fd2` | 色相290.1°でLilacから7°離れ、彩度0.212がLilacの0.178を超えます。地（`#fafafc`）に対するコントラストは6.19:1です |
| `--a-trouble`（うまくいかないときの囲み） | `#8a4a9e` | 色相317.6°でDark Plumから9.5°離れます |
| `--a-border`（検索欄の枠） | `#e4ddee` | 地に対して1.27:1です。DESIGN.mdは入力欄の枠に、欄の塗りに対して3.5:1、置かれた地に対して3:1を求めています |

本文の文字（`--a-text`、`--a-text-2`、`--a-text-3`）は、地と`--a-bg-soft`のどちらに対しても4.5:1以上あります。

### 文字

| 場所 | 本文 | 見出し |
|---|---|---|
| ガイド | 読み手のPCの書体（システムのUI書体、Noto Sans JP、ヒラギノ、BIZ UDPゴシック、Yu Gothic UI、メイリオ）。16 px | 本文と同じ書体。h1は30 px、h2は22 px、h3は18 px。トップの製品名は52 pxから96 px |
| マニュアル | `system-ui`から始まる別の並び。16 px、行の高さ1.75 | Outfitが入っているPCだけOutfit。入っていなければ本文と同じ書体 |
| アプリ | 利用者が選んだUI書体。1.2 remから2.4 remの8段（アプリの1 remは10 px） | 同じ段から選ぶ |

どちらもウェブフォントは読み込みません。ガイドのh2（22 px）は、アプリの文字の段（12、13、14、15、16、18、20、24 px）にない大きさです。

### 角丸と動き

| 場所 | 角丸 | 動きの時間 |
|---|---|---|
| ガイド | `custom.css`はおもに8 px（アプリの`control`）。部品の中には10 px（5か所）、7 px、6 px、5 px、14 pxもある | 140 msと240 ms |
| マニュアル | おもに14 px（`--a-radius`）。ほかに18 px、12 px、10 px、8 px、7 px、6 px、5 px、丸い端（999 px） | 140 ms |
| アプリ | 2、4、8、12 pxの段。ほかはバーや溝の丸い端だけ | 120 msと220 ms |

部品のスタイルに直接書いた色もあります。フォーカスの色`#a9ccff`は、ガイドの部品の中で7回書かれています。

## 情報の置き方の問題

番号は[再設計の提案](README.md)から参照します。

### P-01 同じ内容に入口と目次が2つある

ガイド（23ページ、サイドバーの5つのまとまり）とマニュアル（10章）が、同じ内容を別の目次で並べています。マニュアルの章には本文がなく、どの章もガイドのページへのリンクを置くだけです。読み手はどちらが正本か分かりません。ガイドの上部のナビゲーションからはマニュアルへ行けず、マニュアルのフッターはガイドを「以前のガイド」と呼んでいます。本文があるのはガイドのほうです。

### P-02 トップのページが2つあり、事実を二重に持っている

`/ja/`のトップと`/manual/`のトップは、どちらもダウンロードのボタンと機能の紹介を持っています。マニュアルのトップは、動作環境（OSの条件、GPUの条件）とダウンロードの7種類の配布形式を`content.mjs`に自分で持っています。同じ事実はガイドの「インストール」と「動作環境と推奨スペック」にも書かれています。

二重に持った事実は、片方だけが直されます。たとえば#673は0.6.0でWindowsの配布物を1つにする変更をガイドのページに反映しますが、`content.mjs`の7種類の枠（「ZIP（CUDA版）」を含む）は変えていません。また、`content.mjs`は「字幕とVR」のページを「VRとオーバーレイ」と呼んでいます。アプリの設定のページは2026-11-18に「字幕とVR」に改名され、ガイドのサイドバーはこの名前です。

### P-03 言語の切り替え方が2通りある

ガイドは言語ごとに別のURL（`/ja/…`と`/en/…`）を持ち、`hreflang`で対応を示します。マニュアルは日本語のHTMLだけをビルドし、スクリプトで英語に切り替えます。そのため、JavaScriptが動かない読み手と検索エンジンには英語のマニュアルが見えません。マニュアルのページには`hreflang`もありません。

### P-04 検索が2通りある

ガイドの検索は、全ページの本文を対象にしたパレットです（VitePressのローカル検索、日本語の文中の語にも対応）。マニュアルの検索窓は章の題、要約、キーワードだけを絞り込みます。マニュアルのページは`search: false`で、ガイドの検索の対象からも外れています。

### P-05 見た目がアプリともマニュアルともそろっていない

「3つの配色が並んでいる」のとおりです。ガイドはダークだけで、マニュアルはOSに合わせてライトとダークを切り替えます。スクリーンショット、動画、図も紺のままです。

### P-06 同じ役割の部品が2つずつある

| 役割 | ガイド | マニュアル |
|---|---|---|
| ダウンロードのボタン | `DownloadButton.vue`（502行。最新のリリースのファイルをOSごとに並べ、すべての版とソースコードへのリンクを付ける） | `ManualDownload.vue`（342行。7種類の配布形式を固定の枠で並べ、ないものは「この版にはありません」と出す） |
| 言語の切り替え | VitePressのナビゲーションの言語メニュー（別のURLへ移る） | `ManualLangMenu.vue`（その場で切り替える） |
| 囲み | VitePressのカスタムブロック（`custom.css`で色を変えている） | `ManualCallout.vue`（6種類、表情付き） |
| メニューのキーボード操作 | `DownloadButton.vue`の中に自前で持つ | `useMenu.ts` |

### P-07 マスコットがマニュアルのトップにしかいない

マスコット（悪魔ペンギン）はマニュアルのトップのヒーローと案内役の節にだけいます。トップで「表情を見ればその場面で何に気をつけるかが分かる」と説明していますが、表情付きの囲み（`ManualCallout`）を使っている本文はありません。ガイドのページにはマスコットが出てきません。

### P-08 サイドバーのまとまりがアプリの設定と違い、最初の設定までが遠い

- 「はじめに」に6ページあり、動作環境と対応環境の表（調べるときに読むもの）が「最初の設定」より前にあります。初めての読み手がメッセージを送れるまでに、間に参考の表を2つ挟みます。
- 「やりたいこと」は2ページだけです。「自分のモデルを使う」は「モデルの取得」（設定と運用）と離れています。
- 「設定と運用」に、モデル、音声経路、困ったとき、プライバシー、ライセンスが並んでいます。音声経路のページは「入力と出力」（画面と連携）とも離れています。
- 機能のまとまりは、アプリの設定のメニューのまとまり（会話の基本、声と読み取り、使い心地、アプリ。DESIGN.mdの「Layout」、#554）と違います。アプリとガイドを見比べる読み手は、同じ機能を別のまとまりで探すことになります。

### P-09 上部のナビゲーションから行けるところが少ない

上部のナビゲーションは「ガイド」「インストール」「困ったとき」だけです。ダウンロードのボタンはトップにしかなく、リリースノートへのリンクもありません。

### P-10 画面の言葉の規則に合わない文がある

DESIGN.mdの「Words」は、利用者のPCを「お使いのPC」と書くか、PCを省くと決めています（#437）。2026-11-19の時点で、この規則に合わない言い方が日本語のページでは7ページに15か所、英語のページでは5ページに9か所あります。

### P-11 VitePressの内部に頼っている部分がある

- `LocalSearchBox.vue`は、VitePress 1.6.4の内部のファイル（`vitepress/dist/client/…`）をimportする写しです。VitePress 2では元のファイルが約410行変わっていて（#690）、上げるときに合わせ直す必要があります。
- `StepProgress.vue`は`.VPNav`と`.VPLocalNav`の位置を読み、`custom.css`は`.VPSidebarItem`、`.VPHero`などの既定のテーマのクラスを上書きしています。

### P-12 文言の置き場所が散らばっている

ガイドの部品の文言は、`config.mts`（ナビゲーション、サイドバー、検索）、各部品の中の`WORDS`（`DownloadButton`、`CopyText`、`StepProgress`）、`routes.ts`に分かれています。日英のキーがそろっているかを確かめる検査は、マニュアルの`content.mjs`にだけあります（`check_site_manual.mjs`）。
