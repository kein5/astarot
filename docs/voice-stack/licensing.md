# 配布境界と原典

2026-10-27に提供されたevidence mapと以下の一次資料を参照。
この冒頭表は初期調査時点の記録。後日、ユーザー承認済みの開発用モデル取得とSeed外部worker実装を行った。配布許可とは区別し、各PoC報告と下記追記を参照。

2026-10-31に`v0.1.0-beta.1`（プレリリース）を公開した。Linux配布物（tar.gz・AppImage）には固定speech.cpp 0.10.0の実行ファイルと通知を同梱した。Windows版にはこの時点で同梱していない（2026-11-07に同梱を追加。下記参照）。配布物のLGPL/GPL部品は[NOTICE](../../NOTICE.md#lgpl-and-gpl-components-in-vrct-vox-builds)に記載。以下の各節は日付ごとの記録で、「未公開」「次工程」などはその時点の状態を表す。

| 対象 | 確認した根拠 | 今回の扱い |
|---|---|---|
| VRCTコード | [LICENSE](../../LICENSE), [NOTICE](../../NOTICE.md) | MIT帰属を維持 |
| upstream OCR検出重み | [モデルライセンス](https://github.com/kein5/astarot/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.txt) | fork成果物から除外。0.2.0でリポジトリからも削除（0.1.0までのコミットには残る） |
| speech.cpp | [検証済みv0.11.0のMIT](https://github.com/nyosegawa/speech.cpp/blob/v0.11.0/LICENSE) | 2026-10-29承認後、固定CPU/Vulkan実行ファイルと依存通知の配布部品を作成・検証。Linux配布物に同梱し、0.1.0-beta.1で公開。2026-11-15に0.11.0へ更新。下記追記参照 |
| Irodori v4.1 Small MF | [モデルカード](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small-MF) | 日本語のみ。MIT表示に加え、声の本人の明示同意・なりすまし/誤情報禁止の記載を確認。ユーザー管理のvoiceだけ利用 |
| Irodori Large | [モデル説明](https://github.com/nyosegawa/speech.cpp/blob/main/docs/models/irodori-tts.md) | Smallと条件を混同しない。今回は同梱・検証なし |
| Qwen3-TTS | [モデル説明](https://github.com/nyosegawa/speech.cpp/tree/main/docs/models) | ユーザーが選んだ重みの条件・hashを実機導入時に記録。モデル取得なし |
| Seed-VC Realtime | [GPL-3.0](https://github.com/jiaheguo521/seed-vc-realtime/blob/main/LICENSE) | 開発用外部workerを統合。`integrations/seed_vc`の派生コードはGPL-3.0-only表示。承認済みモデルでPoC実施、最終配布条件と対応ソースの整理は未完了 |
| Beatrice | [v1.1 JVS版条件](https://github.com/w-okada/voice-changer/blob/master/server/voice_changer/Beatrice/README.md) | 商用利用禁止・再配布時許諾の記載。これをv2全モデルへ一般化しない。版/モデル別条件はP2ゲート |

CPU/CUDA PyInstallerの展開済みTOCから `chatbox_yolox_tiny.onnx` を除外し、
Tauri buildとZIP作成前にも古い成果物の混入を拒否する。CIでZIP/sidecarを検査。
モデル不在時、既存のOCRチャット吹き出し検出は利用不可（他の音声・翻訳機能は独立）。
`tools/check_voice_distribution.py` は配布物のパスを受け取り、禁止モデルを見つけると失敗する。

Forkの製品名/publisher/更新配布先はP5の未完了ゲート。現行公式リリース用workflowを
forkの公開に使える状態とは主張しない。この作業ではタグ・push・公開を行わない。
ライセンス台帳は同梱許可を与えるものではない。追加モデルは個別に確認する。

## 2026-10-29 fork配布境界の追加検証

冒頭の「P5未完了」記述のうちfork identity/公開先分離は今回実装。
CPU/CUDA specのOCR/rapidocr全体収集を廃止し、
OCR重みを展開済みdatas/binariesのsource/destination両方で除外する。
元LICENSE/NOTICE、OCRモデル通知を明示収集。ZIP/NSIS検査は失敗時に配布処理を止める。
Windows最終実物、Linux製品package、全同梱依存の最終ライセンス監査は未完了。
モデル取得承認を再配布承認へ読み替えない。speech.cpp GUI管理はP5-Bで実装済み、未公開。

## Windowsインストーラーの通知とzeroconfの版（2026-11-06）

NScurlと依存部品の通知7点は、`src-tauri/nsis/licenses/nscurl/`の原文を保持し、
NSISインストーラー内の`$PLUGINSDIR/licenses/nscurl/`へ同梱する。
アプリ本体の取得に失敗した場合も、setup.exeを7-Zipで展開して読める。
WindowsのZIP（`VRCT-VOX.zip`。0.5まではCUDA版のZIPも）にも`_internal/licenses/nscurl/`として収集し、
[NOTICE](../../NOTICE.md#windows-installer-download-component)に場所を記載する。
最終NSIS成果物の検査では、この7点のいずれかが欠けていれば失敗する。
Windows実物の展開結果と、同梱DLLの版に対応する通知一式かどうかの確認は別途必要。

zeroconfのNOTICEは、`uv.lock`に固定された0.152.0と、そのソース配布物のURLへ訂正した。
各specの`.py`収集設定は維持する。凍結後のファイル構成の確認や、配布条件全体の監査を
完了したという意味ではない。

配布物の検査では、ZIPとtar内のZIPを拡張子や先頭の署名だけでなく末尾の情報でも識別する。
ネストしたZIPは1個128 MiBまで、ZIP・tarそれぞれの検査全体は展開後16 GiB・10万エントリーまで、
ZIPの入れ子は4段までとし、上限を超えた場合は検査失敗とする。
OCRのディレクトリー情報は入れ子の中でも引き継ぎ、ホスト上の作業ディレクトリー名は判定に使わない。

## Managed route追加分（2026-10-27）

制御helper `native/voice-gate/main.c` はMITの新規コード。system `libpipewire-0.3` に動的リンクし、
音声推論コード・モデル・独自音声daemonを同梱しない。
PipeWireの [COPYING](https://github.com/PipeWire/pipewire/blob/master/COPYING) と
[公開header](https://github.com/PipeWire/pipewire/blob/master/src/pipewire/pipewire.h) のMIT表示を確認。
今回はソースcheckoutとsystemライブラリでの検証で、helperのバイナリ配布は未整備。
バイナリ配布時はPipeWire/SPA header由来のコードを含め、利用版の著作権・許諾表示を同梱する。
VCモデルの採用条件はこの追加によって変わらない。

## Realtime ASR用resampler（2026-10-28）

`soxr==1.1.0`を明示依存に追加。Python wrapper固定commit
`91479780e687fa994daabcff074e5960dc0bd4e2`、同梱modified libsoxr固定commit
`a66f3eeeeb62a32403ff143b756eed92b1ec6b62`。双方LGPL-2.1-or-later。
PFFFTは付属BSD系noticeを保持する。PyAV/FFmpegをこの変換処理に追加利用しない。

Python3.11実wheelのsha256:

- Linux x64 manylinux2.27/2.28: `3da87e3ffa3e41823d873b051c7ecb2acebd8d1b6b46b752f5facf10a0d84ab9`。
- Windows x64: `ae30c48ac795378cf23ba3c7c640b8ff794af714ac388b9fd6b31a40b39e6e86`。

Linux固定wheelはuvでhash照合して導入。両wheelに`COPYING.LGPL`、`LICENSE.txt`、
`LICENSE-libsoxr.txt`、`LICENSE-PFFFT.txt`が実在することを調査で確認した。
Windowsはartifact検査のみ、実行試験ではない。numpy1.26.4との実行はLinuxで確認。

[固定LICENSE](https://github.com/dofuuz/python-soxr/blob/91479780e687fa994daabcff074e5960dc0bd4e2/LICENSE.txt)、
[固定build](https://github.com/dofuuz/python-soxr/blob/91479780e687fa994daabcff074e5960dc0bd4e2/CMakeLists.txt)、
[PyPI固定配布](https://pypi.org/project/soxr/1.1.0/)。native libsoxrは拡張へ静的組込み。
2026-10-31（0.1.0前）: 配布物のLGPL/GPL部品を[NOTICE](../../NOTICE.md#lgpl-and-gpl-components-in-vrct-vox-builds)に列挙し、
対応ソースの入手先、差し替え方法、3年間のソース提供の申し出を記載した。libsoxrは拡張モジュール（別ファイル）として差し替え可能。
LGPLの純Pythonパッケージ`zeroconf`はPYZへ入れず`.py`のまま同梱する。PyAVの公式wheelは12〜18系のLinux/Windowsいずれも
GPLのx264/x265を同梱していたため配布せず、`packaging/pyinstaller-stubs/av`の代用モジュールを使う（0.5.0でPyInstallerの工程と一緒に削除。配布ポリシーの拒否は残す）
（faster-whisperはnumpy配列の入力ではデコードしない）。配布ポリシーがPyAVのネイティブライブラリとx264/x265を拒否する。
nanobind（BSD-3-Clause）の実ビルド版の特定は未了。

## RVC同梱ワーカー（2026-11-15、#275 Phase 3）

RVCの変換は、本家の推論を再実装した`native/rvc-runtime`（MIT、本家コードの複写・翻案なし）を
`astarot-rvc-worker`としてWindowsとLinuxの配布物に同梱して行う。これにより、下の「RVC追加分」以降に書いた
外部のPython実行環境（PyTorch、本家エンジン、`praat-parselmouth`などの依存）と、本家由来のMITコード
（`integrations/rvc/blocks.py`、`loader.py`、`LICENSE.upstream`）は使わなくなり、リポジトリと配布物から削除した。

ワーカーはONNX Runtimeを自分では持たず、実行時に読み込む。ONNX Runtime、CUDAとcuDNNのライブラリ、
基礎モデルは配布物に含めず、利用者の同意を得てから提供元から直接取得する（版・サイズ・SHA-256を
Rustの中核が使う`native/voice-conversion/src/runtime.rs`に固定する。0.4までの`src-python/models/voice_conversion/runtime_setup.py`は
ONNX RuntimeをGitHubから取得していたときの値のまま残す）。

| 取得物 | 取得元 | ライセンス |
|---|---|---|
| ONNX Runtime 1.31.0（NVIDIAのドライバーがあるPCはCUDA 13版、ないPCはCPU版） | NuGetのMicrosoft公式パッケージ（CPU版は`Microsoft.ML.OnnxRuntime`、CUDA 13版は`Microsoft.ML.OnnxRuntime.Gpu.Windows`と`Microsoft.ML.OnnxRuntime.Gpu.Linux`）。2026-11-18まではGitHubのMicrosoft公式リリース | MIT |
| CUDA runtime、cuBLAS、cuRAND、NVRTC（CUDA 13.4 Update 1）、cuDNN 9.26（GPU用だけ） | PyPIのNVIDIA公式wheel（`nvidia-cuda-runtime`、`nvidia-cublas`、`nvidia-curand`、`nvidia-cuda-nvrtc`、`nvidia-cudnn-cu13`）から必要なファイルだけ | NVIDIAのCUDA EULA、cuDNN SLA |
| HuBERT（`hubert_base`の`config.json`と`pytorch_model.bin`）、`rmvpe.onnx` | Hugging Faceの`lj1995/VoiceConversionWebUI`（以前と同じ固定revision） | モデルカードの表示はMIT（本文は空）。HuBERT/ContentVecの上流条件は未確認のまま（同梱しないので取得の形を保つ）。2026-11-15に確認した（下の「#322」の節） |

`rmvpe.onnx`はこの取得で新しく加わったファイルで、同じrevisionの`rmvpe.pt`の代わり。2026-11-15の追加の判断で、
CUDA 12（PyTorch実行環境と同じ12.8系）からCUDA 13へ移し（ドライバー580以降が必要）、NVIDIAのドライバーがないPC向けに
CPU版の実行環境を加えた。CPU版にはNVIDIAのファイルを含まない。新しい実行環境の取得が終わると、同じフォルダーにある
以前のPyTorch実行環境のファイル（venv、python、engine、固定の`rmvpe.pt`など）をアプリが削除する（`remove_earlier_rvc`）。HuBERTはONNXに
変換した物を配らず、取得した`pytorch_model.bin`からワーカーが読み込み時にグラフを組み立てる。

GitHubの`microsoft/onnxruntime`がリポジトリもリリースの資産も404を返すようになったので、2026-11-18にONNX Runtimeの
取得元をGitHubのリリースからNuGetのパッケージに移した。版は1.31.0のままで、ライセンス（MIT）も変わらない。
CPU版のパッケージに入っているライブラリは、GitHubのアーカイブのものとバイト単位で同じ。CUDA 13版のパッケージの
CUDAプロバイダも、GitHubの`gpu_cuda13`版と同じくcuBLAS 13とcudart 13にリンクしていて、固定したNVIDIAのwheelと合う。
同意画面のライセンスのリンクはNuGetのパッケージのLicenseのページにした。GitHubから準備した実行環境は、`lib/`の
ファイルが同じ名前なので導入済みのまま使える（`runtime.rs`の`OrtSource`）。DirectML版はNuGetに1.31.0がない
（最新は1.24.4）が、RVCの取得はDirectML版を使っていない。RVCのワーカーはDirectMLで変換するときに、ローカル翻訳と
共用のDirectML版（下の節）を自分のプロセスに読み込む。新しく取得するものはない。

ワーカーのRust依存（`ort`、`ort-sys`、`libloading`、`prost`、`rustfft`、`serde_json`、`thiserror`、`hound`など）は
MIT、Apache-2.0、ISCなどの許容型ライセンス。配布物へのライセンス文書の同梱方法は、Tauri本体のRust依存と同じく
未整理（残課題）。→ 下の「#322」の節で整備した。

### ローカル翻訳のGPU用のONNX Runtime（2026-11-19、core-integrationの判断2 (c)）

配布物にはONNX RuntimeのCPU版だけを入れる。ローカル翻訳をGPUで動かすためのONNX Runtimeは配布物に含めず、
上の実行環境と同じ仕組みで、利用者の同意を得てから提供元から取得する（`runtime.rs`の`onnx_cuda_runtime`と
`onnx_directml_runtime`。保存先は設定フォルダーの`vc_runtimes/onnxruntime-cuda`と`vc_runtimes/onnxruntime-directml`）。
アプリは、翻訳の処理デバイスにその版が選ばれているときだけ、起動時に同梱のCPU版の代わりに読み込む。チャット読み取りも
同じライブラリを使う。RVCのワーカーも、DirectMLで変換するときはDirectML版を使う（`native/rvc-runtime/README.md`）。

| 取得物 | 取得元 | ライセンス |
|---|---|---|
| CUDA版（NVIDIAのドライバーがあるとき）: ONNX Runtime 1.31.0（CUDA 13版）と、上の表と同じCUDAとcuDNNのライブラリ | RVCのGPU用と同じNuGetのパッケージとPyPIのwheel（同じ版・SHA-256）。基礎モデルは含まない | MIT、NVIDIAのCUDA EULA、cuDNN SLA |
| DirectML版（Windowsだけ）: ONNX Runtime 1.24.4（DirectML版）の`onnxruntime.dll`と`onnxruntime_providers_shared.dll`、DirectML 1.15.4の`DirectML.dll` | NuGetのMicrosoft公式パッケージ`Microsoft.ML.OnnxRuntime.DirectML` 1.24.4と`Microsoft.AI.DirectML` 1.15.4 | ONNX RuntimeはMIT。DirectMLはMicrosoft Software License Terms（DirectML） |

DirectMLのライセンス（2026-11-19にNuGetのLicenseのページで確認）は、アプリやサービスに入れて配布することを認め、
使えるのはWindowsとXboxだけとしている。2aに、ソフトウェアが利用者と使い方の情報を集めてMicrosoftに送ることがある、
という定めがある。オプトアウトできるのは一部だけとしている。取得の確認の画面にこのことを書いた。DirectML版を同梱しないので、
配布物の義務は生じない。ONNX RuntimeのDirectML版は1.24.4が最後（DirectMLは保守のみ）で、CPU版とCUDA版の1.31.0より古い。

CUDA版は#288の受け入れ条件（配布物にCUDAのライブラリを入れない）に合わせて同梱しない。RVCのGPU用の実行環境を
準備済みなら、同じファイルなので取得し直さずにそれを使う（`cuda_libraries`）。

## アプリ内の更新（2026-11-15、#330）

Tauri本体に`tauri-plugin-updater` 2.14.1を加えた。Windows（x86_64-pc-windows-msvc）とLinux（x86_64-unknown-linux-gnu）のビルドに
新しく入るRustクレートと、その`Cargo.toml`のライセンスは次のとおり（`cargo tree -e normal --target …`で確認）。

| ライセンス | クレート |
|---|---|
| Apache-2.0 OR MIT（いずれか） | `tauri-plugin-updater`、`rustls`、`rustls-pki-types`、`rustls-platform-verifier`、`rustls-native-certs`、`hyper-rustls`、`tokio-rustls`、`getrandom`、`zeroize`、`zeroize_derive`、`openssl-probe`、`filetime`、`tar`、`xattr`、`typed-path`、`windows-registry`、`constant_time_eq`（CC0-1.0／MIT-0／Apache-2.0） |
| MIT | `minisign-verify`、`zip` |
| ISC | `rustls-webpki`、`untrusted` |
| Apache-2.0 AND ISC | `ring` |
| BSD-3-Clause | `subtle` |

`webpki-root-certs`（CDLA-Permissive-2.0）はロックファイルに載るが、WindowsとLinuxのビルドには入らない。
同梱するのはプログラムだけで、証明書のデータやモデルは加えていない。配布物へのライセンス文書の同梱方法は、
Tauri本体の他のRust依存と同じく未整理（残課題）。→ 下の「#322」の節で整備した。
2026-11-16時点では、#344で`webpki-roots`の証明書データがTauri本体に入った（下の「#344」の節）。

## Rust依存のライセンス文と基礎モデルの記録（2026-11-15、#322）

### Rust依存のライセンス文

配布物に入るRust製の実行ファイルは、Tauri本体の`vrct-vox`とRVCワーカーの`astarot-rvc-worker`の2つ。
`native/`の他のクレートは2026-11-15のdevelopではまだどの実行ファイルにも組み込んでいない
（`asr-capture`など`main.c`だけのものはC）。→ #344で`native/core`などが`vrct-vox`に入った（下の「#344」の節）。

`tools/rust_licenses.py`がパッケージを作るときに2つの実行ファイルの依存をロックファイルから求める。
対象の環境（`x86_64-pc-windows-msvc`、`x86_64-unknown-linux-gnu`）で`cargo metadata --filter-platform`を使い、
通常の依存をたどる。手続きマクロは含め、ビルドスクリプトだけの依存と開発用の依存は含めない。
各クレートの公開パッケージの先頭にあるLICENSE・COPYING・NOTICEなどの文書を
`_internal/licenses/rust/<クレート>-<版>/`に写し、一覧を`README.md`と`crates.json`に書く。
写した文書と一覧は、WindowsではPyInstallerのデータとして（`bat/build.bat`、`bat/build_cuda.bat`、`tools/windows_voice_resources.py`）、
Linuxではリソースとして（`tools/build_linux.py`）、どちらもPyInstallerの`_internal`に入る。
→ 0.5.0からはPyInstallerを使わず、`tools/app_resources.py`が同じ`_internal/licenses/rust/`へ写す（下の「Pythonの同梱の終了」の節）。
どちらの検査も`crates.json`がないと失敗する。リポジトリ内のクレート（パス依存）はVRCT-VOX自身のコードで、
`LICENSE`に従うので文書を写さない。

2026-11-15のロックファイルでは、Windowsが313クレート、Linuxが385クレート（リポジトリ内のクレートを含む）。
ライセンスはMIT、Apache-2.0、BSD、ISC、Zlib、Unicode-3.0、CC0-1.0、Unlicenseなどの許容型と、
MPL-2.0の数件（`cssparser`、`cssparser-macros`、`dtoa-short`、`option-ext`、`selectors`、Windowsだけ`dwrote`）。
GPLとLGPLのクレートはない。MPL-2.0のクレートは改変していない。ソースはcrates.ioの同じ版にあり、
そのことを一覧とNOTICEに書いた。

公開パッケージにライセンス文がないクレートが11件あった。上流の対応するコミットの文書か、ライセンスの公式の本文で補い、
出典を`licenses/rust/supplements.json`に記録した（文書は同じフォルダー）。
`pathfinder_geometry` 0.5.1は、パッケージが指すコミットが上流にないので、同じプロジェクトの文書を使った。
`dwrote`と`selectors`は上流にライセンス文のファイルがなく、ソースの各ファイルにMPL-2.0の表示があるので、
Mozillaが公開しているMPL-2.0の本文を使った。補いのないクレートでライセンス文がないものが加わると、ツールが失敗してビルドが止まる。
一覧に載るのはライセンスの表示で、各条件を満たしたことの監査の代わりではない。

### RVCの基礎モデル

承認記録の[rvc-base-artifacts.proposal.json](rvc-base-artifacts.proposal.json)を今の取得に合わせた。
`files`は今アプリが取得する3つ（`hubert_base/config.json`、`hubert_base/pytorch_model.bin`、`rmvpe.onnx`）、
`earlier_files`は以前のPyTorch実行環境が取得し、今は削除のためだけに見分ける2つ（`rmvpe.pt`、
`hubert_base/preprocessor_config.json`）。`rmvpe.onnx`のサイズとSHA-256は、2026-11-15にHugging FaceのAPIで
固定revisionの値と一致することを確かめた。試験（`tests/voice/test_vc_runtime_setup.py`）は、取得の固定値と
記録が過不足なく一致することを確かめる。

上流の条件は次のとおり（2026-11-15確認）。

| モデル | 確認したこと | 残ること |
|---|---|---|
| HuBERT（`hubert_base`） | RVC本家のREADMEが[ContentVec](https://github.com/auspicious3000/contentvec)を参考に挙げる。ContentVecのリポジトリはMIT（Copyright (c) 2019、名義なし）で、fairseqのHuBERT（[MIT](https://github.com/facebookresearch/fairseq/blob/main/LICENSE)）をもとにする | lj1995にもRVC本家にも、`hubert_base`がどのContentVecの重みで、どう変換したかの記載がない。ContentVecのREADMEは重みの配布先を示すだけで、重みの条件を別に定めていない。学習データの条件は見ていない |
| RMVPE（`rmvpe.onnx`） | [RMVPE](https://github.com/Dream-High/RMVPE)のコードはApache-2.0。RVC本家のREADMEによると、学習済みの重みはyxlllcとRVC-Bossが学習した | 重みに別の条件は見つからない。`yxlllc/RMVPE`はもうない |

どちらも配布物に含めず、利用者の同意を得てから提供元から直接取得するので、取得の形は変えない。
NOTICEに「RVC base models」の節を足して、出所を示した。

## 中核統合（#344）後のRust依存の突き合わせ（2026-11-16）

#322の残課題へのオーナーの決定を受けて、台帳と#344で増えた依存を突き合わせた。#344をマージした後のdevelop（`6fe7bd36`）で`tools/rust_licenses.py`を実行し、マージ直前のdevelop（`131bbc3a`）の一覧と比べた。

配布物に入るRust製の実行ファイルは、引き続き`vrct-vox`と`astarot-rvc-worker`の2つ。#344で`vrct-vox`がバックエンドの中核（`native/core`）を取り込み、中核が使う`native/adapters`、`native/ops`、`native/speech-server`、`native/tts`も一緒に入った。どれもリポジトリ内のクレートで、一覧ではVRCT-VOXのコードとして扱う。アプリの依存は`src-tauri/Cargo.lock`で決まり、中核を単独で試験するための`native/core/Cargo.lock`は使わない。2つのロックファイルで同じクレートの版が食い違う例はなかった。中核のクレートは機能フラグを持たず、配布物に入る新しい実行ファイルもない（`fake-speech`などの`[[bin]]`は試験用）。

| 項目 | Windows | Linux |
|---|---|---|
| クレートの数（マージ前 → 後） | 313 → 335 | 385 → 407 |
| 新しく入ったクレート | 17（外部12、リポジトリ内5） | 同じ17 |
| なくなったクレート | 0 | 0 |
| ライセンス文が欠けたクレート | 0 | 0 |

新しく入った外部のクレートは`chacha20`、`const-oid`、`data-encoding`、`hybrid-array`、`if-addrs`、`rand`、`rand_core`、`sha1`、`tokio-macros`、`tokio-tungstenite`、`tungstenite`、`webpki-roots`。`if-addrs`はMIT OR BSD-3-Clause、`webpki-roots`はCDLA-Permissive-2.0で、ほかはMIT、またはMITとApache-2.0のいずれか。どれも公開パッケージにライセンス文があり、補い（`licenses/rust/supplements.json`）は要らなかった。`supplements.json`の11件は、すべて今もどちらかのビルドで使われている。

すでにあった`base64`、`block-buffer`、`cpufeatures`、`crypto-common`、`digest`には別の版が加わった。`tokio-rustls`は0.26.6から0.26.4へ、`uuid`は1.29.2から1.29.0へ下がった。`native/adapters`が`tokio-rustls = "=0.26.4"`、`native/ops`が`uuid = "=1.29.0"`と版を完全一致で指定していて、Cargoがアプリ全体をこの版にそろえた。ライセンスは変わらない。版の指定を直すかは未決。

#300の残課題に挙がった依存（tokio、rustls、ring、tokio-tungstenite、x11rb、windows-sys、if-addrs、socket2、serde_json、subtle、futures-util）は、対象の環境のものがすべて一覧に載る（`x11rb`はLinuxだけ、`windows-sys`はWindowsだけ）。

`webpki-roots`はMozillaのルート証明書のデータで、`native/ops`がTLSの証明書の検証に使う。そのため、上の#330の節の「証明書のデータは加えていない」は当てはまらなくなった（`webpki-root-certs`は今もビルドに入らない）。このデータはCCADB（Common CA Database）のデータの派生物で、[CCADBのデータ利用条件](https://www.ccadb.org/rootstores/usage#ccadb-data-usage-terms)に従う。条件はCDLA-Permissive-2.0で、データを配るときは契約の本文を添えることを求める。利用条件はさらに、再配布や派生物での利用のときにCCADBへの帰属を示すことを求める。本文は`_internal/licenses/rust/webpki-roots-1.0.11/LICENSE`として同梱されていたが、帰属の表示はどこにもなかった。そこでNOTICEの「Rust crates in VRCT-VOX builds」に表示を足し、`tools/rust_licenses.py`が書く一覧（`README.md`）にも、このクレートが入るビルドでは表示を書くようにした。ロックファイルに`webpki-roots`があるかぎりNOTICEに表示があることは、試験（`tests/devtools/test_rust_licenses.py`）で確かめる。

### 音声デバイスを中核につないだときの追加（2026-11-16）

中核が`native/audio-routing`（MIT、リポジトリ内）を使うようになり、`vrct-vox`に入るクレートが増えた。`tools/rust_licenses.py`の一覧は Windows が 335 から 336、Linux が 407 から 414 になった。Windows で増えたのは`vrct-audio-routing`だけで、`windows`などのクレートはすでに入っていた。Linux では`pipewire`、`pipewire-sys`、`libspa`、`libspa-sys`（どれも MIT）、`nom` 8.0.0（MIT）、`cookie-factory`（MIT）が加わった。`bindgen`（BSD-3-Clause）などはビルドのときだけ使い、配布物には入らない。`cookie-factory` 0.3.3 は公開パッケージにライセンス文がないので、公開した版の commit にある`LICENSES/MIT.txt`を補い（`licenses/rust/supplements.json`）に足した。`pipewire`のクレートは実行時に`libpipewire-0.3`（MIT）へ動的にリンクする。中核の`pipewire`機能はアプリだけが有効にし、中核の試験のビルドには入らない。

中核のクレートが`include_str!`で取り込むファイルは、OBSのブラウザーソースのページ（`native/adapters/src/obs/page.html`）と言語の表（`native/core/data/*.json`）だけ。どちらもリポジトリのコードとデータから作ったもので、第三者のデータではない。中核のクレートには`build.rs`もない。

### 翻訳のプロバイダと読み（#277）

中核が`native/translation`（翻訳のプロバイダ、プロンプト、読みの規則）を使うようになった。リポジトリ内のクレートで、VRCT-VOXのコードとして扱う。使う外部のクレート（`httparse`、`rustls`、`serde_json`、`webpki-roots`）と、中核に足した`chrono`は、どれもすでに`src-tauri/Cargo.lock`にあった版で、アプリのロックファイルに新しい外部のクレートは増えていない。プロンプトの文面はPythonの`translation_settings/prompt/*.yml`（VRCT-VOXのコード）を移したもの。

中核の機能フラグ`onnx-translation`は、2026-11-16から既定でオンで、アプリでも有効（ローカル翻訳のエンジンを`native/translate-onnx`に決めた。[core-integration.md](core-integration.md)の「決まったこと」）。`ort`はチャットの読み取りと同じ`load-dynamic`で、ONNX Runtimeをビルドで取得もリンクもしない。アプリのロックファイルに新しく入った外部のクレートは`tokenizers` 0.23.2（Apache-2.0）とその依存（`esaxx-rs`、`spm_precompiled`、`fancy-regex`、`rayon`、`derive_builder`、`monostate`、`daachorse`、`compact_str`など。どれもMITかApache-2.0、またはそのどちらかを選べる。`zerocopy`はBSD-2-Clause OR Apache-2.0 OR MIT、`macro_rules_attribute`はApache-2.0 OR MIT OR Zlib）。`tools/rust_licenses.py`をWindowsとLinuxの両方の対象で実行し、どれも公開パッケージにライセンス文があることを確かめた。`tokenizers`は`default-features = false`と`fancy-regex`で使うので、C++のコード（`esaxx_fast`、`onig`）はビルドに入らない。ONNX Runtimeのライブラリそのものをどこから配るかは未決（同じ文書の「判断が要ること」の2）。読みの辞書（同じく3）も、決まったら辞書のライセンスをここに足す。
## チャットの読み取りを中核に入れたときの依存（2026-11-16、#285）

中核（`native/core`）が`native/ocr-runtime`を使うようになり、`vrct-vox`に次の外部のクレートが加わった。`caseless`（MIT）、`libloading` 0.9.1（ISC）、`ort`と`ort-sys`（MIT OR Apache-2.0）、`ndarray`、`matrixmultiply`、`num-complex`、`num-integer`、`rawpointer`、`unicode-bidi`、`unicode-normalization`（MITとApache-2.0のいずれか）。`tools/rust_licenses.py`をWindowsとLinuxの両方で実行し、どれも公開パッケージにライセンス文があることを確かめた。`ndarray`などは`astarot-rvc-worker`がすでに使っていたもの。

`native/ocr-runtime`はVRCT-VOXのコードで、OpenCV 4.10.0（Apache-2.0）、RapidOCR 3.9.2（Apache-2.0）、pyclipperが同梱するClipper 6.4.2（Boost Software License 1.0）の処理を、結果が一致するように書き直したもの。ソースファイルの複写はない。表示は[NOTICE](../../NOTICE.md#rust-crates-in-vrct-vox-builds)に書いた。ONNX Runtimeはアプリに静的にリンクせず、実行時に読み込む（[core-integration.md](core-integration.md)の「判断が要ること」の13）。どのONNX Runtimeをどこから配るかは未決。OpenVRのクライアントライブラリも同じく未決（同じ節の16）。

## 音声認識を中核に入れたときの依存（2026-11-16、#278）

中核が`native/transcription`（音声認識）を使うようになった。リポジトリ内のクレートで、VRCT-VOXのコードとして扱う。使う外部のクレート（`tungstenite`、`serde_json`、`libc`）と`native/translation`のHTTPクライアントは、どれもすでに`src-tauri/Cargo.lock`にあった版で、アプリのロックファイルに新しい外部のクレートは増えていない。音量による発話の切り出しはSpeechRecognition 3.10.4（BSD-3-Clause）の処理を、`rms`と`ratecv`はCPythonの`audioop`（PSF-2.0）を、結果が同じになるように書き直したもの。ソースファイルの複写はない。表示は[NOTICE](../../NOTICE.md#rust-crates-in-vrct-vox-builds)に書いた。Googleの音声認識（SpeechRecognitionの既定のキーで送るもの）は移していない（[core-integration.md](core-integration.md)の「決まったこと」の「Google の Web 音声認識」）。Silero VADのモデルは中核では使わない（同じ節の20）。

音声認識のクラウドの通信がプロキシを使うようになった（2026-11-19、core-integration.md の 15 の (4)）。Windows のインターネットの設定を読むため、`native/translation`が Windows でだけ`windows-sys` 0.61.2（MIT OR Apache-2.0）の`Win32_System_Registry`を使う。この版はすでに`src-tauri/Cargo.lock`にあり、アプリのロックファイルに新しい外部のクレートは増えていない。プロキシの認証の Base64 は自前で書いた。

## rmvpe.onnxの承認（2026-11-16、#322）

#322の残課題へのオーナーの決定で、`rmvpe.onnx`は使い続けることになった。承認記録の[rvc-base-artifacts.proposal.json](rvc-base-artifacts.proposal.json)では、`status`を`approved_for_app_fetch_after_user_consent`に変え、`consent`にこの決定を足した。取得の形は変わらない。固定revisionから利用者の同意を得てから取得し、配布物には含めない。再配布の承認ではない。

2026-11-16にHugging FaceのAPIで、記録の5ファイル（今取得する3つと以前の2つ）のサイズとblob IDが記録と一致することを確かめた。LFSのファイルはSHA-256も一致した。

取得するのは、既定の経路のPythonのサイドカー（`src-python/models/voice_conversion/runtime_setup.py`）と、Rustの中核（`native/voice-conversion/src/runtime.rs`、[core-integration.md](core-integration.md)の「判断が要ること」の6）。中核はPythonと同じ固定値で取得し、`receipt.json`の版も同じ文字列にする（`native/voice-conversion`の単体の試験が、Pythonで計算した4通りの版と一致することを確かめる）。Pythonの固定値と記録の一致は、試験（`tests/voice/test_vc_runtime_setup.py`）が確かめている。

## RVC追加分（2026-10-29、モデル未取得）

> 2026-11-15以降、この節とMia2026の節の外部Python実行環境は使っていない（上の節）。記録として残す。

RVC-Project/Retrieval-based-Voice-Conversion-WebUI固定commit
`81eed5e8f68b6bed1789f682fe78cdd324495afc`の推論APIを外部workerから利用する。
`integrations/rvc/blocks.py`のresampling/SOLAとloaderのsynthesizer構築は同commit由来のMITコード。
[MIT原典](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/81eed5e8f68b6bed1789f682fe78cdd324495afc/LICENSE)
と、RVCがSOLA出典として挙げる[DDSP-SVCのMIT](https://github.com/yxlllc/DDSP-SVC/blob/master/LICENSE)の通知を
[LICENSE.upstream](https://github.com/kein5/astarot/blob/a0ba2300c196016b046de5c59ad4c7cdabf145e2/integrations/rvc/LICENSE.upstream)（削除する前のコミット）に保持する。レビュー再現用の原典抜粋にも帰属を記載。

基礎モデル候補は公式READMEが指す `lj1995/VoiceConversionWebUI` のHuBERT/RMVPE。
[モデルカード](https://huggingface.co/lj1995/VoiceConversionWebUI)はMITを表示するが本文は空である。
固定版・サイズ・hashは[rvc-base-artifacts.proposal.json](rvc-base-artifacts.proposal.json)に記録。
当初は未承認・未取得の候補。その後の承認・取得は下のMia2026追記を参照。
基礎モデルの情報だけで第三者の声の利用許諾を証明しない。
話者モデル・indexは別途利用条件を確認し、同意後に取得する。無断同梱しない。

独立したuv実行環境の依存lockはMia2026検証で作成。各wheelの最終再配布条件は未監査。RVCモデル・エンジンバイナリを
配布物へ同梱したとは主張しない。Seed workerのGPL-3.0-only境界はRVC追加で変わらない。

## Mia2026ローカル検証（2026-10-29）

ユーザー提供Mia2026のZIP同梱規約（RVC girls共通利用規約v1.0、2026-09-04）と、
ユーザーの明示指示により**モデル・index・同梱データを製品へバンドルしない**。
モデル等はGit管理外のprivate検証領域だけで使用。CPU/CUDAの両specと配布guardに
Mia2026.pth/.index/.zip/.pngの除外・拒否を追加した。試験は偽データで実施。

HuBERT/RMVPEの固定4ファイルは今回明示承認され、370,392,700 bytesを取得してhash照合した。
新しい録音・モデル/音声の公開は行っていない。

実際に導入した`praat-parselmouth==0.4.6`のwheel metadataはGPLv3。RVCソースのMITだけを
実行環境全体へ一般化しない。Torch/torchaudio、FAISS、Transformers、NumPy/SciPy、
librosa、libsndfile等を含む最終runtime配布条件の監査は引き続きP5で必要。

## speech.cpp配布部品（Windows、2026-11-07）

Windows版にも固定speech.cpp 0.10.0の公式Vulkan版`speech.exe`と通知を同梱する。元ZIPのサイズとSHA-256は[固定台帳](speechcpp-bundle-artifacts.json)にある。ZIP内の`speech.dll`、`speech.h`、`speech.lib`は使わないので含めない。`speech.exe`はMSVCのビルド情報を持ち、Cランタイムの動的ライブラリを読み込まないので、GCCのランタイムは含まない。GCCの文書はLinux版のための通知で、同じ通知一式に残る。`vulkan-1.dll`とGPUドライバーは配布物に含まない。

RVCとSeed-VCの実行環境、基礎モデル、声のモデルは、WindowsでもLinuxでも配布物に含まない。アプリの準備機能は、利用者の同意を得て提供元からこのPCへ直接取得するだけで、再配布はしない。取得先はGitHub（uv、Python、エンジン本体、ONNX Runtime）、PyPI、PyTorch、Hugging Faceで、同意画面にライセンスのリンクとサイズを示す。2026-11-15からRVCの実行環境はONNX Runtime（GPU用はNVIDIAのライブラリも）だけになり、変換は同梱の`astarot-rvc-worker`が行う（上の「RVC同梱ワーカー」）。0.4.xまでのWindowsの配布物の`_internal/voice_worker/integrations/seed_vc/`にはGPL-3.0-onlyのアダプターを、`_internal/licenses/python/`には凍結したPythonパッケージのライセンス文書を含んでいた。0.5.0の中核はSeed-VCの実行環境を準備せず、RVCの実行環境だけをNuGet（ONNX Runtime。2026-11-18まではGitHub）、PyPI（NVIDIAのライブラリ）、Hugging Face（基礎モデル）から取得する（`native/voice-conversion/src/runtime.rs`）。0.5.0の配布物の中身は下の「Pythonの同梱の終了」の節にある。

Linuxの配布物も、2026-11-11から同じ準備機能を持つ（以下のuvとSeed-VCの記述は0.4.xまでのもの）。取得するuvはLinux用の公式リリース（x86-64、glibc版）で、版・サイズ・SHA-256を固定する。そのために`_internal/integrations/seed_vc/`へ（2026-11-15まではRVCの`_internal/integrations/rvc/`にも）、ハッシュを固定した依存の一覧（`requirements-cuda.lock`、`requirements.lock`）と、Seed-VCのパッチ（`offline-loader.patch`、GPL-3.0-only）を加えた。Linux用のPyTorch（CUDA版）は、NVIDIAのライブラリを別のパッケージ（`nvidia-*-cu12`など）として取得する。これらもNVIDIAのライセンスに従い、配布物には含まない。

## speech.cpp配布部品（2026-10-29）

固定0.9.0の公式Linux CPU/Vulkan ZIPをサイズ・SHA256で照合し、実行ファイルと通知のみを抽出。
[固定artifact台帳](speechcpp-bundle-artifacts.json)と[実物検証結果](speechcpp-bundle-report.md)。
[通知一式](../../licenses/speech.cpp/NOTICE.md)にspeech.cpp/GGML/cpp-httplibのMIT、
miniaudioの二重ライセンス、静的GCCランタイムのGPLv3＋Runtime Library Exception 3.1を保持する。
実行ファイル全体をspeech.cppのMITだけで説明しない。OSのlibc/Vulkan loader/driverは部品外。
モデル・参照音声・Mia2026・VC runtimeは含まない。ライセンス文の欠落/改ざんを自動検査する。
この部品の確認をアプリ全体・別VCランタイムの配布監査完了とは扱わない。未公開。

2026-10-31に固定版を0.10.0（commit 06590811a90041f935a470ba0e2b85346d2fc041）へ更新。speech.cpp/cpp-httplib/miniaudio/GGMLのライセンス文は0.9.0と同一で、vendorは無変更、GGMLはsubmodule 700c9d743ed7cc583c0f1b6507afebb6c0e88bc0へ更新。公式Vulkan実行ファイルのGCCは同じUbuntu 11.4.0-1ubuntu1~22.04.3。新規に同梱する第三者コードはない。

2026-11-15に固定版を0.11.0（commit 8d18924cd238b87c0297df112f7ff40783a6414f）へ更新。3種の公式ZIP（Linux CPU、Linux Vulkan、Windows Vulkan）は、リリースの`SHA256SUMS`とGitHubが示すダイジェストの両方と一致した。speech.cpp/cpp-httplib/miniaudioのライセンス文は0.10.0と同一で、vendorは無変更。GGMLはspeech.cppのfork（[nyosegawa/ggml](https://github.com/nyosegawa/ggml)）のsubmodule 79b50d239d0b88852814c873db0d85d43ed66d9bへ更新し、ライセンス文は同一。forkは0.10.0の時点から使われていたので、通知と台帳の原典URLもforkに直した。Linuxの実行ファイルのGCCは同じUbuntu 11.4.0-1ubuntu1~22.04.3で、必要なglibcは2.34のまま、動的に読むのはlibc・libm・（Vulkan版は）libvulkanだけ。Windowsの`speech.exe`はMSVCのビルド情報を持ち、読み込むDLLはWindows標準のものと`vulkan-1.dll`だけで、Cランタイムの動的ライブラリは読まない。新規に同梱する第三者コードはない。0.11.0で増えた音声強調（RE-USE）と対話（Haru-4B）のモデルはアプリから使わず、取得の候補にも入れない。

## Linuxの2つのspeech.cpp（0.5.0、2026-11-16）

0.5.0から、Linuxの配布物（tar.gz、AppImage、deb、rpm）はアーキテクチャごとに1つになり、speech.cppのCPU版とVulkan版の両方を入れる。Vulkan版は`_internal/build/speechcpp/`、CPU版は`_internal/build/speechcpp-cpu/`にあり、それぞれが固定台帳のZIPから作った自分の`bundle.json`と通知一式を持つ。どちらを使うかは設定の推論デバイスで決まる（[中核の統合](core-integration.md)の「判断が要ること」の5）。2つの実行ファイルは同じリリース（0.11.0、commit 8d18924cd238b87c0297df112f7ff40783a6414f）の公式ZIPで、通知の文面は同じ。新規に同梱する第三者コードはない。CPU版が動的に読むのはlibcとlibmだけで、Vulkanローダーは読まない。Vulkan版はlibvulkanを読むが、ローダーとドライバーは今までどおり配布物に含めない。debとrpmではVulkanローダーを必須から推奨に移した（「判断が要ること」の48）。Windowsは公式のWindows版がVulkan版だけなので、今までどおりVulkan版だけを入れる。

## 内蔵CTranslate2の取得条件

ローカルの Whisper（faster-whisper）は #288 で削除し、Whisper の重み（OpenAIのMITモデルを元にしたSystran・Zoont・deepdmlのCTranslate2変換版）の取得もやめた。以前の版が取得した重みは読まず、設定の「音声認識（ASR）」から利用者が削除できる。提供元は[NOTICE](../../NOTICE.md#whisper-weights-from-earlier-versions)に残す。faster-whisperは依存から外し（`pyproject.toml`、`uv.lock`。PyAVも一緒に外れた）、発話区間の検出（同梱のSilero VAD）とOCRが使う`onnxruntime`を直接の依存にした。PyAVを必要とする依存はなくなったが、`packaging/pyinstaller-stubs/av`の代用モジュールと配布ポリシーによるPyAV・x264/x265の拒否は、防御として残す（代用モジュールは0.5.0でPyInstallerの工程と一緒に削除した）。CTranslate2と、そのCUDA用の追加依存は、ローカルの翻訳が使うので残す。

CTranslate2翻訳はM2M100とその文章分割ファイルがMIT、NLLBとその文章分割ファイルがCC-BY-NC-4.0（非商用）。[NOTICEの一覧](../../NOTICE.md#downloadable-ctranslate2-translation-weights)を正本とする。非商用モデルは既定にしない。

内蔵モデルの取得は、選択済みのNLLBや同じ一式に含まれるtokenizerも含め、モデルと固定した一覧への明示的な同意を必要とする。起動時の取得は、その同意の記録がある版だけに限る。tokenizerはCTranslate2変換リポジトリ内の固定済みファイルを使い、容量・SHA-256を検証する。確認画面の合計容量に含め、取得元の変更によりmanifestの再同意が必要になる。ライセンスの条件は変えない。この追記で配布許可や完全性の検証完了を主張しない。取得画面と移行の詳細は[モデル取得](model-downloads.md#内蔵ctranslate2と文章分割ファイル)を参照する。

0.5.0でPythonを同梱しなくなったので、`ctranslate2`のホイール（Intel MKLとoneDNNを含む）も配布物から消えた。中核は以前の版が取得した重みを読まず、起動の後で消す（[core-integration.md](core-integration.md)の「決まったこと」）。

### ローカル翻訳のエンジンの候補（2026-11-16）

中核のローカル翻訳に使えるOSSを比べた（[core-integration.md](core-integration.md)の「判断が要ること」の1）。どれもアプリにはまだ入れていない。依存とライセンスの台帳、NOTICE、`tools/rust_licenses.py`の一覧は変わらない。

| 候補 | エンジンのライセンス | モデルのライセンス | 扱い |
|---|---|---|---|
| `native/translate-onnx`（`ort`、ONNX Runtime、`tokenizers`） | VRCT-VOXのコード（MIT）。`ort`はMIT OR Apache-2.0、ONNX RuntimeはMIT、`tokenizers`はApache-2.0 | M2M100はMIT、NLLB-200はCC-BY-NC-4.0（既定にしない） | **採用**（2026-11-16）。アプリに入れた。モデルは2026-11-19に公開した（下の「公開したモデル（2026-11-19、#687）」）。利用者が自分で置くモデルのライセンスは利用者が確かめる |
| `ct2rs` 0.11.2（CTranslate2 4.8.5を同梱して静的にビルド） | `ct2rs`・`ct2rs-sys`・CTranslate2はMIT。同梱のcpu_features・ruyはApache-2.0、spdlogはMIT。oneDNN（`onednn-src`）はApache-2.0、SentencePiece（`sentencepiece-sys`）はApache-2.0 | 既存のCTranslate2の重み（上の一覧と同じ） | 候補。入れるときは、C++のソースから作るライブラリのライセンス文を`tools/rust_licenses.py`の一覧の外で収める必要がある |
| `ct2rs`の機能`mkl`（Intel oneMKL） | IntelのEULA（再配布できるがOSSではない） | 同上 | 計っていない。入れるならEULAの条件を台帳に書く |
| `candle-transformers` 0.11.1 | MIT OR Apache-2.0 | M2M100とNLLBの実装がない。Opus-MTはCC-BY-4.0、MADLAD-400はApache-2.0 | モデルの取り直しと品質の確認が要るので候補から外した |
| `fxtranslate` 0.5.0 | MPL-2.0 | Firefoxの翻訳モデル（作者は自分で配り直すよう求めている） | 英語との組だけで、配り直しが要るので候補から外した |
| Bergamot（translateLocally、`marek_translate_locally` 1.0.1） | AGPL-3.0-or-later | ― | **除外**。AGPLはアプリ全体の配布の条件に及ぶため |

### ローカル翻訳のモデルの候補とNLLBの扱い（2026-11-18、#277）

NLLBを差し替えるかの検討（#288の未決事項）のために、ローカル翻訳のモデルの候補のライセンスを確かめた。ライセンスは2026-11-18にHugging FaceのAPI（`/api/models/<リポジトリ>`）が返したモデルカードの`license`の欄で、版はそのときの`sha`である。カードに欄がないものは、リポジトリのライセンスのファイルを読んだ。調べ方と技術の面の検討は[ローカル翻訳のGPUと公開の準備](local-translation-gpu-2026-11-18.md)にある。

この作業では、モデルも依存も配布物に足していない。`NOTICE.md`とRustの依存の一覧は変わらない。

| モデル | リポジトリと版 | ライセンス | 商用の利用 | 今の`native/translate-onnx`で動くか | 扱い |
|---|---|---|---|---|---|
| M2M100 418M、1.2B | `facebook/m2m100_418M`@`55c2e61b`、`facebook/m2m100_1.2B`@`7b361841` | MIT | できる | 動く | 採用済み。既定は418M。418Mのint8を2026-11-19に公開した |
| NLLB-200 distilled 600M、1.3B、3.3B | `facebook/nllb-200-distilled-600M`@`f8d333a0`、`-1.3B`@`7be3e246`、`facebook/nllb-200-3.3B`@`1a07f7d1` | CC-BY-NC-4.0 | できない | 動く | 採用済み。既定にせず、選ぶときに非商用のライセンスを示して同意を得る。distilled 600Mのint8を2026-11-19に公開した（判断78）。1.3Bは後から足し、3.3Bは今は公開しない |
| MADLAD-400 3B MT、7B MT | `google/madlad400-3b-mt`@`fa184c67`、`google/madlad400-7b-mt`@`1ff63ce7` | Apache-2.0 | できる | 動かない（T5の形） | 候補。T5の形とSentencePieceのunigramを足す必要がある。3Bは約29億のパラメータ |
| SMaLL-100 | `alirezamsh/small100`@`8ab680e2` | MIT | できる | 一部だけ（訳先の言語のトークンを原文の側に付ける） | 候補。約3.3億のパラメータ |
| mBART-50 many-to-many | `facebook/mbart-large-50-many-to-many-mmt`@`e30b6cb8` | モデルカードにライセンスの記載がない | 確かめられない | 動かない（MBartの形） | 対象外。ライセンスを確かめられないため |
| Opus-MT（`ja-en`など） | `Helsinki-NLP/opus-mt-ja-en`@`0770961a` | Apache-2.0（このカード。Tatoebaの新しいモデルにはCC-BY-4.0のものがある） | できる | 動かない（Marianの形） | 対象外。言語の組ごとにモデルが要る |
| SeamlessM4T v2 | `facebook/seamless-m4t-v2-large`@`5f8cc790` | CC-BY-NC-4.0 | できない | 動かない | 対象外 |
| TranslateGemma 4B | `google/translategemma-4b-it`@`10042cb0` | Gemmaの利用規約（取得に利用規約への同意が要る） | 規約の範囲でできる（規約の本文は今回読んでいない） | 動かない（デコーダだけのLLM） | 今のプロバイダ（Ollama、LM Studio、OpenAI互換）で使える。組み込むなら#413の翻訳カタログのランタイムとして別に審査する。規約と取り込み方は下の「TranslateGemma（2026-11-18、#412）」 |
| Hunyuan-MT 7B | `tencent/Hunyuan-MT-7B`@`9305c783` | Tencent Hunyuan Community License。欧州連合、英国、韓国では効力がない（`License.txt`の冒頭） | 地域の制限がある | 動かない | 同上。地域の制限があるのでカタログには向かない |
| PLaMo 2 translate | `pfnet/plamo-2-translate`@`7546b474` | PLaMo Community License | 条件がある（本文は今回読んでいない） | 動かない | 同上 |
| Aya Expanse 8B | `CohereLabs/aya-expanse-8b`@`5062468b` | CC-BY-NC-4.0 | できない | 動かない | 対象外 |

NLLBのCC-BY-NC-4.0について確かめたこと:

- 作者、ライセンス、変更したことを示せば、写しと改変したものを配れる。営利を主な目的とする使い方には使えない（NonCommercial）。
- VRCT-VOXは、NLLBを既定にせず、選ぶときに非商用のライセンスを示して同意を得ている（2026-11-14からの方針）。公開するなら、モデルカードに元のモデルと版、CC-BY-NC-4.0、変えたこと（ONNXへの書き出しと量子化）を書く。`tools/translation_onnx/publish.py stage`がこれを書く。
- 利用者の使い方が非商用の範囲かどうかは、アプリからは判断できない。

#### NLLB-200をカタログに載せるときの決まり（2026-11-18、#411）

公開して`publish.py catalog --write`で`native/ops/data/translation_models.json`に載せると、idは次のようになる（`<モデル>-onnx-<形>`を小文字にし、`_`と`.`を`-`にする）。大きさは`tools/translation_onnx/README.md`の「モデルの大きさ」のint8の値で、公開したファイルの値ではない。

| 予定のid | 元のモデル | 大きさ（int8） |
|---|---|---|
| `nllb-200-distilled-600m-onnx-int8` | `facebook/nllb-200-distilled-600M` | 643 MB |
| `nllb-200-distilled-1-3b-onnx-int8` | `facebook/nllb-200-distilled-1.3B` | 1,402 MB |
| `nllb-200-3-3b-onnx-int8` | `facebook/nllb-200-3.3B` | 3,380 MB |

- 非商用のライセンスなので、既定のモデルにしない。
- 取得にはふつうの同意とは別に、非商用に限ることの確認が要る。カタログの行の`restrictions`はライセンスの文字列から決まり、CC-BY-NC-4.0なら`non_commercial`になる。確認の画面はライセンスの名前を示して2つ目のチェックを求め、開始の要求にその確認（`acknowledged`）がなければ何も書かずに断る（`model_download_restriction_unacknowledged`）。仕組みは[モデル取得](model-downloads.md#非商用のライセンスの確認)にある。
- 選ぶときの確認（翻訳の設定のNLLBの確認と、中核の`WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED`）は残す。取得のときの確認とは別にもう一度求める。

上の表のMADLAD-400 3B MTの元の重み（`model.safetensors`）は11,761,587,872 bytesである。ライセンスはApache-2.0なので、載せるときに追加の確認は要らない。

公開するモデルの記録は、公開した版とファイルのSHA-256を`native/ops/data/translation_models.json`に固定したときに、この節に足す。

#### 公開したモデル（2026-11-19、#687）

判断78の決定（2026-11-19）で、NLLB-200 distilled 600Mと既定のM2M100 418Mのint8を公開し、カタログに載せた。どちらも`tools/translation_onnx/export.py`で書き出し、`publish.py stage`のモデルカード（元のモデルと版、作者、ライセンス、変えたこと、各ファイルのSHA-256）を添えた。ファイルごとの大きさとSHA-256は`native/ops/data/translation_models.json`に固定した。

| カタログのid | 公開先と版 | 元のモデル | ライセンス | 大きさ（全ファイル） | 扱い |
|---|---|---|---|---|---|
| `m2m100-418m-onnx-int8` | `kein5/m2m100_418M-onnx-int8`@`edfdb3e670e257cee60858861031fe40e2e17934` | `facebook/m2m100_418M`@`55c2e61b` | MIT（`LICENSE`にfairseqのMITの文を添えた） | 505,722,914 bytes | 既定のモデル |
| `nllb-200-distilled-600m-onnx-int8` | `kein5/nllb-200-distilled-600M-onnx-int8`@`3c6d40d6ebd424d17d69f0e3236a8a7f8be9a170` | `facebook/nllb-200-distilled-600M`@`f8d333a0` | CC-BY-NC-4.0（非商用） | 642,621,286 bytes | 既定にしない。取得の前に非商用の確認を求める。取得の画面の注記（`translation_nllb_600m`）で、容量と翻訳の間のメモリー（約1.4 GiB）を示す |

1.3Bは別の作業で後から足す。3.3Bは今は公開しない。

### TranslateGemma（2026-11-18、#412）

翻訳のカタログに載せる候補として、上の表の行より詳しく調べた。**載せていない**。カタログ（`native/ops/data/translation_models.json`）、NOTICE、`tools/rust_licenses.py`の一覧は変わらない。重みは取得しておらず、大きさはHugging FaceとOllamaのレジストリのAPIが2026-11-18に返した値である。経路と重みの入手の比較は[TranslateGemmaを翻訳に使う道筋](translategemma.md)にある。

| 項目 | 内容 |
|---|---|
| モデル | Googleの翻訳用のLLM。Gemma 3をもとにしたdecoder-onlyで、4B、12B、27Bがある。モデルカードは55言語を対象とする |
| ライセンス | Gemma Terms of Use（2026-04-01の版。付録にTranslateGemmaがある）と、3.2節で規約に組み込まれたGemma Prohibited Use Policy（2024-02-21の版）。OSIのライセンスではない。禁止用途の制限は使う人にも及ぶ |
| 公式の重み | [google/translategemma-4b-it](https://huggingface.co/google/translategemma-4b-it/tree/10042cb0e6e7fdce748996a71dc3dc432a4e0c89) @ `10042cb0e6e7fdce748996a71dc3dc432a4e0c89`、12b @ `d1b225e1caa17f1ddc7e62065d8637d0923f34e2`、27b @ `7d10f0b72f89a2d0f268cea30727d8b77c0d25c2`。3つともゲート付き（`gated: manual`）で、取得にはHugging Faceのアカウントと規約への同意が要る。中身は16ビットのsafetensorsだけで、重みは4Bが8,600,277,880 bytes、12Bが24,374,793,024 bytes、27Bが54,864,980,440 bytes。ログインしないとSHA-256を読めない |
| 第三者の変換 | [onnx-community/translategemma-text-4b-it-ONNX](https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/tree/f7874a1ac60758872a4f78aac0df95b17b776994) @ `f7874a1ac60758872a4f78aac0df95b17b776994`はゲートがなく、q4が3,091,548,551 bytes。ライセンスの表示も規約の写しもない。ゲートのないGGUFの変換も多いが、規約の写しを添えたものは少ない。Ollamaの`translategemma:4b`は3,298,866,368 bytesで、Gemma Terms of Useをライセンスの層に持つ |
| 再配布の条件 | 3.1節。利用の制限を強制できる条項として課すこと、規約の写しを渡すこと、変更したファイルにその旨を示すこと、決まった一文の`Notice`ファイルを添えること |
| 扱い | 候補。カタログには載せていない。載せるなら既定にはしない。アプリの中で動かすには`native/translate-onnx`にdecoder-onlyの生成を足す必要があり、重みはプロジェクトが変換して規約を添えて公開する形を推奨した（公開は保守担当者が決める）。規約の写しを添えていない第三者の変換からは取得しない |

2026-11-19の追記：保守担当者はLLM用の実行基盤で動かすと決めた（ADR-015）。段階3では、利用者が自分のGGUFのファイルを翻訳のカタログに追加し、llama.cppのサーバー（下の節）で動かせるようにした。組み込みの項目はまだ載せていない。カタログの取得でGemmaの利用規約に従う翻訳のモデルは、同意とは別に規約の確認（`gemma_terms`）を求める。Irodori-TTS v4 Largeにはこの確認を付けない（翻訳のモデルだけに限ると2026-11-19に決めた）。同意画面のライセンスと規約のリンクは今までどおり示す。

### llama.cppのサーバー（2026-11-19、ADR-015の段階3）

翻訳のLLMを動かす`llama-server`。同梱しない。利用者が同意したときだけ、固定のリリースのアーカイブを取得して`vc_runtimes/llamacpp-vulkan/`の`lib/`に必要なファイルだけを取り出す。出すのはVulkan版だけである。版、大きさ、SHA-256は[モデルの取得](model-downloads.md#llamacppのサーバーの取得)の表にある。

| 項目 | 内容 |
|---|---|
| 取得元 | GitHubの`ggml-org/llama.cpp`のリリース b12125（2026-11-04）。`github.com`から`release-assets.githubusercontent.com`へ転送される |
| llama.cppとggml | MIT（Copyright (c) 2023-2026 The ggml authors）。Linuxのアーカイブは`LICENSE`として持つ。Windowsのアーカイブにはこの文がないので、確認の画面はタグの`LICENSE`へリンクする |
| `libomp.dll`（Windowsだけ） | LLVMのOpenMPのランタイム。Apache-2.0 WITH LLVM-exception（古いコードはNCSAとMITの二重）。アーカイブの`LICENSE-LLVM-OpenMP`を`lib/`に取り出す |
| サーバーのライブラリに含まれるもの | 2026-11-19にバイナリの文字列で確かめた。cpp-httplib（MIT）、nlohmann/json（MIT）、WindowsではBoringSSL（Apache-2.0と、OpenSSLとISCのライセンス）。これらのライセンスの文はアーカイブにない |
| Linuxで使うシステムのライブラリ | `libssl.so.3`と`libcrypto.so.3`（OpenSSL 3、Apache-2.0）、`libgomp.so.1`（GCCの実行時ライブラリの例外付きGPL-3.0）、Vulkan版は`libvulkan.so.1`。アプリは取得も同梱もしない |
| 取り出さないもの | CLI、量子化やベンチマークの道具、RPCのサーバー（`ggml-rpc`）、マルチモーダルの道具 |
| 扱い | アプリの配布物には入らない。利用者が提供元から直接取得する。確認の画面にライセンスと「ASTAROTの配布物ではない」ことを書いた |

## Silero VADの同梱（2026-11-15）

マイクとスピーカーの文字起こしで発話区間を見つけるSilero VADのモデルは、これまでfaster-whisper 1.1.1のパッケージに入っていたものを読み込んでいた。faster-whisperをやめる前提作業として（#288）、同じ2ファイルをアプリの一部として同梱する。確率の計算は変わらない。

| 項目 | 内容 |
|---|---|
| モデル | [Silero VAD](https://github.com/snakers4/silero-vad) v5。MIT、Copyright (c) 2020-present Silero Team。ライセンス文はタグv5.1.2のもの |
| 2グラフへの分割 | [faster-whisper](https://github.com/SYSTRAN/faster-whisper)。MIT、Copyright (c) 2023 SYSTRAN。v1.1.1（commit `9e657b47cb71ed7aa32ce115ef0dca953ca39ae5`）のファイルを無加工で使う。PyPIのwheel（SHA-256 `5808dc33…`）と照合した |
| ファイル | `silero_encoder_v5.onnx` 713,415 bytes、`silero_decoder_v5.onnx` 532,505 bytes。SHA-256は[通知](https://github.com/kein5/astarot/blob/v0.5.2/licenses/silero-vad/NOTICE.md)にあり、読み込むたびに照合する |
| 置き場所 | リポジトリは`src-python/models/transcription/silero_vad/`、配布物は`_internal/models/transcription/silero_vad/`。ライセンス文と通知は`licenses/silero-vad/` |

## Outfit（ASTAROTのブランド書体、2026-11-16）

ASTAROTのブランド書体をSpace GroteskからOutfitに変えた。ワードマークはOutfit Boldの字形の輪郭で、ロゴのサブタイトルもOutfitで組む。サブタイトルなどの表示のため、Outfitのフォントファイルをアプリに同梱する（ADR-011の3.2節）。同梱の実装はP1のUIの作業で行い、この時点では配布物にもリポジトリにもフォントファイルはない。

| 項目 | 内容 |
|---|---|
| 書体 | [Outfit](https://github.com/Outfitio/Outfit-Fonts)。SIL Open Font License 1.1、Copyright 2021 The Outfit Project Authors。Reserved Font Nameはない |
| ライセンス文 | 上流のcommit `902773808eb372f70fb34e8946dd1ffe604efc79`の`OFL.txt`を無加工で`licenses/outfit/OFL.txt`に置いた。Google Fontsもこのcommitを取り込んでいる |
| ワードマークに使ったフォント | Google Fontsが配る静的なOutfit Bold（Version 1.100）。SHA-256 `cc3235ab6d698be85a2735d1fd59ba8f73b144cb763c00aaf173b68f0471a9c7`。上流の静的な`Outfit-Bold.ttf`とは輪郭が少し違う |
| 同梱するとき | フォントファイルに`OFL.txt`を添え、`licenses/outfit/NOTICE.md`にファイル名、版、サイズ、SHA-256を足す。OFLはフォント単体での販売を認めないが、ソフトウェアに同梱して再配布することは認める。同梱するときは、著作権表示とライセンス文を添える |

## 音の出来事の検出モデルの候補（2026-11-17、#386）

字幕に`[拍手]`のような注記を付けるために、音の分類モデルの候補を比べた（#386）。どれもアプリにはまだ入れていない。重みは取得しておらず、ライセンスは提供元のリポジトリとモデルカードで確かめた。依存とライセンスの台帳、NOTICE、カタログは変わらない。

| 候補 | 重みの取得元 | 重みのライセンス | 確かめたこと | 扱い |
|---|---|---|---|---|
| CED-Tiny、CED-Mini | [mispeech/ced-tiny](https://huggingface.co/mispeech/ced-tiny/tree/ace276d29dd0bb3f3517b0fa8cf300738c409019) @ `ace276d29dd0bb3f3517b0fa8cf300738c409019`、[mispeech/ced-mini](https://huggingface.co/mispeech/ced-mini/tree/26c3ebcae85d4330f4fc26763f029539a3afcda0) @ `26c3ebcae85d4330f4fc26763f029539a3afcda0` | Apache-2.0（モデルカードの表示） | `model.onnx`はTinyが6,681,767 bytes（SHA-256 `3890f227660be71886ff48633d11a731993e0206db8a486781412c28a0873435`）、Miniが10,890,069 bytes（SHA-256 `2a86374dbe1fa03e96b0acf6a02618ac71852d12aa3d72a030b062ff1e5c5434`）。リポジトリにLICENSEファイルはなく、同じリポジトリの`modeling_ced.py`は「Copyright 2023 Xiaomi Corporation and The HuggingFace Inc. team」のApache-2.0。ログインは要らない（`gated: false`）。学習用のコード（[RicherMans/CED](https://github.com/RicherMans/CED)）はGPL-3.0なので、そこからコードを写さない | **推奨**。Tinyを同梱の第一候補にする。同梱するときは、Apache-2.0の全文と上の著作権表示を`licenses/`に置き、NOTICEにファイル名、revision、サイズ、SHA-256を足す |
| EfficientAT（`mn10_as`など） | [fschmid56/EfficientAT](https://github.com/fschmid56/EfficientAT)のGitHub Release `v0.0.1` | MIT（リポジトリ） | 重みに別の条件の記載はない。ONNXは公開されておらず、自分で変換する | 予備の候補 |
| PANNs（CNN14、MobileNetV1） | [Zenodo 3987831](https://zenodo.org/records/3987831) | CC-BY-4.0（重み）。コードはMIT | 帰属表示があれば同梱できる。ONNXは自分で変換する | 精度とサイズで劣るので採らない |
| YAMNet | `storage.googleapis.com/audioset/yamnet.h5`（[tensorflow/models](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet)） | Apache-2.0（リポジトリ） | 取得元に版の固定がなく、Keras 2でしか読めない。ONNXは自分で変換する | 精度が低いので採らない |
| BEATs | [microsoft/unilm](https://github.com/microsoft/unilm/tree/master/beats)のREADMEにあるOneDriveのリンク | MIT（リポジトリ）。重みに別の条件の記載はない | OneDriveのリンクは版とハッシュを固定できず、カタログの条件に合わない | 採らない |
| AST | [MIT/ast-finetuned-audioset-10-10-0.4593](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593) | BSD-3-Clause | 330 MB。常に動かすには重い | 採らない |
| d1-omni-600M、d1-Omni-2B | [LiquidAI/d1-omni-600M](https://huggingface.co/LiquidAI/d1-omni-600M/tree/02b55d7076f15129e59ab3f94783f32c4b088674) @ `02b55d7076f15129e59ab3f94783f32c4b088674`、[LiquidAI/d1-Omni-2B](https://huggingface.co/LiquidAI/d1-Omni-2B/tree/51918b53052eacfd24062f99f13556c3c56fcf63) @ `51918b53052eacfd24062f99f13556c3c56fcf63`。公式のGGUF版とONNX版（2Bだけ）もある | LFM Open License v1.0 | 下の「d1の条件」を参照 | 既定にも同梱にもしない。カタログに載せるかは保守担当者が決める |

**d1の条件**：2026-11-17に両リポジトリの`LICENSE`を読んだ。600Mと2Bの文面は空白を除いて同じだった（600M 10,572 bytes、2B 10,574 bytes）。Apache-2.0をもとにした許諾で、再配布の条件はライセンスの写しを渡すこと、変更したファイルに変更の旨を示すこと、`NOTICE`ファイルがあればその表示を残すことである（4節）。5節で、年間売上が1000万米ドル以上の法人による商用の利用は許諾の外になる。この条件は配布する側だけでなく、使う側の一人ひとりに及ぶ。VRCT-VOXが同梱すると、該当する法人の利用者は許諾なしで使うことになる。同じ形の売上の条件を持つdrama-3も、載せるかどうかを保守担当者の判断にした（上の「speech.cppの読み上げモデルの追加」）。OSIのライセンスではないので、既定にはしない。

**AudioSetのラベル**：CED、EfficientAT、PANNs、YAMNet、BEATs、ASTは、どれもAudioSetで学習した527種（YAMNetは521種）の分類を返す。AudioSetのデータはCC BY 4.0、ラベルの体系（ontology）はCC BY-SA 4.0で配られている（[AudioSetのダウンロードの頁](https://research.google.com/audioset/download.html)）。CEDの`config.json`にはラベルの名前が入っている。ラベルの一覧をファイルとして同梱するときは、ontologyの帰属とCC BY-SA 4.0をNOTICEに書く。学習に使われたYouTubeの音声そのものの権利は、どのモデルの提供元も扱っていない。

**実測（2026-11-17）**：取得の承認を受けて、CED-Tiny、CED-Mini、d1-omni-600M（公式のGGUF Q8_0、llama.cpp b12445）をESC-50で比べた。結果は#386のコメントにある。CEDの2つの`model.onnx`は、上の表のサイズとSHA-256に一致した。ESC-50（[karolpiczak/ESC-50](https://github.com/karolpiczak/ESC-50) @ `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6`）は全体がCC BY-NC 3.0で、クリップごとに別の条件もある。評価にだけ使い、リポジトリにも配布物にも入れない。測定のあとで、ESC-50とd1のファイルは消した。

## speech.cppの読み上げモデルの追加（2026-11-16）

speech.cppの読み上げで選べるモデルを増やした。どれも配布物には含めない。利用者が同意画面でライセンスとサイズを確認してから、Hugging Faceの固定revisionからこのPCへ取得する。取得するファイルは、speech.cppがそのモデル名で取得するもの（`speech models --json`の既定の型）と同じで、サイズとSHA-256もそれと一致させた。revision、サイズ、SHA-256は0.10.0と同梱の0.11.0で変わらない。

| speech.cppの名前 | カタログのID | 取得元とrevision | ファイル | ライセンス | 扱い |
|---|---|---|---|---|---|
| `irodori-tts-mf` | `irodori-v41-f16`、`irodori-v41-q8` | 既存 | 既存 | MIT + Apache-2.0 | 変更なし |
| `qwen3-tts-0.6b` | `qwen3-06b-q8`、`qwen3-06b-q5` | 既存 | 既存 | Apache-2.0 | 変更なし |
| `irodori-tts` | `irodori-v41-small-f16` | [sakasegawa/Irodori-TTS-v4.1-Small-GGUF](https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-GGUF/tree/66fe2cde1973fd44e7202fbe36df722103958188) @ `66fe2cde1973fd44e7202fbe36df722103958188` | `Irodori-TTS-859M-v4.1-F16.gguf`、1,905,903,936 bytes、SHA-256 `f334932bdf166579bada0a3c8bdabb7199af85682fdcefb6f1cb7e444f5c75b3` | MIT（モデル、codec）+ Apache-2.0（codecの基盤） | 追加 |
| `irodori-tts-large` | `irodori-v4-large-q8` | [sakasegawa/Irodori-TTS-v4-Large-GGUF](https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/tree/79cae5947a97e941c62912749e1387c8b35ec16b) @ `79cae5947a97e941c62912749e1387c8b35ec16b` | `Irodori-TTS-3.4B-v4-Q8_0.gguf`、3,875,154,272 bytes、SHA-256 `836a2deda5115e4400d25674612ff30d704a358d0b16cf96a3eb510dc416bc4e` | Gemma Terms of Use（禁止用途のポリシーを含む）+ MIT + Apache-2.0 | 追加。既定にしない |
| `qwen3-tts-1.7b` | `qwen3-17b-q8` | [sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF](https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/tree/a72e6c6575d67652488cdffc1c863215a9899978) @ `a72e6c6575d67652488cdffc1c863215a9899978` | `Qwen3-TTS-12Hz-1.7B-CustomVoice-Q8_0.gguf`、2,287,780,352 bytes、SHA-256 `1bc0ef69547c003507b6536639a6080c8856382f4d0963b15d4475528330592d` | Apache-2.0 | 追加 |
| `drama-3` | なし | [sakasegawa/drama-3-GGUF](https://huggingface.co/sakasegawa/drama-3-GGUF/tree/9a01354d04ab6eb521bc9cdfc56ab6824c474af2) @ `9a01354d04ab6eb521bc9cdfc56ab6824c474af2` | 既定の`Drama-35B-A3B-v3-Q4_K.gguf`で20,787,264,352 bytes | Fish Audio Community License 1.0 | 対象外 |

どのリポジトリも取得にログインは要らない（2026-11-16にHugging FaceのAPIで`gated: false`を確認）。

**Irodori-TTS v4 Large**：文章と説明を読むエンコーダーがGoogleの`google/t5gemma-2-1b-1b`に由来するので、モデルとGGUFはGemma Terms of Useに従って配布されている。2026-11-16にリポジトリ内の`GEMMA_TERMS_OF_USE.md`と`NOTICE`を確認した。この規約は利用を商用と非商用で分けておらず、再配布も認める。再配布するときは、規約の写しを渡し、禁止用途の制限を受け手にも拘束力のある条件として課し、変更したファイルにその旨を示し、`NOTICE`の表示を添える条件がある（3.1節）。Googleは規約違反と考える利用を制限できる（3.2節）。ASTAROTはファイルを再配布せず、利用者が提供元から直接取得するので、再配布の条件は当てはまらない。ただし禁止用途のポリシーは利用者の使い方に及ぶ。そこで同意画面に、Gemmaの規約と禁止用途のポリシーに従うことを書き、`GEMMA_TERMS_OF_USE.md`、`GEMMA_PROHIBITED_USE_POLICY.md`、`LICENSE-MIT`、`LICENSE-APACHE-2.0`へのリンクを個別に示す。OSIのライセンスではないので既定にはせず、一覧の最後に置いた。モデルカードには、無断の声の模倣やなりすまし、誤情報の生成の禁止も書かれている。公式の実行環境は聞こえない透かし（SilentCipher）を入れるが、speech.cppは入れない、とモデルカードにある。

**drama-3を対象外にした理由**：Fish Audio Community License 1.0（2026-10-13版）を2026-11-16に読んだ。研究と非商用の利用は無料だが、商用の利用は年間売上が50万米ドル未満の間だけ認められる。さらに、音声合成を第三者に使わせる場合は、規約と同等以上の制限を拘束力のある条件で相手に課す義務があり、製品や説明に「Built with Fish Audio」を目立つように示す義務もある。ASTAROTが取得を案内すると、この義務を誰が負うのかを判断する必要がある。その判断は独断でしない。既定の型でも20.79 GB、上流の測定でGPUメモリを約21 GiB使い、VRChatと並べて動かす前提にも合わない。条件を確認したうえで載せるかどうかは、保守担当者が決める。

同意画面で、Hugging Face上のライセンスファイルへのリンクをファイル名で示すようにした。1つのモデルに複数の条件があっても、どれがどの文書か区別できる。

## RVCの声のモデルの候補（2026-11-17、#383）

カタログに足すRVCの声のモデルの候補を調べた。調べただけで、カタログ（`catalog.py`、`native/ops/src/downloads/catalog.rs`）は変えていない。確認した点は次の3つ。

- ライセンス：無料で使えるか。非商用などの制限があるか。
- 配り方：利用者の同意を得て提供元から取得する形と合うか。今のカタログはHugging Faceの固定revisionから1ファイルずつ取得し、ZIPは展開しない（`native/ops/src/downloads/transport.rs`の`HOSTS`）。
- 声の権利：誰の声を学習したか。その人の許諾があるか。人物やキャラクターの声を無許諾で学習したモデルは対象外にする。

Hugging Faceのファイルの大きさとSHA-256はAPIが示すLFSの値を2026-11-17に読んだもの。作者のサーバーのZIPの大きさはHEADの応答の`Content-Length`。どちらもファイルは取得していない。

### カタログの形に合い、判断を待つもの

| モデル | 取得元とrevision | ファイル | ライセンス | 声の出どころ | 扱い |
|---|---|---|---|---|---|
| Saisho Utane · RVC v2（既存の`rvc-saisho`） | [Saisho-Utane/Saisho-Model-RVC](https://huggingface.co/Saisho-Utane/Saisho-Model-RVC/tree/7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a) @ `7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a` | 変わらない（[モデル取得](model-downloads.md#固定カタログ)） | CC BY 4.0 | 作者本人の声と自前のデータセット（作者のカード） | 載せたまま。2026-11-17もリポジトリの最新revisionはこの値 |
| 愛想良い系少女の声 5種風味パック（ちはや神社、製作：鶴乃） | [aa444rt/RVC_V2_models_5_japanese_womens](https://huggingface.co/aa444rt/RVC_V2_models_5_japanese_womens/tree/944f947d44a77b7f67509cd4f8f30333a1009548) @ `944f947d44a77b7f67509cd4f8f30333a1009548`。第三者による転載 | `V2-AISO-HOWATTO.pth` 55,074,309 bytes `8fc32652b8ec472615af3f6661a50a195dd54990e0f517bd0dbd66db59813146`、`V2-AISO-KAKKOII.pth` 55,074,309 bytes `ae33b60655a59ecb37135892ed4a95ba326b412d6589dea251fced95e18aef31`、`V2-AISO-SARASARA.pth` 55,074,757 bytes `ff8c3058dc6ef17f46bd178190cd38fdf46fc06f1d47c12fae55a0cc54398a4e`、`V2-AISO-SITTORI.pth` 55,074,309 bytes `7696d020ced92d9d5502ca40943ee7d35120988a92b70909fa099fc4e24a8477`、`V2-AISO-SYAKITTO.pth` 55,074,757 bytes `569257d45848dada4ba604dfb9a60496d3043eb112e82c81d71eb37be942be50`。共用の`.index`はダミー（2,556,043 bytes、検索の割合を0にする前提） | MIT（モデル、index、アイコン、サンプル音声） | 同梱の`説明書.txt`に、10人の女性の会話の録音をマージした実在しない人物の声で、全員が「AI化、NSFW、R18Gを含めた著作権関係の放棄」をしたとある | 判断待ち（下の1） |
| Nepali RVC Voices v1（4声） | [ampixa/nepali-rvc-voices-v1](https://huggingface.co/ampixa/nepali-rvc-voices-v1/tree/f9b58227fcb9e85b2435b514947d8c672e40dee1) @ `f9b58227fcb9e85b2435b514947d8c672e40dee1` | `voices/ne_rvc_{f01,f02,m01,m02}/*_v1.pth` 各57,584,861 bytes と`.index` 200,923,939〜274,905,539 bytes。SHA-256はリポジトリの`voices.json`と一致 | CC BY 4.0（モデル）。学習データの[IndicVoices-R](https://huggingface.co/datasets/ai4bharat/indicvoices_r)もCC BY 4.0 | IndicVoices-Rの匿名の話者。[論文](https://proceedings.neurips.cc/paper_files/paper/2024/file/7dfcaf4512bbf2a807a783b90afb6c09-Paper-Datasets_and_Benchmarks_Track.pdf)は元のIndicVoicesで話者から明示の同意を得たと書く。カードは実在の人物として示すことや、聞き手をだますことを禁じる | 判断待ち（下の2） |

### 配り方が今のカタログに合わないもの

| モデル | 取得元 | ライセンスと配り方の条件 | 声の出どころ | 扱い |
|---|---|---|---|---|
| [つくよみちゃん公式RVCモデル](https://tyc.rei-yumesaki.net/work/software/rvc/) 1.0.0 | 作者のサーバーのZIP（`tyc-rvc.zip`、255,700,053 bytes。HEADで確認） | [独自の規約](https://tyc.rei-yumesaki.net/work/software/rvc/terms/)。個人・法人、営利・非営利を問わず無料。クレジットが要る。単品・無改変の再配布は原則禁止。自作のソフトへの同梱は、配布ページへのリンク、規約の同梱、無料のおまけとして扱うこと、使う前に説明とクレジットを示すことを条件に認める。政治・宗教の活動や実在の人物への攻撃などには使えない | 作者の夢前黎さんが自分の声だけを学習させた（規約のページ） | 取得元がHugging Faceでなく、ZIPなので、今の仕組みでは取得できない（下の3）。用途の制限があるので既定にはしない |
| [あみたろの声素材工房のRVCモデル](https://amitaro.net/synth/rvc/)（はきはき、るんるん、よふかし、ささやき） | 作者のサーバーのZIP（はきはきは421,620,163 bytes。HEADで確認） | 商用も含めて無料、クレジットが要る。転売・再配布と、第三者のサービスへの登録を禁じる。自作のソフトへの組み込みは事前に相談するよう求める。性的な表現などに使えない | あみたろさん本人が自分のコーパスの読み上げで学習した | 権利者への相談がないので入れない（下の4） |
| [RVC_v2_Rio](https://huggingface.co/Alpha-Humana/RVC_v2_Rio/tree/ffcb30eb5994e5d8162abb59887d94ff08dc8b60) 1.1 | Hugging FaceのZIP（`RVC_v2_Rio_1.1.zip`、85,711,967 bytes、`57a904d565ee3520a81f872f4d7e59d6916fb9f6b4fdedc907e65dad370f577f`） | CC BY 4.0 | カードに「my own voice」とあるだけ（男性、20代半ば） | ZIPなので今の仕組みでは取得できない（下の3）。カードが短く、声の出どころは作者の一文だけ |
| [黄琴まひろ RVC学習済モデル](https://booth.pm/ja/items/5014978) 4.0.0 | BOOTHのZIP（取得にログインが要る） | [れぷりかどーるの個別利用規約](https://replicadoll.studio.site/terms-of-service/rvc)。ページがスクリプトで描画され、本文を読めなかった。検索の抜粋では商用利用とソフトウェアに組み込んでの再配布を認める | キャラクターの声の担当は作者。学習データの内訳と提供者の許諾は確かめられなかった | 保留。規約の本文と学習データを確かめるまで入れない |
| [VCTK話者のモデル](https://huggingface.co/Nekochu/RVC-VCTK_Voice-sample)（Nekochu） | Hugging Faceの単体の`.pth`と`.index`。形は合う | カードはApache-2.0。学習データの[VCTK 0.92](https://datashare.ed.ac.uk/handle/10283/3443)はCC BY 4.0だが、カードにVCTKへの帰属の表示がない | VCTKの話者。コーパスは声の複製の研究用に作られたが、話者の同意の範囲を示す一次資料は見つからなかった | 保留（下の5） |

### 対象外にしたもの

| モデル | 理由 |
|---|---|
| VCClientのサンプル（[wok000/vcclient_model](https://huggingface.co/wok000/vcclient_model)のつくよみちゃん、あみたろ、黄琴まひろ、黄琴海月、刻鳴時雨） | どの`terms_of_use.txt`も「本モデルは、VCClient上でのみ使用可能です。」とする |
| [RinneVoiceSet](https://huggingface.co/RinneAi/RinneVoiceSet) | 音声モデルの二次配布を禁じる。声の主と同意について書いていない。ZIPだけ |
| [刻鳴時雨のRVCモデル](https://huggingface.co/yasyune/Shigure_Tokina_RVC)（yasyune） | モデルのライセンスがない。作ったのは権利者でない第三者。コーパスの追記が配布を認めるのは、声の高さを変えて学習したモデルと、マージしたモデルだけ |
| [RVCgirls/RVC-japanese](https://huggingface.co/RVCgirls/RVC-japanese) | 中身は実行環境のパッケージ（4〜18 GBのZIP）で、声のモデルではない |
| [kuwacom/RVC-Models](https://huggingface.co/kuwacom/RVC-Models) | カードが私用に限るとする |
| Hugging Faceの検索でライセンスの表示がCC0、CC BY、MIT、Apache-2.0の残り（2026-11-17に460件） | ほとんどがアニメやゲームのキャラクター、歌手、配信者などの名前で、本人や権利者の許諾を示していない。ライセンスの表示は、学習した声の権利を示さない |

### 判断が要ること

1. AISOの5種を載せるか。ライセンスと声の提供者の権利放棄は同梱の`説明書.txt`にある。ただし元の[BOOTHのページ](https://chihaya369.booth.pm/items/4701666)は2026-11-17に非公開で、Hugging Faceの転載が元の配布物と同じかを確かめられない。権利放棄は配布者の記載だけである。F0を使わない40 kHzのv2モデルで、`native/rvc-runtime`は乱数の重みでしか試していない形なので、載せるなら実物で聞いて確かめる。
2. Nepali RVC Voices v1を載せるか。ライセンスと同意の記録はそろっている。ただし同意は元のIndicVoices（音声認識のデータ）で取ったもので、声の複製を明示した同意かは論文から読み取れない。80エポックの試作と作者が書いていて、日本語の入力での品質は未確認。載せるなら、ampixaとIndicVoices-Rへの帰属を同意画面と[NOTICE](../../NOTICE.md)に書く。
3. ZIPと作者のサーバーからの取得を足すか。つくよみちゃんとRioはこれがないと載せられない。足すなら、取得先の追加、ZIPの固定の大きさとSHA-256、展開するファイルの一覧と検査を、`transport.rs`とカタログの両方で設計する。つくよみちゃんは、規約が求める説明とクレジットを使う前に示す必要もある。
4. 権利者に相談するか（あみたろなど）。権利者への連絡は、指示があるまで行わない。
5. VCTKの話者のモデルをどう扱うか。話者の同意の範囲を示す資料が見つかるまで保留する。

## 話者分離モデル（2026-11-13）

ゲーム音声の字幕で話者を区別するために、取得できるモデルへNemotron 3 Diarization（Q8_0）を足した。配布物には含めない。利用者が同意画面で確認してから、Hugging Faceの固定revisionからこのPCへ取得する。

| 項目 | 内容 |
|---|---|
| 提供元 | NVIDIA（[nvidia/Nemotron-3-Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization)）。GGUFへの変換はsakasegawa |
| 取得元 | [sakasegawa/Nemotron-3-Diarization-GGUF](https://huggingface.co/sakasegawa/Nemotron-3-Diarization-GGUF/tree/9096d41cb78bba7ac882b96d453e25239eac692b) @ `9096d41cb78bba7ac882b96d453e25239eac692b` |
| ファイル | `Nemotron-3-Diarization-99M-Q8_0.gguf`、106,179,488 bytes、SHA-256 `336df6350dce2ea5ff06aa6e2b249d331a859ced13305fbb45c44bdb3c0abe20` |
| ライセンス | [OpenMDW-1.1](https://openmdw.ai/license/1-1/)。リポジトリに`LICENSE.OpenMDW-1.1`がある。取得にログインは要らない |

2026-11-13にOpenMDW-1.1の本文を読んだ。モデルと関連物を制限なく扱える許諾で、配布するときは契約の写しと著作権表示・出所の表示を残す条件である。特許や著作権の侵害を主張する訴訟を起こすと許諾が終わる。出力の利用には制限も義務も課さない。ASTAROTはこのモデルを再配布しないので、配布時の条件は当てはまらない。同意画面ではモデルカードとリポジトリ内のライセンス文へのリンクを示す。

元のモデルカードは学習データに日本語を挙げていない。日本語での精度は提供元も変換者も公表していない。この条件と手元での試験の結果は[話者分離の選定と試験](speaker-diarization-2026-11-13.md)に記録した。

候補のうち、Streaming Sortformer v2.1（NVIDIA Open Model License）とMultitalker Parakeet（同）は採用していない。Sortformer v1（CC-BY-NC-4.0）は非商用なので候補から外した。pyannoteのモデルは取得にログインと利用規約への同意が要るので、カタログに載せられない。

## speech.cppの音声認識モデル（2026-11-16）

同梱のspeech.cpp 0.11.0が扱う認識モデル7種を、取得できるモデルに加えた（量子化の種類ごとに31件）。配布物には含めない。利用者が同意画面で確認してから、Hugging Faceの固定revisionからこのPCへ取得する。revision・容量・SHA-256はspeech.cppのカタログの値で、モデルごとの表は[licenses/speechcpp-models/NOTICE.md](../../licenses/speechcpp-models/NOTICE.md)にある。

| モデル | ライセンス | 確認したこと |
|---|---|---|
| Qwen3-ASR 0.6B / 1.7B | Apache-2.0 | GGUF版と元のモデル（Qwen）のカードが一致 |
| ReazonSpeech v2 | Apache-2.0 | 元のモデル（reazon-research）と一致。学習に使ったコーパスには別の条件があるが、取得も提供もしない |
| Parakeet TDT-CTC 0.6B ja | CC BY 4.0 | 元のモデル（NVIDIA）と一致。モデルを共有するときはクレジットとライセンスへのリンクが要る。同意画面の注意書きで伝える |
| Parakeet TDT 0.6B v3 | CC BY 4.0 | 同上 |
| Haas-ja v1.0 | Apache-2.0 | 以前から取得できたQ8_0と同じrevision。ほかの種類も同じリポジトリ |
| Nemotron 3.5 Transcribe 30B-A4B | OpenMDW-1.1 | 話者分離モデルと同じ契約（上の節）。リポジトリの`LICENSE`がNVIDIAの著作権表示を含む |

2026-11-16に、固定revisionのモデルカードと元のモデルのカードで確かめた。どれもHugging Faceのアクセス制限（gated）がなく、ログインや利用規約への同意は要らない。非商用の制限もない。ライセンスを理由に外したモデルはない。Nemotron 3.5 Transcribeはいちばん小さいファイルでも約19 GBある。同意画面の注意書きで容量とメモリーの大きさを示し、既定では選ばない。

## Pythonの同梱の終了（0.5.0、2026-11-16）

0.5.0から、バックエンドはアプリ（`vrct-vox`）の中で動くRustの中核になり（[中核の統合](core-integration.md)）、配布物にPythonを入れない。PyInstallerの工程（`spec/*.spec`）もやめた。配布物の`_internal`は`tools/app_resources.py`が作り、中身は次のものだけになる。

| パス | 内容 | ライセンス |
|---|---|---|
| `_internal/build/speechcpp/` | 固定版のspeech.cpp（Vulkan版）と依存の通知 | MITと通知の各ライセンス（上の各節） |
| Linuxの`_internal/build/speechcpp-cpu/` | 固定版のspeech.cpp（CPU版）と依存の通知 | 同上（下の「Linuxの2つのspeech.cpp」） |
| `_internal/build/sudachi/`（版が決まってから） | 読みの辞書SudachiDictと`LEGAL`、`LICENSE-2.0.txt` | Apache-2.0（下の「読みの解析器と辞書」） |
| `_internal/build/astarot-rvc-worker(.exe)` | RVCの同梱ワーカー | MIT（VRCT-VOX）。Rustの依存は`licenses/rust` |
| Linuxの`_internal/build/vrct-*` | 音声の補助プログラム（`astarot-voice-gate`など） | VRCT-VOX自身のコード |
| `_internal/licenses/VRCT/` | `LICENSE`と`NOTICE.md` | |
| `_internal/licenses/rust/` | アプリとワーカーのRustのクレートのライセンス文 | 一覧のとおり |
| `_internal/licenses/nscurl/`（Windows） | インストーラーのNScurlの通知 | 上の節のとおり |
| Linuxの`_internal/config/pipewire/` | PipeWireの設定の例 | VRCT-VOX自身のファイル |

配布物から消えるもの:

- Pythonの実行環境とPythonのパッケージ（`_internal/licenses/python/`のライセンス文も）。NOTICEの「LGPL and GPL components」の表の部品（libsoxr、OpenCVのFFmpegとGCCのランタイム、zeroconf、Seed-VCのアダプター、PyInstallerのブートローダー）は0.4.xまでの配布物にだけ入る。ソースの提供の約束は、その版の公開から3年間続く。
- Silero VADの同梱（上の節の`_internal/models/transcription/silero_vad/`）。Rustの音声認識がSilero VADを使うことになったら、`tools/app_resources.py`に足し、`licenses/silero-vad/`の通知も同梱する。
- RapidOCRの設定ファイル（`rapidocr/*.yaml`）。Rustの`ocr-runtime`は読まない。
- フォント（`*.ttf`）。0.4.xまではVRの字幕のためにNoto SansのJP・KR・SC・TC（SIL Open Font License 1.1）を`_internal`に入れていた。Rustの中核は書体を同梱せず、利用者のPCの書体を使う（[中核の統合](core-integration.md)の「決まったこと」の「字幕の書体」）。そのため書体のライセンスは配布物に関係しない。Outfitの節はブランドの文字のためのもので、これとは別。
- Sudachiの辞書（SudachiPyの`sudachidict_core`と`sudachidict_full`）。Rustの中核は同じ辞書をsudachi.rsで読む。入れる版は下の「読みの解析器と辞書」の節。

- ONNX Runtime（2026-11-17に決定、#509）。翻訳（`translate-onnx`）とOCR（`ocr-runtime`）は`ort`の`load-dynamic`でONNX Runtimeを実行時に読み込み、プロセスで1つの環境を共有する。配布物には公式のCPU版1.31.0（MIT、Microsoft）を`_internal/onnxruntime`に入れ、ライセンスと`ThirdPartyNotices.txt`を`_internal/licenses/onnxruntime`に置く（`tools/runtime_libraries.py`）。取得元はNuGetの`Microsoft.ML.OnnxRuntime`で、声質変換の実行環境の準備がCPU用に取得するものと同じパッケージ。2026-11-18まではGitHubのリリースのアーカイブから取っていた。取り出すライブラリはそのときとバイト単位で同じ。Linuxの配布物のライセンスの文書だけは、改行がCRLFになった（本文は同じ）。DirectML、CUDA、OpenVINOなどの実行プロバイダの入った版は入れない。0.5.0-beta.4までは何も入れておらず、WindowsではSystem32の古いONNX Runtime（1.17）が読み込まれてOCRのモデル（IR 10）を読めなかった。
- OpenVRのクライアントライブラリ（2026-11-17に決定、#509）。VRのオーバーレイとOCRのVRの映像が実行時に読み込む。0.4.xと同じpyopenvr 2.12.1401のwheel（BSD-3-Clause、Christopher Bruns）から、OpenVR SDK 2.12.14の`libopenvr_api_64`（BSD-3-Clause、Valve Corporation）を`_internal/openvr`に入れる。ライセンスは、Valveの同じ版のもの（`LICENSE`）とpyopenvrのもの（`pyopenvr-LICENSE`）を`_internal/licenses/openvr`に置く。

まだ決まっていないもの（[中核の統合](core-integration.md)の「判断が要ること」）:

- CUDA版（20）。中身は標準版と同じになった。NVIDIAのライブラリは入らない。

Rustのクレートの一覧から`tauri-plugin-shell`とその依存（`os_pipe`、`shared_child`、`encoding_rs`など）が消えた。UIがプログラムを起動しなくなったため。

## 開発に使うPythonを3.14にした（2026-11-18）

開発の道具と試験に使うPythonを3.14にした（`mise.toml`）。配布物にPythonは入らないので（上の節）、配布物とNOTICEの記載は変わらない。`uv.lock`には次のパッケージが増えた。

| パッケージ | 版 | ライセンス | 入れた理由 |
|---|---|---|---|
| `audioop-lts` | 0.2.2 | PSF-2.0 | 3.13で標準ライブラリから外れた`audioop`の代わり。VAD（`src-python/models/transcription/audio_vad.py`）、SpeechRecognitionのフォーク、speech.cppの実時間の試験が使う |
| `standard-aifc` | 3.13.0 | PSF-2.0 | 3.13で外れた`aifc`の代わり。SpeechRecognitionのフォークが使う |
| `standard-chunk` | 3.13.0 | PSF-2.0 | `standard-aifc`の依存（3.13で外れた`chunk`） |

3.14用のwheelがある版にするため、次の3つを上げた。ライセンスは前の版と同じ。

- PyAudioWPatch: 0.2.12.6から0.2.12.8へ（Apache-2.0）
- PyYAML: 6.0.2から6.0.3へ（MIT）
- SudachiPy: 0.6.10から0.6.11へ（Apache-2.0）

### 別のロックを持つ環境（2026-11-19）

自分のロックを持つ環境も3.14にそろえた。どれも配布物には入らない。

- Seed-VCの実行環境（`integrations/seed_vc/`）: Pythonのバックエンド（`src-python/`）が利用者の同意のあとで提供元から取得する環境。0.5.0からの中核は提供していない。3.14のwheelがある版にするため、numpy（1.26.4から2.4.6）、scipy（1.13.1から1.16.3、BSD-3-Clause）、librosa（0.10.2から0.10.2.post1、ISC）、PyYAML（6.0.2から6.0.3、MIT）を上げた。PyTorchのCUDA版は2.10.0のままで、cp314のwheelにした。audioreadが3.13から求める`audioop-lts`、`standard-aifc`、`standard-chunk`、`standard-sunau`（どれもPSF-2.0）が増えた。funasr 1.2.7が挙げる`editdistance`（MIT）は3.14のwheelがなく、funasrは精度の計算でしか使わないので、ロックから外した。
- RVCの参照環境（`native/rvc-runtime/reference/`）: 以前の`integrations/rvc/requirements.in`と同じ依存を`native/rvc-runtime/reference/requirements.in`に移した。numpy、scipy、praat-parselmouth（0.4.6から0.4.7、GPL-3.0-or-later）を上げた。適合の試験の参照を作るためだけの環境で、配布物とアプリの実行には使わない。
- 翻訳モデルを書き出す環境（`tools/translation_onnx/`）: 固定した版のままで、どの依存にも3.14のwheelがある。
- チャットボックスの学習環境（`tools/chatbox_lab/`）: PyTorch 2.9（CUDA 12.6）とtorchvision 0.24（どちらもBSD-3-Clause）にした。どちらも3.14のwheelがある最初の版。

## Pythonのバックエンドを消した（2026-11-20、#285）

Pythonのバックエンド（`src-python/`）と、それだけが使っていたものを消した。配布物には0.5.0からPythonが入っていないので、配布物とNOTICEの部品の表は変わらない。

- `uv.lock`から、アプリの依存とその間接の依存の102のパッケージが外れた（ctranslate2、transformers、rapidocr、SpeechRecognitionのフォーク、PyAudioWPatch、pyinstallerなど）。残ったのは開発の道具と試験の依存で、版は変わっていない。`pyproject.toml`の`cuda`のextraと`linux-build`のグループもなくした。
- `voice-test`のグループに2つ足した。`python-osc` 1.10.2（Unlicense。実機の試験のチャットボックスの補助の試験が使う）と、pyopenvr（`openvr` 2.12.1401、BSD-3-Clause。中核のOpenVRの関数表の写しを照らす試験が使う。配布物の`libopenvr_api_64`はこのwheelから取り出す）。どちらも前はアプリの依存として`uv.lock`にあった。
- Silero VADのONNXのモデル（`src-python/models/transcription/silero_vad/`）とライセンス文（`licenses/silero-vad/`）を消した。0.4.xの配布物の分は、そのタグに残る。
- Seed-VCの統合（`integrations/seed_vc/`、GPL-3.0-onlyの表示のあるファイルを含む）を消した。0.4.xまでの配布物に入っていた分のソースの提供の約束は、上の節のとおり続く。
- 翻訳の比較の道具（`tools/translation_onnx/compare.py`）が照らすCTranslate2のモデルの固定値は、`tools/translation_onnx/ctranslate2_pins.py`に移した。

## 使われていない試験の依存を外した（2026-11-20、#810）

`pyproject.toml`の`voice-test`のグループから、`tests/`、`tools/`、`utils/`のどこからもimportされていなかった4つを外した。開発の試験の依存で、配布物には入らないので、配布物とNOTICEは変わらない。

- `audioop-lts` 0.2.2（PSF-2.0）。上の「開発に使うPythonを3.14にした」の節で足したもの。使っていたVADとSpeechRecognitionのフォークは、Pythonのバックエンドと一緒に消えた。
- `soxr` 1.1.0（LGPL-2.1-or-later）、`websockets` 17.4（BSD-3-Clause）、`requests` 2.34.2（Apache-2.0）。
- `requests`の間接の依存の`certifi`、`charset-normalizer`、`idna`、`urllib3`も`uv.lock`から外れた。
- `tools/dev.py`の`doctor`が確かめるパッケージの一覧からも外した。

## 結合テストの道具（2026-11-20、#821）

画面から中核まで通す結合テスト（ADR-017）のために、開発の依存を足した。どれも配布物には入らないので、配布物とNOTICEは変わらない。

- npmの開発の依存：`@playwright/test` 1.65.0と、その依存の`playwright`と`playwright-core`（どれもApache-2.0）。
- Playwrightのブラウザ（ChromiumとWebKit）は、`python tools/dev.py setup --scope integration`が開発のPCとCIのキャッシュに取得する。リポジトリと配布物には入れない。
- 中核のホスト`native/browser-core-bridge`は試験の道具のクレートで、アプリのビルドに含めない。使う外部のクレート（`tungstenite`、`serde_json`）は、すでに中核が使っている版と同じ。

## 読みの解析器と辞書（2026-11-16）

メッセージの読み（ひらがな・ローマ字）は、Pythonと同じくSudachiで解析する。中核は解析器にsudachi.rsを使い、辞書は`_internal/build/sudachi/system.dic`を読む。候補の比較は[中核の統合](core-integration.md)の「判断が要ること」の3にある。

| 部品 | 入れ方 | ライセンス | 確認したこと |
|---|---|---|---|
| sudachi.rs 0.6.11（クレート`sudachi`） | アプリに組み込む。crates.ioにないので、GitHubのタグv0.6.11のコミット（`90fd6068`）をgitの依存で固定 | Apache-2.0（Works Applications） | パッケージのフォルダにライセンス文がないので、リポジトリの`LICENSE`を`licenses/rust/sudachi-0.6.11/`に置いた（`supplements.json`）。NOTICEファイルはない。組み込む設定と文字の定義（`resources/`）も同じライセンス |
| sudachi.rsの依存（`fancy-regex`、`nom`、`yada`、`csv`、`memmap2`など） | アプリに組み込む | MIT、Apache-2.0、Unlicense/MITなど | `tools/rust_licenses.py`がWindowsとLinuxの両方で、ライセンス文の欠けなしに集められた |
| SudachiDict 20250825（full、core、small） | 公式の配布（`d2ej7fkh96fzlu.cloudfront.net/sudachidict/`）から`tools/sudachi_dictionary.py`が固定の大きさとSHA-256で取得し、`_internal/build/sudachi/`に置く。版は未決 | Apache-2.0。語彙の一部はUniDic（BSD-3-Clause、UniDic Consortium）とmecab-unidic-NEologd（Apache-2.0）に由来し、配布の`LEGAL`がその表示を持つ | 配布の`LEGAL`と`LICENSE-2.0.txt`を辞書と一緒に置く。辞書はSudachiPyの`sudachidict_*` 20250825と同じバイト列 |

比べた候補のライセンス:

- lindera（MIT）とvibrato（MITかApache-2.0）は問題ない。読みの質で外した。
- IPADIC（mecab-ipadic 2.7.0）は独自の許諾で、再配布できるが著作権の表示が要る。NAIST-JDICはBSD-3-Clause。どちらも読みの質で外した。
- UniDic（unidic-mecab 2.1.2、UniDic-cwj 3.1.1）はBSD・GPL・LGPLの三つから選ぶ形で、BSDを選べば配布できる。読みの質で外した。
- linderaのSudachiDictの埋め込み（`lindera-sudachidict`）は、ビルドのたびに配布元ではないlindera.devから辞書を取得する。ライセンスはSudachiDictと同じ。読みの質と実行ファイルの大きさ（+593 MB）で外した。

ライセンスを理由に外した候補はない。

## shadcn/ui（部品の設計、2026-11-19）

部品の設計、見た目、構造を shadcn/ui の部品に寄せる方針にした（DESIGN.md「Components」）。最初に寄せたのは設定画面の部品の実験の kit（`src-ui/views/kit/`）で、パーツの `data-slot` の名前、選択欄のシェブロンの大きさと位置、ボタンの文字の太さ、使えない状態の不透明度を shadcn/ui に合わせた。コードはそのまま写さず、Tailwind のクラスを vanilla-extract に読み替え、色は ASTAROT のトークンにした。読み替えた部品も MIT の著作権表示の対象とみなし、`NOTICE.md` に表示とライセンス文を載せた。依存は増えていない。

| 項目 | 内容 |
|---|---|
| 参照元 | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) の `apps/v4/registry/new-york-v4/ui/`（`main` のコミット `968d8cb9dc`）。MIT、Copyright (c) 2023 shadcn |
| 参照しなかったもの | shadcn.io。shadcn/ui の上に作られた別のサイトで、無料の部品にライセンスの名前がない |
| 配布物 | kit はまだ画面で使っておらず、見本のページ（`kit-lab.html`）もビルドに入らない。配布物には `NOTICE.md` が `licenses/VRCT/NOTICE.md` として入る（`tools/app_resources.py`）ので、画面の部品を寄せるときも、表示は `NOTICE.md` のこの節で足りる |
