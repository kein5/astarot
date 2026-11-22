# 推論ランタイムの比較（OCR、Silero VAD、ローカル翻訳）

2026-11-17 の調査です。判断項目「どの推論ランタイムに寄せるか」（[中核の統合](core-integration.md)の「判断が要ること」の 53）の材料にします。計測に使ったコードと生のデータは、リポジトリの外の作業用フォルダにあります。

## 前提

- 中核は OCR（`native/ocr-runtime`）と翻訳（`native/translate-onnx`）を、`ort` 2.0.0-rc.15 の `load-dynamic` で動かしています。ONNX Runtime のライブラリはまだ配っていません（`core-integration.md` の 2 と 42）。VAD は移すかどうかが未決です（13）。翻訳の GPU と量子化の形は未計測です（34）。
- 比べた候補は `ort`、`tract`、`rten`、`candle`（`candle-onnx`）、`burn`（`burn-onnx` で ONNX を Rust のコードにする）です。`wonnx` はリポジトリが 2025-05-07 にアーカイブされたので外しました。
- 使ったモデル:
  - OCR: PP-OCRv6 small の det と rec、チャット吹き出し検出（YOLOX-tiny）。本物の重みです。
  - VAD: Silero VAD v5 のエンコーダとデコーダ。
  - 翻訳: 本物の重みはないので、乱数で初期化した小さな M2M100 を作りました（語彙 4000、隠れ層 64、2 層、頭 4）。書き出しは `graphs.py` と `export.py` の関数をそのまま使いました。形は int8、float32、float16、int4 の 4 つで、NLLB 風の設定でも同じものを作りました。演算子とグラフの作りは確かめられますが、速さと訳の質はわかりません。
- 入力は乱数で固定しました。
  - det: 1×3×736×1280
  - rec: 6×3×48×320
  - 吹き出し検出: 1×3×736×1280（値は 0 から 255）
  - VAD: エンコーダは 1×576 と 32×576。デコーダは 1×128 と状態 2×1×128。
  - 翻訳: エンコーダ（12 トークン）、デコーダの最初のステップ（空のキャッシュ）、キャッシュ付きのステップ。
- 「差」は ort CPU（公式 1.31.0、1 スレッド）の出力との差の絶対値の最大です。

## 比較の表

「計測」はこの PC で計った値で、「資料」は出典の値です。

| 候補 | 演算子のカバー | GPU | 配布サイズ（計測） | CPU の速さ（計測、ort 比） | ライセンス | 保守 |
|---|---|---|---|---|---|---|
| ort（ONNX Runtime 1.31） | 全部動いた。量子化も動く | 資料: DirectML（Windows。NVIDIA、AMD、Intel）、CUDA と TensorRT、OpenVINO、MIGraphX（Linux）、WebGPU。計測: DirectML が Iris Xe と RTX 3060 Ti で動いた | 実行ファイル +0.24 MB と `onnxruntime.dll` 17.3 MB。DirectML 版は `DirectML.dll` 18.5 MB も要る | 1（基準） | MIT（DirectML は Microsoft の再配布条件） | 主流。DirectML 版は 1.24.4 で止まっている |
| tract 0.23.10 | OCR と VAD は動いた（入力の形を固定したとき）。翻訳は全部失敗 | 資料: 0.23 から CUDA と Metal、wgpu はアルファ。試していない | +28.4 MB | OCR は 1.7 から 5.8 倍遅い。VAD はほぼ同じ | MIT か Apache-2.0 | 活発。最新は 2026-11-05 |
| rten 0.28.0 | 全部動いた。int8 だけ出力が大きくずれた | CPU だけ | +5.0 MB | OCR は 1.3 から 6.6 倍遅い。VAD は回によって大きくぶれた | MIT か Apache-2.0 | 個人が活発に保守。ONNX を直接読めるのは 0.23 から |
| candle 0.11.1 | VAD だけ動いた | 資料: CUDA と Metal（AMD と Intel の GPU はない） | +5.3 MB。ビルドに `protoc` が要る | VAD で 3 から 7 倍遅い | MIT か Apache-2.0 | ONNX の取り込みは補助的 |
| burn 0.22 と burn-onnx | OCR、VAD、翻訳の float32 は動いた。int8 と int4 は取り込めず、float16 は実行時に失敗 | 資料: wgpu（Vulkan、DX12、Metal）、CUDA、ROCm。計測: wgpu が RTX 3060 Ti と Iris Xe で動いた | flex（CPU）で VAD の 2 モデルだけなら +4.7 MB。wgpu 込みで +49.7 MB | OCR は 1.4 から 9.4 倍遅い。VAD はほぼ同じ | MIT か Apache-2.0 | 活発。取り込みは 0.23 で別の crate に移る途中 |

