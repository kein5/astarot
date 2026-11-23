---
date: 2026-11-23
status: accepted
era: rust-core
validity: current
implementation_status: pending
implementation_checked: 2026-11-23
evidence:
  - docs/adr/adr-019-voicevox-core-tts-runtime-exception.md
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - docs/adr/adr-008-external-speech-engines.md
---
# ADR-019: VOICEVOX CORE を専用ワーカーと C API の動的ロードで読み上げに組み込む（ADR-012 の例外）

Status: 採用（2026-11-23、Issue #1061 の決定の記録）。VOICEVOX CORE によるアプリ内日本語読み上げを ADR-012 の管理対象の例外とし、薄い Rust 子プロセスから公式 C API と `voicevox_onnxruntime` を動的ロードする構成を採る。実装の本着手は、Windows と Linux の実機 PoC の結果を見てから別途判断する。
Date: 2026-11-23
Decision owners: リポジトリの保守担当者
Related: Issue #1061、[ADR-012](adr-012-audio-ai-runtime-consolidation.md)、[ADR-008](adr-008-external-speech-engines.md)、[ADR-015](adr-015-translation-llm-runtime-exception.md)、[ライセンス台帳](../voice-stack/licensing.md)、[モデルの取得](../voice-stack/model-downloads.md)、`NOTICE.md`

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ASTAROT（ADR-011）である。書いた時点の構成は、Rust の中核（`native/core`）がアプリのプロセスの中で動き、OCR・ローカル翻訳・RVC に Microsoft 公式の ONNX Runtime `1.31.0` を使う 0.6.0 の構成（`rust-core`）である。評価に使った上流の版は `voicevox_core` `0.17.1`、`voicevox_onnxruntime` `1.17.3`（正式版）、`voicevox_vvm` `0.17.1`、Open JTalk システム辞書 `v1.11.1` である。

## 1. Context（背景）

### 1.1 課題と既存の読み上げ構成

ASTAROT の読み上げ（TTS）は、ADR-012 の 2.2 で原則として speech.cpp に寄せ、日本語のキャラクター音声は ADR-008 により利用者が自分で導入・起動した外部の合成音声エンジン（VOICEVOX、SHAREVOX、AivisSpeech、COEIROINK v2）へループバック HTTP で接続して提供している。

この構成には次の 2 つの課題がある。

- 外部エンジンを別に導入・起動する手間が大きく、設定画面から声を選ぶだけで使い始めたい利用者の負担になる。
- speech.cpp の日本語読み上げモデル（Irodori-TTS v4.1 Small MF）は GPU 前提であり、CPU のみの環境や VRAM を VRChat へ残したい環境では実用にならない（Core i7-1255U の CPU では初回 3〜7 秒かつ実時間の約 4 倍遅く再生が途切れる）。

一方、VOICEVOX の推論本体である `voicevox_core`（0.16 以降 MIT）をアプリ内で動かし、必要なキャラクターの声（`.vvm`）だけを同意つきで取得すれば、外部エンジンの起動なしで日本語キャラクター音声を読み上げられる。

### 1.2 ADR-012 の 2.3 に沿った評価

ADR-012 の 2.3（手順 1〜3）に沿って、speech.cpp への統合と既存 ONNX Runtime の共有を評価した結果は次のとおりである。

- **speech.cpp での代替・上流貢献は不可**: 製品版の音声モデル（`.vvm`）は独自形式（`vv-bin`）と Open JTalk の韻律解析、`voicevox_onnxruntime` の固有処理に依存する。加えて `VOICEVOX 音声モデル 利用規約`（`TERMS.txt`）はリバースエンジニアリングを禁止しており、GGUF への変換や speech.cpp への上流移植は技術的にも規約上も実現できない。キャラクター音声自体も speech.cpp の既存モデルで代替できない。
- **既存の ONNX Runtime（1.31.0）とは共有できない**: `voicevox_core` 0.16 以降は `vv-bin` の読み込み処理を `voicevox_onnxruntime` 側へ分離しており、起動時に専用の識別文字列（`VOICEVOX ORT Build Info:`）と `session.use_vv_bin=1` を確認する。`voicevox_core` `0.17.1` の対応版は `1.17.3〜1.29`（`--disable_contrib_ops` ビルド）であり、ASTAROT 本体の Microsoft 公式 ONNX Runtime `1.31.0`（API v31）とは版も構成も合わない。さらに `ort` は 1 プロセスにつき 1 つの `OrtApi` しか初期化できず、`voicevox_core` `0.17.1` は `ort-sys = 2.0.0-rc.12` と `open_jtalk-rs`（C++ ビルド）の git 依存を持つため、本体プロセスへ直接組み込めない。

