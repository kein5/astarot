# Windows の配布物の一本化（#288）

Issue #288「CPU/CUDA 2バリアント解消」の要件、決定、受け入れ条件の正本は、Issue の本文と Issue に付いた決定のコメント（2026-11-14〜11-15、2026-11-18〜11-19）です。この文書は 2026-11-18 の develop（0.5.1 の後）での実装の状態と、残りの作業の手順をまとめたものです。2026-11-19 に残りの判断がすべて決まりました（「決まったこと」）。実装の計画と PR の分け方は Issue のコメント（2026-11-19）にあります。

関係する記録は次のとおりです。

- [中核への統合](core-integration.md)の「判断が要ること」。ローカル翻訳の残り（1）、ONNX Runtime の配り方（2）、音声認識の VAD（13）、CUDA 版（20）、`src-python/` を消す時期（27）、ローカル翻訳の計測（34）
- ローカル翻訳の実行プロバイダと量子化の形: [`native/translate-onnx/README.md`](../../native/translate-onnx/README.md)
- ONNX への変換と CTranslate2 との比較: [`tools/translation_onnx/README.md`](../../tools/translation_onnx/README.md)
- [推論の実行基盤の比較](inference-runtime-comparison.md)、[対応環境の検証の記録](platform-verification.md)
- [ローカル翻訳の GPU と公開の準備](local-translation-gpu-2026-11-18.md)（DirectML で翻訳のグラフが動くようにした直しと、モデルの公開の道具）

## 受け入れ条件の状態

| 受け入れ条件 | 状態 | 根拠 |
|---|---|---|
| Windows の配布物が単一パッケージで、CPU と CUDA の区別がない | 満たす（次の版から） | 0.5.1 の `VRCT-VOX.zip` と `VRCT-VOX_cuda.zip` は同じ 729 個のファイル（展開して 102,141,609 バイト）でした。中身が違うのは別々にビルドした `vrct-vox.exe` と `_internal/build/vrct-rvc-worker.exe` の2つで、大きさは同じでした。判断 3 で CUDA 版をやめ、リリースの工程は `VRCT-VOX.zip` だけを作ります（「C. パッケージの一本化」） |
| NVIDIA、AMD、Intel の各 GPU で、音声認識とローカル翻訳の GPU 実行を実測 | 未実施 | 2026-11-15 の決定で 0.4.0 の前提から外した。計画は「GPU ベンダーの実測の計画」。ローカル翻訳は GPU で動かす手段がまだない（判断 5） |
| 既存利用者の設定が引き継がれ、faster-whisper の廃止の案内がある | 満たす（0.3.0 から） | 「既存の利用者への配慮」 |
| 同梱物に CTranslate2 と CUDA のライブラリがない | 満たす（0.5.0 から） | 0.5.0 で Python を配布物から外した。2026-11-18 から、配布物の検査（`tools/distribution_policy.py`）が CTranslate2 と CUDA の数学ライブラリを見つけると候補を止める |

## A. 音声認識の棚卸し（faster-whisper と speech.cpp）

faster-whisper のエンジンは 0.3.0（2026-11-15、#306）で除きました。下の表は 2026-11-14 の棚卸し（Issue のコメント）を、0.5.1 の中核に合わせて書き直したものです。「同等にできない」とした項目は 2026-11-14 の決定で廃止しました。

