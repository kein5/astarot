# Google と Papago のウェブ翻訳を Rust で作り直せるかの調査（2026-11-16）

調べた日: 2026-11-16。出典はすべてこの日に見たものです。法的な結論は出していません。規約の読み方は出典に書いてある範囲にとどめ、はっきりしない点はそう書いています。

## 前提

- 上流の VRCT は、Google・Bing・Papago のウェブ翻訳を 2 つのモジュールで使ってきました。
  - 2026-09 まで: UlionTse の `translators`（GPL-3.0）。上流は misyaguziya/translators というフォークを固定していました（`src-python/model.py` と `src-python/test/test_model_input_translate_parallel.py` のコメント）。
  - 2026-09-17 から: 上流の作者による `translator_engines`（コミット 5d455c31「Replace translators (GPLv3) with translator_engines」）。コンパイル済みの拡張（`.pyd`）として同梱されていました。
- `translator_engines` のライセンス（「VRCT Translator Engines License」）は、ソースを読むことは許しますが、使うことと配ることは公式の VRCT の部品としてだけ許しています。フォークや派生物での利用ははっきり禁じています。対象には「modification or derivative work」も含みます。このため VRCT-VOX はコミット 7806cacc で同梱をやめました。2026-11-16 には翻訳エンジンの一覧からも外しました（`docs/voice-stack/core-integration.md` の 17）。
- `translation_translator.py` は `from translator_engines import translate_text` で読み込み、無ければ `ENABLE_TRANSLATORS = False` にします。1 回の要求のタイムアウトは 10 秒です。Bing は認証ページの取得と再試行で最大 4 回の要求になるとコメントにあります。
- 作り直すときの著作権上の条件は 2 つあります。`translator_engines` のコードを見て写すと、そのライセンスの「派生物」にあたるおそれがあります。`translators` を移植すると GPL-3.0 の派生物になります。どちらのコードも参照せず、公開の情報と通信の観察から書く形（クリーンルーム）が前提になります。なお、これは著作権の話です。サービスの規約の問題は別に残ります（下の「規約面のリスク」）。
- 中核にはすでに似た例があります。Google の音声認識は Chromium の公開キーで非公式の窓口に送っています（`core-integration.md` の 14。この調査の後、外すことに決まりました）。ウェブ翻訳を作り直すかどうかは、14 と同じ方針でそろえるのが自然です。
- 公式 API（Google Cloud Translation と NAVER Cloud Platform の Papago）を利用者のキーで使う形は、2026-11-16 に足すことが決まり、中核に入れました（`core-integration.md` の 32）。

## 技術的な可否

### Google（ウェブ）

HTTP だけで動き、ブラウザは要りません。Rust なら `reqwest` と `serde_json` で足ります。ただし窓口はどれも非公式で、2026 年の秋にも止まっています。窓口は主に 4 つあります。

| 窓口 | 形 | 要るもの | 2026 年の状況 |
|---|---|---|---|
| `translate.googleapis.com/translate_a/single?client=gtx&sl=..&tl=..&dt=t&q=..` | GET。応答は入れ子の JSON 配列 | トークンなし | 2026-09 ごろから `client=gtx` には HTTP 429 と「automated queries」の HTML が返るようになった。`client=at` か `client=dict-chrome-ex` に変えると 200 が返る、という報告が複数ある [G5][G6][G7] |
| `translate.google.com/translate_a/single?client=webapp&tk=..` | GET | ページの JavaScript から取る TKK という値でトークンを作る | トークンの取り出しが何度も壊れた（py-googletrans #280、2021-03 など）[G3][G4]。上の curl の試験では `client=webapp` は 403 [G5] |
| `translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc` | POST。`f.req` に入れ子の JSON。応答は前置きの付いた JSON の行 | ページから取る `f.sid` と `bl`（ビルドの名前）。Origin と Referer | ウェブの画面そのものが使う窓口。ビルドの名前の固定や応答の形の変化で壊れた報告がある [G8][G9] |
| `translate-pa.googleapis.com/v1/translateHtml` | POST。JSON+protobuf の形 | ウェブの画面に埋め込まれた公開のキー（`wt_lib`） | 2026-10 に 429 の逃げ先として使い始めたクライアントがある。キーが変わったら差し替える前提 [G10] |