以上から、VOICEVOX CORE をアプリ内読み上げに導入するには、RVC（ADR-012 の 6.1）や TranslateGemma（ADR-015）と同様の「管理対象の例外」として個別の ADR で境界を定める必要がある。

## 2. Decision（決定）

2026-11-23 の保守担当者の決定（Issue #1061）に基づき、次を定める。

1. **例外とする範囲**: VOICEVOX CORE によるアプリ内の日本語読み上げを、ADR-012 の 2.2（読み上げは speech.cpp）に対する管理対象の例外とする。既存の speech.cpp による読み上げはそのまま維持し、既定の TTS エンジンは変えない。VOICEVOX CORE は利用者が明示的に選んだときだけ使う。
2. **例外とする理由（ADR-012 の 2.1 の 2 条件）**:
   - **既存基盤で実現できない技術的・規約的理由**: 製品版 VVM は `vv-bin` 独自形式・Open JTalk 韻律解析・`voicevox_onnxruntime` 固有処理を必要とし、リバースエンジニアリング禁止のため speech.cpp への変換・上流貢献ができない。既存の Microsoft ONNX Runtime `1.31.0` とも共有できない。
   - **性能・保守・配布コスト上の明確な優位性**: GPU がない環境や VRAM を VRChat へ温存したい環境で、speech.cpp の日本語 TTS（CPU では再生が途切れる）に対して CPU のみで実用的に読み上げられる優位性がある。ADR-008（外部エンジン手動起動）と比べて導入負担も大きく下がる。下記の案 B1 により、配布物の増加・C++ ビルド保守・LGPL の義務も避けられる。
3. **組み込み方式と実行基盤（案 B1）**:
   - 薄い Rust 子プロセス `astarot-voicevox-worker`（MIT）をアプリに同梱する。
   - 共通基盤は配布物に同梱せず、利用者の同意を得てからデータフォルダーへ取得し、ワーカー起動時に `libloading` で動的ロードする。対象は公式ビルド済み `voicevox_core` C API（`0.17.1`、MIT、Windows x64・Linux x64 とも zip 約 1.39 MiB）、`voicevox_onnxruntime` 正式版 `1.17.3`（CPU 版、Windows x64 約 4.44 MiB / Linux x64 約 6.45 MiB）、Open JTalk システム辞書 `v1.11.1`（BSD-3-Clause、圧縮 22.55 MiB、展開後約 102 MiB）とする。プレリリース版 `1.23.2` の正式版は待たない。
   - 初回は **CPU 推論のみ** とし、VRAM を消費しない。Windows 向けの DirectML オプション（約 5.6〜6.4 MiB＋`DirectML.dll` 約 9 MiB）は実機計測を見て後段で検討する。CUDA ライブラリ（約 1.5 GiB）は同梱も取得もしない。
   - ワーカーの通信経路は親プロセスとの専用ローカル経路（標準入出力または非公開ローカル IPC）に限定し、ネットワークへ公開しない。
