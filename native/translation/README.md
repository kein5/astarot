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

形態素解析は Python と同じく Sudachi で、分割モード C を使います。Python の SudachiPy の中身にあたる sudachi.rs（Apache-2.0）を、機能 `sudachi` の `transliteration::sudachi` で使います。中核はこの機能を有効にします。プロバイダだけを使うクレート（`native/transcription`）は無効のままです。

- sudachi.rs は crates.io にないので、git の依存としてタグ v0.6.11 のコミットに固定しています。0.6 の系列は SudachiDict 20250825 の形式（V0）を読みます。0.7 は新しい形式（V1）だけを読むので、上げるときは辞書も一緒に替えます。
- 辞書は `system.dic`（SudachiDict）をファイルのまま読み、メモリーに写像します（`Sudachi::open`）。設定（`sudachi.json`）と文字の定義（`char.def` など）は sudachi.rs に組み込まれたものを使います。SudachiPy が同梱していたものと同じです。
- `SudachiFile` は最初の文で辞書を開きます。ファイルがない、または読めない（途中で切れたファイルを含む）ときは `Unavailable` を返し、`unavailable_reason` が理由（ファイルの場所だけで、文章は入りません）を返します。アプリをもう一度起動するまで開き直しません。
- どの辞書（full、core、small）を配布物に入れるかは `docs/voice-stack/core-integration.md` の「判断が要ること」の 3 です。辞書は `tools/sudachi_dictionary.py` が公式の配布から固定の版で取得し、大きさと SHA-256 を確かめます。

解析のあとの処理（読みの分け方、文脈の規則、ひらがなとヘボン式）は Python と同じ結果を返します。152 文で SudachiPy の出力と比べ、SudachiDict full ではすべて一致しました（計測は `core-integration.md`）。

## ログとデータ

ログには何も書きません。エラーは固定の値だけで、キー、URL、利用者の文章は入りません。キーはヘッダーにだけ入れ、`Client` の `Debug` 表示にも出しません。

## 試験

```sh
cargo test --locked --manifest-path native/translation/Cargo.toml
```

`tests/providers.rs` は、ループバックに立てた偽のプロバイダ（機能 `fake-server` の `fake::FakeProviders`）を相手に、キーの確認、モデルの一覧、翻訳、失敗と再試行を確かめます。外のネットワークには出ません。

`tests/sudachi.rs` は、sudachi.rs の辞書の作成機能で数語の辞書をその場で作り、Sudachi の解析から読みまでを確かめます。ない辞書と壊れた辞書も確かめます。SudachiDict は取得しません。ビルドでは sudachi.rs を GitHub から取得します（C の依存はありません）。