配布サイズは、計測用のコード（0.30 MB）だけを入れた実行ファイルとの差です。何もしない実行ファイルは 0.14 MB でした。

ビルドへの影響（計測。候補ごとに別の target フォルダを使い、まっさらからビルドしました）:

| 候補 | ビルド時間 | C/C++ への依存 |
|---|---|---|
| ort（`load-dynamic`） | 11.6 秒 | なし。静的リンクは MSVC 14.43 で失敗した記録がある |
| tract | 約 408 秒 | `cc` で SIMD のカーネルを作る |
| rten | 98 秒 | なし |
| candle | 204 秒 | `protoc` が要る（この PC にはなかった） |
| burn（flex、VAD のみ） | 379 秒 | なし |
| burn（flex と wgpu、VAD のみ） | 929 秒 | なし |
| burn（flex と wgpu、12 モデル） | 860 秒。実行ファイルは 58.4 MB | なし |

## モデルごとの結果

速さの単位はミリ秒です。2 回の暖機のあと、最大 11 から 15 回実行した中央値です。このノート PC では、同じ組み合わせでも回によって 2 倍近くぶれました。表には一番速い回の中央値を書き、括弧内に一番遅い回の中央値を書きました。値はこの PC でのものです。

### OCR（CPU）

| 候補 | det 1 スレッド | det 4 | rec 1 | rec 4 | 吹き出し 1 | 吹き出し 4 | 最大の差 |
|---|---|---|---|---|---|---|---|
| ort 1.31.0 | 349（609） | 242（482） | 295（320） | 105（116） | 384（915） | 237（265） | 基準 |
| ort 1.24.4（DirectML 版の CPU 実行） | 626 | ― | 296 | ― | 663 | ― | 3.4e-6 |
| tract（形を固定） | 1199（1965） | 619（647） | 610（826） | 348（521） | 1497（2522） | 797（2878） | det 2.9e-6、rec 1.8e-5、吹き出し 4.3e-4 |
| rten | 2169（2311） | 459（490） | 412（704） | 160（381） | 909（1671） | 444（771） | det 2.1e-5、rec 7.1e-6、吹き出し 1.5e-4 |
| burn flex | 1307（4750） | 1591（2196） | 422（541） | 430（1504） | 3270（4889） | 1437（2202） | det 1.2e-5、rec 1.6e-4、吹き出し 2.7e-4 |
| candle | 失敗（`auto_pad` の `SAME_UPPER` に未対応） | | 同じ | | 失敗（パディング付きの `MaxPool` に未対応） | | |

### OCR（GPU、1 回の計測）

| 候補と機器 | det | rec | 吹き出し | 最大の差 |
|---|---|---|---|---|
| ort DirectML、RTX 3060 Ti（Thunderbolt 経由） | 51 | 76 | 62 | 2.5e-5 |
| ort DirectML、Iris Xe | 120 | 58 | 89 | 2.7e-5 |
| burn wgpu、RTX 3060 Ti | 133 | 106 | 270 | 7.3e-4 |
| burn wgpu、Iris Xe | 1353 | 967 | 1012 | 4.3e-4 |

