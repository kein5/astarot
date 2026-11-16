# vrct-translation

オンラインの翻訳プロバイダと、かな・ローマ字の読みを扱う Rust クレートです。Issue #277 の範囲で、Python の `src-python/models/translation/` と `src-python/models/transliteration/` を置き換えます。中核（`native/core`）がこのクレートをエンドポイントにつなぎます。

## 内容

| モジュール | 役割 | Python |
|---|---|---|
| `providers` | DeepL、Plamo、Gemini、OpenAI、Groq、OpenRouter、OpenAI 互換、LM Studio、Ollama のキーの確認、モデルの一覧、翻訳 | `translation_*.py` の各クライアント、`translation_providers.py` |
| `prompt` | チャット型のプロバイダに渡すシステムプロンプトと会話の履歴 | `translation_settings/prompt/*.yml` |
| `transliteration` | 読みの分け方、何（なに・なん）の規則、カタカナからひらがなとヘボン式 | `transliteration_*.py` |
| `http` | プロバイダとの通信に使う小さな HTTP/1.1 クライアント | `models/network_policy.py` の一部 |

Google、Bing、Papago の Web 翻訳は、上流のライセンスにより VRCT-VOX では配布していません。Python でも動いていなかったので、このクレートにもありません。

## Python と同じにしていること

- キーの確かめ方。DeepL は `" "` を `EN-US` に訳してみます。`:fx` で終わるキーは無料版の API へ送ります。OpenRouter は `/auth/key` を、ほかはモデルの一覧を取得して確かめます。
- モデルの絞り込み。各クライアントが除いていた語（`whisper`、`embedding` など）と、OpenAI の `gpt-` の条件をそのまま使います。一覧は名前の順に並べます。
- 待ち時間。キーの確認とモデルの一覧は 3 秒（1 回の確認全体で 8 秒）、クラウドの翻訳は接続 5 秒・読み取り 30 秒、PC の中のサーバは読み取り 120 秒、DeepL は接続 5 秒・読み取り 10 秒です。LM Studio と Ollama が動いているかは 0.2 秒で確かめます。
- 再試行。クラウドのプロバイダは、通信の失敗と 408、409、429、5xx のときに 1 回だけ再試行します。LM Studio と Ollama は再試行しません。
- 長さの上限で切れた応答（`finish_reason` が `length`、Gemini の `MAX_TOKENS`）は、訳せなかったものとして空の文字列を返します。
- プロンプトの文面、言語の一覧の書き方（Python のリストの表記）、履歴の件数（5 件）と文字数（4000 字）。

## Python と違う点

- **プロキシ**。Python はクラウドのプロバイダへの通信で `HTTP(S)_PROXY` を使っていました。このクレートはプロキシを使いません（`native/ops` と同じ）。
- **SDK の細かな違い**。LangChain や各社の SDK ではなく、各 API を直接呼びます。OpenAI は Chat Completions だけを使い、一部のモデルで SDK が選んでいた Responses API は使いません。

## 読み（transliteration）

形態素解析の辞書はまだ決めていません（`docs/voice-stack/core-integration.md` の「判断が要ること」）。解析器は `transliteration::Tokenizer` として外から渡します。辞書が決まるまで、中核は `NoDictionary` を使い、読みは出しません。解析のあとの処理（読みの分け方、文脈の規則、ひらがなとヘボン式）は Python と同じ結果を返します。

## ログとデータ

ログには何も書きません。エラーは固定の値だけで、キー、URL、利用者の文章は入りません。キーはヘッダーにだけ入れ、`Client` の `Debug` 表示にも出しません。

## 試験

```sh
cargo test --locked --manifest-path native/translation/Cargo.toml
```

`tests/providers.rs` は、ループバックに立てた偽のプロバイダ（機能 `fake-server` の `fake::FakeProviders`）を相手に、キーの確認、モデルの一覧、翻訳、失敗と再試行を確かめます。外のネットワークには出ません。
