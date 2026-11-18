# vrct-translate-onnx

ローカル翻訳（M2M100 と NLLB-200）を ONNX Runtime で動かす Rust クレートです。Python 側の CTranslate2 による翻訳（`src-python/models/translation/translation_translator.py` の `translateCTranslate2`）を置き換えます。

## 現在の状態

- アプリのローカル翻訳のエンジンです（2026-11-16 に決定。[core-integration.md](../../docs/voice-stack/core-integration.md) の「決まったこと」）。中核（`native/core`）の機能 `onnx-translation`（既定でオン）の裏にあり、アプリ（`src-tauri`）でも有効です。
- ONNX Runtime は実行時に読み込みます（`ort` の `load-dynamic`）。ビルドでは何も取得もリンクもしません。ライブラリはまだ配布物に入っていないので、ライブラリを置かないかぎりモデルを読み込めません（`translation_runtime_missing`。中核では `TRANSLATION_MODEL_LOAD_FAILED`）。
- モデルは `tools/translation_onnx/export.py` で作ります。作ったモデルの公開とモデル取得カタログへの登録は、まだしていません（公開は保守担当者の確認が要る外部への操作です）。公開とカタログの項目の作成には `tools/translation_onnx/publish.py` を使い、項目は `native/ops/data/translation_models.json` に置きます。

## 対象モデル

| 名前 | 元のモデル | ライセンス | ビーム数 |
|---|---|---|---|
| `m2m100_418M` | `facebook/m2m100_418M` | MIT | 5 |
| `m2m100_1.2B` | `facebook/m2m100_1.2B` | MIT | 5 |
| `nllb-200-distilled-600M` | `facebook/nllb-200-distilled-600M` | CC-BY-NC-4.0 | 2 |
| `nllb-200-distilled-1.3B` | `facebook/nllb-200-distilled-1.3B` | CC-BY-NC-4.0 | 2 |
| `nllb-200-3.3B` | `facebook/nllb-200-3.3B` | CC-BY-NC-4.0 | 2 |

元のモデルのコミットは `export.py` に固定してあります。1つのフォルダに1つの量子化の形（下の「量子化の形」）が入ります。

## ONNX Runtime の読み込み

`runtime.rs` が、チャットの読み取り（`native/ocr-runtime`）と同じ順でライブラリを探します。

1. 環境変数 `ORT_DYLIB_PATH`
2. 実行ファイルの隣の `onnxruntime.dll`（Linux は `libonnxruntime.so`）
3. 名前だけでの検索

`ort` は1つのプロセスで最初に読み込んだライブラリを使い続けます。翻訳とチャットの読み取りは同じライブラリを共有します。どの実行プロバイダがあるかは、そのライブラリのビルドで決まります。`ort` の機能 `cuda`、`tensorrt`、`openvino`、`migraphx`、`webgpu`（Windows では `directml` も）は Rust 側の呼び出しを足すだけで、`load-dynamic` では何もリンクしません。`ort` の機能はアプリ全体で1つにまとまるので、このクレートの既定の機能も `load-dynamic` です。単体で `ort` の配るバイナリにリンクしたいときは `--no-default-features --features download-binaries` を使います。

`vrct-translate --providers` は、読み込んだライブラリの実行プロバイダを表示します。2026-11-16 に公式の `onnxruntime-win-x64-1.31.0.zip` では `["cpu"]`、NuGet の `Microsoft.ML.OnnxRuntime.DirectML` 1.24.4 では `["cpu","directml"]` と出ることを確かめました（Windows 11、モデルなし）。

## 実行プロバイダ（使う機器）

`accelerate.rs` が、設定の計算デバイスを実行プロバイダに読み替えます。選んだプロバイダが始められないとき（ライブラリにない、ドライバーがない、メモリーが足りないなど）は CPU で読み込み直し、その理由（固定の符号）を返します。中核はそれをログに書き、UI に知らせます。黙って切り替えることはありません。ただし、プロバイダが対応しない一部の演算を ONNX Runtime が CPU に回すことは、ONNX Runtime の中で起き、ここからは見えません。

