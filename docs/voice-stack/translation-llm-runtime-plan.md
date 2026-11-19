# 翻訳の LLM の実行基盤の選定と導入の計画（2026-11-19）

調べた日: 2026-11-19。状態: **提案**（判断項目 1、2、4、5、7 は 2026-11-19 に決定。8 を参照）。[ADR-015](../adr/adr-015-translation-llm-runtime-exception.md) の段階 2 で、Issue #412 の材料である。決めるのは保守担当者で、この計画そのものはコード、カタログ、表示する文言を変えていない。推奨の案での段階 3 の実装の進み具合は 6 の末尾の表に、計測の結果は 6 の「3-6 の計測」にある。

TranslateGemma をアプリの中で動かす LLM 用の実行基盤を選び、配布の大きさへの影響、同梱するか後から取得するか、ライセンスをまとめた。数値は 2026-11-19 に公開されていたリリースの情報（GitHub、NuGet、PyPI、Hugging Face の API が返すメタデータ）で、ファイルは取得していない。速さとメモリーは計っていない（6）。

## 1. 前提

- 保守担当者は 2026-11-19 に、TranslateGemma を LLM 用の実行基盤で動かし、ADR-012 の例外として扱うと決めた。ゲート付きの重みの規約への同意の扱いも実装の範囲に入る（Issue #412、ADR-015）。
- 既定の翻訳エンジンとモデルは変えない。TranslateGemma は利用者が選んだときだけ使う。
- アプリの今の構成（2026-11-19 の develop）は次のとおり。
  - 音声認識と読み上げは、同梱の speech.cpp のサーバーを別のプロセスで動かす（GGML、Vulkan）。中核の `native/speech-server` が起動、ポート、準備の確認、停止を受け持つ。
  - ローカル翻訳と OCR は ONNX Runtime 1.31.0（CPU 版を同梱）。
  - 声質変換の GPU の実行環境（ONNX Runtime の GPU 版、CUDA と cuDNN）は同梱せず、利用者の同意を得てから、版と SHA-256 を固定して Hugging Face、NuGet、PyPI から取得する（`native/voice-conversion/src/runtime.rs`）。

## 2. 候補の比較

| 項目 | llama.cpp（`llama-server`） | ONNX Runtime GenAI |
|---|---|---|
| ライセンス | MIT | MIT |
| 版（2026-11-19） | b12529（GitHub の Release） | 0.20.0（NuGet、PyPI） |
| 配布物の大きさ（Windows x64） | CPU 版 25.7 MB、Vulkan 版 38.9 MB（ZIP）。CUDA 13.5 版は 229.0 MB で、CUDA の実行時のライブラリが別に 426.3 MB | 本体 4.9 MB（Python のホイール）。ほかに ONNX Runtime 1.32.0 が要る。CUDA 版の本体は 9.2 MB で、ONNX Runtime の GPU 版と CUDA が要る |
| 配布物の大きさ（Linux x64） | CPU 版 23.9 MB、Vulkan 版 36.9 MB（tar.gz）。CUDA 版は 228.0 MB と実行時のライブラリ | 本体 7.2 MB（CUDA 版は 12.6 MB）。ほかに ONNX Runtime 1.32.0 |
| GPU | Vulkan（NVIDIA、AMD、Intel）、CUDA、ほか | CUDA。DirectML 版は 0.14.1（ONNX Runtime 1.23.0）で更新が止まっている |
| モデルの形 | GGUF（1つのファイル） | ONNX と `genai_config.json` のフォルダ |
| TranslateGemma 4B の大きさ | Q4_K_M で 2.49 GB、Q8_0 で 4.13 GB（第三者の変換の大きさ。文章だけ） | int4 の ONNX で約 3.09 GB（第三者の変換の大きさ） |
| アプリとのつなぎ方 | 別のプロセスの HTTP のサーバー（`/completion`、OpenAI 互換の API）。speech.cpp のサーバーと同じ形で管理できる | 中核のプロセスに読み込む C の API。Rust からは自前の FFI が要る |
| 今の基盤との関係 | speech.cpp と同じ GGML の系統。Vulkan の機器の選び方と GPU の扱いをそろえやすい | OCR と翻訳と同じ ONNX Runtime だが、同梱の 1.31.0 を 1.32.0 に上げる必要がある。上げると OCR、翻訳、声質変換の版も動く |