| 機能 | faster-whisper（0.2 まで） | speech.cpp（0.5.1 の中核） | 判定 | 扱い |
|---|---|---|---|---|
| モデルの大きさの選択 | 9 種。tiny、base、small、medium、large-v1〜v3、large-v3-turbo、large-v3-turbo-int8 | Whisper は動かない。Qwen3-ASR 0.6B と 1.7B（30 言語）、Parakeet TDT 0.6B v3（欧州の 25 言語）、日本語専用の 3 つ（ReazonSpeech v2、Parakeet TDT-CTC 0.6B ja、Haas-ja v1.0）、Nemotron 3.5 Transcribe（40 言語、大型）から選ぶ | 同等にできない | 廃止（決定 2026-11-14） |
| 小さいモデル | tiny は約 75 MB、base は約 145 MB | 最小で日本語専用 0.35 GB、多言語 0.51 GB | 同等にできない | 廃止に含む。性能の低い CPU で実用になるかは計っていない |
| 対応する言語 | アプリの言語の表で 69 言語 | Qwen3-ASR で 30 言語、Parakeet v3 を足して 38 言語 | 31 言語が同等にできない | 廃止（決定 2026-11-14） |
| 言語の指定 | できる | できる。モデルが受け付ける言語だけ。日本語専用のモデルは日本語だけ | 同等 | ― |
| 言語の自動判定 | できる。確からしさ（`language_probability`）で候補の中から選んでいた | Qwen3-ASR などは `auto` で判定し、判定した言語で翻訳の向きを決める。確からしさの値はない。言語を判定しないモデル（日本語専用のモデルなど）は `auto` を断る（`realtime_language_auto_unsupported`） | 一部同等 | 候補の中から選ぶ処理はない。言語の判定の細部は #278 の区切り 3-3 |
| 信頼度のしきい値（`avg_logprob`、`no_speech_prob`） | 設定できる | speech.cpp の答えに値がない | 同等にできない | 画面だけを廃止。設定の値と IPC は、OpenAI 互換のクラウドのエンジンが使うので残す（決定 2026-11-14） |
| 繰り返しの抑制（`no_repeat_ngram_size`） | 設定できる | 当たるオプションがない | 同等にできない | 廃止（決定 2026-11-14） |
| 計算デバイスと計算型 | CPU と CUDA（NVIDIA だけ）。計算型も選べる | CPU と Vulkan（NVIDIA、AMD、Intel）。精度はモデルの量子化（Q8_0 など）で選ぶ | 置き換えた | 計算型の設定は廃止（決定 2026-11-14）。GPU は speech.cpp のサーバの設定で選ぶ |
| VAD との連携 | アプリの Silero VAD で区切った音声を渡す | リアルタイム認識ではサーバの Silero VAD（GGUF。モデル取得のカタログの `silero-vad`）が区切る | リアルタイムは同等 | クラウドのエンジンの録音の VAD は、0.5.0 で中核に移したあと動いていない（core-integration の 13。#278 の区切り 3-4）。faster-whisper の置き換えとは別の問題 |
| リアルタイム認識 | 区切りごとに1回認識する。途中経過は伸びていくバッファを送り直して出す | Realtime（WebSocket）で途中経過を逐次受け取る | 同等以上 | Python との遅れの比較は #278 |
| モデルの取得 | Hugging Face のコミットに固定し、全ファイルの SHA-256 を確かめる | モデル取得のカタログに版、大きさ、SHA-256、ライセンスを固定する | 同等 | ― |
| 起動のしかた | エンジンを選ぶだけで、サイドカーの中にモデルを読み込む | 別のプロセスのサーバ。スイッチを入れたときに同梱のサーバを起動するかを設定で選べる（`REALTIME_ASR_SETTINGS.start_server`、既定はオン） | 仕様を変えた | 決定 2026-11-14 の 3 |

speech.cpp にだけある機能は語彙の指定と話者の区別です。

## 既存の利用者への配慮

設定の引き継ぎ、お知らせ、古い Whisper の重みの削除は 0.3.0 から入っていて、0.5.0 で中核に移しました。

- 保存した設定の `LOCAL_ASR_MIGRATION` が 2 より小さいとき、設定を一度だけ引き継ぎます（`native/core/src/config/mod.rs` の `migrate_local_asr`）。
  - エンジンが `Whisper` なら `SpeechCpp`（ローカル）にします。Windows ではリアルタイム認識の接続先を同梱のサーバにします。お知らせの印（`LOCAL_ASR_NOTICE_PENDING`）を立てます。
  - 引き継ぐ前の設定を `config.json.before-migration-<段階>` に写します。API キーは写しません。
  - 保存した段階で判断するので、0.2 以前から 0.5 系へ直接更新しても同じように引き継ぎます。
  - 試験は `native/core/tests/lifecycle.rs` と、Python の結果と照らし合わせる `native/core/tests/config_reference.rs`（Windows と Linux）です。