| 実行プロバイダ | Windows | Linux | 使える機器 | 要るもの（x64） | ライセンス | 保守の状況 | 計算デバイスの一覧 |
|---|---|---|---|---|---|---|---|
| CPU | ○ | ○ | すべての CPU | 公式の ONNX Runtime。`onnxruntime.dll` 17.3 MB（zip 82.9 MB）、Linux は tgz 11.4 MB | MIT | 主流 | いつも出す（`cpu`） |
| DirectML | ○ | × | DirectX 12 の GPU（NVIDIA、AMD、Intel、Qualcomm） | NuGet の `Microsoft.ML.OnnxRuntime.DirectML`（1.24.4。`onnxruntime.dll` 17.3 MB）と `Microsoft.AI.DirectML`（1.15.4。`DirectML.dll` 18.5 MB） | ONNX Runtime は MIT。DirectML は Microsoft の再配布できるライセンス | 維持のみ（sustained engineering）。新しい機能は Windows ML へ移った。DirectML 版の ONNX Runtime は 1.24.4 で止まっている | ライブラリにあれば出す（`directml`） |
| CUDA | ○ | ○ | NVIDIA | 公式の GPU 版（`gpu_cuda13`。Windows zip 309.5 MB、Linux tgz 244.6 MB）と CUDA 13 のランタイム、cuBLAS、cuDNN（合わせて 1 GB 前後。声質変換の実行環境と同じもの） | ONNX Runtime は MIT。CUDA と cuDNN は NVIDIA の EULA | 主流。1.31 からはプラグインの形も出ている | ライブラリにあれば出す（`cuda`） |
| TensorRT | ○ | ○ | NVIDIA | CUDA 版に加えて TensorRT のライブラリ | NVIDIA の EULA | 主流 | 出さない。入力の形ごとにエンジンを作るので、ステップごとにキャッシュが伸びるデコーダに向かない |
| OpenVINO | ○ | ○ | Intel の CPU、GPU、NPU | Intel の ONNX Runtime（Windows は NuGet の `Intel.ML.OnnxRuntime.OpenVino` 1.24.1、41.0 MB。Linux は `onnxruntime-openvino`）と OpenVINO のランタイム | ONNX Runtime は MIT、OpenVINO は Apache-2.0 | Intel が保守 | ライブラリにあれば出す（`openvino`、GPU を使う） |
| ROCm | ― | ― | AMD | ― | ― | ONNX Runtime 1.23 で消えた | 出さない |
| MIGraphX | × | ○ | AMD の GPU（ROCm を入れた Linux） | AMD の ONNX Runtime（`onnxruntime-migraphx`。ROCm 10 からはプラグイン）と ROCm 一式（システムに入れる） | ONNX Runtime は MIT、ROCm は部品ごと（多くは MIT か Apache-2.0） | AMD が保守。キャッシュ付きのデコーダで問題が出るという報告がある | ライブラリにあれば出す（`migraphx`） |
| WebGPU | ○ | ○ | Direct3D 12 または Vulkan の GPU | WebGPU の実行プロバイダ（1.31 ではプラグインの別の包み）。公式の zip には入っていない。大きさは計っていない | MIT（Dawn は BSD-3-Clause） | 新しい。生成 AI 向けに盛んに手が入っている | ライブラリにあれば出す（`webgpu`） |

大きさは 2026-11-16 の公式の配布物（GitHub と NuGet）の値です。1 MB は 10^6 バイトです。どのプロバイダも、実際のモデルではまだ動かしていません。

DirectML は、乱数の小さなモデル（`tools/translation_onnx/tiny.py`）で、4 つの形すべてが Intel と NVIDIA の GPU で CPU と同じ訳の ID を出しました（2026-11-18、DirectML 版の ONNX Runtime 1.24.4）。そのために直したことが 2 つあります。

- `export.py` は `Reshape` を `allowzero=0` で書き出します。DirectML は `allowzero=1` を断ります。2026-11-18 より前に作ったフォルダは DirectML では動きません。
- キャッシュ付きのステップでは、原文の側のキーと値（`present.<層>.encoder.*`。行のない出力）を求めません。DirectML にこれを求めると、同じ実行のロジットとキャッシュがおかしな値になりました。

詳しくは [ローカル翻訳の GPU と公開の準備](../../docs/voice-stack/local-translation-gpu-2026-11-18.md) にあります。

## 量子化の形

フォルダごとに1つの形です。`manifest.json` の `variant` が名前です（schema 1 は int8）。中核は設定の計算型を次のように読み替え、PC にある形から選びます。

| 計算型（設定の値） | 選ぶ形 |
|---|---|
| `auto` | CPU は int8、float32、int4 の順。GPU は float16、float32 の順 |
| `float32` | float32 |
| `float16` | float16 |
| `int8`、`int8_float32` | int8（重みが int8、計算は float。CTranslate2 の `int8_float32` と同じ考え方） |
| `int4` | int4 |

選んだ GPU に合う形がない（たとえば int8 のフォルダしかない）ときは、CPU で読み込み、その旨を知らせます。

| 形 × 実行プロバイダ | CPU | DirectML | CUDA | TensorRT | OpenVINO | MIGraphX | WebGPU |
|---|---|---|---|---|---|---|---|
| float32 | 動く（計った） | 未確認 | 未確認 | 出さない | 未確認 | 未確認 | 未確認 |
| float16 | 出さない（CPU にはほとんどの float16 の演算がない） | 未確認 | 未確認 | 出さない | 未確認 | 未確認 | 未確認 |
| int8（動的量子化、`MatMulInteger`） | 動く（計った） | 出さない（一部の演算だけ） | 出さない（CPU に回る演算が多い） | 出さない | 出さない | 出さない | 出さない |
| int4（重みだけ、`MatMulNBits`） | 未確認 | 出さない | 未確認 | 出さない | 出さない | 出さない | 出さない |

「未確認」は ONNX Runtime にその演算の実装があり、計算型の一覧に出すものです。実際のモデルではまだ動かしていません。「出さない」は一覧に出しません。表は `accelerate.rs` の `support` と同じです。