- 妨害の仕組み: 回数の制限（429）、「Sorry... automated queries」のページと reCAPTCHA、IP の遮断があります [G2][G4][G11]。2026-09 の件は回数ではなく `client=gtx` という識別子そのものを止めたように見える、と報告者は書いています [G5]。Wi-Fi と携帯の回線のどちらでも 429 だったという報告もあります。一方で IP ごとの制限を示す報告もあり、原因ははっきりしません。
- 変わる頻度: 公開の記録だけでも、TKK の取り出しの破損（2020〜2021、py-googletrans）、batchexecute の応答の変化（2021、2023）、`client=gtx` の遮断（2026-09）、ある窓口の 404（2026-09、Translumo の v1.1.0 のリリースノートに「Google moved its endpoint and started answering 404」）があります [G3][G4][G8][G12]。年に 1 回以上は手を入れる前提です。
- robots.txt: `translate.google.com` は `User-agent: *` に対して `/translate_a` と `/m?` を `Disallow` にしています（`/translate_a/element.js` だけ `Allow`）[G13]。Google の利用規約は、robots.txt のような機械が読む指示に反した自動の取得を禁じています（下の「規約面のリスク」）。

### Papago（ウェブ）

これも HTTP だけで作れます。ただし今も動くかどうかは確かめられませんでした。

- 窓口: `https://papago.naver.com/apis/n2mt/translate` への POST（フォーム。`source`、`target`、`text`、`honorific` など）。言語の判定は `/apis/langs/dect` です [P1][P2]。
- 認証: `Authorization: PPG {UUID}:{署名}` と `Timestamp` の見出しを付けます。署名は「UUID、URL、時刻」をつないだ文字列の HMAC-MD5 を Base64 にしたものです。鍵は、サイトの JavaScript の束に埋め込まれた版の文字列です [P2]。この手順は公開のクライアントのコードから読んだもので、NAVER の文書はありません。毎回サイトのページと JavaScript を取りにいき、正規表現で鍵を探す作りになります。
- 壊れた記録:
  - XUnity.AutoTranslator: 2025-04 に「Papago から結果が返らない」（版の文字列が取り出せない）。直ったのは 2026-03-23 で、JavaScript の束の名前が `vendors~main...` から `main.<hash>.chunk.js` に変わったのに合わせた修正でした。この PR は同じ症状の 5 件の issue をまとめて閉じています [P3][P4]。
  - MORT: 2026-03 に、Papago でアプリが固まる、ボットの要求を遮断しているらしい、という報告。原因ははっきりしないまま閉じられました [P5]。
  - Translumo: 2026-09-22 の v1.1.0 で Papago を外しました。理由は「Papago's endpoint returns 404」と、公式 API が有料であることです [P6]。この 404 がどの窓口かは確かめられていません。
- 2024-02-29 に NAVER Developers の無料の Papago API（1 日 10,000 字）は終わり、NAVER Cloud Platform の有料の API だけになりました [P7]。2024-09-01 には他社ブラウザ向けのサイト翻訳の機能も終わっています [P8]。こちらは文章の翻訳とは別の機能です。
- 言語: ウェブの Papago は約 15 言語です（`translators` の README）[P9]。VRCT-VOX の言語の表で、Papago だけが訳せる言語はありませんでした（`core-integration.md` の 17）。

### Rust での作り方（どちらも作る場合）

