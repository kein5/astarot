# ローカル翻訳の GPU とモデルの公開の準備（2026-11-18、#277）

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