- 起動時に一度だけお知らせを出します（`src-ui/views/app/_app_controllers/LocalAsrNoticeController.jsx`）。Whisper がなくなったことと、必要なモデル（音声認識と VAD）が取得済みかを示し、設定を開くボタンを置きます。モデルは取得の画面でライセンスと大きさを見せ、同意を得てから取ります。お知らせから自動では取得しません。
- 古い Whisper の重みは、`<データ>/weights/whisper/` の下の 9 種の名前のフォルダだけを数え、利用者が頼んだときだけ消します（`native/core/src/controller/files.rs`、設定の `OldWhisperWeights.jsx`）。リンクとジャンクションはたどりません。設定の「音声認識（ASR）」とお知らせの両方から消せます。
- 旧 CTranslate2 の翻訳の重みは、0.5.0 から起動の後に知らせずに消します（core-integration の「決まったこと」）。知らせるかどうかは core-integration の 26 で未決です。
- 廃止は 0.3.0 のリリースノートの Breaking Changes と、マニュアルの「以前の版でWhisperを使っていた場合」（`site/ja/features/transcription.md`）で知らせています。
- CUDA 版を入れていた利用者は、0.5.0 への更新で `_internal` が置き換わり、`_internal/nvidia` が消えます。次の更新からは標準版として更新します（core-integration の 20）。

#278 の区切り 3-2 には、「ローカルの音声認識への移行の知らせ」を中核を通して確かめる試験が入っています。お知らせや引き継ぎの動きを変えるときは #278 と合わせます。この文書の作業では引き継ぎのコードを変えていません。

## C. パッケージの一本化の計画

### いまの状態

- `backend_cuda.spec` は、0.5.0 で Python を配布物から外したとき（`8f186f6c`）に `spec/backend.spec` と一緒に消えました。
- `cuda` extra（`nvidia-cublas-cu12`、`nvidia-cudnn-cu12`）は `pyproject.toml` と `uv.lock` に残っています。使うのは開発用の `.venv_cuda`（`bat/install.bat`、`mise run setup:app`）だけで、配布物には入りません。`src-python/` の Python のバックエンドを、比べる相手として動かすためのものです。
- 0.5.1 の Windows の ZIP は約 36 MB、展開して約 0.1 GB です。0.4 の CPU 版は約 0.4 GB、CUDA 版は約 1.7 GB でした。音声認識の GPU 対応（speech.cpp の Vulkan 版）は入っています。ローカル翻訳の GPU 対応は、判断 5 の決定（#630 の判断 2 (c)）に沿って #277 で入れます。

### CUDA 版をやめた（判断 3、2026-11-19）

CUDA 版の ZIP には、0.5.0 から標準版にないものが何もありませんでした。判断 3 で CUDA 版をやめ、次のように変えました。

- **名前**: Windows の配布物は `VRCT-VOX.zip` の1つです。新しい名前は付けず、標準版の名前をそのまま使います。ASTAROT への改名は、内部識別子の移行（#635）で扱います。
- **インストーラー**（`src-tauri/nsis/template.nsi`）: 版を選ぶ画面、`PACKAGE_SHA256_GPU`、GPU 版の容量の目安をなくしました。`/EDITION=` は受け付けて読みません。0.5 までのアプリが更新のときに `/EDITION=gpu` を渡しても、`VRCT-VOX.zip` を取ります。`/VERSION` で 0.5 以前の版を入れるときも同じです。試験は `tests/installer/windows_update_scenarios.py` の「`/EDITION=cpu` と `/EDITION=gpu` が同じ ZIP を取る」場合です。
- **ハッシュの組み込み**（`tools/installer_package_hashes.py`）: `--package` の1つだけで、`PACKAGE_SHA256` を書きます。
- **リリースの工程**: `release.yml` は `build` と `candidate` の2つのジョブです。`tools/release_candidate.py` は Windows の候補に `VRCT-VOX.zip` とインストーラーだけを求めます。`package.json` の `release-cuda` と `release-all` はなくしました。
- **アプリ**: `src-tauri/src/app_update.rs` は `/EDITION=` を渡しません。`_internal/nvidia` の判定もなくしました。中核の `/run/update_cuda_software` は IPC の契約なので残し、`/run/update_software` と同じ動きです。中核の `SoftwareUpdates::install` からエディションの引数を外しました。UI は `/run/update_software` だけを呼びます。設定の左下の版の表示から「CUDA」の印を外しました（計算デバイスの一覧に CUDA があると出ていた印で、配布物の名前と紛れるため）。
- **サイト**: ダウンロードの表示（`releases.mjs`）は、CUDA 版のない新しいリリースと、CUDA 版のある古いリリースの両方を扱えます（`tools/check_site_downloads.mjs` に両方の場合があります）。導入の案内（`site/*/guide/install.md` など）から版の選択と CUDA 版の説明を外すのは、CUDA 版のない最初のリリースに合わせて別の PR で行います。サイトは develop から公開するので、先に変えると今のリリースの案内と食い違うためです。

