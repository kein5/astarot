# ONNX 版ローカル翻訳モデルの作成と比較

`native/translate-onnx` が読み込むモデルを作り、現行の CTranslate2 と訳文を比べるための道具です。アプリの実行時には使いません。

## モデルを作る

```sh
uv venv --python 3.11 build/translation-onnx/venv
uv pip install --python build/translation-onnx/venv/bin/python --index-strategy unsafe-best-match \
    --extra-index-url https://download.pytorch.org/whl/cpu -r tools/translation_onnx/requirements.txt
build/translation-onnx/venv/bin/python tools/translation_onnx/export.py m2m100_418M --output <出力先>
```

`<出力先>/m2m100_418M-onnx-int8/` に、エンコーダとデコーダの ONNX、`tokenizer.json`、`vocab.json`、`manifest.json` ができます。`manifest.json` には、各ファイルの SHA-256、元のモデルのコミット、使ったパッケージの版が入ります。

- 元のモデルは `export.py` の中でコミットを固定しています。
- 必要なメモリの目安は、418M・600M が 15GB、1.2B・1.3B が 30GB、3.3B が 55GB 程度です。中間ファイルも元のモデルの数倍の大きさになります（3.3B では約 27GB）。tmpfs の `/tmp` ではなく、ディスク上を `--work` に指定してください。
- `--float32` を付けると、量子化しないモデルを作ります。これはデコードの検証用で、アプリでは使いません。

## 現行の CTranslate2 と比べる

比べるときの Python 環境は、アプリの `uv.lock` と同じ版にします（ctranslate2 4.8.4、transformers 5.22.1、tokenizers 0.23.3、sentencepiece 0.2.1）。これに sacrebleu 2.6.0 を足します。

```sh
cargo build --release --manifest-path native/translate-onnx/Cargo.toml
python tools/translation_onnx/compare.py m2m100_418M \
    --onnx <出力先>/m2m100_418M-onnx-int8 \
    --cli native/translate-onnx/target/release/vrct-translate \
    --out <結果>.json
```

CTranslate2 の側は、アプリが固定しているモデルを取得し、ピン留めと照合してから、`translation_translator.py` と同じ手順で翻訳します。比べる対象は、WMT20 の8方向（英語と日本語・中国語・ドイツ語・ロシア語の双方向）で、各方向の先頭 N 文です。結果のファイルには点数と件数だけを書き、文章は書きません。