4. **カタログと VVM の範囲**:
   - 取得と検証の単位は VVM ファイル（版、サイズ、SHA-256 をカタログに固定）とし、GitHub Releases（`github.com` から `release-assets.githubusercontent.com` への転送）からの取得に対応する。配布物への誤同梱を防ぐため、`tools/distribution_policy.py` の `MODEL_EXTENSIONS` に `vvm` を追加する。
   - 初回は**標準規約のみの代表パック**（例: `0.vvm`、56.6 MiB、四国めたん・ずんだもん・春日部つむぎ・雨晴はうの 4 キャラクター）から始める。共通基盤（CPU）と `0.vvm` 1 本の初回ダウンロード合計は約 85〜89 MiB である。
   - 個別制限（非商用限定、法人・商用事前確認）がある 7 キャラクターを含む VVM（`6`・`7`・`15`・`16`・`17`・`18`・`20.vvm`）への拡張は、代表パックの実装が固まってから個別確認チェックとあわせて別途進める。
   - VOICEVOX Nemo（`n0.vvm`）と歌唱用（`s0.vvm`）は対象に含めない。
5. **ADR-008（外部合成音声エンジン接続）との住み分け**:
   - ADR-008 はそのまま有効として並存させ、置き換えない。
   - アプリ内 VOICEVOX CORE は「別途インストールなしで始められること」「CPU のみ・VRAM 非消費での日本語読み上げ」「標準規約キャラクターの即時利用」を担う。
   - ADR-008（外部接続）は「SHAREVOX・AivisSpeech・COEIROINK v2 の利用」「利用者が独自に運用する VOICEVOX ENGINE やカスタム辞書、GPU エンジン、カタログ未収録の VVM の利用」を担う。設定画面では両者を区別できる表示で並べて選べるようにする。
6. **ライセンス、同意、クレジット表示（ADR-012 の 2.6・2.7）**:
   - `VOICEVOX ENGINE`（LGPL-3.0）を使わないため、LGPL の義務は発生しない。
   - `voicevox_onnxruntime` と `.vvm` の独自規約（クレジット表記必須、音声ライブラリ規約の利用者への継承義務、リバースエンジニアリング禁止）を守るため、どちらも MIT の配布物へ同梱せず、明示の同意を得てから取得する。
   - クレジット表示は次の 4 箇所へ配置する。(a) 設定画面の声選択欄の直下（選択中キャラクターの正確なクレジット文字列と規約リンク）、(b) ダウンロード同意画面（`TERMS.txt` と収録キャラクター規約リンク、クレジット必須の明示）、(c) 「ASTAROT について」画面（`AboutVrct.tsx` への VOICEVOX 帰属文言の直接表示）、(d) `NOTICE.md` とライセンス台帳（`docs/voice-stack/licensing.md`）。
7. **リアルタイム性と安全性（ADR-012 の 2.6）**:
   - 推論は専用子プロセス内で行い、音声コールバックや UI スレッドに置かない。明示の取り消し・ミュート・停止は合成中でも即応する。
   - ワーカーの異常終了やタイムアウトでアプリ本体、音声経路、ミュート、他エンジンを巻き込まない。失敗時はエラーを通知して無音を保ち、元の声や別エンジンへ黙って切り替えない。
   - 既存の `native/tts/src/engines.rs` と同じ文分割・読点分割・先読み合成を使い、マイク読み上げの開始期限（5 秒以内、ADR-008 の 13）を満たす。
   - 読み上げ文や合成音声をログへ出さず、同意なしの外部通信を増やさない。