- DirectML のデバイス 0 と 1 は、速さから Iris Xe と RTX と判断しました。対応は確かめていません。
- rec の確率の差は、tract で 1.8e-5、burn で 1.6e-4 でした。`ocr-runtime` が求めるスコアの差は 1e-5 以内なので、これを超えます。読み取った文字が変わるかは確かめていません。
- tract は入力の形を固定しないと最適化できませんでした。形を固定しない設定（tract-sym）では全部失敗しました。det の入力はフレームの大きさで変わるので、形ごとに 0.2 から 0.5 秒かけて作り直すことになります。

### Silero VAD v5

| 候補 | エンコーダ 1×576 | エンコーダ 32×576 | デコーダ | 最大の差 |
|---|---|---|---|---|
| ort 1.31.0 | 0.12（0.18） | 2.3（4.4） | 0.065（0.10） | 基準 |
| ort 1.24.4（CPU） | 0.061 | 1.34 | 0.037 | 0 |
| tract | 0.19（0.22） | 4.0（7.9） | 0.056（0.076） | 1.2e-6 |
| rten | 0.33（30.4） | 5.5（23.2） | 0.048（22.1） | 4.1e-6 |
| burn flex | 0.84（0.85） | 5.8（7.1） | 0.061（0.064） | 6.0e-6 |
| candle | 0.83（0.92） | 6.4（8.1） | 0.27（0.42） | 1.4e-6 |
| ort DirectML（Iris Xe / RTX） | 0.97 / 0.71 | 1.5 / 12.2 | 0.96 / 21.3 | 1.9e-6 |
| burn wgpu（Iris Xe / RTX） | 1.8 / 2.9 | 4.8 / 2.2 | 1.9 / 7.1 | 7.5e-6 |

1 回の呼び出しは 32 ms の音声に当たります。どの CPU の候補でも足ります。GPU は待ちが大きく、VAD には向きません。rten はぶれが大きく、原因は調べていません。

### ローカル翻訳（小さな M2M100）

| 候補 | float32 | int8 | int4 | float16 |
|---|---|---|---|---|
| ort 1.31.0 CPU | 動く | 動く | 動く | 動く |
| ort 1.24.4 CPU | 動く（7.2e-7） | 動く（9.5e-7） | 動く（1.7e-6） | 動く（1.5e-5） |
| ort DirectML（両方の GPU） | 失敗 | 失敗 | 失敗 | 失敗 |
| tract | 失敗 | 失敗 | 失敗 | 失敗 |
| rten | 動く（7.2e-7） | 差が大きい（ロジットで最大 0.19。ロジットの大きさは 0.6 前後） | 動く（7.2e-7） | 動く（1.4e-3） |
| candle | 失敗 | 失敗 | 失敗 | 失敗 |
| burn（flex と wgpu の両方の GPU） | 動く（7.2e-7。`If` でつないだデコーダも動く） | 取り込めない（`DynamicQuantizeLinear` に未対応） | 取り込めない（`MatMulNBits` は自前の実装が要る） | 実行時に失敗（LayerNorm の重みが float16 で入力が float32） |

失敗の中身:

- **ort DirectML**: エンコーダとデコーダの両方が、`graphs.py` 70 行目の `reshape(batch, length, -1)` が書き出す `Reshape`（`allowzero=1`）で失敗しました。エラーは「The parameter is incorrect」です。
  - `allowzero` を 0 に変えた複製では、エンコーダと最初のステップは一致しました。
  - キャッシュ付きのステップは値が壊れ、ロジットが 1e35 や NaN になりました。
  - したがって、translate-onnx の README で DirectML の float32 と float16 を「未確認」としている組み合わせは、いまのグラフでは動かない見込みです。本物のモデルでは試していません。
  - 2026-11-18 の追記（#277）: キャッシュ付きのステップが壊れた原因は、そのステップが返す行のない出力（`present.<層>.encoder.*`）でした。その出力を求めないようにし、`allowzero` も 0 で書き出すようにして、4 つの形すべてが両方の GPU で CPU と同じ訳の ID を出すようになりました。[ローカル翻訳の GPU と公開の準備](local-translation-gpu-2026-11-18.md) にあります。