## 自分で用意したモデル

利用者は、データのフォルダの `translation-models/<フォルダ名>/` にモデルを置けます。起動の時に探し、翻訳のモデルの一覧に `custom:<フォルダ名>` として出ます。新しく置いたモデルは、アプリを起動し直すと出ます。

要件:

- アーキテクチャは M2M100 か NLLB-200（`transformers` の `M2M100ForConditionalGeneration` の形）。`manifest.json` の `family` が `m2m100` か `nllb`。
- ファイルは `export.py` が書くものと同じ形です。エンコーダの ONNX（入力 `input_ids`、`attention_mask`）、過去のキー・値を受け取るデコーダの ONNX（`use_cache_branch` で初回とキャッシュ付きを切り替える1つのグラフ。`past_key_values.<層>.decoder|encoder.key|value` を受け取り `present.*` と `logits` を返す）、`tokenizer.json`、`vocab.json`、`manifest.json`。入出力は float32 です（float16 の形も入出力は float32 のまま）。
- `manifest.json`（schema 2）には、`name`、`family`、`variant`、`license`、グラフのファイル名、層の数、注意の頭の数、隠れ層の大きさ、開始と終了と未知のトークン、言語のトークンの形（`{}` が言語の符号になる）、言語の符号の一覧 `languages`、ビーム数、入力と出力の上限、各ファイルの大きさと SHA-256（小文字の16進）を書きます。
- 任意で `language_names`（アプリの言語の名前と符号の対応。`{"Japanese": "jpn_Jpan"}`）を書けます。ないときは、同じアーキテクチャの組み込みの表（M2M100 418M か NLLB 600M）から、`languages` にある符号だけを使います。
- フォルダの名前は英数字と `.`、`_`、`-` で 64 文字まで（`.` で始まらない）。
- ライセンスは利用者が確かめます。アプリは `license` を表示しません。非商用のモデルでも、組み込みの NLLB のような確認は出しません。

確かめること（起動の時と読み込む時）と、断ったときの理由（`process.log` に「Translation model folder refused: <フォルダ名> (<理由>)」と1行書きます）:

| 理由 | 意味 |
|---|---|
| `translation_model_name_invalid` | フォルダの名前が上の規則に合わない |
| `translation_manifest_missing` | `manifest.json` がない |
| `translation_bundle_invalid` | JSON として読めない、欄が欠けている、値が合わない、フォルダの外を指すファイル名がある |
| `translation_architecture_unsupported` | `family` が `m2m100` と `nllb` のどちらでもない |
| `translation_variant_unsupported` | `variant` が `float32`、`float16`、`int8`、`int4` のどれでもない |
| `translation_file_missing` | 一覧のファイルがない |
| `translation_bundle_modified` | ファイルの大きさが違う（読み込む時は SHA-256 も比べ、違えば「モデルがない」と同じ扱い） |
| `translation_languages_unknown` | アプリが名前を付けられる言語が1つもない |

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

## ログとデータ

翻訳する文章と訳文は、ログにもエラーにも入れません。エラーは `codes` の固定の文字列だけです。メモリー不足（`translation_out_of_memory`）は ONNX Runtime のエラーの文面から判断しますが、その文面は外に出しません。

## 試験

```sh
cargo test --locked --manifest-path native/translate-onnx/Cargo.toml
```

ビーム探索、実行プロバイダの選び方と CPU への切り替え（偽の読み込みで）、計算型と形の対応、マニフェストの検査、デコードは、モデルも ONNX Runtime もなしで試験します。実際のモデルで試すときは、`export.py` で作ったフォルダを環境変数で指定し、ONNX Runtime のライブラリを `ORT_DYLIB_PATH` で渡します。指定がなければ、その試験は何もせずに通ります。

```sh
ORT_DYLIB_PATH=<onnxruntime のライブラリ> \
VRCT_TRANSLATE_M2M100=<m2m100_418M-onnx-int8 のフォルダ> \
VRCT_TRANSLATE_NLLB=<nllb-200-distilled-600M-onnx-int8 のフォルダ> \
cargo test --manifest-path native/translate-onnx/Cargo.toml
```

GPU の実行プロバイダで CPU と同じ訳になるかは、`a_device_decodes_as_the_cpu_does` で確かめます。フォルダは実際のモデルでも、`tools/translation_onnx/tiny.py` が作る乱数の小さなモデルでもかまいません。小さなモデルは取得が要らないので、どの PC でも確かめられます。ライブラリにはその実行プロバイダが要ります。DirectML 版では、`DirectML.dll` のあるフォルダも `PATH` に足します。

```sh
ORT_DYLIB_PATH=<DirectML 版の onnxruntime.dll> \
VRCT_TRANSLATE_DEVICE=directml:0 \
VRCT_TRANSLATE_DEVICE_MODEL=<tiny-nllb-onnx-float32 のフォルダ> \
cargo test --manifest-path native/translate-onnx/Cargo.toml --test real a_device
```

現行の CTranslate2 との訳文の比較は `tools/translation_onnx/compare.py` で行います。手順は同じフォルダの README にあります。
