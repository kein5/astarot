---
date: 2026-11-19
status: accepted
era: rust-core
validity: current
implementation_status: pending
implementation_checked: 2026-11-19
evidence:
  - docs/adr/adr-015-translation-llm-runtime-exception.md
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - docs/voice-stack/translategemma.md
---
# ADR-015: TranslateGemma の翻訳を LLM 用の実行基盤で動かす（ADR-012 の例外）

Status: 採用（2026-11-19）。TranslateGemma のような decoder-only の翻訳の LLM を、LLM 用の実行基盤で動かすことを ADR-012 の例外とする。どの実行基盤にするかはこの ADR では決めない（7）。
Date: 2026-11-19
Decision owners: リポジトリの保守担当者
Related: Issue #412、PR #643、[ADR-012](adr-012-audio-ai-runtime-consolidation.md)、[TranslateGemma を翻訳に使う道筋](../voice-stack/translategemma.md)、[ライセンス台帳](../voice-stack/licensing.md)、[モデルの取得](../voice-stack/model-downloads.md)、`native/translate-onnx`、`NOTICE.md`

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ASTAROT（ADR-011）で、識別子は VRCT-VOX のままである。

> **段階 2 の注記**（2026-11-19）：実行基盤の選定と導入の計画（提案）を[翻訳の LLM の実行基盤の選定と導入の計画](../voice-stack/translation-llm-runtime-plan.md)に書いた。推奨は llama.cpp の `llama-server` を別のプロセスで動かし、同梱せずに選んだときに取得する形である。決まったら、この注記の下に決定を足す。本文は書き換えていない。

## 1. Context（背景）

### 1.1 ADR-012 の分担

ADR-012 の 2.2 はローカル翻訳の推論の担当を ONNX Runtime とした。2.5 は、翻訳の ONNX のモデルを足すことは音声 AI の例外の手続きの対象外だが、既存の ONNX Runtime の上で動くことを求めるとした。新しい推論の基盤を足すには、6.2 のとおり例外ごとの ADR で承認する。

### 1.2 TranslateGemma と今の実行部

TranslateGemma は Google の翻訳用の LLM で、Gemma 3 をもとにした decoder-only のモデルである（4B、12B、27B）。2026-11-19 の develop のローカル翻訳の実行部（`native/translate-onnx`）は、encoder-decoder の M2M100 と NLLB-200 だけを読む（`bundle.rs` の `ARCHITECTURES`）。decoder-only の生成、LLM の KV キャッシュ、4 ビットの量子化の演算、チャットのテンプレートを持たない。

Issue #412 では実行の経路を4つ比べた（[TranslateGemma を翻訳に使う道筋](../voice-stack/translategemma.md)）。

| 経路 | 中身 |
|---|---|
| (a) ONNX Runtime GenAI | ONNX Runtime の上に LLM の生成を足すライブラリ |
| (b) GGUF の実行基盤（llama.cpp など） | GGUF の形の LLM を動かす実行基盤 |
| (c) `native/translate-onnx` に decoder-only の生成を足す | 今の ONNX Runtime のまま、LLM の生成を自前で書く |
| (d) 利用者のサーバーにつなぐ | Ollama などに翻訳のカタログの API 系でつなぐ。アプリは実行部を持たない |

2026-11-19 に保守担当者が、(a) か (b) のような LLM 用の実行基盤で動かすことを決めた（Issue #412 と PR #643 の決定の記録）。これは ADR-012 の 2.2 の分担の外なので、例外として扱う。

### 1.3 重みの入手

公式の重みは Hugging Face でゲート付きで、取得には Hugging Face のアカウントと Gemma の規約への同意が要る。重みと、そこから作ったものは Gemma Terms of Use に従い、禁止用途のポリシーは使う人にも及ぶ。アプリのモデルの取得はログインの要らない固定の取得だけを扱っている。保守担当者は、ゲート付きの重みの規約への同意の扱いも実装の範囲に入れると決めた。

## 2. Decision（決定）

1. **例外とする範囲**：TranslateGemma のような decoder-only の翻訳の LLM を、アプリの中で LLM 用の実行基盤で動かすこと。ほかのローカル翻訳（M2M100、NLLB-200、今後の encoder-decoder のモデル）は、これまでどおり ONNX Runtime（`native/translate-onnx`）で動かす。音声 AI の推論（ASR、TTS、VAD など）の分担は変えない。
2. **例外とする理由**（ADR-012 の 2.1 の2つの条件）
   - 既存の基盤で実現できない技術的な理由：今の実行部は encoder-decoder の形だけを動かす。decoder-only の LLM には、KV キャッシュを持つ生成、4 ビットの重みの演算、チャットのテンプレートの組み立てが要る。これらを ONNX Runtime の上に自前で書く案 (c) は、LLM の実行基盤がすでに持つ機能を作り直すことになる。speech.cpp は機械翻訳を扱わない（ADR-012 の 5 の非目標）ので、上流への貢献の道もない。
   - 性能、保守、配布の優位性：LLM 用の実行基盤は LLM の量子化、GPU の利用、メモリーの扱いを持ち、Gemma 3 系の変換がすでに出回っている。自前の生成より保守の負担が小さく、速さとメモリーで有利だと見込む。この見込みは、段階 2 の計画で選ぶ実行基盤について、計測で確かめる（5）。
3. **段階**：例外の範囲で、次の順に進める。段階ごとにプルリクエストを分ける。
   1. この ADR と、ADR-012 への注記（文書）。
   2. 実行基盤の選定と導入の計画。配布の大きさへの影響、同梱するか後から取得するか、ライセンスを明記し、Issue #412 かプルリクエストで示す。
   3. 計画に沿った実装。
