# ADR 001: 外部speech.cppと独立した音声worker

Status: accepted for P1, 2026-10-27.

speech.cppのHTTPストリームを標準ライブラリで扱う。VRCTへ推論ライブラリ・
torch・モデル重みは追加しない。ローカルHTTPのみ、proxy/redirectは使わない。
API根拠: [speech.cpp server](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)。
`audio/pcm`、mono s16le、`X-Sample-Rate`を検証し、未対応形式は停止する。
全WAVを待たず、PCMのサンプル境界を保って再生する。

日本語はIrodori、他言語は別ポートのQwen3-TTSへ。未設定・未対応言語は
無音とエラーにする。明示した翻訳先1つのみを読み上げ、訳文欠落時に原文へ戻さない。
要求の自動再送は途中からの二重発声を招くので行わない。

## ADR 002: 出力と寿命

HTTP、デバイスopen/write/closeはworker上。設定変更と停止はcancel信号を送り、
キューを破棄。出力は短いPCMブロックに分割し、OSのresamplerに実際のrateを渡す。
ヘッダだけ書き換える疑似resamplingは行わない。Windowsはデバイス名とhost APIを
照合し、再接続後のindex再利用で別デバイスへ流さない。Linuxはtargetと
`node.dont-fallback` / `node.dont-reconnect` を指定する。

## ADR 003: VCは選定保留

speech.cppには生音声VC機能はない。P2は外部プロセス/仮想デバイス契約から始める。
[VCClient](https://github.com/w-okada/voice-changer)のWindows CUDA/ONNX RVCと
[Seed-VC Realtime](https://github.com/jiaheguo521/seed-vc-realtime)を候補にする。
Linux標準VCClientのRVC対応は確約しない。Seedの作者測定は自環境の達成値ではない。
GPU/VRChat環境でp50/p95、ドロップ、品質、VRAM、OS、モデル許諾を比較してから選定する。
VC本体やモデルは同梱しない。P1終了前にVC/ASRの大改造を行わない。

## 提案中の再評価

[ADR 004: 外部推論と音声経路の境界を条件付きで選ぶ](adr-004-audio-integration-boundaries.md)
は2026-10-27の設計評価による提案。001〜003の履歴を置換せず、3案の比較、
採用を覆す条件、未実施のPoCを記録する。新しい実装や採用承認を意味しない。

[ADR-007: 訳文の読み上げを声の変換に通す](adr-007-translated-speech-through-voice-conversion.md)は2026-11-14の提案で、同じ日に採用して実装した。RVCとSeed-VCの入力へ読み上げの音声を流し、訳文を変換後の声で届ける設計と、ミュートと直接音声の抑制を分ける理由を書いた。

[ADR-008: 外部の合成音声エンジンを読み上げに使う](adr-008-external-speech-engines.md)は2026-11-15に採用し、0.3.0で実装した（#272、#313）。利用者が入れたVOICEVOX、SHAREVOX、AivisSpeech、COEIROINK v2に、ループバックのHTTPで接続して日本語を読み上げる。エンジンと声は同梱も取得もしない。

[ADR-009: Windowsの仮想マイクは外部のドライバに頼り、Microsoft Storeでは依存を開示する](adr-009-virtual-microphone-and-store.md)は2026-11-15に採用した。MSIXはドライバを入れられず、自前のドライバの署名や既存のドライバの再配布にも条件があるので、VB-CABLEなどは同梱しない。Storeではポリシー10.2.4に従って説明文の冒頭と認証ノートで依存を開示し、アプリは初回起動での検出、案内、再検出、自己診断で導入を支える（0.4.0で実装予定）。前提の制約は[プラットフォームの制約](platform-constraints.md)にまとめた。

[ADR-010: フロントエンドのスタック（React と Vite を維持し、TypeScript と vanilla-extract を採用する）](adr-010-frontend-stack.md)は2026-11-15に採用し、0.5.0に向けて段階的に移行する。React と Vite はそのまま使い、Vite+ は見送って再評価の条件を残した。TypeScript は logics から型を付け、スタイルは SCSS Modules から vanilla-extract へ移し、UI 部品の土台に Radix UI を使う。0.4.0 の UI 変更は現行のスタックで行う。

[ADR-011: ASTAROT の名称、ブランド統一、マルチモーダル・アクセシビリティの製品方針](adr-011-astarot-brand-and-multimodal-accessibility.md)は2026-11-16に製品方針とブランド仕様として採用した。新しい名前を ASTAROT とし、正式サブタイトルを「Speech, Translation, Accessibility, Revoicing & OCR Toolkit」と決めた。ロゴとアイコンの原版は `docs/brand/astarot/` に置く。表示の移行（P1）と識別子の移行（P2、別の ADR が必要）はまだ始めておらず、現行のビルドの名前と識別子は VRCT-VOX のままである。

[ADR-012: Audio AI Runtime Consolidation](adr-012-audio-ai-runtime-consolidation.md)は2026-11-17に開発の原則として採用した。新しい音声AIモデルは、まずspeech.cppへの上流の貢献で入れる。VRCT-VOX固有の推論エンジンや独立したランタイムは、既存の基盤で実現できない技術的な理由と、性能・保守・配布のコストでの明確な優位性の両方を確かめたときだけ採用する。機能ごとの責務の分担は、音声AIの推論（ASR、TTS、VAD、話者、音声強調）がspeech.cpp、OCRとローカル翻訳がONNX Runtime、音声の入出力とAIでないDSPがRustとOSの機能、字幕やOSCなど固有の制御がアプリとした。RVCは管理対象の例外としてONNX Runtimeの実装を続け、移行は義務にしない。新しいモデルの評価の手順、例外のADRに書くこと、非機能要件、検証、見直す条件も定めた。