- **tract**: エンコーダは `CumSum` で「TDim is not a number」になりました。デコーダは `If` の 2 つの枝の出力の形が合わずに失敗しました。マージ前の最初のステップのグラフも `Square does not support TDim` で失敗しました。整数のテンソルを形の計算として扱うことが原因のようです。
- **candle**: 外部データを読めませんでした。外部データのない float32 も「axis 2 is too large」で失敗しました。
- **rten の int8**: float32 と int4 は一致したので、int8 の量子化の演算子の計算が ONNX Runtime と違うようです。どちらが仕様どおりかと、訳への影響は調べていません。

### `export.py` の不具合（途中で見つけたもの）

`--variant float16` はデコーダをつなぐ所で失敗し、作れません。`onnx.checker.check_model` が「Nodes in a graph must be topologically sorted」を出します。`convert_float_to_float16(keep_io_types=True)` が、入力の `Cast` ノードを使う側より後ろに置くためです。今回はノードを並べ直して先へ進めました。直すなら、`to_float16` のあとに並べ直しを足します。2026-11-18 にその形で直しました（#277、`graphs.sort_nodes`）。

## 自前のランタイムの見込み

- 必要な演算子は、OCR で約 30 種類、VAD で 11 種類、翻訳で約 25 種類と量子化の 4 種類です。burn が生成したモデルごとのコードは、12 モデル分で合わせて約 460 KB でした。
- VAD だけなら現実的です。Silero VAD v5 は畳み込みと LSTM の小さなモデルで、数百行で書けます。CPU で 1 ms 未満にするのも難しくありません。
- OCR と翻訳を ort と同じ速さにするのは現実的ではありません。理由は 3 つあります。
  - ONNX Runtime の速さは、MLAS の SIMD カーネル（int8 と int4 の専用カーネルを含む）、スレッドの分け方、演算の融合から来ています。pure Rust の候補でも、OCR は 1.3 から 9 倍遅いのが現状です。
  - GPU まで含めると、ベンダーごとの実装か、wgpu の上の自前のシェーダーが要ります。
  - OCR は RapidOCR と同じ結果（スコアの差 1e-5 以内）を保つ作りです。自前の畳み込みは、積算の順番まで合わせる必要があります。

## 選択肢と影響

| 案 | よい所 | 悪い所 | 影響 |
|---|---|---|---|
| A. いまのまま ort | 全モデルと全量子化が動く。CPU で一番速い。GPU の選択肢が一番多い | 17.3 MB のライブラリを配る。DirectML 版は 1.24.4 で止まっている。翻訳のグラフは DirectML で動かない | 2、34、42 の決定どおりに進める。DirectML を使うなら `graphs.py` の直しと再検証 |
| B. OCR と翻訳は ort、VAD は tract か burn か自前 | VAD が ONNX Runtime なしで動く | 推論の仕組みが 2 つになる | VAD（13）を 2 と切り離して決められる。tract は +28 MB、burn flex は +4.7 MB |
| C. OCR と VAD は tract か rten、翻訳は ort | OCR に ONNX Runtime が要らない | OCR が遅くなる。tract は形ごとの作り直しが要る。rec の差が 1e-5 を超える。翻訳のために結局 ort を配る | 一致の試験をやり直す。速さの後退を受け入れるかの判断 |
| D. すべて tract | pure Rust で一本化できる | 翻訳が動かない | 現状では選べない |
| E. すべて burn（CPU は flex、GPU は wgpu） | ONNX Runtime なしで NVIDIA、AMD、Intel の GPU を使える | CPU の OCR が遅い。int8 と int4 が使えない。モデルをビルドの時にコードにするので、利用者が置くモデルやカタログの ONNX を実行時に読めない。+50 MB、ビルドは約 15 分 | 翻訳の形の選び方、カスタムモデル、モデル取得を作り直す |
| F. ort の API のまま裏を `ort-tract` か `ort-candle` にする | 書き換えが少ない | 実験的と明記されている。中身は tract と candle なので、上の失敗を受け継ぐ | 計っていない |

