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

`--directions en-ja,ja-en` のように指定すると、方向を絞れます。

## 比較の結果（2026-11-15）

結果のファイルは `results/` にあります。

- 環境：Linux x86_64（Ryzen 9 9900X）の CPU。スレッドは4つで、CTranslate2 の計算型は int8 です。
- CTranslate2 の側は、アプリが固定しているモデルを、アプリと同じ版（ctranslate2 4.8.4、transformers 5.22.1）で動かしました。
- 比べた文は、WMT20 の8方向それぞれの先頭の文です。418M と 600M は各方向 100 文、ほかは 50 文です。
- 3.3B は、時間の上限で1回目が止まったため、残りの方向を2回目で取って合わせました（`runs` の欄に記録があります）。

### int8 どうしの比較

| モデル | 文数 | BLEU の差（平均） | chrF の差（平均） | 訳文の完全一致 | 入力 ID の不一致 | 失敗（CT2 / ONNX） |
|---|---|---|---|---|---|---|
| M2M100 418M | 800 | +0.07 | +0.13 | 353 | 0 | 0 / 0 |
| M2M100 1.2B | 400 | +0.27 | +0.49 | 170 | 0 | 0 / 0 |
| NLLB 600M | 800 | -0.15 | +0.20 | 246 | 0 | 1 / 3 |
| NLLB 1.3B | 400 | +0.14 | +0.18 | 165 | 0 | 0 / 0 |
| NLLB 3.3B | 400 | -0.48 | -0.12 | 149 | 0 | 0 / 0 |

差は「ONNX − CT2」で、どちらも参照訳に対して測りました。デコードの不一致（ONNX の出力 ID をアプリのトークナイザで戻した文字列と、ONNX の訳文の違い）は、どのモデルでも 0 です。

- **失敗**は、どれも 256 トークンまでに終了トークンが出なかったものです。アプリが CTranslate2 で失敗として扱う条件と同じです。量子化の方式の違いによって、繰り返しに入る文が変わります。
- **NLLB 3.3B** は、英語へ訳す4方向がすべてマイナスでした（BLEU -1.09〜-2.33）。各方向 50 文なのでぶれは大きいですが、向きがそろっているため、回帰がないとまでは確認できていません。

### float32 どうしの比較（探索の確認）

量子化しない M2M100 418M で、ONNX と CTranslate2（元のモデルを float32 で変換したもの）を比べました。**400 文中 399 文で訳文が完全に一致しました。** 残る1文（de→en）は、float32 の丸めの違いで同点に近い候補が入れ替わったものです。int8 で出る差は、探索ではなく量子化の方式（CTranslate2 の int8 と ONNX Runtime の動的 int8）によるものだと言えます。

### 速度（参考）

| モデル | 方向（30 文） | CT2 | ONNX |
|---|---|---|---|
| M2M100 418M | en→ja | 27.4秒 | 44.5秒 |
| M2M100 418M | ja→en | 9.9秒 | 12.9秒 |
| NLLB 600M | en→ja | 18.0秒 | 25.3秒 |
| NLLB 600M | ja→en | 10.4秒 | 11.6秒 |

- 計測の条件：同じ PC の CPU で、スレッドは4つです。ほかのセッションの処理で平均負荷は 3.6〜4.0 ありました。
- ONNX の時間には、コマンドの起動とモデルの読み込みも含みます。
- CPU では、ONNX のほうが 1.1〜1.6 倍遅くなりました。GPU（DirectML）では計っていません。

### モデルの大きさ

| モデル | CT2 版 | ONNX 版 |
|---|---|---|
| M2M100 418M | 500 MB | 778 MB |
| M2M100 1.2B | 1,259 MB | 1,537 MB |
| NLLB 600M | 647 MB | 1,178 MB |
| NLLB 1.3B | 1,401 MB | 1,936 MB |
| NLLB 3.3B | 3,379 MB | 4,450 MB |

ONNX 版は、エンコーダとデコーダが埋め込みをそれぞれ持ち、デコーダの出力層も別に量子化されるため、CT2 版より大きくなります。
