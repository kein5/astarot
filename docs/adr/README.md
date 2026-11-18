# ADR（アーキテクチャ決定記録）

ASTAROT の設計判断の記録（ADR）の正本は、このディレクトリだけにある。このページがその索引である。新しい ADR もここに置く。

- 番号は通し番号である。一度使った番号は使い直さず、ファイル名（`adr-NNN-<英語の短い名前>.md`）も後から変えない。
- 採用の状態は、各 ADR の Status 欄を正とする。
- ADR の本文は、書いた時点の判断と前提の記録である。後から状況が変わっても本文は書き換えず、注記や後続の ADR で示す。

## 一覧

| ADR | 題名 | 日付 |
|---|---|---|
| [001](adr-001-external-speechcpp-and-voice-worker.md) | 外部speech.cppと独立した音声worker | 2026-10-27 |
| [002](adr-002-output-and-lifetime.md) | 出力と寿命 | 2026-10-27 |
| [003](adr-003-voice-conversion-selection-deferred.md) | VCは選定保留 | 2026-10-27 |
| [004](adr-004-audio-integration-boundaries.md) | 外部推論と音声経路の境界を条件付きで選ぶ | 2026-10-27 |
| [005](adr-005-managed-microphone-lifetime.md) | 仮想マイクの寿命と保持ミュート | 2026-10-27 |
| [006](adr-006-external-source-health.md) | 外部入力の接続確認とVC変換状態を分ける | 2026-10-28 |
| [007](adr-007-translated-speech-through-voice-conversion.md) | 訳文の読み上げを声の変換に通す | 2026-11-14 |
| [008](adr-008-external-speech-engines.md) | 外部の合成音声エンジン（VOICEVOX系、COEIROINK）を読み上げに使う | 2026-11-15 |
| [009](adr-009-virtual-microphone-and-store.md) | Windows の仮想マイクは外部のドライバに頼り、Microsoft Store では依存を開示する | 2026-11-15 |
| [010](adr-010-frontend-stack.md) | フロントエンドのスタック（React と Vite を維持し、TypeScript と vanilla-extract を採用する） | 2026-11-15 |
| [011](adr-011-astarot-brand-and-multimodal-accessibility.md) | ASTAROT の名称、ブランド統一、マルチモーダル・アクセシビリティの製品方針 | 2026-11-16 |
| [012](adr-012-audio-ai-runtime-consolidation.md) | Audio AI Runtime Consolidation | 2026-11-17 |
| [013](adr-013-secret-store.md) | API キーを OS の資格情報ストアに保管する | 2026-11-18 |

## 各 ADR の要約

ADR 001〜003 は、2026-10-27 に音声の最初の段階（P1）のために採用した。もとは `docs/voice-stack/decisions.md` の1つのファイルに書かれていて、2026-11-18 に1件ずつのファイルに分けた。

[ADR 001: 外部speech.cppと独立した音声worker](adr-001-external-speechcpp-and-voice-worker.md)は、読み上げを外部の speech.cpp に HTTP でつなぎ、アプリに推論のライブラリ、torch、モデルの重みを足さないと決めた。PCM のストリームの形式を検証してから再生し、要求を自動で送り直さない。

[ADR 002: 出力と寿命](adr-002-output-and-lifetime.md)は、HTTP とデバイスの操作を worker で行い、設定の変更と停止を取り消しの信号とキューの破棄で扱うと決めた。疑似の resampling はせず、再接続の後に別のデバイスへ流さない。

[ADR 003: VCは選定保留](adr-003-voice-conversion-selection-deferred.md)は、VC の選定を保留し、外部プロセスと仮想デバイスの契約から始めると決めた。候補は VCClient と Seed-VC Realtime で、VC の本体とモデルは同梱しない。その後、VC は自前の実装に決まり、[ADR-012](adr-012-audio-ai-runtime-consolidation.md) の 6.1 で例外として登録した（ADR 003 の冒頭の状態の注記）。