調べた範囲では、案 A が一番影響が小さく、全モデルが動く唯一の案です。ONNX Runtime なしの構成を残したいなら、案 B で VAD だけを切り離す選び方があります。burn の wgpu は GPU の面では有望です。ただ、量子化と実行時のモデル読み込みがないので、翻訳の置き換えには向きません。どれを選ぶかは決めていません。

## 調べられなかったこと

- 本物の M2M100 と NLLB での動作、速さ、訳の質。rten の int8 の差が訳を変えるか。
- Linux での計測。AMD の GPU。
- ort の CUDA、TensorRT、OpenVINO、WebGPU。導入が大きいので試していません。
- tract と candle の GPU。burn の CUDA と cubecl の CPU バックエンド。`ort-tract` と `ort-candle`。`wonnx`（アーカイブ済み）。
- ビーム探索を通した翻訳全体の速さ。小さなモデルでは意味がないので、翻訳の速さは表に入れていません。
- burn の wgpu が使ったグラフィックスの API（Vulkan か DX12 か）。
- 速さのぶれの原因（電源の状態、P コアと E コアの割り当て、温度）。

## 計測の環境と条件

- PC: ノート PC。Core i7-1255U（P コア 2、E コア 8、12 スレッド）、Iris Xe（ドライバ 32.0.101.7085）、RTX 3060 Ti を Thunderbolt で接続（ドライバ 621.24）。Windows 11 Home 10.0.26320。電源の状態は記録していません。ほかの PC での速さを示す値ではありません。
- Rust 1.100.0（MSVC）、`--release`、`strip = "symbols"`。
- ONNX Runtime:
  - 公式の CPU 版 1.31.0
  - NuGet の DirectML 版 1.24.4 と DirectML 1.15.4
  - `ort` 2.0.0-rc.15（`load-dynamic`、`directml`）
  - DirectML ではメモリーパターンと並列実行を切りました（translate-onnx と同じ）。
- crate: `tract-onnx` 0.23.10（`multithread-mm`）、`rten` 0.28.0、`candle` 0.11.1（`protoc` 29.3）、`burn` と `burn-onnx` 0.22.0（`flex`、`wgpu`）。
- 書き出しの環境: Python 3.11、torch 2.15.0+cpu、transformers 5.22.1、onnx 1.23.2、onnxscript 0.7.2、onnxruntime 1.32.0。float32 のグラフと transformers の差は 5.4e-7 でした。
- スレッドの指定: ort は `intra_op` を 1 か 4。tract は `Executor::multithread`。rten は `RTEN_NUM_THREADS`。candle と burn は `RAYON_NUM_THREADS`。
- 組み合わせごとに別のプロセスで実行しました。読み込みの時間は速さの表に入れていません。GPU の読み込みは 1 から 7 秒かかりました。

## 出典

- ort の代わりのバックエンド: [ort.pyke.io/backends](https://ort.pyke.io/backends)、[pykeio/ort releases](https://github.com/pykeio/ort/releases)
- tract: [CHANGELOG](https://github.com/sonos/tract/blob/main/CHANGELOG.md)、[v0.23.10](https://github.com/sonos/tract/releases/tag/v0.23.10)
- rten: [RTen in 2025](https://robertknight.me.uk/posts/rten-2025/)、[crates.io/crates/rten](https://crates.io/crates/rten)
- wonnx（アーカイブ済み）: [github.com/webonnx/wonnx](https://github.com/webonnx/wonnx)
- candle: [github.com/huggingface/candle](https://github.com/huggingface/candle)
- burn-onnx: [github.com/tracel-ai/burn-onnx](https://github.com/tracel-ai/burn-onnx)
- ONNX Runtime の実行プロバイダと大きさ: `native/translate-onnx/README.md`（2026-11-16 の値）