- `native/translation` に、今のプロバイダと同じ形のクライアントを足します。必要なのは HTTP の要求、見出し、JSON の読み取りです。Papago にはページの取得、正規表現、HMAC-MD5（`hmac` と `md-5` の crate）、UUID が加わります。依存はどれも MIT か Apache-2.0 で、配布物はほとんど増えません。
- 窓口が変わるたびにアプリの更新が要ります。窓口の切り替え（gtx から at へ、など）を設定やリモートの表で直せる形にすると、変わり方が速くなる分だけ、規約の面での「回避」の色が濃くなります。
- 試験は偽のサーバでできます。本物の窓口での確認は CI に入れられず（遮断されやすいので）、人の手で行うことになります。

## 規約面のリスク

### Google

- 今の Google 利用規約（2026-07-30 から有効）は、次のことを禁じています [G1]。
  - 「using automated means to access content from any of our services in violation of the machine-readable instructions」。例として robots.txt を挙げています。
  - 「abuse, harm, interfere with, or disrupt our services or systems」。その例として「bypassing our systems or protective measures」があります。
  - 「Reverse engineering our services or underlying technology」（法律が許す範囲を除く）。
  - 規約に従わないときは、サービスの停止やアカウントの停止があり得ると書いています。
- 2017 年版までの規約には「don't ... try to access them using a method other than the interface and the instructions that we provide」という直接の文がありました [G14]。今の版にこの文は見当たりません。ただ、上の robots.txt の条項と「保護の仕組みを迂回しない」条項が、同じ範囲をかなり覆っているように読めます。どこまで及ぶかは判断できません。
- 上の表の窓口の多くは robots.txt で `Disallow` になっているパス（`translate.google.com/translate_a`）か、公開の文書にない窓口です。429 が出たあとに `client` の値を変えて通す行為は、「protective measures」の迂回と読まれるおそれがあります。これは推測で、Google がそう判断したという出典はありません。
- Google API の利用規約（Google APIs Terms of Service、2021-11-09 最終更新）は、API を「by the means described in the documentation」でしか使わない、制限を迂回しない、開発者の認証情報をオープンソースのプロジェクトに埋め込まない、と定めています [G15]。これは公式 API を使う開発者に向けた規約で、ウェブの窓口に直接かかるかはわかりません。ただ、ウェブの画面の公開キー（`wt_lib`）をアプリに入れる案とは、考え方が正面からぶつかります。
- 公式の Cloud Translation API の出力を見せるときは、機械翻訳だと示すこと、「powered by Google Translate」の表示、免責文、などの決まりがあります [G16]。

### NAVER と Papago

- NAVER の利用規約の原文（policy.naver.com）は、この環境から取得できませんでした。二次資料によると、2026-10-01 から適用の規約に「NAVER の事前の許可なく、マクロやボットなどの自動化された手段で ... 投稿を収集し ...」してはならない、という趣旨の条項があります [P10]。2018 年からは、自動化プログラムでのコメントなどを禁じる条項も明記されています [P11]。どちらも二次資料からの引用なので、原文と照らす必要があります。Papago のウェブ翻訳に特定した条項は見つけていません。
- NAVER は公式の API を有料で出しているので、無料のウェブの窓口を機械から使うことを NAVER が歓迎すると考える根拠はありません。
- 公式の Papago Translation（NAVER Cloud Platform）は有料で、1,000,000 字の単位で課金されます。1 回 5,000 字まで、Papago のブランドの表示とリンクが必須です [P12][P13]。単価は公式のページで確かめられませんでした。

### 計画にとってのリスク

