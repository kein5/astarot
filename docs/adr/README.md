# ADR（アーキテクチャ決定記録）

ASTAROT の設計判断の記録（ADR）の正本は、このディレクトリだけにある。このページがその索引である。新しい ADR もここに置く。

- 番号は通し番号である。一度使った番号は使い直さず、ファイル名（`adr-NNN-<英語の短い名前>.md`）も後から変えない。
- いまの状態は、各 ADR の冒頭の front matter が正である。本文の Status 欄は、書いた時点の記録として残す。
- ADR の本文は、書いた時点の判断と前提の記録である。後から状況が変わっても本文は書き換えず、front matter、注記、後続の ADR で示す。

## 一覧

<!-- adr-index:start -->
<!-- 自動生成。手で編集しない。`python tools/adr_catalog.py --write`で更新する。 -->

| ADR | 題名 | 日付 | 状態 | 実装 | 有効性 | 時代 |
|---|---|---|---|---|---|---|
| [001](adr-001-external-speechcpp-and-voice-worker.md) | 外部speech.cppと独立した音声worker | 2026-10-27 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [002](adr-002-output-and-lifetime.md) | 出力と寿命 | 2026-10-27 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [003](adr-003-voice-conversion-selection-deferred.md) | VCは選定保留 | 2026-10-27 | 採用 | 対象外 | 置き換えられた（[ADR-012](adr-012-audio-ai-runtime-consolidation.md)） | Python のサイドカー |
| [004](adr-004-audio-integration-boundaries.md) | 外部推論と音声経路の境界を条件付きで選ぶ | 2026-10-27 | 提案 | 未確認 | 未確認 | Python のサイドカー |
| [005](adr-005-managed-microphone-lifetime.md) | 仮想マイクの寿命と保持ミュート | 2026-10-27 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [006](adr-006-external-source-health.md) | 外部入力の接続確認とVC変換状態を分ける | 2026-10-28 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [007](adr-007-translated-speech-through-voice-conversion.md) | 訳文の読み上げを声の変換に通す | 2026-11-14 | 採用 | 一部 | 実装の方式が変わった | Python のサイドカー |
| [008](adr-008-external-speech-engines.md) | 外部の合成音声エンジン（VOICEVOX系、COEIROINK）を読み上げに使う | 2026-11-15 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [009](adr-009-virtual-microphone-and-store.md) | Windows の仮想マイクは外部のドライバに頼り、Microsoft Store では依存を開示する | 2026-11-15 | 採用 | 一部 | 有効 | Python のサイドカー |
| [010](adr-010-frontend-stack.md) | フロントエンドのスタック（React と Vite を維持し、TypeScript と vanilla-extract を採用する） | 2026-11-15 | 採用 | 一部 | 有効 | Python のサイドカー |
| [011](adr-011-astarot-brand-and-multimodal-accessibility.md) | ASTAROT の名称、ブランド統一、マルチモーダル・アクセシビリティの製品方針 | 2026-11-16 | 採用 | 一部 | 有効 | Python のサイドカー |
| [012](adr-012-audio-ai-runtime-consolidation.md) | Audio AI Runtime Consolidation | 2026-11-17 | 採用 | 対象外 | 有効 | Rust の中核 |
| [013](adr-013-secret-store.md) | API キーを OS の資格情報ストアに保管する | 2026-11-18 | 採用 | 実装済み | 有効 | Rust の中核 |
| [014](adr-014-internal-identifier-migration.md) | 内部識別子を ASTAROT にそろえ、設定とモデルを引き継ぐ | 2026-11-19 | 採用 | 未着手 | 有効 | Rust の中核 |
| [015](adr-015-translation-llm-runtime-exception.md) | TranslateGemma の翻訳を LLM 用の実行基盤で動かす（ADR-012 の例外） | 2026-11-19 | 採用 | 未着手 | 有効 | Rust の中核 |
| [016](adr-016-user-guide-site-on-rspress.md) | 利用者向けのサイトの土台を VitePress から Rspress（React）に替える | 2026-11-20 | 採用 | 未着手 | 有効 | Rust の中核 |
| [017](adr-017-integration-tests-through-the-core.md) | 画面から中核まで通す試験を Playwright の結合テストにし、配布物で通す試験だけを E2E と呼ぶ | 2026-11-20 | 採用 | 未着手 | 有効 | Rust の中核 |
| [018](adr-018-talk-ai-through-external-services.md) | おしゃべりAIは外部の対話サービスにつなぎ、アプリは対話のモデルを動かさない | 2026-11-22 | 採用 | 未着手 | 有効 | Rust の中核 |

