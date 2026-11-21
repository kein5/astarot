# vrct-translation

オンラインの翻訳プロバイダと、かな・ローマ字の読みを扱う Rust クレートです。Issue #277 の範囲で、Python の `src-python/models/translation/` と `src-python/models/transliteration/` を置き換えます。中核（`native/core`）がこのクレートをエンドポイントにつなぎます。

## 内容

| モジュール | 役割 | Python |
|---|---|---|
| `providers` | DeepL、Google Cloud Translation、Papago（NAVER Cloud Platform）、Plamo、Gemini、OpenAI、Groq、OpenRouter、OpenAI 互換、LM Studio、Ollama のキーの確認、モデルの一覧、翻訳。プロバイダごとに 1 ファイル（`providers/deepl.rs` など）で、共通の部分はトレイト（`Api`、`ChatCompletions`）に書く | `translation_*.py` の各クライアント |
| `prompt` | チャット型のプロバイダに渡すシステムプロンプトと会話の履歴 | `translation_settings/prompt/*.yml` |
| `transliteration` | 読みの分け方、何（なに・なん）の規則、カタカナからひらがなとヘボン式 | `transliteration_*.py` |
| `http` | プロバイダとの通信に使う小さな HTTP/1.1 クライアント | [`models/network_policy.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/network_policy.py) の一部 |
| `translategemma` | TranslateGemma の公式のテンプレートの文を組み立て、アプリが起動した llama.cpp のサーバーの `/completion` に送る（ADR-015）。system を送らず、会話の文脈も送らず、温度 0 で生成する。エンジンの一覧のプロバイダではない。契約は `tests/translategemma.rs` と `tests/contract/translategemma.json` | （なし） |

## プロバイダの形

ゼロコスト抽象化で書いています（2026-11-16 に訂正したオーナーの決定）。共通の振る舞いはトレイトの既定のメソッドと関連定数に 1 回だけ書き、各プロバイダは単位構造体（`DeepL`、`OpenAi` など）としてトレイトを実装します。トレイトはジェネリクスの境界（`P: Api`）としてだけ使い、`dyn` や関数ポインタの表は使いません。呼び出しはコンパイル時に決まり、実行時の負担は 1 つの `match` だけです。各プロバイダは `src/providers/` の 1 ファイルで、Python の 1 ファイルに当たります。

| トレイト | 役割 |
|---|---|
| `Api` | すべてのプロバイダ。関連定数は `PROVIDER`（実行時の名前）、`ENGINE`（設定に残る名前）、`MODELS`（モデルを選ぶか。機械翻訳の API は `false`）、`LOCAL`（利用者が動かすサーバ。キーなし、長い待ち時間、再試行なし）、`TRANSLATE_WAIT`（クラウドの翻訳の待ち時間）。確認は `reach`（そのプロバイダ独自の確認。既定は何もしない）のあとに `list`（モデルの一覧。既定は空）です。`check`、`models`、`attempt`（待ち時間と 1 回の再試行）は既定のメソッドで、`translate` だけは各プロバイダが書きます |
| `chat::ChatCompletions` | OpenAI 形式のチャット（PLaMo、OpenAI、Groq、OpenRouter、OpenAI 互換、LM Studio）。`GET /models` と `POST /chat/completions` を既定のメソッド（`list_models`、`chat`）に 1 回だけ書きます。違いは関連定数の `PLAMO_PROMPT`（PLaMo のプロンプト）と `INCOMPLETE_DETAILS`（`incomplete_details` で切れた答えも見るか。OpenAI と OpenAI 互換だけ）と、`authorization`（LM Studio は `Bearer lmstudio`）と `keep`（モデルの絞り込み）の上書きで表します |

各プロバイダに残るのは、そのプロバイダだけの部分です。

- DeepL: `:fx` のキーの送り先、`" "` を訳す確認、大文字のコード。
- Google Cloud Translation: `x-goog-api-key` ヘッダー、言語の一覧での確認、`format: "text"`。
- Papago: Client ID（`Access::client_id`）と Client Secret のヘッダー、空の文での確認、訳せる組。
- Gemini: ページごとのモデルの一覧（全体で 8 秒）、`generateContent`、`MAX_TOKENS`、思考の部分を除くこと。
- OpenRouter: `/auth/key` での確認。OpenAI 互換: アドレスがこの PC か LAN なら `local` を真にする。
- LM Studio と Ollama: 0.2 秒でサーバが答えるかの確認と、キーなしのモデルの一覧。Ollama は `/api/chat` と `done_reason`。

設定は実行時にエンジンの名前で選ぶので、名前を型に変える場所が要ります。それは `Provider::call` の 1 つの `match` だけです。`Call` トレイト（ジェネリックな `call::<P>()`）を渡すと、そのプロバイダの型で呼びます。中核は `Provider::check`、`models`、`translate`、`reach` を呼ぶだけで、プロバイダごとの分岐を持ちません。

ほかに共有するもの。

- `http`: HTTP/1.1 の送受信と、平文の HTTP を許す範囲（下の「この PC と LAN」）。HTTP の送り口（`http::Transport`）は試験で偽物に替えるための口で、翻訳の呼び出しの分岐ではありません。
- `prompt`: チャット型のプロバイダに渡すプロンプトの文面と履歴。
- `providers/mod.rs`: 固定のアドレス（`Endpoints`、試験では偽のサーバに向ける）、エラーの値、待ち時間、URL と JSON と 1 回の再試行とモデルの選び方の小さな関数。

Google、Bing、Papago の Web 翻訳は、上流のライセンスにより ASTAROT では配布していません。Python でも動いていなかったので、このクレートにもありません。代わりに、各社の公式の API（Google Cloud Translation と Papago Translation）を利用者のキーで呼びます。

## Python と同じにしていること

- キーの確かめ方。DeepL は `" "` を `EN-US` に訳してみます。`:fx` で終わるキーは無料版の API へ送ります。OpenRouter は `/auth/key` を、ほかはモデルの一覧を取得して確かめます。
- モデルの絞り込み。各クライアントが除いていた語（`whisper`、`embedding` など）と、OpenAI の `gpt-` の条件をそのまま使います。一覧は名前の順に並べます。
- 待ち時間。キーの確認とモデルの一覧は 3 秒（1 回の確認全体で 8 秒）、クラウドの翻訳は接続 5 秒・読み取り 30 秒、PC の中のサーバは読み取り 120 秒、DeepL は接続 5 秒・読み取り 10 秒です。Gemini の翻訳は Google の SDK と同じく接続も含めて 30 秒です。LM Studio と Ollama が動いているかは 0.2 秒で確かめます。
- 再試行。クラウドのプロバイダは通信の失敗と次の状態コードのときに 1 回だけ再試行します。どの状態で再試行するかと、再試行の前にどれだけ待つかは、Python のクライアントが使っていた SDK の規則です（`providers/retry.rs`）。LM Studio と Ollama は再試行しません。
  - OpenAI の SDK（PLaMo、OpenAI、Groq、OpenRouter、OpenAI 互換。中核で足した Google Cloud Translation と Papago も）: 408、409、429、5xx。応答に `x-should-retry` があればそれに従い、`retry-after` が 120 秒を超えるときは再試行しません。待つのは `retry-after-ms` か `retry-after`（秒か HTTP の日付）の値で、なければ 0.375〜0.5 秒です。
  - DeepL の SDK: 429、5xx。2 回目は 1 回目を始めてから 1 秒後に始めます。
  - Google の SDK（Gemini）: 408、429、500、502、503、504。1〜2 秒待ちます。
- 長さの上限で切れた応答（`finish_reason` が `length`、Gemini の `MAX_TOKENS`、Ollama の `done_reason` が `length`、OpenAI と OpenAI 互換の Responses API の `incomplete_details`）は、訳せなかったものとして空の文字列を返します。
- 要求の本文。Gemini には LangChain が送っていた生成の設定（`temperature` 0.7、候補 1 つ、空の `safetySettings`）を送ります。DeepL には SDK と同じく `show_billed_characters` を付け、Ollama には空の `options` と `tools` を付けます。
- Responses API。LangChain は、名前が `gpt-5-pro`、`gpt-5.2-pro`、`gpt-5.4-pro`、`gpt-5.5-pro`、`gpt-5.6-sol` で始まるか `codex` を含むモデルを Chat Completions ではなく Responses API（`POST /responses`）で呼んでいました。OpenAI 形式のチャットのプロバイダは同じ規則で選びます（`chat::responses_only`）。
- プロンプトの文面、言語の一覧の書き方（Python のリストの表記）、履歴の件数（5 件）と文字数（4000 字）。

## 公式の翻訳 API（中核で足したもの）

Python にはなかったプロバイダです。どちらも機械翻訳の API で、モデルを選びません。待ち時間は DeepL と同じ（接続 5 秒、読み取り 10 秒）で、再試行は OpenAI の SDK の規則に従います（上の「Python と同じにしていること」）。本物のサービスでは確かめていません。

| プロバイダ | 送り方 | キーの確認 | 参照（2026-11-16 に確認） |
|---|---|---|---|
| Google Cloud Translation（Basic、v2） | `POST https://translation.googleapis.com/language/translate/v2`。本文は JSON の `q`、`source`、`target`、`format: "text"`。キーは `x-goog-api-key` ヘッダー（URL の `key=` は使わない） | `GET /language/translate/v2/languages`（何も訳さない） | [translate](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)、[languages](https://docs.cloud.google.com/translate/docs/reference/rest/v2/languages)、[API キー](https://docs.cloud.google.com/docs/authentication/api-keys-use)、[言語](https://docs.cloud.google.com/translate/docs/languages) |
| Papago Translation（NAVER Cloud Platform） | `POST https://papago.apigw.ntruss.com/nmt/v1/translation`。本文は JSON の `source`、`target`、`text`。Client ID は `X-NCP-APIGW-API-KEY-ID`、Client Secret は `X-NCP-APIGW-API-KEY` ヘッダー。1 回 5,000 字まで | 空の文を送る。ゲートウェイが認証を断ると 401（または 429）。通れば Papago が 400 と `N2MT…` のコードで断るので、何も訳さずに確かめられる | [Translation](https://api.ncloud-docs.com/docs/en/ai-naver-papagonmt-translation)、[エラーコード](https://api.ncloud-docs.com/docs/en/ai-naver-papagonmt)、[ゲートウェイ](https://api.ncloud-docs.com/docs/en/common-naverapi-naverapi) |

Papago が直接訳せる組は限られます（`papago::supports`）。ほかの組は送らずに `Error::UnsupportedPair` を返します。

## この PC と LAN

平文の HTTP は、この PC と LAN にだけ送ります（`http::is_local_host`）。中核の URL の検査（`net_policy`）も同じ関数を使います。

- この PC: `localhost`、127.0.0.0/8、::1。
- LAN: 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、169.254.0.0/16、fe80::/10、fc00::/7、`.local` の名前（mDNS）。
- 名前は接続のときに引いたアドレスがこの範囲にあるかをもう一度確かめ、範囲の外なら送りません（`HttpError::Url`）。
- 100.64.0.0/10（CGNAT、Tailscale など）は含めません。

LM Studio と Ollama はこの PC か LAN のサーバとして、再試行せずに長く待ちます（読み取り 120 秒）。OpenAI 互換のエンドポイントも、アドレスがこの PC か LAN のときは同じにします（Python はクラウドと同じ 30 秒と 1 回の再試行でした）。

## Python と違う点

- **プロキシ**。Python はクラウドのプロバイダへの通信で `HTTP(S)_PROXY` を使っていました。このクレートはプロキシを使いません（`native/ops` と同じ）。
- **SDK の細かな違い**。LangChain や各社の SDK ではなく各 API を直接呼びます。送る中身と再試行の規則は Python のクライアントと同じにしてあり、契約テスト（下の「試験」）で確かめます。SDK が自分で付けるヘッダー（`User-Agent`、`x-stainless-*` など）は送りません。
- **この PC と LAN の OpenAI 互換のエンドポイント**。LM Studio と同じ待ち時間で再試行しません（上の「この PC と LAN」）。

## 読み（transliteration）

形態素解析は Python と同じく Sudachi で、分割モード C を使います。Python の SudachiPy の中身にあたる sudachi.rs（Apache-2.0）を、機能 `sudachi` の `transliteration::sudachi` で使います。中核はこの機能を有効にします。プロバイダだけを使うクレート（`native/transcription`）は無効のままです。

- sudachi.rs は crates.io にないので、git の依存としてタグ v0.6.11 のコミットに固定しています。0.6 の系列は SudachiDict 20250825 の形式（V0）を読みます。0.7 は新しい形式（V1）だけを読むので、上げるときは辞書も一緒に替えます。
- 辞書は `system.dic`（SudachiDict）をファイルのまま読み、メモリーに写像します（`Sudachi::open`）。設定（`sudachi.json`）と文字の定義（`char.def` など）は sudachi.rs に組み込まれたものを使います。SudachiPy が同梱していたものと同じです。
- `SudachiFile` は最初の文で辞書を開きます。ファイルがない、または読めない（途中で切れたファイルを含む）ときは `Unavailable` を返し、`unavailable_reason` が理由（ファイルの場所だけで、文章は入りません）を返します。アプリをもう一度起動するまで開き直しません。
- 配布物には full を入れます（`docs/voice-stack/core-integration.md` の「判断が要ること」の 3、2026-11-21 に決定、#924）。辞書は `tools/sudachi_dictionary.py` が公式の配布から固定の版で取得し、大きさと SHA-256 を確かめます。

解析のあとの処理（読みの分け方、文脈の規則、ひらがなとヘボン式）は Python と同じ結果を返します。152 文で SudachiPy の出力と比べ、SudachiDict full ではすべて一致しました（計測は `core-integration.md`）。

## ログとデータ

ログには何も書きません。エラーは固定の値だけで、キー、URL、利用者の文章は入りません。キーはヘッダーにだけ入れます。呼び出し先と資格情報をまとめた `Access` は `Debug` を持たないので、キーを誤って表示することもありません。

## 試験

```sh
cargo test --locked --manifest-path native/translation/Cargo.toml
```

`tests/providers.rs` は、ループバックに立てた偽のプロバイダ（機能 `fake-server` の `fake::FakeProviders`）を相手に、各プロバイダの型を直接呼んで、キーの確認、モデルの一覧、翻訳、失敗と再試行、Google Cloud Translation と Papago の要求の形を確かめます。実行時の名前からの呼び出しが型からの呼び出しと同じ要求を送ること、`incomplete_details` を見るのが OpenAI と OpenAI 互換だけであること、モデルのないチャットは何も送らないことも確かめます。外のネットワークには出ません。

`tests/sudachi.rs` は、sudachi.rs の辞書の作成機能で数語の辞書をその場で作り、Sudachi の解析から読みまでを確かめます。ない辞書と壊れた辞書も確かめます。SudachiDict は取得しません。ビルドでは sudachi.rs を GitHub から取得します（C の依存はありません）。

### 契約テスト（Python との同等性）

Python の実装と同じに動くことは、`tests/contract/` の 2 つのファイルで確かめます。どちらも Python の実装から記録したもので、0.6.0 で Python を消したので、このファイルが仕様です。場面を足すときは、記録を手で書きます。

| ファイル | 中身 | Rust の試験 | 記録した Python の試験（0.6.0 で消した） |
|---|---|---|---|
| `providers.json` | プロバイダごとの場面（頼む操作と、プロバイダが返す応答）と、そのとき Python のクライアントが送った要求（メソッド、URL、ヘッダー、本文、待ち時間）と返した結果 | `tests/contract.rs` | `src-python/test/test_translation_contract.py` |
| `transliteration.json` | 文ごとの Sudachi の形態素と読み（マクロンありとなし）、かなごとのヘボン式 | `tests/transliteration_contract.rs` | `src-python/test/test_transliteration_contract.py` |

- プロバイダの契約は通信を差し替えて実際のアドレスのまま記録します。外のネットワークには出ません。キーは作り物です。比べないのは、HTTP のライブラリや SDK が自分で付けるヘッダー（`User-Agent`、`Accept`、`x-stainless-*` など）と、本文のない要求の `Content-Type` だけです。Python の requests には書き込みの待ち時間がないので、その欄も比べません。
- 応答には `retry-after` などのヘッダーを付けられます。再試行の前の待ちは SDK の規則に乱数が入るので、記録ではなく範囲（`retry_pause`）で書き、1 回目と 2 回目の要求の間の時間を Python と Rust の両方で確かめます。待つ場面があるので、Rust の試験は場面を並べて流します。
- 中核が意図して Python と違う場面は、`python` の記録を残したまま `rust` に中核の記録を書き、`differences` にその理由と決めた場所を書きます（いまは、この PC と LAN の OpenAI 互換のエンドポイントの待ち時間と再試行だけです）。Google Cloud Translation と Papago は Python になかったので、各社の文書から書いた `expect` と比べます。
- 読みの契約は記録した形態素を Rust の読みに渡して比べるので、辞書なしで動きます。`ASTAROT_SUDACHI_DICTIONARY` に SudachiDict の `system.dic`（ファイルに書いた版）を指定すると、sudachi.rs の解析結果も記録と比べます。2026-11-18 に Python の環境の SudachiDict full 20250825 で 170 文すべてが一致しました。
- 場面を変えたときは、Python の環境で `ASTAROT_TRANSLATION_CONTRACT_WRITE=1` を付けて 2 つの Python の試験を流すと、記録を書き直します。Python のない環境では場面と記録を手で書きます。
