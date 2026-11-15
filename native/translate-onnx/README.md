# vrct-translate-onnx

ローカル翻訳（M2M100 と NLLB-200）を ONNX Runtime で動かす Rust クレートです。Issue #288 の要件B で、Python 側の CTranslate2 による翻訳（`src-python/models/translation/translation_translator.py` の `translateCTranslate2`）を置き換えるためのものです。

## 現在の状態

- ライブラリと、比較用のコマンド `vrct-translate` が動きます。**アプリにはまだ組み込んでいません。** アプリのローカル翻訳は、今も Python 側の CTranslate2 で動いています。
- モデルは `tools/translation_onnx/export.py` で作ります。作ったモデルの配布先（Hugging Face など）とモデル取得カタログへの登録は、まだしていません。

## 対象モデル

| 名前 | 元のモデル | ライセンス | ビーム数 |
|---|---|---|---|
| `m2m100_418M` | `facebook/m2m100_418M` | MIT | 5 |
| `m2m100_1.2B` | `facebook/m2m100_1.2B` | MIT | 5 |
| `nllb-200-distilled-600M` | `facebook/nllb-200-distilled-600M` | CC-BY-NC-4.0 | 2 |
| `nllb-200-distilled-1.3B` | `facebook/nllb-200-distilled-1.3B` | CC-BY-NC-4.0 | 2 |
| `nllb-200-3.3B` | `facebook/nllb-200-3.3B` | CC-BY-NC-4.0 | 2 |

元のモデルのコミットは `export.py` に固定してあります。重みは int8（動的量子化）です。

## 現行の CTranslate2 と同じにしていること

- 入力は 1024 トークンまでで、超えたら失敗にします（`translation_input_too_long`）。
- 出力は 256 トークンまでです。言語トークンと終了トークンも数に含めます。終了トークンで終わらなかった訳文は失敗にします（`translation_unfinished`）。どちらもアプリが CTranslate2 で調べている条件と同じです。
- ビーム探索は CTranslate2 4.8.4 の規則に合わせました。
  - 各ステップで、ビーム数の2倍の候補を取ります。
  - 最初の自由ステップでは、2番目以降の候補に出た終了トークンを除きます。
  - 終わった訳文の位置は、次の候補で埋めます。
  - スコアは、言語トークンと終了トークンを含めた長さで割ります。
  
  規則の説明は `src/beam.rs` の冒頭にあります。
- トークナイザは、アプリと同じ ID とデコード結果を返します。
  - NLLB はアプリと同じ `tokenizer.json` を使います。
  - M2M100 は `export.py` が SentencePiece のモデルから `tokenizer.json` を作り、`vocab.json` でモデルの ID に変換します。SentencePiece が出す断片のうち 390 個はモデルの語彙になく、アプリでは `<unk>` になります。ここでも同じく `<unk>` にします。
- CPU のスレッド数は、アプリが CTranslate2 に渡している値と同じ4です。

## 実行する場所

| 環境 | 実行プロバイダ |
|---|---|
| Windows | DirectML（NVIDIA、AMD、Intel を1つのビルドで扱う）。読み込めないときは CPU |
| Linux | CPU |

`Device::Auto` で GPU を試し、失敗したら CPU で動かします。`Translator::backend()` で、どちらで動いているかが分かります。Linux の GPU（ROCm）は、`ort` の配布バイナリに入っていないので対応していません。

## ログとデータ

翻訳する文章と訳文は、ログにもエラーにも入れません。エラーは `codes` の固定の文字列だけです。

## 試験

```sh
cargo test --locked --manifest-path native/translate-onnx/Cargo.toml
```

ビーム探索、マニフェストの検査、デコードは、モデルなしで試験します。実際のモデルで試すときは、`export.py` で作ったフォルダを環境変数で指定します。指定がなければ、その試験は何もせずに通ります。

```sh
VRCT_TRANSLATE_M2M100=<m2m100_418M-onnx-int8 のフォルダ> \
VRCT_TRANSLATE_NLLB=<nllb-200-distilled-600M-onnx-int8 のフォルダ> \
cargo test --manifest-path native/translate-onnx/Cargo.toml
```

現行の CTranslate2 との訳文の比較は `tools/translation_onnx/compare.py` で行います。手順は同じフォルダの README にあります。