<!-- adr-index:end -->

各列の意味は[項目と値](#項目と値)にある。古い ADR を読むときは、先に「時代」と「有効性」を見る。

## 新しい ADR の書き方

1. [TEMPLATE.md](TEMPLATE.md) を写して、一覧の最後の次の番号で `adr-NNN-<英語の短い名前>.md` を作る。
2. front matter を埋める。確かめていない値は `unknown` にし、推測で埋めない。
3. `python tools/adr_catalog.py --write`（`mise run adr`）で一覧の表を作り直す。`python tools/dev.py check` の `tooling` が `--check` を実行し、番号の重複、項目と値、`evidence` のパス、リンク、一覧の古さを確かめる。
4. 判断の内容を変える変更と、ファイルの移動やメタデータだけの変更は、別のプルリクエストに分ける。

ADR を後から更新するときも本文は書き換えない。実装が進んだら `implementation_status`、`implementation_checked`、`evidence` を直し、判断が変わるなら新しい ADR を書いて、古い ADR の `validity` と `superseded_by` を直す。

## 項目と値

front matter は YAML の一部だけを使う。`キー: 値` の行と、`  - 項目` の行が続くリストである。値に `: ` や ` #` が入るとき、または記号で始まるときは、値を二重引用符で囲む。コメントと空行は書かない。

| 項目 | 必要なとき | 中身 |
|---|---|---|
| `date` | 必須 | 判断を書いた日（`YYYY-MM-DD`）。原文の Date 欄か Status 欄の日付 |
| `status` | 必須 | 判断の状態 |
| `era` | 必須 | 書いた時点の前提（時代背景） |
| `validity` | 必須 | 判断がいまも有効か |
| `validity_note` | `validity` が `implementation_changed` か `replaced` のとき | 何が変わったか、何が引き継いだか |
| `superseded_by` | `status` が `superseded` か、`validity` が `replaced` のとき | 置き換えた ADR（`ADR-NNN`） |
| `implementation_status` | 必須 | 実装を確かめた結果 |
| `implementation_checked` | `implementation_status` が `pending`、`partial`、`implemented` のとき | 実装を確かめた日 |
| `implementation_note` | `implementation_status` が `partial` のとき | 残っていること、確かめていないこと |
| `evidence` | `validity` と `implementation_status` の両方が `unknown` のときだけ省ける | 値の裏付けにしたファイル。リポジトリの中のパスで書く |

### status（判断の状態）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `proposed` | 提案 | 提案したが、採用を決めていない |
| `accepted` | 採用 | 採用した |
| `rejected` | 不採用 | 検討して採らなかった |
| `superseded` | 置き換え済み | 後続の ADR で置き換えると決めた。`validity` を `replaced` にし、`superseded_by` を書く |
| `deprecated` | 廃止 | 置き換えずにやめた |

`status` を `superseded` や `deprecated` に変えるのは、保守担当者がそう決めたときだけである。後続の ADR が判断を実際に引き継いだだけのときは、`status` は変えずに `validity` を `replaced` にする（ADR 003 がこれに当たる）。

### implementation_status（実装の確認状況）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `pending` | 未着手 | 実装が始まっていない |
| `partial` | 一部 | 決定の一部だけが実装されている。または一部の OS や経路でだけ動く |
| `implemented` | 実装済み | 決定の範囲が実装されている。実機での受け入れがすべて済んだことは意味しない |
| `not_applicable` | 対象外 | 判断そのものがコードの変更を求めない（開発の原則、選定の保留など） |
| `unknown` | 未確認 | 確かめていない |

`status` と `implementation_status` は別々に決める。`accepted` であることだけを根拠に `implemented` にしない。実装を確かめたら、`implementation_checked` をその日にし、確かめたファイルを `evidence` に足す。残る確認は `implementation_note` に書く。

### validity（判断の現在の有効性）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `current` | 有効 | 判断の原則も、本文に書いた実装の方式も、いまも当てはまる |
| `implementation_changed` | 実装の方式が変わった | 判断の原則はいまも有効だが、本文に書いた実装の方式（言語、プロセスの構成、使う API など）が変わった |
| `replaced` | 置き換えられた | 後続の ADR が判断を置き換えた。いまの判断は `superseded_by` の ADR を読む |
| `unknown` | 未確認 | 確かめていない |

### era（時代背景）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `python-sidecar` | Python のサイドカー | 書いた時点のバックエンドは Python のサイドカーだった。0.4.x までの構成で、Rust の中核を唯一のバックエンドにした変更（2026-11-16、`8f186f6c`）より前に書いた |
| `rust-core` | Rust の中核 | 書いた時点で、Rust の中核（`native/core`）が唯一のバックエンドだった（0.5.0 からの構成） |

`python-sidecar` の ADR は、実装を Python のモジュール名や `src-python/` のパスで書いていることがある。いまの実装は、`native/` の各クレートの README にある Python との対応表で引ける。新しい時代の値が要るときは、この表と `tools/adr_catalog.py` の `ERA` に同時に足す。

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

[ADR-014: 内部識別子を ASTAROT にそろえ、設定とモデルを引き継ぐ](adr-014-internal-identifier-migration.md)は2026-11-19に採用した。ADR-011 の P2 にあたる。アプリ ID、保存先、Windows のインストール先とレジストリのキー、実行ファイル名、Linux のパッケージと音声経路、資格情報の名前、環境変数、配布物の名前を、0.6.0 で ASTAROT の名前へ移す。判断の項目は Issue #635 の決定のとおりである。Windows のインストール先を移すこととレジストリのキーを変えることは、#635 で推奨した案と逆の決定である。どちらも移行の処理（フォルダーを移すことと、旧のキーを読んで新しいキーへ移すこと）と一緒に入れる。移せないときは旧の場所と名前で動き続け、旧の名前は 0.6.x の間は読む。更新確認とテレメトリの送信先、チャット欄検出モデルの ID、設定と IPC と OSC の契約は変えない。実装は 0.6.0 で行い、12 の PR に分ける。

[ADR-016: 利用者向けのサイトの土台を VitePress から Rspress（React）に替える](adr-016-user-guide-site-on-rspress.md)は2026-11-20に採用した。サイトの再設計（PR #701）の決定のうち、土台を VitePress のままにし部品を Vue で作るという前提だけを置き換える。アプリの UI と、部品を寄せる先の shadcn/ui が React なので、部品と知見を React にそろえる。配布済みのアプリが開く URL とアンカー、日英、全文検索、GitHub Pages への公開は保つ。Rspress は既定の言語のページを接頭辞なしで出すので、`/` だけを受け持つ既定の言語を置いて `/ja/` と `/en/` を保つ。

[ADR-017: 画面から中核まで通す試験を Playwright の結合テストにし、配布物で通す試験だけを E2E と呼ぶ](adr-017-integration-tests-through-the-core.md)は2026-11-20に採用した。試験を、単体と契約（Vitest と Rust）、結合テスト、E2E の 3 つの層に分ける。結合テストは、画面を操作して中核と Rust のクレートを通り、外への出口と画面の結果までを確かめる試験で、Playwright で `tests/integration/` に書き、すべての PR で Linux と Windows、Chromium と WebKit で流す。画面の側は Tauri の公式の偽物で中核とのやり取りだけをホストへ流し、中核の側は試験の道具の専用のクレートが偽物の `Services` で中核を起動する。E2E は、配布物の形で殻と OS を通す試験だけを指す。

[ADR-018: おしゃべりAIは外部の対話サービスにつなぎ、アプリは対話のモデルを動かさない](adr-018-talk-ai-through-external-services.md)は2026-11-22に提案し、2026-11-23に採用した（PR #969）。Issue #388 の「おしゃべりAI」の相手を、クラウドのリアルタイム API（OpenAI Realtime、Gemini Live）と、利用者が立てる vLLM-Omni のサーバーに分け、どちらもアプリの外のサービスとしてつなぐ。アプリは対話のモデルもその推論のランタイムも同梱せず、取得もしない。ADR-012 の 2.2 の「外部の翻訳サービスと LLM のサービス」と同じ扱いで、ADR-012 の例外ではない。アプリは、画面と声を送る前の同意、送っている間の表示、送る量の制御、止めたら送らないことを受け持つ。

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

ADR 001〜003 の本文は原文のままで、分けるときに足したのは移行と状態の注記だけである。ADR 004〜013 は `git mv` で移し、移すときに変えたのは、ディレクトリが変わって切れるリンクの行き先だけである。その後、すべての ADR の冒頭に front matter を足した。