ほかの Rust の実行基盤（mistral.rs、candle など）は、Vulkan で動かせるか、Gemma 3 の変換の手間がわからないので、今回は比べていない。

## 3. 推奨：llama.cpp の `llama-server` を別のプロセスで動かす

理由は次のとおり。

- speech.cpp のサーバーと同じ形（別のプロセス、ポート 0、準備の確認、停止）で管理できる。実行基盤が落ちても、中核と音声の経路を巻き込まない（ADR-015 の 2.4）。
- Vulkan 版で NVIDIA、AMD、Intel の GPU を使え、CPU 版との差は約 13 MB である。speech.cpp の Vulkan の機器の選び方（`Vulkan0`、`Vulkan1`）とそろえられる。
- 中核に C++ のビルドを足さない。公開されたビルドを固定して取得する。
- ONNX Runtime GenAI は、同梱の ONNX Runtime の版を上げる必要があり、Windows の DirectML 版の更新が止まっている。中核への FFI も新しく書くことになる。

## 4. 配布：同梱せず、選んだときに取得する

- アプリの ZIP と AppImage には入れない。配布物の大きさは変わらない。
- 利用者が TranslateGemma を選び、取得の画面で同意したときに、`llama-server` の固定した版を取得する。出すのは Windows と Linux x64 の Vulkan 版だけで、CPU だけで動かすときも同じ版を使う（判断項目 5、2026-11-19 に決定）。CUDA 版（実行時のライブラリと合わせて 600 MB 以上）は最初は扱わない。
- 取得するものは版、大きさ、SHA-256 を固定する。取得元は次のどちらかで、判断項目 2 とする。
  - (a) GitHub の Release（`ggml-org/llama.cpp` の固定のタグ）。取得の許可の一覧（`native/ops/src/downloads/transport.rs` の `HOSTS` と、声質変換の実行環境の `SOURCE_HOSTS`）に GitHub の Release のホストを足す。
  - (b) プロジェクトの Hugging Face のリポジトリに写す。今の取得の仕組み（Hugging Face だけ）のままでよいが、写す作業と、元のライセンスの文を添える手間がかかる。
- 同梱する案（Windows の CPU 版で ZIP が 25.7 MB 増える）は、使う人が少ない機能のために全員の取得量を増やすので勧めない。

## 5. 重みと規約への同意

### 5.1 重みの入手

公式の重み（`google/translategemma-4b-it`）はゲート付きで、中身は 16 ビットの safetensors だけである。GGUF の公式の版はない。利用者の PC で GGUF に変換するには Python が要り、アプリは Python を同梱していない。そこで次の2つの形がある。

| 形 | 中身 | 利点 | 負担 |
|---|---|---|---|
| (A) プロジェクトが変換して公開する | 保守担当者が公式の重みのゲートを通り、llama.cpp の変換の道具で GGUF（Q4_K_M など）にする。Gemma の規約、禁止用途のポリシー、`NOTICE` を添えて、プロジェクトのアカウントに公開する。ゲートは付けない | 利用者はログインもトークンも要らない。前例（Irodori-TTS v4 Large）と同じ形 | プロジェクトが配る側になり、規約の 3.1 節の義務を負う。変換と公開は保守担当者の作業 |
| (B) (A) の変換をゲート付きで公開する | (A) と同じ変換を、Hugging Face のゲート（規約への同意）を付けて公開する | 規約への同意を Hugging Face の仕組みでも記録できる | 利用者は Hugging Face のアカウントとトークンが要る。アプリにトークンを受け取る仕組みが要る（OS の資格情報ストアに置き、`huggingface.co` への要求だけに付ける。ADR-013） |

推奨は (A)。決定の「ゲート付きの重みの規約への同意の扱い」は、(A) ではアプリの取得の画面での同意として実装する（5.2）。(B) を選ぶときは、トークンの受け取り、保存、消去の画面と試験を段階 3 に足す。

### 5.2 取得の画面での同意

- #642 で入れた「制限の確認」に、種類 `gemma_terms` を足す。ライセンスの文字列に Gemma Terms of Use が入る項目は、取得の前に、規約と禁止用途のポリシーへのリンク、その条件が使う人にも及ぶことを示し、同意とは別のチェックを求める。チェックがなければ中核が取得を断る。
- この確認を求めるのは翻訳の項目だけとする。同じ規約の Irodori-TTS v4 Large には付けない（判断項目 4、2026-11-19 に決定）。
- 実行基盤（`llama-server`）の取得にも、MIT のライセンスと取得する大きさを示して同意を求める。