新しい版から `VRCT-VOX_cuda.zip` はリリースに載りません。それを取りに行く外部の手順は動かなくなるので、変更には `!` と `BREAKING CHANGE:` を付けました。0.5 系のリリースの `VRCT-VOX_cuda.zip` はそのまま残ります。

### `cuda` extra を消す時期

`src-python/` を消すとき（core-integration の 27。0.6.0 で中核への移行が終わったとき）に、`pyproject.toml` の `cuda`、`uv.lock`、`.venv_cuda`（`bat/install.bat`、`mise.toml`、`.gitignore`、`pytest.ini`、`vite.config.js`、`docs/development.md`）を一緒に消します。core-integration の「Python の削除に伴うもの」に入っています。配布物に関係しないので、先に消す理由はありません。

## GPU ベンダーの実測の計画

受け入れ条件の「NVIDIA、AMD、Intel の各 GPU で実測」の根拠を作るための計画です。2026-11-15 の決定により、リリースを止める条件にはしていません。

### 対象

| 部品 | 実行基盤 | NVIDIA | Intel | AMD | GPU なし |
|---|---|---|---|---|---|
| 音声認識（同梱の speech.cpp 0.11.0、Vulkan 版） | Vulkan | 計る（単体 GPU） | 計る（内蔵 GPU） | 未検証（計れる機器がない） | 計る（Vulkan のドライバーを読ませない模擬） |
| ローカル翻訳（`native/translate-onnx`） | DirectML | 計る | 計る | 未検証 | ― |
| | CUDA | 計る | ― | ― | ― |
| | OpenVINO | ― | 計る | ― | ― |
| | CPU（基準） | ― | ― | ― | int8 と float32 は計測済み（`tools/translation_onnx/README.md`） |

### 計る前にそろえるもの

1. 音声認識: 同梱の speech.cpp と、カタログの Qwen3-ASR 0.6B Q8_0 と Silero VAD（同意を得て取得します）。計測の道具は #278 の `native/core/examples/live_asr.rs` です。中核をアプリと同じく起動し、デバイスと同じ間隔で音声を流します。#278 のマージを待ちます。
2. ローカル翻訳: ONNX の翻訳モデルは公開していないので、`tools/translation_onnx/export.py` で作ります。元のモデルの取得に同意が要ります。GPU の実行プロバイダを含む ONNX Runtime は同梱していません（同梱は CPU 版）。DirectML 版（NuGet の 1.24.4）、OpenVINO 版、CUDA 版を `ORT_DYLIB_PATH` で指します。道具は `vrct-translate` と、それを動かす `tools/translation_onnx/compare.py` です。`vrct-translate` は `--device directml:<番号>` などで機器を選び、実際に動いた実行プロバイダと CPU への切り替えを標準エラーに出します。DirectML では、2026-11-18 より後の `export.py` で作ったフォルダを使います（前のものは `Reshape` の `allowzero=1` のため動きません）。計る前に、`tools/translation_onnx/tiny.py` の小さなモデルと `tests/real.rs` の `a_device_decodes_as_the_cpu_does` で、その GPU で CPU と同じ訳になることを確かめられます。

### 手順