4. **守ること**（ADR-012 の 2.6 を引き継ぐ）
   - 翻訳の失敗や実行基盤の停止で、音声の経路、ミュート、停止、ほかの翻訳エンジンを巻き込まない。失敗は翻訳の失敗として知らせる。
   - 翻訳する文と訳文をログに出さない。外部への無断の通信を増やさない。
   - 実行基盤とモデルは、利用者の同意なしに取得しない。取得するものは版、大きさ、SHA-256 を固定する。
   - 実行基盤のライセンスと再配布の可否を、`NOTICE.md` とライセンス台帳に記録する。
   - 既定の翻訳エンジンとモデルは変えない。TranslateGemma は利用者が選んだときだけ使う。
5. **ゲート付きの重みと規約**：取得の前に、Gemma Terms of Use と禁止用途のポリシー、その条件が使う人にも及ぶことを示し、利用者の同意を得てから取得する。重みの入手の形（利用者のトークンで公式の重みを取るか、規約を添えて公開した変換を取るか）は段階 2 の計画で決める。トークンを受け取る形にするときは、OS の資格情報ストアに置き（ADR-013）、`huggingface.co` への要求だけに付け、ログに出さない。

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| (c) `native/translate-onnx` に decoder-only の生成を足す | ADR-012 の範囲のまま、ONNX Runtime の上で生成を自前で書く | LLM の実行基盤が持つ生成、量子化、GPU の利用を作り直すことになる。保守の負担が大きい |
| (d) 利用者のサーバーだけにする | アプリは実行部を持たず、Ollama などにつなぐ | 利用者がサーバーを用意する必要がある。アプリの中で動かす要望に応えない。今の LLM の翻訳の送り方は TranslateGemma のテンプレートと合わない（[道筋](../voice-stack/translategemma.md)の (d)） |
| TranslateGemma を入れない | NLLB-200 などの encoder-decoder だけにする | 翻訳の質の選択肢を増やすという Issue #412 の目的に応えない |

## 4. Consequences（影響）

**得るもの**

- TranslateGemma（55 言語）を、利用者のサーバーなしで使える道ができる。
- 実行部を自前で書くより、LLM の生成の保守が小さくなる見込み。

**負担とリスク**

- 推論の基盤が1つ増える。配布、版の追従、脆弱性への対応、OS ごとのビルド、GPU の実行プロバイダの組み合わせを、その基盤の分だけ持つ（ADR-012 の 1.1）。
- 4B の 4 ビットでも重みは約 3 GB ある。VRChat、音声認識、読み上げと同じ PC で動かすので、メモリーと VRAM を圧迫しうる。
- Gemma の規約の再配布の条件（3.1 節）と禁止用途のポリシーを、取得の画面と配る側の両方で守る必要がある。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

段階 3 で製品に入れる前に、次を確かめる。確かめられないときは、この例外を見直す（6）。

| 観点 | 確かめること | 方法 |
|---|---|---|
| 2.1 の条件 | 選んだ実行基盤が、(c) の自前の生成より速さかメモリーか保守で明らかに有利なこと | 段階 2 の計画に、比べた値と計測の環境を書く |
| 性能 | 4B の読み込みの時間、メモリーと VRAM の最大値、1発話の時間。VRChat、音声認識、読み上げと同時に動かした値 | Windows と Linux の実機で測る（ADR-012 の 2.6、2.7） |
| 品質 | 訳の質が NLLB-200 と M2M100 より悪くならないこと | 既存の比較（WMT20 の方向）にそろえて測る |
| 安全性 | 実行基盤が落ちても、音声の経路、ミュート、停止、ほかの翻訳エンジンが影響を受けないこと | 偽の実行基盤を落とす試験 |
| 配布とライセンス | 実行基盤とモデルのライセンス、再配布の可否、版と SHA-256 の固定、`NOTICE.md` と台帳の記録 | 既存の取得の決まりと `tools/rust_licenses.py` など |
| 同意 | 取得の前に Gemma の規約と禁止用途のポリシーを示し、同意がなければ取得しないこと | 取得の画面の試験 |

## 6. Revisit triggers（見直す条件）

- 選んだ実行基盤が 5 の条件を満たさなかったとき。
- `native/translate-onnx` か ONNX Runtime が decoder-only の LLM を十分な速さで動かせるようになったとき。
- 選んだ実行基盤の更新が止まったとき、ライセンスが変わったとき、深刻な脆弱性が見つかったとき。
- Gemma の規約や TranslateGemma の配布の条件が変わったとき。
- ほかの decoder-only の翻訳の LLM を足すとき（この例外の範囲に入るかを確かめる）。

## 7. 未決のこと

- どの実行基盤にするか（ONNX Runtime GenAI、llama.cpp、ほか）。配布の大きさ、同梱するか後から取得するか、ライセンス、GPU の扱いと合わせて段階 2 で示す。
- 重みの入手の形（利用者のトークン、規約を添えて公開した変換、その両方）と、規約への同意の画面。
- 実行基盤を別のプロセスで動かすか、中核に組み込むか。
- アプリの中で動かす大きさを 4B だけにするか。
- ADR-012 の 2.4 は例外の ADR に配布の大きさ、依存、VRAM、担当、更新の方針を書くよう求めている。これらは実行基盤によって決まるので、段階 2 の計画で示し、この ADR の注記として足す。