## 6. 段階 3 の実装の順

| 段 | 中身 | おもな場所 |
|---|---|---|
| 3-1 | 規約の確認の種類 `gemma_terms`（5.2） | `native/ops/src/downloads/catalog.rs`、`manager.rs`、`ModelDownloads.jsx`、`locales/` |
| 3-2 | `llama-server` の取得と検証（版、大きさ、SHA-256 の固定、同意、取得元のホスト） | `native/ops` か、声質変換の実行環境と同じ形の新しいモジュール |
| 3-3 | `llama-server` のプロセスの管理（起動、ポート 0、準備の確認、停止、落ちたときの知らせ）。偽のサーバーで試験する | speech.cpp のサーバーの管理（`native/speech-server`）にならう |
| 3-4 | 翻訳のプロバイダ。TranslateGemma のテンプレートの文を組み立てて `/completion` に送る（system を送らない、言語は ISO の符号、会話の文脈を送らない、温度 0）。訳す文と訳文はログに出さない | `native/translation` |
| 3-5 | カタログ。翻訳のカタログの推論エンジン系に実行基盤 `llamacpp` を足し、TranslateGemma 4B を組み込みの項目にする。モデルは (A) で公開したものを、版、大きさ、SHA-256 を固定して載せる | `translation_catalog.rs`、`native/ops/data/translation_models.json` か新しいデータ |
| 3-6 | 計測（ADR-015 の 5）。4B の読み込みの時間、メモリーと VRAM の最大値、1発話の時間を、VRChat、音声認識、読み上げと同時に、Windows と Linux で測る。訳の質を NLLB-200 と M2M100 と同じ文で比べる | 実機 |
| 3-7 | 記録。`NOTICE.md`、ライセンス台帳、モデルの取得の文書、マニュアル | 文書 |

3-6 の結果が ADR-015 の 5 の条件に届かないときは、製品に入れずに ADR-015 を見直す。

### 段階 3 の進み具合（2026-11-19）

推奨の案（llama.cpp、(a) GitHub の Release）で実装し、2026-11-19 の決定（判断項目 2、4、5）に合わせて直した。