[ADR 004: 外部推論と音声経路の境界を条件付きで選ぶ](adr-004-audio-integration-boundaries.md)
は2026-10-27の設計評価による提案。001〜003の履歴を置換せず、3案の比較、
採用を覆す条件、未実施のPoCを記録する。新しい実装や採用承認を意味しない。

[ADR-005: 仮想マイクの寿命と保持ミュート](adr-005-managed-microphone-lifetime.md)は2026-10-27に、ソースのcheckout向けのLinuxの実装として採用した。

[ADR-006: 外部入力の接続確認とVCの変換状態を分ける](adr-006-external-source-health.md)は2026-10-28に、モデルの要らない基盤の実装として採用した。

[ADR-007: 訳文の読み上げを声の変換に通す](adr-007-translated-speech-through-voice-conversion.md)は2026-11-14の提案で、同じ日に採用して実装した。RVCとSeed-VCの入力へ読み上げの音声を流し、訳文を変換後の声で届ける設計と、ミュートと直接音声の抑制を分ける理由を書いた。

[ADR-008: 外部の合成音声エンジンを読み上げに使う](adr-008-external-speech-engines.md)は2026-11-15に採用し、0.3.0で実装した（#272、#313）。利用者が入れたVOICEVOX、SHAREVOX、AivisSpeech、COEIROINK v2に、ループバックのHTTPで接続して日本語を読み上げる。エンジンと声は同梱も取得もしない。

[ADR-009: Windowsの仮想マイクは外部のドライバに頼り、Microsoft Storeでは依存を開示する](adr-009-virtual-microphone-and-store.md)は2026-11-15に採用した。MSIXはドライバを入れられず、自前のドライバの署名や既存のドライバの再配布にも条件があるので、VB-CABLEなどは同梱しない。Storeではポリシー10.2.4に従って説明文の冒頭と認証ノートで依存を開示し、アプリは初回起動での検出、案内、再検出、自己診断で導入を支える（0.4.0で実装した）。前提の制約は[プラットフォームの制約](../voice-stack/platform-constraints.md)にまとめた。

[ADR-010: フロントエンドのスタック（React と Vite を維持し、TypeScript と vanilla-extract を採用する）](adr-010-frontend-stack.md)は2026-11-15に採用し、0.5.0に向けて段階的に移行する。React と Vite はそのまま使い、Vite+ は見送って再評価の条件を残した。TypeScript は logics から型を付け、スタイルは SCSS Modules から vanilla-extract へ移し、UI 部品の土台に Radix UI を使う。0.4.0 の UI 変更は現行のスタックで行う。

[ADR-011: ASTAROT の名称、ブランド統一、マルチモーダル・アクセシビリティの製品方針](adr-011-astarot-brand-and-multimodal-accessibility.md)は2026-11-16に製品方針とブランド仕様として採用した。新しい名前を ASTAROT とし、正式サブタイトルを「Speech, Translation, Accessibility, Revoicing & OCR Toolkit」と決めた。ロゴとアイコンの原版は `docs/brand/astarot/` に置く。表示の移行（P1）のうち、アプリの表示は 0.5.0 に向けて develop に入れた。識別子の移行（P2、別の ADR が必要）は始めておらず、実行ファイル名、アプリ ID、保存先などの識別子は VRCT-VOX のままである。

[ADR-012: Audio AI Runtime Consolidation](adr-012-audio-ai-runtime-consolidation.md)は2026-11-17に開発の原則として採用した。新しい音声AIモデルは、まずspeech.cppへの上流の貢献で入れる。VRCT-VOX固有の推論エンジンや独立したランタイムは、既存の基盤で実現できない技術的な理由と、性能・保守・配布のコストでの明確な優位性の両方を確かめたときだけ採用する。機能ごとの責務の分担は、音声AIの推論（ASR、TTS、VAD、話者、音声強調）がspeech.cpp、OCRとローカル翻訳がONNX Runtime、音声の入出力とAIでないDSPがRustとOSの機能、字幕やOSCなど固有の制御がアプリとした。RVCは管理対象の例外としてONNX Runtimeの実装を続け、移行は義務にしない。新しいモデルの評価の手順、例外のADRに書くこと、非機能要件、検証、見直す条件も定めた。