8. **段階、担当、更新と脆弱性対応の方針（ADR-012 の 2.4）**:
   - **段階**: 第 1 段階としてこの ADR と Windows・Linux 実機での PoC 計測（遅延・CPU・メモリ）を進め、その結果を見てから第 2 段階（本実装）の着手を判断する。
   - **担当**: リポジトリの保守担当者（ワーカーと TTS 統合は `native/tts`、取得カタログと検証は `native/ops`、設定とクレジット表示は `src-ui/` の領域で管理する）。
   - **更新と脆弱性対応**: `voicevox_core`・`voicevox_onnxruntime`・`voicevox_vvm` のリリースを確認し、版を上げる際はサイズ・SHA-256・`TERMS.txt` の差分を検査したうえでカタログ、`NOTICE.md`、ライセンス台帳を同時更新する。重大な脆弱性や規約変更が見つかった場合は、該当項目の新規取得を止め、修正版へ差し替えるか撤去する。

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| 案 A: 本体プロセスへ `voicevox_core` Rust クレートを直接組み込む | `native/core` と同じプロセスで `voicevox_core` を呼ぶ | 本体の Microsoft ONNX Runtime `1.31.0` と `voicevox_onnxruntime`（`1.17.3`）が 1 プロセス内で衝突する。`ort-sys` の版差と git・C++ 依存が本体ビルドへ入り、推論クラッシュでアプリ全体が落ちる |
| 案 B2: 別 Cargo ワークスペースで `voicevox_core` クレートを直接ビルドする | 子プロセスを分けつつ、Rust クレートからソースビルドする | `voicevox_core` は crates.io 未公開で、`open_jtalk-rs`（C++ ビルド）と `ort` の git 依存を Windows・Linux の CI で保守する負担が重い。公式 C API 動的ロードならその負担を避けられる |
| 案 C: `VOICEVOX ENGINE` を別プロセスで同梱する | 公式エンジン実行ファイル一式をアプリへ同梱し HTTP 接続する | `VOICEVOX ENGINE` は LGPL-3.0 対象となり 3 年間のソース提供と差し替え手順の保守が要る。Python 実行環境ごと数百 MiB 増え、0.5.0 の脱 Python の方針に逆行し、ADR-008 とも役割が重複する |
| 現行維持（ADR-008 の外部接続のみ） | アプリ内組み込みを行わず、利用者による VOICEVOX 起動に任せる | VOICEVOX 本体の別途導入と起動が必須のままで、設定画面から声を選ぶだけで始めたい利用者の障壁が解消しない |
| speech.cpp への移植・上流貢献 | VVM を GGUF へ変換し speech.cpp へ貢献する | `vv-bin` 独自形式と Open JTalk 韻律解析に依存し、`TERMS.txt` のリバースエンジニアリング禁止条項にも抵触するため技術的・規約的に不可 |

## 4. Consequences（影響）

**得るもの**

- 外部の VOICEVOX を別に導入・起動せず、設定画面から代表パックを取得するだけで日本語キャラクター音声を使えるようになる。
- CPU のみ（VRAM 消費 0）で動作し、GPU のない PC や VRAM を VRChat へ温存したい環境でも日本語読み上げが実用的になる。
- `voicevox_core` C API（MIT）の動的ロードにより、LGPL の義務、配布物への独自規約バイナリ同梱、本体への C++・git 依存を避けられる。
- 子プロセス分離により、ONNX Runtime の競合と推論クラッシュの波及を防げる。

**負担とリスク**

- 推論ランタイム（`voicevox_onnxruntime` `1.17.3`）と C API の組を 1 つ管理対象へ増やすため、版の追従、SHA-256 と `TERMS.txt` の確認、OS ごとの動作確認の負担が増える（ADR-012 の 1.1）。
- CPU での文単位一括合成（`voicevox_core` `0.17.1` の `StreamingTalk` は現時点で `Talk` と同等の非ストリーミング）のため、GPU 前提の全体遅延目標（#556 の話し終わりから発声開始まで p50 1.0 秒以下）とは両立しない。低遅延の GPU 経路としては speech.cpp を維持し、VOICEVOX CORE は CPU・キャラクター音声の選択肢として位置づける。
- 利用者には初回約 85〜89 MiB（共通基盤＋ `0.vvm`、展開後約 180 MiB 超）の取得と、規約同意・クレジット表記の理解を求める。
- `voicevox_onnxruntime` `1.17.3` は上流の正式版最新だが 2025-03 公開であり、今後の OS 更新やセキュリティ更新で上位版（`1.23.x` 以降の正式版など）への移行判断が必要になる。

**移行の方針**

- 既存の TTS エンジン（speech.cpp）、ADR-008 の外部エンジン接続、既存の設定ファイルと IPC 契約を壊さない。
- 本実装の着手前に、Windows x64 と Linux x64 の実機で案 B1 の PoC を計測し、遅延・CPU・メモリを確かめる。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