- 配布: VRCT-VOX は GitHub Releases などで配っています。規約に反する通信をするアプリを配ること自体を禁じる出典は、GitHub やパッケージの配布先について確かめていません。Google Play の開発者ポリシーには「サービスの利用規約に反してサービスや API を使うアプリ」を違反の例に挙げる記述があるという二次資料があります [G17]。いま Play で配る予定はありませんが、ストアで配る段になったら確かめる必要があります。
- 利用者: 遮断は IP 単位で起きることがあります。Google は、同じ回線（学校、会社、VPN、家庭）のほかの人の自動の要求でも「unusual traffic」の画面が出ると説明しています [G11]。翻訳の窓口での遮断が検索などほかのサービスにも及ぶかは、出典で確かめられませんでした。VRChat の利用者は VPN を使う人もいるので、遮断に巻き込まれる人が出ることはあり得ます。ログインは使わないので、Google アカウントの停止に直接つながる経路は考えにくいですが、断言はできません。
- 信頼: 公式 API と違って、動かなくなっても苦情を持っていく先がありません。止まったときの不具合の報告はプロジェクトに来ます。
- 上流との関係: 上流は同じ機能を自分の許諾で配っています。VRCT-VOX が別に作り直すことは著作権の上では問題にならない形にできますが、上流と機能が競合することへの配慮は別の論点です（`publication-and-upstream.md`）。

## 保守の持続可能性

- Google: 公開の記録だけで、2020、2021、2023、2026（2 回）に壊れています。2026-09 の遮断は多くのクライアントが同時に踏み、各自が `client` の値を変えるか、別の窓口に逃げて直しました。次に止まるのは逃げ先のほうだ、という見方がクライアントの側にもあります [G5][G7][G10]。
- Papago: 壊れてから直るまで 1 年近くかかった例があります（XUnity.AutoTranslator、2025-04 から 2026-03）[P3][P4]。サイトの JavaScript の名前や中身が変わるたびに、鍵の取り出しが壊れます。2026-09 には 404 を理由に外したアプリもあります [P6]。
- 作業の量: 壊れるたびに、原因の調査、修正、試験、リリースが要ります。直すまでは利用者が翻訳を使えません。VRCT-VOX はアプリの更新を配って直すので、壊れてから利用者の手に届くまでに日数がかかります。
- 見つかりやすさ: 1 つのアプリから多くの利用者が同じ形の要求を送ると、見分けやすい形になります。ブラウザの指紋をまねる（Anki のアドオンが `curl_cffi` に変えた例 [G7]）ような対策は、迂回の性格がさらに強くなります。
- 代わりの手段:
  - 公式 API を利用者のキーで使う（32）。Google Cloud Translation Basic（v2）は API キーで使え、毎月 500,000 字まで無料、その後 1,000,000 字ごとに 20 ドルです。請求の設定は要ります [G18][G19]。Papago は有料です。
  - DeepL と LLM のプロバイダ（すでにある）。
  - ローカル翻訳（`core-integration.md` の 1 と 34 で検討中）。ネットワークも規約も要りません。

## 選択肢と影響

| 案 | 中身 | よい点 | 困る点 |
|---|---|---|---|
| A. 作らない（公式 API とローカル翻訳だけ） | 17 の今の状態を保ち、32 の公式 API を足す | 規約の心配がない。壊れたときの保守がない。利用者の回線を巻き込まない | 無料でキーなしの高品質な翻訳がない。上流から移った利用者は、キーを取るかローカル翻訳に移る必要がある |
| B. 明示のオプトインで作る | Rust でクリーンルームに作る。既定はオフ。選ぶときに「非公式の窓口で、規約に反するおそれがあり、止まったり回線が遮断されたりする」ことを示して同意を取る。回数の上限を付ける | 上流と同じ使い心地を戻せる。著作権の問題は避けられる | 規約の問題は同意を取っても消えない（同意は利用者とプロジェクトの間のもので、Google や NAVER との関係は変わらない）。年に 1 回以上の修理。遮断を迂回する修理を重ねるほど規約の面で悪くなる。14 の音声認識と方針をそろえる必要がある |
| B'. Google だけ作る | B を Google に絞る | Papago より壊れる頻度が低め。言語が多い | B と同じ。Papago だけが訳せる言語はないので、Papago を外しても失うものは少ない |
| C. 公式 API だけ（A と同じだが Papago の公式も足す） | Google Cloud Translation、Azure Translator、NAVER の Papago を利用者のキーで | 規約に沿う。応答の形が文書で決まっていて壊れにくい | キーの取得と請求の設定が利用者の手間。Papago の公式は有料でキーが 2 つ要る |