[ADR-013: API キーを OS の資格情報ストアに保管する](adr-013-secret-store.md)は2026-11-18に採用した。`SECRET_SETTINGS`の項目（APIキー、PapagoのClient ID）の保管先を、`secrets.json`（WindowsはDPAPI、Linuxは0600の平文）から、Windowsの資格情報マネージャーとLinuxのSecret Serviceへ移す。現状維持とアプリが管理する鍵での暗号化を比べ、Linuxの平文をなくせることと、両OSで守られ方が揃うことから選んだ。移行は読み戻せた項目だけを移す段階的な形にし、失敗してもキーを失わない。実施はIssue #575で、そのときに残っていた4つの判断（Secret Serviceのない環境、移行した後の`secrets.json`、ストアの障害、読めない`secrets.json`）も決めた。どれもキーを失わず平文を増やさない側を選び、ADR-013の「実施で決めたこと」に書いた。

## 配置の移行（2026-11-18）

ADR は 2026-11-18 まで `docs/voice-stack/` にあった。対象が音声の外（フロントエンド、ブランド、秘密情報など）に広がったので、このディレクトリに集めた（Issue #587）。番号とファイル名は変えていない。古いパスには、ここへの案内だけを残している。

> **追記**（2026-11-18、Issue #587）：古いパスに残していた案内のページ（`docs/voice-stack/decisions.md` と `docs/voice-stack/adr-004〜013-*.md`）は、保守担当者の判断で削除した。リポジトリの中の参照は、その前にすべて `docs/adr/` へ直してある。古いパスへのリンクはもう開けないので、下の表で新しいパスを引く。

| 古いパス | いまのパス |
|---|---|
| `docs/voice-stack/decisions.md`（ADR 001〜003 と索引） | [`adr-001-external-speechcpp-and-voice-worker.md`](adr-001-external-speechcpp-and-voice-worker.md)、[`adr-002-output-and-lifetime.md`](adr-002-output-and-lifetime.md)、[`adr-003-voice-conversion-selection-deferred.md`](adr-003-voice-conversion-selection-deferred.md)、このページ |
| `docs/voice-stack/adr-004-audio-integration-boundaries.md` | [`adr-004-audio-integration-boundaries.md`](adr-004-audio-integration-boundaries.md) |
| `docs/voice-stack/adr-005-managed-microphone-lifetime.md` | [`adr-005-managed-microphone-lifetime.md`](adr-005-managed-microphone-lifetime.md) |
| `docs/voice-stack/adr-006-external-source-health.md` | [`adr-006-external-source-health.md`](adr-006-external-source-health.md) |
| `docs/voice-stack/adr-007-translated-speech-through-voice-conversion.md` | [`adr-007-translated-speech-through-voice-conversion.md`](adr-007-translated-speech-through-voice-conversion.md) |
| `docs/voice-stack/adr-008-external-speech-engines.md` | [`adr-008-external-speech-engines.md`](adr-008-external-speech-engines.md) |
| `docs/voice-stack/adr-009-virtual-microphone-and-store.md` | [`adr-009-virtual-microphone-and-store.md`](adr-009-virtual-microphone-and-store.md) |
| `docs/voice-stack/adr-010-frontend-stack.md` | [`adr-010-frontend-stack.md`](adr-010-frontend-stack.md) |
| `docs/voice-stack/adr-011-astarot-brand-and-multimodal-accessibility.md` | [`adr-011-astarot-brand-and-multimodal-accessibility.md`](adr-011-astarot-brand-and-multimodal-accessibility.md) |
| `docs/voice-stack/adr-012-audio-ai-runtime-consolidation.md` | [`adr-012-audio-ai-runtime-consolidation.md`](adr-012-audio-ai-runtime-consolidation.md) |
| `docs/voice-stack/adr-013-secret-store.md` | [`adr-013-secret-store.md`](adr-013-secret-store.md) |

ADR 001〜003 の本文は原文のままで、足したのは移行と状態の注記だけである。ADR 004〜013 は `git mv` で移し、変えたのは、ディレクトリが変わって切れるリンクの行き先だけである。
