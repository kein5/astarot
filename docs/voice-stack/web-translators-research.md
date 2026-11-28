# Whether Google and Papago web translation can be rebuilt in Rust (2026-11-16)

[日本語版](#google-と-papago-のウェブ翻訳を-rust-で作り直せるかの調査2026-11-16日本語版)

Researched on 2026-11-16. All sources were viewed on that date. This research draws no legal conclusions. Readings of the terms stay within what the sources say, and points that are unclear are marked as unclear.

## Background

- Upstream VRCT has used Google, Bing and Papago web translation through two modules.
  - Until 2026-09: UlionTse's `translators` (GPL-3.0). Upstream pinned a fork called misyaguziya/translators (comments in `src-python/model.py` and `src-python/test/test_model_input_translate_parallel.py`).
  - From 2026-09-17: `translator_engines` by the upstream author (commit 5d455c31, "Replace translators (GPLv3) with translator_engines"). It was bundled as a compiled extension (`.pyd`).
- The license of `translator_engines` ("VRCT Translator Engines License") allows reading the source, but allows use and distribution only as part of official VRCT. It explicitly forbids use in forks and derivatives, and what it covers includes "modification or derivative work". For this reason VRCT-VOX stopped bundling it in commit 7806cacc. On 2026-11-16 it was also removed from the list of translation engines (17 in `docs/voice-stack/core-integration.md`).
- `translation_translator.py` imports it with `from translator_engines import translate_text` and sets `ENABLE_TRANSLATORS = False` if it is missing. The timeout for one request is 10 seconds. A comment says Bing takes up to 4 requests, counting the fetch of the authentication page and the retries.
- A rebuild has two copyright conditions. Copying from the `translator_engines` code may count as a "derivative" under its license. Porting `translators` makes a GPL-3.0 derivative. A rebuild therefore has to be written without referring to either codebase, from public information and observed traffic (a clean room). This is about copyright only. The question of the services' terms remains separately ("Risks from the terms of service" below).
- The core already has a similar case. Google speech recognition sends requests to an unofficial endpoint with Chromium's public key (14 in `core-integration.md`; after this research, it was decided to remove it). It is natural to decide on rebuilding web translation by the same policy as 14.
- Using the official APIs (Google Cloud Translation and Papago on NAVER Cloud Platform) with the user's key was decided on 2026-11-16 and added to the core (32 in `core-integration.md`).

## Technical feasibility

### Google (web)

It works over plain HTTP, and no browser is needed. In Rust, `reqwest` and `serde_json` are enough. However, every endpoint is unofficial, and they stopped working again in autumn 2026. There are four main endpoints.

| Endpoint | Form | What it needs | Status in 2026 |
|---|---|---|---|
| `translate.googleapis.com/translate_a/single?client=gtx&sl=..&tl=..&dt=t&q=..` | GET. The response is a nested JSON array | No token | From around 2026-09, `client=gtx` started getting HTTP 429 and an "automated queries" HTML page. Several reports say that changing to `client=at` or `client=dict-chrome-ex` returns 200 [G5][G6][G7] |
| `translate.google.com/translate_a/single?client=webapp&tk=..` | GET | A token built from a value called TKK, taken from the page's JavaScript | Extracting the token broke many times (py-googletrans #280, 2021-03, and others) [G3][G4]. In the curl test above, `client=webapp` got 403 [G5] |
| `translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc` | POST. Nested JSON in `f.req`. The response is lines of JSON with a prefix | `f.sid` and `bl` (the build name) taken from the page; Origin and Referer | The endpoint that the web page itself uses. There are reports of it breaking from a pinned build name or a change in the response format [G8][G9] |
| `translate-pa.googleapis.com/v1/translateHtml` | POST. JSON+protobuf format | A public key embedded in the web page (`wt_lib`) | One client started using it in 2026-10 as a way around the 429. It assumes the key is replaced when it changes [G10] |

- Blocking mechanisms: rate limits (429), the "Sorry... automated queries" page with reCAPTCHA, and IP blocks [G2][G4][G11]. The reporter of the 2026-09 case writes that the identifier `client=gtx` itself seems to have been blocked, not the request rate [G5]. There is also a report of 429 on both Wi-Fi and a mobile connection. Other reports point to per-IP limits, so the cause is unclear.
- How often things change: public records alone show broken TKK extraction (2020 to 2021, py-googletrans), changes in the batchexecute response (2021, 2023), the block on `client=gtx` (2026-09) and a 404 from one endpoint (2026-09; Translumo's v1.1.0 release notes say "Google moved its endpoint and started answering 404") [G3][G4][G8][G12]. Expect to fix things at least once a year.
- robots.txt: `translate.google.com` sets `Disallow` on `/translate_a` and `/m?` for `User-agent: *` (only `/translate_a/element.js` is `Allow`) [G13]. Google's Terms of Service forbid automated access that violates machine-readable instructions such as robots.txt ("Risks from the terms of service" below).

### Papago (web)

This can also be built with plain HTTP. However, whether it still works could not be confirmed.

- Endpoint: a POST to `https://papago.naver.com/apis/n2mt/translate` (a form with `source`, `target`, `text`, `honorific` and other fields). Language detection is `/apis/langs/dect` [P1][P2].
- Authentication: add the headers `Authorization: PPG {UUID}:{signature}` and `Timestamp`. The signature is the Base64 of the HMAC-MD5 of a string that joins "UUID, URL and time". The key is a version string embedded in the site's JavaScript bundle [P2]. This procedure was read from the code of public clients, and NAVER has no documentation of it. A client has to fetch the site's page and JavaScript every time and find the key with a regular expression.
- Records of breakage:
  - XUnity.AutoTranslator: in 2025-04, "no result returned from Papago" (the version string could not be extracted). It was fixed on 2026-03-23, with a change that followed the rename of the JavaScript bundle from `vendors~main...` to `main.<hash>.chunk.js`. That PR closed 5 issues with the same symptom [P3][P4].
  - MORT: a report in 2026-03 that the app freezes with Papago and that Papago appears to block bot requests. It was closed without a clear cause [P5].
  - Translumo: removed Papago in v1.1.0 on 2026-09-22. The reasons given are "Papago's endpoint returns 404" and that the official API is paid [P6]. Which endpoint this 404 came from has not been confirmed.
- On 2024-02-29 the free Papago API on NAVER Developers (10,000 characters a day) ended, which left only the paid API on NAVER Cloud Platform [P7]. On 2024-09-01 the website translation feature for other companies' browsers also ended [P8]. That is a separate feature from text translation.
- Languages: web Papago covers about 15 languages (the README of `translators`) [P9]. In VRCT-VOX's language table, there was no language that only Papago could translate (17 in `core-integration.md`).

### How to build it in Rust (if both are built)

- Add clients to `native/translation` in the same form as the current providers. They need HTTP requests, headers and JSON parsing. Papago adds fetching the page, regular expressions, HMAC-MD5 (the `hmac` and `md-5` crates) and UUIDs. All these dependencies are MIT or Apache-2.0, and the distribution barely grows.
- Every endpoint change needs an app update. If endpoint switches (gtx to at, for example) can be fixed through settings or a remote table, fixes go out faster, but by the same measure the app looks more like it is "circumventing" under the terms.
- Tests can use a fake server. Checks against the real endpoints cannot go into CI (they are easily blocked) and have to be done by hand.

## Risks from the terms of service

### Google's terms

- The current Google Terms of Service (in effect from 2026-07-30) forbid the following [G1].
  - "using automated means to access content from any of our services in violation of the machine-readable instructions". It gives robots.txt as an example.
  - "abuse, harm, interfere with, or disrupt our services or systems". Its examples include "bypassing our systems or protective measures".
  - "Reverse engineering our services or underlying technology" (except where the law allows it).
  - The terms state that failing to follow them can lead to suspension of the service or of the account.
- Terms up to the 2017 version had a direct sentence: "don't ... try to access them using a method other than the interface and the instructions that we provide" [G14]. The current version does not appear to have it. Still, the robots.txt clause above and the clause against bypassing protective measures seem to cover much of the same ground. How far they reach cannot be judged here. <!-- writing-exempt: quoted wording of Google's 2017 terms -->
- Most endpoints in the table above are either on a path that robots.txt marks `Disallow` (`translate.google.com/translate_a`) or not in any public documentation. Changing the `client` value to get through after a 429 could be read as bypassing "protective measures". This is a guess, and no source shows that Google has judged it so.
- The Google APIs Terms of Service (last updated 2021-11-09) require using APIs only "by the means described in the documentation", not circumventing limits and not embedding developer credentials in open source projects [G15]. These terms are for developers who use the official APIs, and whether they apply directly to the web endpoints is unknown. Still, their reasoning directly conflicts with the idea of putting the web page's public key (`wt_lib`) into the app.
- Showing output from the official Cloud Translation API comes with rules, such as marking it as machine translation, showing "powered by Google Translate" and including a disclaimer [G16].

### NAVER and Papago

- The original text of NAVER's terms of service (policy.naver.com) could not be retrieved from this environment. According to a secondary source, the terms in force from 2026-10-01 have a clause to the effect that users must not "collect ... posts ... by automated means such as macros or bots without NAVER's prior permission" [P10]. Since 2018, a clause that forbids comments and the like by automated programs has also been stated explicitly [P11]. Both are quoted from secondary sources, so they need checking against the original. No clause specific to Papago web translation was found.
- NAVER offers its official API for a fee, so there is no reason to think that NAVER welcomes automated use of the free web endpoint.
- The official Papago Translation (NAVER Cloud Platform) is paid and billed in units of 1,000,000 characters. A request is limited to 5,000 characters, and showing the Papago brand with a link is required [P12][P13]. The unit price could not be confirmed on the official pages.

### Risks to the plan

- Distribution: VRCT-VOX is distributed through GitHub Releases and other channels. For GitHub and the package channels, no source was checked on whether distributing an app that communicates in violation of a service's terms is itself forbidden. A secondary source says that Google Play's developer policy lists "apps that use a service or API in violation of its terms of service" as an example of a violation [G17]. There is no plan to distribute on Play now, but this needs checking if the app is ever distributed through a store.
- Users: blocks can happen per IP. Google explains that automated requests from other people on the same connection (school, workplace, VPN, home) can also bring up the "unusual traffic" page [G11]. Whether a block at the translation endpoint extends to other services such as Search could not be confirmed from the sources. Some VRChat users use VPNs, so some people may get caught in a block. No sign-in is used, so a direct path to the suspension of a Google account seems unlikely, but this cannot be stated for certain.
- Trust: unlike an official API, there is nowhere to complain when it stops working. Bug reports when it stops come to the project.
- Relationship with upstream: upstream distributes the same feature under its own license. A separate rebuild by VRCT-VOX can be done in a form that raises no copyright problem, but consideration for competing with upstream's feature is a separate issue (`publication-and-upstream.md`).

## Sustainability of maintenance

- Google: public records alone show breakage in 2020, 2021, 2023 and 2026 (twice). Many clients hit the 2026-09 block at the same time, and each fixed it by changing the `client` value or by moving to another endpoint. On the client side, too, some expect the next block to hit the endpoints they moved to [G5][G7][G10].
- Papago: in one case a fix took almost a year after the breakage (XUnity.AutoTranslator, 2025-04 to 2026-03) [P3][P4]. Key extraction breaks whenever the name or the content of the site's JavaScript changes. In 2026-09 one app removed Papago, citing a 404 [P6].
- Amount of work: each breakage needs investigation, a fix, tests and a release. Until the fix, users cannot use the translation. VRCT-VOX fixes things by shipping app updates, so days pass between a breakage and the fix reaching users.
- Detectability: when many users send requests of the same shape from one app, the requests are easy to tell apart. Countermeasures such as imitating a browser fingerprint (as the Anki add-on did by switching to `curl_cffi` [G7]) are even more clearly circumvention.
- Alternatives:
  - Use the official APIs with the user's key (32). Google Cloud Translation Basic (v2) works with an API key, is free up to 500,000 characters a month and then costs 20 dollars per 1,000,000 characters. Billing has to be set up [G18][G19]. Papago is paid.
  - DeepL and the LLM providers (already available).
  - Local translation (under consideration in 1 and 34 of `core-integration.md`). It involves neither a network nor any service's terms.

## Options and their effects

| Option | What it is | Advantages | Drawbacks |
|---|---|---|---|
| A. Do not build (official APIs and local translation only) | Keep the current state from 17 and add the official APIs from 32 | No concerns about the terms. No maintenance when things break. Users' connections are not caught up in blocks | No free, keyless, high-quality translation. Users who moved from upstream have to get a key or move to local translation |
| B. Build with explicit opt-in | Build it in Rust in a clean room. Off by default. When the user selects it, show that "it uses an unofficial endpoint, may violate the terms and can stop working or get the connection blocked", and get consent. Add a rate cap | Brings back the same experience as upstream. Avoids copyright problems | Consent does not remove the terms problem (consent is between the user and the project and does not change the relationship with Google or NAVER). Repairs at least once a year. The more repairs work around blocks, the worse the position under the terms. The policy has to match speech recognition in 14 |
| B'. Build Google only | B limited to Google | Breaks less often than Papago. More languages | Same as B. No language can be translated only by Papago, so dropping Papago loses little |
| C. Official APIs only (as A, but adding official Papago too) | Google Cloud Translation, Azure Translator and NAVER's Papago with the user's keys | Within the terms. The response format is fixed by documentation, so it rarely breaks | Users have to get keys and set up billing. Official Papago is paid and needs two keys |

- What to decide if B is chosen: whether it is off by default; whether to avoid automatic test requests at startup (a request like the current Python startup check hits the endpoint even when the user has not selected it); the rate cap; whether to use the existing flow that switches to local translation when blocked; and whether it can be built without anyone looking at the `translator_engines` and `translators` code.
- The decision follows the same reasoning as 14 (the public key for Google speech recognition). If B is chosen, the consistent direction is to keep 14 as well; if A or C is chosen, to remove 14 as well.
- Within the scope of this research, what can be said is this. It can be built technically. However, Google stopped working as recently as autumn 2026, and whether Papago works now could not be confirmed. At least for Google, the terms' clauses on robots.txt and on bypassing protective measures may apply. This is not a legal judgment of which option is allowed.

## Sources

All viewed on 2026-11-16.

In the repository
- `src-python/models/translation/translation_translator.py` (lines 22 to 38)
- `docs/voice-stack/core-integration.md` (14, 17, 32)
- `NOTICE.md` (lines 24 to 28)
- Commits 5d455c31 (translators to translator_engines) and 7806cacc (stopped bundling translator_engines; the deleted license text is at `git show 7806cacc^:src-python/translator_engines.LICENSE.txt`)

Google
- [G1] Google Terms of Service (in effect from 2026-07-30): https://policies.google.com/terms
- [G2] README of py-googletrans (unofficial-use disclaimer, IP blocks, TKK token): https://github.com/ssut/py-googletrans
- [G3] py-googletrans issue #280 (2021-03-10, broken TKK extraction): https://github.com/ssut/py-googletrans/issues/280
- [G4] py-googletrans `googletrans/urls.py` and `client.py` (`/translate_a/single`, `gtx` and `webapp`): https://raw.githubusercontent.com/ssut/py-googletrans/master/googletrans/urls.py and https://raw.githubusercontent.com/ssut/py-googletrans/master/googletrans/client.py
- [G5] eeeXun/gtt issue #43 (2026-09-14; 429 for `client=gtx`, 200 for `at` and `dict-chrome-ex`): https://github.com/eeeXun/gtt/issues/43
- [G6] noctalia-dev/official-plugins issue #64 (2026-09-03, 429 and a CAPTCHA page): https://github.com/noctalia-dev/official-plugins/issues/64
- [G7] The Google Translate add-on for Anki (moved to `curl_cffi` on 2026-09-13): https://ankiweb.net/shared/info/1536291224 (from a search result summary; the page itself was not checked directly)
- [G8] A batchexecute example (YiiGuxing/TranslationPlugin #835): https://github.com/YiiGuxing/TranslationPlugin/issues/835 and an AutoHotkey example: https://www.autohotkey.com/boards/viewtopic.php?t=113534
- [G9] funkyremi/vscode-google-translate issues #51 and #98 (failures parsing the response): https://github.com/funkyremi/vscode-google-translate/issues/51 and https://github.com/funkyremi/vscode-google-translate/issues/98 (from a search result summary)
- [G10] Asura7170/easydict_win32 PR #4 (2026-10-15, switch to `translate-pa.googleapis.com/v1/translateHtml`): https://github.com/Asura7170/easydict_win32/pull/4
- [G11] Google Search help, "unusual traffic": https://support.google.com/websearch/answer/86640?hl=en
- [G12] Translumo's releases (v1.1.0, September 22): https://github.com/ramjke/Translumo/releases
- [G13] robots.txt of translate.google.com: https://translate.google.com/robots.txt
- [G14] Google Terms of Service, 2017-10-25 version: https://policies.google.com/terms/archive/20171025
- [G15] Google APIs Terms of Service (last updated 2021-11-09): https://developers.google.com/terms
- [G16] Cloud Translation attribution requirements: https://docs.cloud.google.com/translate/attribution
- [G17] Google Play developer policy (from a search result summary; the text itself was not checked directly): https://support.google.com/googleplay/android-developer/answer/18258653?hl=en
- [G18] Cloud Translation pricing: https://cloud.google.com/products/translate/pricing
- [G19] Using Cloud Translation Basic (`translation.googleapis.com/language/translate/v2`, API key): https://docs.cloud.google.com/translate/docs/basic/translating-text

NAVER and Papago
- [P1] arrufat/papago (Go; `/apis/n2mt/translate`, `/apis/langs/dect`, headers): https://github.com/arrufat/papago/blob/master/papago.go
- [P2] 009342/PapagoTranslateAPI PR #1 (the HMAC-MD5 `PPG` signature): https://github.com/009342/PapagoTranslateAPI/pull/1/files (from a search result summary; the format of the signed string comes from a secondary description and was not checked directly)
- [P3] XUnity.AutoTranslator issue #704 (2025-04-29): https://github.com/bbepis/XUnity.AutoTranslator/issues/704
- [P4] XUnity.AutoTranslator PR #820 (2026-03-23, handling the rename of the JavaScript bundle): https://github.com/bbepis/XUnity.AutoTranslator/pull/820
- [P5] kmonkeyhead/MORT issue #137 (2026-03-28): https://github.com/kmonkeyhead/MORT/issues/137
- [P6] Translumo's releases (Papago removed in v1.1.0): https://github.com/ramjke/Translumo/releases
- [P7] End of the Papago API on NAVER Developers (2024-02-29): https://www.oppadu.com/lesson/%EC%97%91%EC%85%80-%ED%8C%8C%ED%8C%8C%EA%B3%A0-%EB%B2%88%EC%97%AD-%ED%95%A8%EC%88%98/ (secondary source), and end of the old console (2025-03-20): https://cloudike.kr/blog/ai-naver-api-papago-%EC%84%9C%EB%B9%84%EC%8A%A4-%EC%A2%85%EB%A3%8C-%EC%95%88%EB%82%B4-25-3-20/ (secondary source)
- [P8] End of Papago website translation (article of 2024-08-13): https://www.koreastocknews.com/news/articleView.html?idxno=102729
- [P9] README of UlionTse/translators (GPL-3.0; Papago covers 15 languages): https://github.com/UlionTse/translators
- [P10] The automation clause in NAVER's terms (secondary source; the original at policy.naver.com could not be retrieved): https://neonomadj.com/aside-naver-blog/
- [P11] Explicit ban on comments by automated programs (article of 2018-04): https://news.nate.com/view/20180404n37939 (from a search result summary)
- [P12] Papago Translation API (`papago.apigw.ntruss.com/nmt/v1/translation`, 5,000 characters per request): https://api.ncloud-docs.com/docs/ai-naver-papagonmt-translation
- [P13] Preparing to use Papago Translation (billing per 1,000,000 characters, limits, brand display): https://guide.ncloud-docs.com/docs/papagotranslation-spec

## What could not be confirmed

- The original text and the article numbers of NAVER's terms of service (policy.naver.com and papago.naver.com could not be retrieved from this environment).
- Whether the current Papago web endpoint works. No real requests were sent.
- The unit price of Papago on NAVER Cloud Platform.
- How Microsoft Store, GitHub and Linux package channels treat apps that communicate in violation of a service's terms.
- Whether a block at the translation endpoint extends to Google Search and other services on the same connection.

---

# Google と Papago のウェブ翻訳を Rust で作り直せるかの調査（2026-11-16）（日本語版）

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