- B を選ぶ場合に決めること: 既定はオフにするか、起動時の自動の試験の要求を出さないか（今の Python の起動時の確認のような要求は、利用者が選んでいなくても窓口を叩く）、回数の上限、遮断されたときにローカル翻訳へ切り替える既存の流れを使うか、`translator_engines` と `translators` のコードを誰も見ない形で作れるか。
- 14（Google の音声認識の公開キー）と同じ理屈で判断することになります。B を選ぶなら 14 も残す方向、A か C を選ぶなら 14 も外す方向が筋です。
- この調べの範囲で言えることは、技術的には作れる、ただし Google は 2026 年秋にも止まったばかりで Papago は今動くか確かめられない、規約は少なくとも Google については robots.txt と保護の仕組みの迂回の条項に触れるおそれがある、ということです。どの案が許されるかを法的に判断したものではありません。

## 出典

すべて 2026-11-16 に見たものです。

リポジトリ内
- `src-python/models/translation/translation_translator.py`（22〜38 行）
- `docs/voice-stack/core-integration.md`（14、17、32）
- `NOTICE.md`（24〜28 行）
- コミット 5d455c31（translators から translator_engines へ）、7806cacc（translator_engines の同梱をやめた。消したライセンス本文は `git show 7806cacc^:src-python/translator_engines.LICENSE.txt`）

Google
- [G1] Google 利用規約（2026-07-30 から有効）: https://policies.google.com/terms
- [G2] py-googletrans の README（非公式の免責、IP の遮断、TKK のトークン）: https://github.com/ssut/py-googletrans
- [G3] py-googletrans issue #280（2021-03-10、TKK の取り出しの破損）: https://github.com/ssut/py-googletrans/issues/280
- [G4] py-googletrans `googletrans/urls.py` と `client.py`（`/translate_a/single`、`gtx` と `webapp`）: https://raw.githubusercontent.com/ssut/py-googletrans/master/googletrans/urls.py 、https://raw.githubusercontent.com/ssut/py-googletrans/master/googletrans/client.py
- [G5] eeeXun/gtt issue #43（2026-09-14、`client=gtx` に 429。`at` と `dict-chrome-ex` は 200）: https://github.com/eeeXun/gtt/issues/43
- [G6] noctalia-dev/official-plugins issue #64（2026-09-03、429 と CAPTCHA のページ）: https://github.com/noctalia-dev/official-plugins/issues/64
- [G7] Anki の Google Translate アドオン（2026-09-13 に `curl_cffi` へ）: https://ankiweb.net/shared/info/1536291224 （検索結果の要約から。ページ本文は直接は確かめていない）
- [G8] batchexecute の例（YiiGuxing/TranslationPlugin #835）: https://github.com/YiiGuxing/TranslationPlugin/issues/835 、AutoHotkey の例: https://www.autohotkey.com/boards/viewtopic.php?t=113534
- [G9] funkyremi/vscode-google-translate issue #51、#98（応答の解析の失敗）: https://github.com/funkyremi/vscode-google-translate/issues/51 、https://github.com/funkyremi/vscode-google-translate/issues/98 （検索結果の要約から）
- [G10] Asura7170/easydict_win32 PR #4（2026-10-15、`translate-pa.googleapis.com/v1/translateHtml` への切り替え）: https://github.com/Asura7170/easydict_win32/pull/4
- [G11] Google 検索のヘルプ「unusual traffic」: https://support.google.com/websearch/answer/86640?hl=en
- [G12] Translumo のリリース一覧（v1.1.0、9 月 22 日）: https://github.com/ramjke/Translumo/releases
- [G13] translate.google.com の robots.txt: https://translate.google.com/robots.txt
- [G14] Google 利用規約の 2017-10-25 版: https://policies.google.com/terms/archive/20171025
- [G15] Google APIs Terms of Service（2021-11-09 最終更新）: https://developers.google.com/terms
- [G16] Cloud Translation の表示の決まり: https://docs.cloud.google.com/translate/attribution
- [G17] Google Play の開発者ポリシー（検索結果の要約から。本文は直接は確かめていない）: https://support.google.com/googleplay/android-developer/answer/18258653?hl=en
- [G18] Cloud Translation の料金: https://cloud.google.com/products/translate/pricing
- [G19] Cloud Translation Basic の使い方（`translation.googleapis.com/language/translate/v2`、API キー）: https://docs.cloud.google.com/translate/docs/basic/translating-text