本実装の着手および製品への受け入れ前に、次を確かめる。満たせない場合は 6 の条件で見直す。

| 観点 | 確かめること | 方法 |
|---|---|---|
| 性能（PoC と実機） | 初回・2 回目以降の短文合成遅延、連続発話時の CPU 使用率とメモリ使用量、マイク読み上げ 5 秒開始期限への適合、VRAM 非消費 | Windows x64 と Linux x64 の実機で案 B1 ワーカー試作を計測し、環境と条件を添えて Issue #1061 へ記録する（ADR-012 の 2.7） |
| 動作と契約 | 合成要求、文分割と先読み、取り消し、失敗通知が既存の TTS 契約どおりに動く | 偽のワーカーを使う `native/tts`・`native/core` の単体・結合試験 |
| 安全性 | ワーカーのクラッシュ・タイムアウト・起動失敗で本体・音声経路・ミュート・他エンジンが影響を受けないこと。元の声や別エンジンへ黙って切り替えないこと | 失敗を注入する試験（偽のワーカーを異常終了・遅延させる） |
| 配布とライセンス | 配布物に `.vvm`・`voicevox_onnxruntime`・Open JTalk 辞書が誤同梱されないこと。版・サイズ・SHA-256 固定、`NOTICE.md` とライセンス台帳への記録 | `tools/distribution_policy.py`（`vvm` 追加）、`tools/check_voice_distribution.py`、`tools/rust_licenses.py`、`native/core/tests/downloads.rs` |
| 同意とクレジット | 同意前に共通基盤と VVM を取得しないこと。声選択欄直下・同意画面・`AboutVrct.tsx`・`NOTICE.md` に正確なクレジットと規約リンクが出ること | UI の単体試験と Playwright 結合試験 |
| OS 対応 | Windows x64 と Linux x64 の両方で動的ロード・合成・再生が動くこと。片方が未確認のままなら明記しリリース候補で確認すること | 両 OS の実機確認（ADR-012 の 2.7） |

## 6. Revisit triggers（見直す条件）

次のいずれかに当たるとき、この例外 ADR を見直す。

- Windows または Linux の実機 PoC、あるいは VRChat 併用時の確認で、5 秒開始期限や CPU・メモリの許容範囲を満たせなかったとき。
- speech.cpp に軽量な CPU 日本語 TTS または同等の体験を提供できる経路が入り、この例外の性能・体験上の優位性がなくなったとき。
- `voicevox_core`、`voicevox_onnxruntime`、`voicevox_vvm` の更新停止、ライセンスや利用規約の変更、深刻な脆弱性が見つかったとき。
- `voicevox_onnxruntime` の上位正式版（`1.23.x` 以降など）へ上げる判断をするとき、または Windows 向け DirectML オプションを追加するとき。
- 個別制限付きキャラクターを含む VVM（`6`・`7`・`15`・`16`・`17`・`18`・`20.vvm`）をカタログへ広げる判断をするとき。
- `voicevox_core` の `StreamingTalk` が実ストリーミング合成に対応し、ワーカーの IPC 契約や遅延目標を見直す価値が生じたとき。

## 7. 未決のこと

- **Windows・Linux 実機 PoC の結果と本実装の着手判断**: Issue #1061 で実測値を集めたうえで判断する。
- **ワーカー IPC の詳細契約**: リクエスト・応答・キャンセル・ヘルスチェックの形式は、本実装の設計時に `docs/spec/` へ仕様化する。
- **代表パック以外の VVM への拡張範囲と時期**: 制限付き 7 キャラクターの個別確認チェック UI とあわせて、代表パックの実装が固まってから判断する。
- **Windows 向け DirectML オプションの採否**: CPU 実機計測を見て後段で判断する。
- **英語など他言語との混在時のルーティング細部**: 既存の外部エンジン接続（ADR-008）との整合を含め、本実装時の仕様で定める。
