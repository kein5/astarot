# Local translation on the GPU and preparing to publish the models (2026-11-18, #277)

[日本語版](#ローカル翻訳の-gpu-とモデルの公開の準備2026-11-18277日本語版)

This is the record of the third piece of work for #277. It covers the fixes for running local translation (`native/translate-onnx`) on the GPU, the tools for publishing models and listing them in the catalog, and a review of how to handle NLLB. Points that need a decision are numbered in "Decisions needed" (判断が要ること) in [core-integration.md](core-integration.md). The license check of the models is in "Candidate models for local translation and how to handle NLLB" (ローカル翻訳のモデルの候補と NLLB の扱い) in [licensing.md](licensing.md).

## Summary

- The current translation graph did not run on the DirectML execution provider of ONNX Runtime. There were two causes, and both were fixed. After the fixes, a small model with random weights gave the same translation IDs as the CPU in all four quantization formats on two GPUs.
- The tools needed to publish the real models (a publishing folder with a model card, upload, and creating and checking catalog entries) are ready, and so is a data file that holds the catalog's translation entries. The models have not been published yet.
- Real models, CUDA, OpenVINO, AMD GPUs and Linux have not been checked yet.

## Why it did not run on DirectML and how it was fixed

### How it was checked

To check without downloading the real models, `tools/translation_onnx/tiny.py` was added. It writes a small model with random weights (NLLB architecture, 2 layers, width 64, vocabulary 4400) through the same path as `export.py`, and creates four folders: float32, float16, int8 and int4. `a_device_decodes_as_the_cpu_does` in `native/translate-onnx/tests/real.rs` loads the same folder on the CPU and on the given execution provider, and compares whether the beam search outputs the same IDs. If the execution provider cannot start and the model runs on the CPU, the test fails.

```sh
python tools/translation_onnx/tiny.py --output <output folder>
ORT_DYLIB_PATH=<onnxruntime.dll of the DirectML build> \
VRCT_TRANSLATE_DEVICE=directml:1 VRCT_TRANSLATE_DEVICE_MODEL=<output folder>/tiny-nllb-onnx-float32 \
cargo test --manifest-path native/translate-onnx/Cargo.toml --test real a_device
```

For the DirectML build of ONNX Runtime, the check used the `onnxruntime.dll` and `DirectML.dll` from `onnxruntime-directml` 1.24.4 on PyPI. That folder is also added to `PATH` so that `DirectML.dll` can be found.

### Cause 1: `allowzero=1` on `Reshape`

`torch.onnx.export` writes every `Reshape` with `allowzero=1`. DirectML rejects this, and the first `Reshape` in the encoder fails with "The parameter is incorrect".

The values 0 and 1 of `allowzero` behave differently only when the target shape contains a 0. The shapes in this graph are made of the batch, the source and target lengths, and the number and width of the heads, and none of them is 0. So `export_float` in `graphs.py` sets every `Reshape` in the three exported float32 graphs to `allowzero=0` (`clear_reshape_allowzero`). The quantized formats are made from the same graphs, so the change applies to every format. The CPU results do not change. The check against the transformers computation (`verify`) also runs on the graphs after this change.

Folders made with `export.py` before 2026-11-18 still have `allowzero=1`. On DirectML they load, and then fail at the first translation. The fallback to the CPU happens only at load time, so in this case the result is a failed translation (decision 76).

### Cause 2: outputs with no elements

The cached step returns the source-side keys and values (`present.<layer>.encoder.*`) with 0 rows. The ones from the first step are reused, and this shape avoids copying them on every step. When DirectML was asked for these outputs with no elements, the other outputs of the same run (the logits and the cache) got wrong values.

- The first values to diverge were in the check of whether an input ID is padding (`Equal` and `Not`). The error spread from there to the position numbers, the embeddings and the logits, and the logits went above 1e30 or became NaN.
- The values changed on every run. This happened with every combination of graph optimization level (all, extended, basic, none) and memory pattern.
- With the outputs with no elements removed from the graph, the difference from the CPU was 1.8e-7 or less in every combination. Leaving the graph unchanged and only not requesting those outputs gave the same result.

The core does not use these outputs in the cached step. So `model.rs` no longer requests them in the cached step (`OutputSelector` in `ort`). The graph's inputs and outputs are unchanged, so folders made earlier and folders that users place can still be read as they are.

### Results

| Format | Intel Iris Xe (DirectML device 0) | NVIDIA GeForce RTX 3060 Ti (device 1) |
|---|---|---|
| float32 | Same IDs as the CPU | Same IDs as the CPU |
| float16 | Same (first 2 IDs compared) | Same (ditto) |
| int8 | Same | Same |
| int4 | Same | Same |

- Two sentences were compared: an empty sentence and a sentence of 24 words.
- In float16, rounding can swap the order of close candidates, so only the first 2 IDs are compared.
- With the fix for cause 2 removed, the float32 and int8 tests failed (checked on device 1). This also shows that the test goes through the cached step.
- The four formats were also confirmed to run on the CPU with the official CPU build of ONNX Runtime 1.31.0.
- Which GPU is DirectML device 0 and which is device 1 was judged from the speeds in an earlier measurement ([Inference runtime comparison](inference-runtime-comparison.md)).

The environment was Windows 11, an Intel Iris Xe and an NVIDIA GeForce RTX 3060 Ti, and the DirectML build of ONNX Runtime 1.24.4. The model is small and random, so the speed and translation quality are unknown.

### int8 and int4 on DirectML

On the small model, int8 and int4 also gave the same IDs as the CPU on DirectML. The table in `accelerate.rs` (`support`), however, does not list these two among the compute types for DirectML. If DirectML does not have a quantized operator, ONNX Runtime silently runs just that operation on the CPU. This test did not check which operations ran on the GPU, or how fast they were. The table was not changed (decision 75).

Addendum of 2026-11-19: decision 75 settled on listing these two among the compute types for DirectML, and the table was changed. With ONNX Runtime profiling (`enable_profiling`), the placement of the nodes executed in the encoder and the first decoder step was counted (NVIDIA GeForce RTX 3060 Ti, DirectML build 1.24.4).

| Format | Nodes run on DirectML | Nodes run on the CPU |
|---|---:|---|
| float32 | 205 | 8 (`Concat` 7, `Squeeze` 1) |
| float16 | 216 | 8 (same as above) |
| int8 | 203 | 8 (same as above) |
| int4 | 205 | 8 (same as above) |

Only shape computations ran on the CPU; the quantized operations (`MatMulInteger`, `DynamicQuantizeLinear`, `MatMulNBits`) ran on DirectML. The cached step and the speed on real models were not counted.

## Not checked

- GPU behavior, speed and translation quality with the real models (M2M100, NLLB). Downloading the original models needs consent, and exporting them needs more than 15 GB of memory.
- The CUDA execution provider. It needs a download of more than 1 GB for the GPU build of ONNX Runtime and the NVIDIA libraries, so it was not done this time. The procedure is the same as for DirectML, with `VRCT_TRANSLATE_DEVICE=cuda:0` and an `ORT_DYLIB_PATH` that points to the `onnxruntime.dll` of the CUDA build. The `lib` folder that the GPU runtime for voice conversion (`runtime.rs` in `native/voice-conversion`) downloads has the CUDA build of ONNX Runtime 1.31.0 and the CUDA 13 and cuDNN 9 libraries.
- OpenVINO, MIGraphX, WebGPU, AMD GPUs, Linux.
- The DirectML build of ONNX Runtime has stopped at 1.24.4. Moving to Windows ML has not been looked into.

## How to distribute the GPU execution providers (option (c) of decision 2)

Only the official CPU build 1.31.0 is bundled, so for users to translate on the GPU, they need a separate ONNX Runtime that has a GPU execution provider. For now, the only way is to set `ORT_DYLIB_PATH`. The options and what was learned this time are below. None of them has been chosen.

| Option | What is placed | Advantages | Points to watch |
|---|---|---|---|
| (c1) Download the DirectML build with consent | `Microsoft.ML.OnnxRuntime.DirectML` 1.24.4 and `Microsoft.AI.DirectML` 1.15.4 from NuGet | One build handles NVIDIA, AMD and Intel GPUs. The small model ran after this fix | It has stopped at 1.24.4. The loaded library is shared with chat reading, so chat reading also runs on 1.24.4 (decision 42). The redistribution terms of DirectML go in the ledger |
| (c2) For NVIDIA, use the GPU runtime for voice conversion | No extra download. Load the `lib` of the GPU runtime for voice conversion (the CUDA build of 1.31.0 and the NVIDIA libraries, downloaded with consent) | It is 1.31.0, the same as the bundled CPU build, so the version for chat reading does not change | Only people who installed the voice conversion runtime can use it. The translation settings need a way to point to the voice conversion runtime |
| (c3) Stay on the CPU only | Nothing | Nothing is added | Translation cannot run on the GPU |

With every option, only one library is loaded per process, so switching needs a restart of the app. The library lookup is in one place, `native/onnx-runtime` (#624), so that is where a downloaded folder would be added to the search locations.

## Publishing the models and registering them in the catalog

Publishing is an external operation, so this work did not do it. The tools and the procedure are ready.

1. Create the folder with `export.py` (for a real model, downloading the original model needs consent).
2. `publish.py stage` checks the files against `manifest.json`, copies them and writes a model card (the original model and its revision, the license, what was changed, how the files were made and the SHA-256 of each file). A model under MIT needs the license text (`--license-file`).
3. The maintainer checks the publishing folder, the license and the repository name.
4. `publish.py upload` uses the write token in `HF_TOKEN` to create the repository and uploads the files in one commit.
5. `publish.py catalog --write` checks the sizes and SHA-256 of the files in the published revision against `manifest.json` and writes an entry to `native/ops/data/translation_models.json`.
6. Raise `CATALOG_VERSION` (`native/ops/data/README.md`).

What has to be decided: which models and formats to publish (at least the int8 of M2M100 418M, and perhaps float16 for the GPU), the owner and name of the target repository, and whether to publish NLLB (decisions 1 and 78).

## NLLB models

### NLLB 3.3B in the directions into English

In the 2026-11-15 comparison, the int8 of NLLB 3.3B scored 1.12 to 1.90 BLEU lower than CTranslate2 in the four directions into English, so it could not be said that there was no regression (`tools/translation_onnx/README.md`). It was not checked this time, because that needs a download of the original model (more than 17 GB) and an export (more than 50 GB of memory). To check it, raise the number of sentences in each direction to 200 with `compare.py --directions de-en,ja-en,ru-en,zh-en`, or compare against folders made with a different quantization method (per-channel quantization, for example).

Addendum of 2026-11-20: the two directions between English and Japanese were checked on all sentences of WMT20. The BLEU difference between the ONNX and CTranslate2 versions was −0.06 for English to Japanese and −0.09 for Japanese to English, and in both the 95% interval spanned 0. German to English, Russian to English and Chinese to English were not checked. This closed decision 77 (77 in [core-integration.md](core-integration.md)). The results are in "Checking English and Japanese (2026-11-20)" (英語と日本語の確認（2026-11-20）) in `tools/translation_onnx/README.md`.

### Considering replacements

The licenses of the candidates are summarized in [licensing.md](licensing.md). All of them assume ONNX Runtime and, as section 2.5 of ADR-012 says, are not subject to the exception procedure for voice AI. Without changes, the current `native/translate-onnx` can run only the M2M100 and NLLB architectures.

- The only model that allows commercial use and runs in the current form is M2M100 (MIT). The default, M2M100 418M, stays as it is.
- MADLAD-400 (Apache-2.0, T5 architecture, 3B and 7B) is a candidate that allows commercial use and covers more languages. It needs support for the T5 architecture (relative position bias) and for loading the SentencePiece unigram model. Its translation quality and size (expected to be around 3 GB for the int8 of 3B) have not been measured.
- SMaLL-100 (MIT, M2M100 architecture, about 330M) differs from M2M100 in that it puts the target-language token on the source side, so that needs mapping.
- LLMs built for translation (TranslateGemma, Hunyuan-MT, PLaMo 2 translate and others) have licenses with conditions on the regions or purposes they may be used for. All of them can be used through the current Ollama, LM Studio and OpenAI-compatible providers. Building them into the app is handled as adding a runtime to the translation catalog of #413.

The option that changes the least is to keep NLLB as it is: not the default, with the non-commercial license shown and consent asked for when it is chosen (decision 78).

---

# ローカル翻訳の GPU とモデルの公開の準備（2026-11-18、#277）（日本語版）

#277 の 3 本目の作業の記録です。ローカル翻訳（`native/translate-onnx`）を GPU で動かすための修正と、モデルを公開してカタログに載せるための道具、NLLB の扱いの検討をまとめます。判断が要ることは [core-integration.md](core-integration.md) の「判断が要ること」に番号で載せています。モデルのライセンスの確認は [licensing.md](licensing.md) の「ローカル翻訳のモデルの候補と NLLB の扱い」にあります。

## 要点

- ONNX Runtime の DirectML の実行プロバイダでは、今の翻訳のグラフが動きませんでした。原因は 2 つあり、どちらも直しました。直したあとは、小さな乱数のモデルで、4 つの量子化の形すべてが 2 つの GPU で CPU と同じ訳の ID を出しました。
- 実際のモデルの公開に要る道具（モデルカードを付けた公開用のフォルダ、アップロード、カタログの項目の作成と照合）と、カタログの翻訳の項目を置くデータのファイルを用意しました。モデルはまだ公開していません。
- 実際のモデル、CUDA、OpenVINO、AMD の GPU、Linux では、まだ確かめていません。

## DirectML で動かなかった原因と直し方

### 確かめ方

実際のモデルを取得せずに確かめるため、`tools/translation_onnx/tiny.py` を足しました。乱数の重みの小さなモデル（NLLB の形、2 層、幅 64、語彙 4400）を `export.py` と同じ道で書き出し、float32、float16、int8、int4 の 4 つのフォルダを作ります。`native/translate-onnx/tests/real.rs` の `a_device_decodes_as_the_cpu_does` は、同じフォルダを CPU と指定した実行プロバイダで読み込み、ビーム探索が出す ID が同じかを比べます。実行プロバイダが始められずに CPU で動いたときは失敗にします。

```sh
python tools/translation_onnx/tiny.py --output <出力先>
ORT_DYLIB_PATH=<DirectML 版の onnxruntime.dll> \
VRCT_TRANSLATE_DEVICE=directml:1 VRCT_TRANSLATE_DEVICE_MODEL=<出力先>/tiny-nllb-onnx-float32 \
cargo test --manifest-path native/translate-onnx/Cargo.toml --test real a_device
```

DirectML 版の ONNX Runtime は、PyPI の `onnxruntime-directml` 1.24.4 に入っている `onnxruntime.dll` と `DirectML.dll` を使いました。`DirectML.dll` を見つけられるように、そのフォルダを `PATH` にも足します。

### 原因 1: `Reshape` の `allowzero=1`

`torch.onnx.export` は `Reshape` をすべて `allowzero=1` で書きます。DirectML はこれを断り、エンコーダの最初の `Reshape` で「The parameter is incorrect」になります。

`allowzero` の 0 と 1 が違うのは、目標の形に 0 があるときだけです。このグラフの形は、バッチ、原文と訳文の長さ、ヘッドの数と幅でできていて、どれも 0 になりません。そこで `graphs.py` の `export_float` が、書き出した 3 つの float32 のグラフのすべての `Reshape` を `allowzero=0` にします（`clear_reshape_allowzero`）。量子化した形も同じグラフから作るので、すべての形に効きます。CPU の結果は変わりません。transformers の計算との照合（`verify`）も、この変更のあとのグラフで行います。

2026-11-18 より前に `export.py` で作ったフォルダは `allowzero=1` のままです。DirectML では読み込みは通り、最初の翻訳で失敗します。CPU への切り替えは読み込みのときだけなので、この場合は翻訳の失敗になります（判断 76）。

### 原因 2: 要素のない出力

キャッシュ付きのステップは、原文の側のキーと値（`present.<層>.encoder.*`）を 0 行で返します。最初のステップのものを使い続けるので、毎回写さないための形です。DirectML にこの要素のない出力を求めると、同じ実行のほかの出力（ロジットとキャッシュ）がおかしな値になりました。

- 最初に食い違うのは、入力の ID がパディングかどうかの判定（`Equal` と `Not`）でした。そこから位置の番号、埋め込み、ロジットへと広がり、ロジットは 1e30 を超えるか NaN になりました。
- 値は実行のたびに変わりました。グラフの最適化の段階（すべて、拡張、基本、なし）とメモリーパターンのどの組み合わせでも同じでした。
- 要素のない出力をグラフから外すと、どの組み合わせでも CPU との差は 1.8e-7 以下になりました。グラフはそのままで、その出力を求めないだけでも同じでした。

中核はキャッシュ付きのステップでこの出力を使っていません。そこで `model.rs` は、キャッシュ付きのステップでこの出力を求めないようにしました（`ort` の `OutputSelector`）。グラフの入出力の形は変えていないので、前に作ったフォルダも、利用者が置くフォルダも、そのまま読めます。

### 結果

| 形 | Intel Iris Xe（DirectML のデバイス 0） | NVIDIA GeForce RTX 3060 Ti（デバイス 1） |
|---|---|---|
| float32 | CPU と同じ ID | CPU と同じ ID |
| float16 | 同じ（初めの 2 つの ID を比べた） | 同じ（同上） |
| int8 | 同じ | 同じ |
| int4 | 同じ | 同じ |

- 比べた文は、空の文と 24 語の文の 2 つです。
- float16 は丸めで近い候補の順が入れ替わることがあるので、初めの 2 つの ID だけを比べます。
- 原因 2 の修正を外すと、float32 と int8 の試験は失敗しました（デバイス 1 で確かめた）。この試験がキャッシュ付きのステップを通っていることも、これでわかります。
- 公式の CPU 版の ONNX Runtime 1.31.0 で、4 つの形が CPU で動くことも確かめました。
- DirectML のデバイス 0 と 1 がどちらの GPU かは、以前の計測の速さから判断しました（[推論ランタイムの比較](inference-runtime-comparison.md)）。

計測の環境は Windows 11、Intel Iris Xe と NVIDIA GeForce RTX 3060 Ti、DirectML 版の ONNX Runtime 1.24.4 です。乱数の小さなモデルなので、速さと訳の質はわかりません。

### int8 と int4 の DirectML

小さなモデルでは int8 と int4 も DirectML で CPU と同じ ID になりました。ただし `accelerate.rs` の表（`support`）は、この 2 つを DirectML の計算型の一覧に出しません。量子化の演算子を DirectML が持たないと、ONNX Runtime はその演算だけを黙って CPU で動かします。今回の試験では、どの演算が GPU で動いたかと速さを確かめていません。表は変えていません（判断 75）。

2026-11-19 の追記: 判断 75 で、この 2 つを DirectML の計算型の一覧に出すことに決まり、表を変えました。ONNX Runtime のプロファイル（`enable_profiling`）で、エンコーダと最初のデコーダのステップで実行したノードの置き場所を数えました（NVIDIA GeForce RTX 3060 Ti、DirectML 版 1.24.4）。

| 形 | DirectML で動いたノード | CPU で動いたノード |
|---|---:|---|
| float32 | 205 | 8（`Concat` 7、`Squeeze` 1） |
| float16 | 216 | 8（同上） |
| int8 | 203 | 8（同上） |
| int4 | 205 | 8（同上） |

CPU で動いたのは形の計算だけで、量子化の演算（`MatMulInteger`、`DynamicQuantizeLinear`、`MatMulNBits`）は DirectML で動きました。キャッシュ付きのステップと、実際のモデルでの速さは数えていません。

## 確かめていないこと

- 実際のモデル（M2M100、NLLB）での GPU の動作、速さ、訳の質。元のモデルの取得には同意が要り、書き出しに 15 GB 以上のメモリーが要ります。
- CUDA の実行プロバイダ。ONNX Runtime の GPU 版と NVIDIA のライブラリで 1 GB を超える取得が要るので、今回は行いませんでした。手順は DirectML と同じで、`VRCT_TRANSLATE_DEVICE=cuda:0` と、CUDA 版の `onnxruntime.dll` を指す `ORT_DYLIB_PATH` を使います。声質変換の GPU の実行環境（`native/voice-conversion` の `runtime.rs`）が取得する `lib` のフォルダには、CUDA 版の ONNX Runtime 1.31.0 と CUDA 13、cuDNN 9 のライブラリがそろっています。
- OpenVINO、MIGraphX、WebGPU、AMD の GPU、Linux。
- DirectML 版の ONNX Runtime は 1.24.4 で止まっています。Windows ML への移行は調べていません。

## GPU の実行プロバイダの配り方（判断 2 の (c)）

同梱しているのは公式の CPU 版 1.31.0 だけなので、利用者が GPU で翻訳するには、GPU の実行プロバイダを持つ ONNX Runtime を別に用意する必要があります。今は `ORT_DYLIB_PATH` を指定するしかありません。案と、今回わかったことは次のとおりです。どれにするかは決めていません。

| 案 | 置くもの | 利点 | 気をつけること |
|---|---|---|---|
| (c1) DirectML 版を同意を得て取得 | NuGet の `Microsoft.ML.OnnxRuntime.DirectML` 1.24.4 と `Microsoft.AI.DirectML` 1.15.4 | NVIDIA、AMD、Intel の GPU を 1 つで扱える。今回の修正で小さなモデルが動いた | 1.24.4 で止まっている。読み込んだライブラリはチャットの読み取りと共有するので、チャットの読み取りも 1.24.4 で動く（判断 42）。DirectML の再配布の条件を台帳に書く |
| (c2) NVIDIA は声質変換の GPU の実行環境を使う | 追加の取得なし。声質変換の GPU の実行環境（同意を得て取得した CUDA 版の 1.31.0 と NVIDIA のライブラリ）の `lib` を読み込む | 同梱の CPU 版と同じ 1.31.0 なので、チャットの読み取りの版は変わらない | 声質変換の実行環境を入れた人だけが使える。翻訳の設定から声質変換の実行環境を指す仕組みが要る |
| (c3) CPU だけのまま | なし | 何も増えない | GPU では翻訳できない |

どの案でも、読み込むライブラリはプロセスで 1 つなので、切り替えたあとはアプリの起動し直しが要ります。ライブラリの探し方は `native/onnx-runtime`（#624）の 1 か所にまとまっているので、取得したフォルダを探す場所に足すのはそこになります。

## モデルの公開とカタログへの登録

公開は外部への操作なので、この作業では行っていません。道具と手順を用意しました。

1. `export.py` でフォルダを作ります（実際のモデルでは元のモデルの取得に同意が要ります）。
2. `publish.py stage` が、ファイルを `manifest.json` と照らし合わせてから写し、モデルカード（元のモデルとその版、ライセンス、変えたこと、作り方、各ファイルの SHA-256）を書きます。MIT のモデルには、ライセンスの文（`--license-file`）が要ります。
3. 保守担当者が公開用のフォルダ、ライセンス、リポジトリの名前を確かめます。
4. `publish.py upload` が、`HF_TOKEN` の書き込みのトークンで、リポジトリを作って 1 つのコミットで上げます。
5. `publish.py catalog --write` が、公開された版のファイルの大きさと SHA-256 を `manifest.json` と照らし合わせ、`native/ops/data/translation_models.json` に項目を書きます。
6. `CATALOG_VERSION` を上げます（`native/ops/data/README.md`）。

決めることは、どのモデルとどの形を公開するか（少なくとも M2M100 418M の int8、GPU 用に float16 か）、公開先のリポジトリの持ち主と名前、NLLB を公開するかです（判断 1、78）。

## NLLB

### NLLB 3.3B の英語へ訳す方向

2026-11-15 の比較では、NLLB 3.3B の int8 は英語へ訳す 4 方向で CTranslate2 より BLEU が 1.12〜1.90 低く、回帰がないとまでは言えませんでした（`tools/translation_onnx/README.md`）。今回は確かめていません。元のモデルの取得（17 GB を超える）と書き出し（50 GB を超えるメモリー）が要るためです。確かめるときは、`compare.py --directions de-en,ja-en,ru-en,zh-en` で文の数を各方向 200 に増やすか、量子化の方式（チャネルごとの量子化など）を変えたフォルダと比べます。

2026-11-20 の追記: 英語と日本語の間の 2 方向を、WMT20 の全文で確かめました。ONNX 版と CTranslate2 版の BLEU の差は、英→日が −0.06、日→英が −0.09 で、どちらも 95% 区間が 0 をまたぎました。独→英、露→英、中→英は確かめていません。判断 77 はこれで閉じました（[core-integration.md](core-integration.md) の 77）。結果は `tools/translation_onnx/README.md` の「英語と日本語の確認（2026-11-20）」にあります。

### 差し替えの検討

候補のライセンスは [licensing.md](licensing.md) にまとめました。どれも ONNX Runtime の上で動かす前提で、ADR-012 の 2.5 のとおり、音声 AI の例外の手続きの対象にはなりません。今の `native/translate-onnx` がそのまま動かせるのは M2M100 と NLLB の形だけです。

- 商用でも使えて今の形で動くのは、M2M100（MIT）だけです。既定の M2M100 418M はこのままです。
- MADLAD-400（Apache-2.0、T5 の形、3B と 7B）は、商用でも使え、言語も多い候補です。T5 の形（相対位置のバイアス）と SentencePiece の unigram の読み込みを足す必要があります。訳の質と大きさ（3B の int8 で 3 GB 前後の見込み）は計っていません。
- SMaLL-100（MIT、M2M100 の形、約 330M）は、訳先の言語のトークンを原文の側に付ける点が M2M100 と違うので、その読み替えが要ります。
- 翻訳向けの LLM（TranslateGemma、Hunyuan-MT、PLaMo 2 translate など）は、ライセンスに使える地域や用途の条件があります。どれも Ollama、LM Studio、OpenAI 互換の今のプロバイダを通して使えます。アプリに組み込む案は、#413 の翻訳カタログのランタイムの追加として扱います。

NLLB は今のまま、既定にせず、選ぶときに非商用のライセンスを示して同意を得る形を続けるのが、変える所が一番少ない案です（判断 78）。