NAVER と Papago
- [P1] arrufat/papago（Go。`/apis/n2mt/translate`、`/apis/langs/dect`、見出し）: https://github.com/arrufat/papago/blob/master/papago.go
- [P2] 009342/PapagoTranslateAPI PR #1（HMAC-MD5 の `PPG` 署名）: https://github.com/009342/PapagoTranslateAPI/pull/1/files （検索結果の要約から。署名する文字列の形は二次の記述で、直接は確かめていない）
- [P3] XUnity.AutoTranslator issue #704（2025-04-29）: https://github.com/bbepis/XUnity.AutoTranslator/issues/704
- [P4] XUnity.AutoTranslator PR #820（2026-03-23、JavaScript の束の名前の変更への対応）: https://github.com/bbepis/XUnity.AutoTranslator/pull/820
- [P5] kmonkeyhead/MORT issue #137（2026-03-28）: https://github.com/kmonkeyhead/MORT/issues/137
- [P6] Translumo のリリース一覧（v1.1.0 で Papago を外した）: https://github.com/ramjke/Translumo/releases
- [P7] NAVER Developers の Papago API の終了（2024-02-29）: https://www.oppadu.com/lesson/%EC%97%91%EC%85%80-%ED%8C%8C%ED%8C%8C%EA%B3%A0-%EB%B2%88%EC%97%AD-%ED%95%A8%EC%88%98/ （二次資料）、旧コンソールの終了（2025-03-20）: https://cloudike.kr/blog/ai-naver-api-papago-%EC%84%9C%EB%B9%84%EC%8A%A4-%EC%A2%85%EB%A3%8C-%EC%95%88%EB%82%B4-25-3-20/ （二次資料）
- [P8] Papago のサイト翻訳の終了（2024-08-13 の記事）: https://www.koreastocknews.com/news/articleView.html?idxno=102729
- [P9] UlionTse/translators の README（GPL-3.0、Papago は 15 言語）: https://github.com/UlionTse/translators
- [P10] NAVER の規約の自動化の条項（二次資料。原文の policy.naver.com は取得できなかった）: https://neonomadj.com/aside-naver-blog/
- [P11] 自動化プログラムでのコメントの禁止を明記（2018-04 の記事）: https://news.nate.com/view/20180404n37939 （検索結果の要約から）
- [P12] Papago Translation の API（`papago.apigw.ntruss.com/nmt/v1/translation`、1 回 5,000 字）: https://api.ncloud-docs.com/docs/ai-naver-papagonmt-translation
- [P13] Papago Translation の使用の準備（1,000,000 字単位の課金、上限、ブランドの表示）: https://guide.ncloud-docs.com/docs/papagotranslation-spec

## 確かめられなかったこと

- NAVER の利用規約の原文と条番号（policy.naver.com と papago.naver.com はこの環境から取得できなかった）。
- 今の Papago のウェブの窓口が動くかどうか。実際の要求は送っていません。
- NAVER Cloud Platform の Papago の単価。
- Microsoft Store、GitHub、Linux のパッケージの配布先が、規約に反する通信をするアプリをどう扱うか。
- 翻訳の窓口での遮断が、同じ回線の Google 検索などに及ぶかどうか。