- speech.cpp では、`speech devices --json` の名前（`Vulkan0` など）をサーバの設定で指定して GPU を選びます。内蔵 GPU と単体 GPU がある PC では `auto` が内蔵 GPU を選ぶことがあるので、両方を名前で指定して別々に計ります。DirectML ではアダプターの番号で選びます。番号と GPU の対応を確かめてから記録します（`inference-runtime-comparison.md` では速さから推定しただけです）。
- GPU なしの構成は `VK_LOADER_DRIVERS_DISABLE=*` で Vulkan のドライバーを読ませずに模擬し、CPU に戻ることを確かめます。Direct3D 12 の変換層だけが残る構成も1回試します。この構成では、モデルは読めて最初の計算で失敗した記録があります（`windows-voice-report.md`）。
- シェーダーのキャッシュを空にした冷えた起動の1回目と、2回目以降を分けて計ります。
- 音声は、Windows の音声合成で作った日本語と英語の文（それぞれ 5 文以上）を、デバイスと同じ間隔で流します。人の声ではないことを記録に書きます。文字の誤り率は計りますが、認識した文はログにも記録にも出しません。
- 翻訳には、既存の比較と同じ会話を想定した日本語 30 文と英語 30 文を使います。M2M100 418M の float32 と float16 を GPU で、int8 を CPU（基準）で動かします。ビーム数はモデルの設定に従います。

### 計るもの

- 音声認識: 発話の終わりから確定まで（中央値と 90 パーセンタイル）、最初の途中経過まで、文字の誤り率、サーバの起動から準備ができるまで（冷えた1回目と2回目）、GPU メモリーの最大、プロセスごとの CPU 使用率、CPU への切り替えや失敗の知らせ。
- ローカル翻訳: 1 文の時間（読み込みを除く）、読み込みの時間、CPU の int8 との訳文の一致数と BLEU、GPU メモリー、実行プロバイダから CPU への切り替え（`/run/translation_compute_device_fallback`）の有無、メモリー不足を文面で見分けられるか（core-integration の 30）。
- 同時に使うとき: 音声認識、ローカル翻訳、読み上げを同じ GPU で動かしたときの遅れ（core-integration の 34）。

### 合格の目安（案）

- 選んだ GPU で実際に動いたこと。speech.cpp のログの機器名と `vrct-translate` が出す実行プロバイダで確かめ、CPU への切り替えの知らせが出ないこと。
- 結果が CPU と同等であること。音声認識は文字の誤り率の差が 0.01 以内、ローカル翻訳は BLEU の差が既存の比較（CTranslate2 との差 −0.48〜+0.27）と同じ幅に収まること。
- 音声認識の確定までの遅れが、同じ PC の CPU より長くならないこと。

数値の目安は案で、決まっていません。

### 記録のしかた

版、コミット、OS とその版、GPU の型番、ドライバーの版、接続（内蔵、単体、外付け）、GPU メモリーの量、同時に動いていたものを書きます。結果は[対応環境の検証の記録](platform-verification.md)に足してから、マトリクスの欄を変えます。PC の持ち主が分かる情報は書きません。ある PC での値を一般の保証にはしません。

AMD の GPU は計れる機器がないので、未検証のまま残します（判断 6）。

## 決まったこと（2026-11-19）

Issue #288 と PR #616、PR #630 に記録した決定です。下の「判断が要ること」は、決める前の選択肢の記録として残します。

| 判断 | 決定 | 実装 |
|---|---|---|
| 1. speech.cpp のバックエンドの構成 | (c)。GPU ベンダー専用のビルド（CUDA など）を、同意を得て取得できる形にする。同梱はしない。同梱の基本の構成（Windows は Vulkan 版 1 つ、Linux は Vulkan 版と CPU 版）は保つ | 上流は CUDA 版を配っていない（上流の `docs/install.md` で「ビルドはできるが確かめも配布もしていない」）ので、このプロジェクトでビルドして配る。ビルドの工程と、同意を得て取得する仕組みに分けて入れる |
| 2. NLLB の差し替え | (a)。ライセンス（CC-BY-NC-4.0、非商用）と大きさを見せて、同意するかを選ばせる形で公開する。既定は M2M100 のまま（#630 の判断 78） | #277 |
| 3. CUDA 版のパッケージ | やめる | 「CUDA 版をやめた」 |
| 4. faster-whisper の廃止の告知と移行 | 告知と移行の画面は残さない。引き継ぎと古い Whisper の重みの削除の画面も残さない（0.6.0 で外す） | 「既存の利用者への配慮」を外す PR |
| 5. ローカル翻訳を GPU で動かす手段 | 既定の配布は CUDA 版と CPU 版。DirectML は任意の追加のダウンロードで、同梱しない（#630 の判断 2 (c)） | #277 |
| 6. AMD の GPU の実測 | 利用者からの報告を募る。テレメトリは広げない。報告する人の心理的な障壁と実際の手間を下げることを必須とする（自動で計測して結果を出す道具を用意する、送る内容を事前に全部見せる、個人を特定する情報を含めない） | 計測の道具と報告の様式を入れる PR |