| 段 | 状態 | 中身 |
|---|---|---|
| 3-1 | 実装した | `gemma_terms` の確認。翻訳の項目だけに付き、Irodori-TTS v4 Large には付かない（判断項目 4） |
| 3-2 | 実装した | llama.cpp b12125 の `llama-server`（Windows と Linux x64 の Vulkan 版だけ）を、同意のあとで GitHub の Release から取得する。取得元のホストに `github.com` と `release-assets.githubusercontent.com` を足した（判断項目 2 と 5） |
| 3-3 | 実装した | `native/speech-server` の `llama` がプロセスを所有する。偽のサーバーで試験した |
| 3-4 | 実装した | `native/translation` の `translategemma` がテンプレートの文を組み立てて `/completion` に送る |
| 3-5 | 一部 | 翻訳のカタログの推論エンジン系に `llamacpp` を足し、利用者が自分の GGUF のファイルを追加できる。ファイルのパスは項目の `file` に入れる（`translation_catalog.json` は、その項目があるあいだ版 2 になる）。組み込みの TranslateGemma の項目は、(A) の変換を公開するまで載せない（判断項目 3） |
| 3-6 | 一部 | Windows の 1 台で、読み込みの時間、メモリーと VRAM、1発話の時間、訳の質を測った（下の「3-6 の計測」）。VRChat、音声認識、読み上げと同時の計測と Linux はまだ |
| 3-7 | 一部 | `NOTICE.md`、ライセンス台帳、[モデルの取得](model-downloads.md#翻訳のカタログ413)、仕様に書いた。マニュアルはまだである |

### 3-6 の計測（2026-11-19、Windows）

承認を得て、第三者の GGUF の変換と固定の `llama-server` を取得して測った。取得したファイルは計測のあとで消した。訳す文と訳文は記録していない。

- 環境：Windows 11 Home（ビルド 26320）、Intel Core i7-1255U（10 コア 12 スレッド）、RAM 32 GB、NVIDIA GeForce RTX 3060 Ti 8 GB（Thunderbolt 接続、ドライバー 617.42）と Intel Iris Xe。llama.cpp b12125 の Vulkan 版（`llama-b12125-bin-win-vulkan-x64.zip`、SHA-256 `29db8012…`）。`Vulkan0` が Iris Xe、`Vulkan1` が RTX 3060 Ti。
- モデル：[mradermacher/translategemma-4b-it-GGUF](https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/tree/d37868f759d2f817a43d28dd80cf9f982ffa62fd) @ `d37868f759d2f817a43d28dd80cf9f982ffa62fd` の `translategemma-4b-it.Q4_K_M.gguf`（2,489,909,760 bytes、SHA-256 `81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330`、文章だけ）。
- 起動はアプリと同じ引数（`--ctx-size 2048 --parallel 1`、GPU は `--device VulkanN --n-gpu-layers 999`、CPU は `--device none --n-gpu-layers 0`）と、アプリと同じテンプレートの文、温度 0 の `/completion`。比べた NLLB-200 distilled 600M と M2M100 418M は、`native/translate-onnx` の int8 の ONNX の変換を `vrct-translate` の CLI で CPU で動かした（ONNX Runtime 1.32.0 の CPU 版、`tools/translation_onnx/compare.py` と同じ使い方）。
- 計り方：読み込みの時間は起動から `/health` が 200 を返すまで。RAM はプロセスの最大のワーキングセット（`GetProcessMemoryInfo`）。VRAM は `nvidia-smi` の使用量の、起動前からの増分の最大（0.25 秒ごと。Iris Xe は共有メモリーなので測れない）。1発話の時間は、短い会話の文（英語 30、日本語 30。最初の1文は暖機として除いた）の要求から答えまで。
- 条件：GPU を使うほかのプロセスは Steam だけで、計測の前後で VRAM は 4 MiB だった。CPU はほかの作業（別のセッションのビルドや試験、`vrct-translate`）と共有で、計測中の PC 全体の CPU 使用率は 74〜99 % だった。時間の値は静かな PC より遅く出ている可能性がある。

| 項目 | TranslateGemma 4B Q4_K_M・RTX 3060 Ti | 同・Iris Xe | 同・CPU だけ | NLLB-200 600M int8・CPU | M2M100 418M int8・CPU |
|---|---|---|---|---|---|
| 読み込み | 7.9〜9.0 秒 | 36.2 秒 | 3.3〜11.6 秒 | 9.4 秒（最初の答えまで） | 3.7 秒（最初の答えまで） |
| RAM の最大 | 3.2 GB（`--cache-ram 0`） | 3.5 GB | 4.2 GB | 1.4 GB | 1.1 GB |
| VRAM の増分 | 2.7 GB | 測れない | 0 | 0 | 0 |
| 1発話 en→ja（中央値 / 90 %） | 234 / 292〜607 ms | 1,413 / 1,643 ms | 2,131 / 2,388 ms | 746 / 973 ms | 538 / 710 ms |
| 1発話 ja→en（中央値 / 90 %） | 211〜217 / 243〜347 ms | 1,437 / 1,557 ms | 2,132 / 2,334 ms | 735 / 1,106 ms | 456 / 600 ms |
| 生成の速さ | 74〜87 トークン/秒 | 14 トークン/秒 | 15.5 トークン/秒 | — | — |

- RTX の 2 つの値は、既定の設定の回と `--cache-ram 0` の回である。CPU だけの値は、PC がとくに混んでいた最初の回（中央値 4.9 秒と 3.3 秒、90 % は 14.0 秒）を除き、`--cache-ram 0` で測り直した回を載せた。CPU だけの読み込みの 3.3 秒は、ファイルが OS のキャッシュに載っていたときの値である。
- b12125 の `llama-server` は、既定でプロンプトのキャッシュに RAM を最大 8 GiB 使う。RTX で WMT20 の 800 文を訳すと、プロセスのメモリーが 11.4 GB まで増えた。`--cache-ram 0` では 3.2 GB にとどまり、訳文も速さも変わらなかった。翻訳は1文ずつ独立しているので、アプリは `--cache-ram 0` で起動する。

訳の質（WMT20 の各方向の最初の 100 文、sacrebleu 2.6.0。BLEU は日本語と中国語が文字単位、ほかは 13a。値は BLEU / chrF）：

| 方向 | TranslateGemma 4B Q4_K_M | NLLB-200 600M int8 | M2M100 418M int8 |
|---|---|---|---|
| en-ja | 31.21 / 28.36 | 27.17 / 24.34 | 30.80 / 26.53 |
| ja-en | 17.07 / 46.88 | 11.11 / 37.88 | 10.62 / 37.48 |
| en-zh | 33.51 / 30.58 | 22.35 / 21.31 | 28.96 / 24.90 |
| zh-en | 22.67 / 54.41 | 20.25 / 50.43 | 18.05 / 49.77 |
| en-de | 29.37 / 58.41 | 29.27 / 57.77 | 23.22 / 53.52 |
| de-en | 36.91 / 63.65 | 30.95 / 55.90 | 30.82 / 57.64 |
| en-ru | 15.41 / 46.59 | 15.97 / 45.70 | 12.89 / 41.57 |
| ru-en | 30.87 / 62.76 | 35.66 / 63.97 | 30.04 / 60.59 |
| 平均 | 27.13 / 48.95 | 24.09 / 44.66 | 23.18 / 44.00 |

- TranslateGemma は 8 方向のうち 6 方向で BLEU と chrF がいちばん高く、ja-en では BLEU が 6 ポイント近く上だった。en-ru と ru-en は NLLB-200 のほうが高かった。
- NLLB-200 は 800 文のうち 4 文で訳を返さず、空の訳として数えた。TranslateGemma（生成の上限 512 トークン）と M2M100 に失敗はなかった。
- 訳の質は RTX 3060 Ti でだけ測った。CPU と Iris Xe では測っていない。

ADR-015 の 5 の条件のうち、VRChat、音声認識、読み上げと同時に動かしたときの値と Linux の値はまだない。RTX 3060 Ti では 1 発話が 0.2〜0.6 秒で、VRAM の増分は 2.7 GB だった。CPU だけでは 1 発話が約 2 秒かかる。

## 7. ライセンス

- llama.cpp と ggml は MIT。Release の配布物が含むほかの部品（HTTP サーバーや JSON のライブラリなど）のライセンスは、取得する版の中身で確かめ、`NOTICE.md` とライセンス台帳に書く（段階 3-2）。
- TranslateGemma の重みは Gemma Terms of Use と禁止用途のポリシーに従う。(A) で公開する変換には規約の写し、禁止用途のポリシー、決まった一文の `NOTICE`、変換したことを書いたモデルカードを添える。
- ONNX Runtime GenAI を選ぶ場合も MIT だが、ONNX Runtime の版を上げることの影響（OCR、翻訳、声質変換）を別に確かめる必要がある。

## 8. 判断項目

1. 実行基盤：llama.cpp（推奨）か ONNX Runtime GenAI か。→ llama.cpp に決定（2026-11-19）。
2. `llama-server` の取得元：(a) GitHub の Release（許可するホストを足す）か、(b) プロジェクトの Hugging Face のリポジトリに写すか。→ (a) GitHub の Release に決定（2026-11-19）。
3. 重みの形：(A) 規約を添えてゲートなしで公開する（推奨）か、(B) ゲート付きで公開してアプリでトークンを扱うか。（未決）
4. 規約の確認（`gemma_terms`）を Irodori-TTS v4 Large にも付けるか。→ 翻訳の項目だけに付け、Irodori-TTS v4 Large には付けないと決定（2026-11-19）。
5. 最初に扱う GPU：Vulkan 版と CPU 版だけにするか（推奨）、CUDA 版も入れるか。→ Vulkan 版だけを出すと決定（2026-11-19）。CPU だけで動かすときも Vulkan 版を使う。
6. 量子化：Q4_K_M（2.49 GB）を基本にするか、Q8_0（4.13 GB）も出すか。計測（3-6）で決める。（未決。Q8_0 はまだ測っていない）
7. 計測のための取得：段階 3-6 の前に、第三者の GGUF の変換と `llama-server` を取得して試すことを認めるか（数 GB）。→ 認められ、6 の「3-6 の計測」のとおり測った（2026-11-19）。

実装で決めたこと（2026-11-19 の決定）：`llamacpp` の項目は GGUF のファイルのパスを `folder` ではなく `file` に入れる。その項目があるあいだ `translation_catalog.json` は版 2 になり、版 1 しか読めない以前の版はファイル全体を読めないものとして扱う（上書きはしない）。`llamacpp` の項目をすべて削除すると版 1 に戻る。