## 判断が要ること（決める前の記録）

1. 同梱する speech.cpp のバックエンドの構成（Issue の未決事項の 1）: いまは Windows が 0.11.0 の Vulkan 版 1 つ（同じ実行ファイルで CPU でも動く）、Linux が Vulkan 版と CPU 版の 2 つ（Vulkan のローダーがなければ CPU 版）です。案は (a) このまま、(b) Windows にも CPU だけのビルドを足す（Vulkan のドライバーが壊れた PC の逃げ道。配布物が増える）、(c) GPU ベンダー専用のビルド（CUDA など）を同意を得て取得できるようにする（同梱はしない）、です。決める材料は、実測の計画で得る NVIDIA と Intel の結果です。
2. NLLB の差し替えの検討（Issue の未決事項の 2）: ONNX にしたときの BLEU の差は、5 つのモデルで −0.48〜+0.27 でした。NLLB 3.3B は英語へ訳す 4 方向がそろって少し低い結果でした（#310）。NLLB は CC-BY-NC-4.0 なので既定にしません。既定は M2M100 418M（MIT）です。案は (a) NLLB を ONNX にして公開し、非商用の同意を残す、(b) 公開せず、利用者が自分で変換して置く（自分のモデルの置き場所がある）、(c) ほかのモデルへの差し替えを調べる、です。公開するかどうかは core-integration の 1 と一緒に決めます。#277 の範囲です。
3. CUDA 版のパッケージ（core-integration の 20）: 案は (a) 同じ中身で作り続ける、(b) やめて、インストーラーの GPU の選択を標準版に読み替える、です。(b) の手順は上の「手順」にあります。(a) でも、インストーラーの説明文と容量の目安は直します。
4. faster-whisper の廃止の告知と移行期間（Issue の未決事項の 3）: 実際には 0.3.0（2026-11-15）で、移行期間を置かずに除きました。告知は 0.3.0 のリリースノート、起動時に一度だけのお知らせ、マニュアルで行いました。残る判断は、引き継ぎ（`LOCAL_ASR_MIGRATION` の段階 2）と古い Whisper の重みの削除の画面をいつまで残すかです。案は (a) 当面残す（コードは小さい）、(b) 区切りの版で外す（外した後に 0.2 以前から更新した利用者は、エンジンが引き継がれない）、(c) 重みの削除の画面だけ残す、です。
5. ローカル翻訳を GPU で動かす手段（core-integration の 2 の残り）: 同梱は CPU 版の ONNX Runtime だけなので、受け入れ条件の「ローカル翻訳の GPU 実行」は、これが決まるまで配布物では確かめられません（ライブラリを手で置けば計れます）。案は core-integration の 2 の (b) DirectML 版を同梱する（約 18.5 MB 増え、ONNX Runtime が 1.24.4 に下がる）と、(c) 同意を得てから取得する、です。#277 の範囲です。
6. AMD の GPU の実測をどう埋めるか: 案は (a) 未検証のまま、マトリクスに「未検証」と書く（いまの形）、(b) 利用者に計測の手順を渡して報告を受ける、(c) AMD の GPU のある環境を用意する、です。

## 残っている作業

- サイトの導入の案内から CUDA 版を外す（CUDA 版のない最初のリリースに合わせる）。
- 判断 4、6、1 の実装（「決まったこと」の表）。
- #278 のマージの後に、音声認識の実測を行います。翻訳のモデルを作ったら、ローカル翻訳の実測を行います。
- `site/*/guide/requirements.md` の Linux のアプリの大きさ（約 0.5 GB、展開して約 1.3 GB）と、「すべての機能をそろえるなら Windows で約 11 GB」の目安は、Python を同梱していたころの値のままです。0.5.1 の Linux の tar.gz は約 52 MB です。Python の同梱をやめた影響（#285）なので、#288 の作業では直していません。
