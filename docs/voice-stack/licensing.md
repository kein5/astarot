# 配布境界と原典

2026-10-27に提供されたevidence mapと以下の一次資料を参照。
この冒頭表は初期調査時点の記録。後日、ユーザー承認済みの開発用モデル取得とSeed外部worker実装を行った。配布許可とは区別し、各PoC報告と下記追記を参照。

2026-10-31に`v0.1.0-beta.1`（プレリリース）を公開した。Linux配布物（tar.gz・AppImage）には固定speech.cpp 0.10.0の実行ファイルと通知を同梱した。Windows版にはこの時点で同梱していない（2026-11-07に同梱を追加。下記参照）。配布物のLGPL/GPL部品は[NOTICE](../../NOTICE.md#lgpl-and-gpl-components-in-vrct-vox-builds)に記載。以下の各節は日付ごとの記録で、「未公開」「次工程」などはその時点の状態を表す。

| 対象 | 確認した根拠 | 今回の扱い |
|---|---|---|
| VRCTコード | [LICENSE](../../LICENSE), [NOTICE](../../NOTICE.md) | MIT帰属を維持 |
| upstream OCR検出重み | [モデルライセンス](https://github.com/kein5/VRCT-VOX/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.txt) | fork成果物から除外。0.2.0でリポジトリからも削除（0.1.0までのコミットには残る） |
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
CPU版・CUDA版のZIPにも`_internal/licenses/nscurl/`として収集し、
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
GPLのx264/x265を同梱していたため配布せず、`packaging/pyinstaller-stubs/av`の代用モジュールを使う
（faster-whisperはnumpy配列の入力ではデコードしない）。配布ポリシーがPyAVのネイティブライブラリとx264/x265を拒否する。
nanobind（BSD-3-Clause）の実ビルド版の特定は未了。

## RVC同梱ワーカー（2026-11-15、#275 Phase 3）

RVCの変換は、本家の推論を再実装した`native/rvc-runtime`（MIT、本家コードの複写・翻案なし）を
`vrct-rvc-worker`としてWindowsとLinuxの配布物に同梱して行う。これにより、下の「RVC追加分」以降に書いた
外部のPython実行環境（PyTorch、本家エンジン、`praat-parselmouth`などの依存）と、本家由来のMITコード
（`integrations/rvc/blocks.py`、`loader.py`、`LICENSE.upstream`）は使わなくなり、リポジトリと配布物から削除した。

ワーカーはONNX Runtimeを自分では持たず、実行時に読み込む。ONNX Runtime、CUDAとcuDNNのライブラリ、
基礎モデルは配布物に含めず、利用者の同意を得てから提供元から直接取得する（版・サイズ・SHA-256を
`src-python/models/voice_conversion/runtime_setup.py`に固定）。

| 取得物 | 取得元 | ライセンス |
|---|---|---|
| ONNX Runtime 1.31.0（NVIDIAのドライバーがあるPCはCUDA 13版、ないPCはCPU版） | GitHubのMicrosoft公式リリース | MIT |
| CUDA runtime、cuBLAS、cuRAND、NVRTC（CUDA 13.4 Update 1）、cuDNN 9.26（GPU用だけ） | PyPIのNVIDIA公式wheel（`nvidia-cuda-runtime`、`nvidia-cublas`、`nvidia-curand`、`nvidia-cuda-nvrtc`、`nvidia-cudnn-cu13`）から必要なファイルだけ | NVIDIAのCUDA EULA、cuDNN SLA |
| HuBERT（`hubert_base`の`config.json`と`pytorch_model.bin`）、`rmvpe.onnx` | Hugging Faceの`lj1995/VoiceConversionWebUI`（以前と同じ固定revision） | モデルカードの表示はMIT（本文は空）。HuBERT/ContentVecの上流条件は未確認のまま（同梱しないので取得の形を保つ）。2026-11-15に確認した（下の「#322」の節） |

`rmvpe.onnx`はこの取得で新しく加わったファイルで、同じrevisionの`rmvpe.pt`の代わり。2026-11-15の追加の判断で、
CUDA 12（PyTorch実行環境と同じ12.8系）からCUDA 13へ移し（ドライバー580以降が必要）、NVIDIAのドライバーがないPC向けに
CPU版の実行環境を加えた。CPU版にはNVIDIAのファイルを含まない。新しい実行環境の取得が終わると、同じフォルダーにある
以前のPyTorch実行環境のファイル（venv、python、engine、固定の`rmvpe.pt`など）をアプリが削除する（`remove_earlier_rvc`）。HuBERTはONNXに
変換した物を配らず、取得した`pytorch_model.bin`からワーカーが読み込み時にグラフを組み立てる。
ワーカーのRust依存（`ort`、`ort-sys`、`libloading`、`prost`、`rustfft`、`serde_json`、`thiserror`、`hound`など）は
MIT、Apache-2.0、ISCなどの許容型ライセンス。配布物へのライセンス文書の同梱方法は、Tauri本体のRust依存と同じく
未整理（残課題）。→ 下の「#322」の節で整備した。

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

配布物に入るRust製の実行ファイルは、Tauri本体の`vrct-vox`とRVCワーカーの`vrct-rvc-worker`の2つ。
`native/`の他のクレートは2026-11-15のdevelopではまだどの実行ファイルにも組み込んでいない
（`asr-capture`など`main.c`だけのものはC）。→ #344で`native/core`などが`vrct-vox`に入った（下の「#344」の節）。

`tools/rust_licenses.py`がパッケージを作るときに2つの実行ファイルの依存をロックファイルから求める。
対象の環境（`x86_64-pc-windows-msvc`、`x86_64-unknown-linux-gnu`）で`cargo metadata --filter-platform`を使い、
通常の依存をたどる。手続きマクロは含め、ビルドスクリプトだけの依存と開発用の依存は含めない。
各クレートの公開パッケージの先頭にあるLICENSE・COPYING・NOTICEなどの文書を
`_internal/licenses/rust/<クレート>-<版>/`に写し、一覧を`README.md`と`crates.json`に書く。
写した文書と一覧は、WindowsではPyInstallerのデータとして（`bat/build.bat`、`bat/build_cuda.bat`、`tools/windows_voice_resources.py`）、
Linuxではリソースとして（`tools/build_linux.py`）、どちらもPyInstallerの`_internal`に入る。
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

配布物に入るRust製の実行ファイルは、引き続き`vrct-vox`と`vrct-rvc-worker`の2つ。#344で`vrct-vox`がバックエンドの中核（`native/core`）を取り込み、中核が使う`native/adapters`、`native/ops`、`native/speech-server`、`native/tts`も一緒に入った。どれもリポジトリ内のクレートで、一覧ではVRCT-VOXのコードとして扱う。アプリの依存は`src-tauri/Cargo.lock`で決まり、中核を単独で試験するための`native/core/Cargo.lock`は使わない。2つのロックファイルで同じクレートの版が食い違う例はなかった。中核のクレートは機能フラグを持たず、配布物に入る新しい実行ファイルもない（`fake-speech`などの`[[bin]]`は試験用）。

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

中核に機能フラグ`onnx-translation`ができた（既定はオフ）。オンにすると`native/translate-onnx`経由で`ort`（ONNX Runtimeの取得を含む）と`tokenizers`が入る。そのため`native/core/Cargo.lock`にはこれらが載るが、既定のビルドとアプリには入らない。オンにするときは、ONNX Runtimeの同梱（[core-integration.md](core-integration.md)の未決事項13）と一緒に、この台帳とNOTICEを見直す。読みの辞書（未決事項16）も、決まったら辞書のライセンスをここに足す。
## チャットの読み取りを中核に入れたときの依存（2026-11-16、#285）

中核（`native/core`）が`native/ocr-runtime`を使うようになり、`vrct-vox`に次の外部のクレートが加わった。`caseless`（MIT）、`libloading` 0.9.1（ISC）、`ort`と`ort-sys`（MIT OR Apache-2.0）、`ndarray`、`matrixmultiply`、`num-complex`、`num-integer`、`rawpointer`、`unicode-bidi`、`unicode-normalization`（MITとApache-2.0のいずれか）。`tools/rust_licenses.py`をWindowsとLinuxの両方で実行し、どれも公開パッケージにライセンス文があることを確かめた。`ndarray`などは`vrct-rvc-worker`がすでに使っていたもの。

`native/ocr-runtime`はVRCT-VOXのコードで、OpenCV 4.10.0（Apache-2.0）、RapidOCR 3.9.2（Apache-2.0）、pyclipperが同梱するClipper 6.4.2（Boost Software License 1.0）の処理を、結果が一致するように書き直したもの。ソースファイルの複写はない。表示は[NOTICE](../../NOTICE.md#rust-crates-in-vrct-vox-builds)に書いた。ONNX Runtimeはアプリに静的にリンクせず、実行時に読み込む（[core-integration.md](core-integration.md)の「判断が要ること」の13）。どのONNX Runtimeをどこから配るかは未決。OpenVRのクライアントライブラリも同じく未決（同じ節の16）。

## rmvpe.onnxの承認（2026-11-16、#322）

#322の残課題へのオーナーの決定で、`rmvpe.onnx`は使い続けることになった。承認記録の[rvc-base-artifacts.proposal.json](rvc-base-artifacts.proposal.json)では、`status`を`approved_for_app_fetch_after_user_consent`に変え、`consent`にこの決定を足した。取得の形は変わらない。固定revisionから利用者の同意を得てから取得し、配布物には含めない。再配布の承認ではない。

2026-11-16にHugging FaceのAPIで、記録の5ファイル（今取得する3つと以前の2つ）のサイズとblob IDが記録と一致することを確かめた。LFSのファイルはSHA-256も一致した。

取得するのは、今も既定の経路のPythonのサイドカー（`src-python/models/voice_conversion/runtime_setup.py`）。#344で入ったRustの中核は、まだ実行環境を準備しない（[core-integration.md](core-integration.md)の未決事項6）。中核に移すときも同じ固定値で取得する必要がある。Pythonの固定値と記録の一致は、試験（`tests/voice/test_vc_runtime_setup.py`）が確かめている。

## RVC追加分（2026-10-29、モデル未取得）

> 2026-11-15以降、この節とMia2026の節の外部Python実行環境は使っていない（上の節）。記録として残す。

RVC-Project/Retrieval-based-Voice-Conversion-WebUI固定commit
`81eed5e8f68b6bed1789f682fe78cdd324495afc`の推論APIを外部workerから利用する。
`integrations/rvc/blocks.py`のresampling/SOLAとloaderのsynthesizer構築は同commit由来のMITコード。
[MIT原典](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/81eed5e8f68b6bed1789f682fe78cdd324495afc/LICENSE)
と、RVCがSOLA出典として挙げる[DDSP-SVCのMIT](https://github.com/yxlllc/DDSP-SVC/blob/master/LICENSE)の通知を
[LICENSE.upstream](../../integrations/rvc/LICENSE.upstream)に保持する。レビュー再現用の原典抜粋にも帰属を記載。

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

RVCとSeed-VCの実行環境、基礎モデル、声のモデルは、WindowsでもLinuxでも配布物に含まない。アプリの準備機能は、利用者の同意を得て提供元からこのPCへ直接取得するだけで、再配布はしない。取得先はGitHub（uv、Python、エンジン本体、ONNX Runtime）、PyPI、PyTorch、Hugging Faceで、同意画面にライセンスのリンクとサイズを示す。2026-11-15からRVCの実行環境はONNX Runtime（GPU用はNVIDIAのライブラリも）だけになり、変換は同梱の`vrct-rvc-worker`が行う（上の「RVC同梱ワーカー」）。Windowsの配布物の`_internal/voice_worker/integrations/seed_vc/`にはGPL-3.0-onlyのアダプターを、`_internal/licenses/python/`には凍結したPythonパッケージのライセンス文書を含む。

Linuxの配布物も、2026-11-11から同じ準備機能を持つ。取得するuvはLinux用の公式リリース（x86-64、glibc版）で、版・サイズ・SHA-256を固定する。そのために`_internal/integrations/seed_vc/`へ（2026-11-15まではRVCの`_internal/integrations/rvc/`にも）、ハッシュを固定した依存の一覧（`requirements-cuda.lock`、`requirements.lock`）と、Seed-VCのパッチ（`offline-loader.patch`、GPL-3.0-only）を加えた。Linux用のPyTorch（CUDA版）は、NVIDIAのライブラリを別のパッケージ（`nvidia-*-cu12`など）として取得する。これらもNVIDIAのライセンスに従い、配布物には含まない。

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

## 内蔵CTranslate2の取得条件

ローカルの Whisper（faster-whisper）は #288 で削除し、Whisper の重み（OpenAIのMITモデルを元にしたSystran・Zoont・deepdmlのCTranslate2変換版）の取得もやめた。以前の版が取得した重みは読まず、設定の「音声認識（ASR）」から利用者が削除できる。提供元は[NOTICE](../../NOTICE.md#whisper-weights-from-earlier-versions)に残す。faster-whisperは依存から外し（`pyproject.toml`、`uv.lock`。PyAVも一緒に外れた）、発話区間の検出（同梱のSilero VAD）とOCRが使う`onnxruntime`を直接の依存にした。PyAVを必要とする依存はなくなったが、`packaging/pyinstaller-stubs/av`の代用モジュールと配布ポリシーによるPyAV・x264/x265の拒否は、防御として残す。CTranslate2と、そのCUDA用の追加依存は、ローカルの翻訳が使うので残す。

CTranslate2翻訳はM2M100とその文章分割ファイルがMIT、NLLBとその文章分割ファイルがCC-BY-NC-4.0（非商用）。[NOTICEの一覧](../../NOTICE.md#downloadable-ctranslate2-translation-weights)を正本とする。非商用モデルは既定にしない。

内蔵モデルの取得は、選択済みのNLLBや同じ一式に含まれるtokenizerも含め、モデルと固定した一覧への明示的な同意を必要とする。起動時の取得は、その同意の記録がある版だけに限る。tokenizerはCTranslate2変換リポジトリ内の固定済みファイルを使い、容量・SHA-256を検証する。確認画面の合計容量に含め、取得元の変更によりmanifestの再同意が必要になる。ライセンスの条件は変えない。この追記で配布許可や完全性の検証完了を主張しない。取得画面と移行の詳細は[モデル取得](model-downloads.md#内蔵ctranslate2と文章分割ファイル)を参照する。

## Silero VADの同梱（2026-11-15）

マイクとスピーカーの文字起こしで発話区間を見つけるSilero VADのモデルは、これまでfaster-whisper 1.1.1のパッケージに入っていたものを読み込んでいた。faster-whisperをやめる前提作業として（#288）、同じ2ファイルをアプリの一部として同梱する。確率の計算は変わらない。

| 項目 | 内容 |
|---|---|
| モデル | [Silero VAD](https://github.com/snakers4/silero-vad) v5。MIT、Copyright (c) 2020-present Silero Team。ライセンス文はタグv5.1.2のもの |
| 2グラフへの分割 | [faster-whisper](https://github.com/SYSTRAN/faster-whisper)。MIT、Copyright (c) 2023 SYSTRAN。v1.1.1（commit `9e657b47cb71ed7aa32ce115ef0dca953ca39ae5`）のファイルを無加工で使う。PyPIのwheel（SHA-256 `5808dc33…`）と照合した |
| ファイル | `silero_encoder_v5.onnx` 713,415 bytes、`silero_decoder_v5.onnx` 532,505 bytes。SHA-256は[通知](../../licenses/silero-vad/NOTICE.md)にあり、読み込むたびに照合する |
| 置き場所 | リポジトリは`src-python/models/transcription/silero_vad/`、配布物は`_internal/models/transcription/silero_vad/`。ライセンス文と通知は`licenses/silero-vad/` |

## Outfit（ASTAROTのブランド書体、2026-11-16）

ASTAROTのブランド書体をSpace GroteskからOutfitに変えた。ワードマークはOutfit Boldの字形の輪郭で、ロゴのサブタイトルもOutfitで組む。サブタイトルなどの表示のため、Outfitのフォントファイルをアプリに同梱する（ADR-011の3.2節）。同梱の実装はP1のUIの作業で行い、この時点では配布物にもリポジトリにもフォントファイルはない。

| 項目 | 内容 |
|---|---|
| 書体 | [Outfit](https://github.com/Outfitio/Outfit-Fonts)。SIL Open Font License 1.1、Copyright 2021 The Outfit Project Authors。Reserved Font Nameはない |
| ライセンス文 | 上流のcommit `902773808eb372f70fb34e8946dd1ffe604efc79`の`OFL.txt`を無加工で`licenses/outfit/OFL.txt`に置いた。Google Fontsもこのcommitを取り込んでいる |
| ワードマークに使ったフォント | Google Fontsが配る静的なOutfit Bold（Version 1.100）。SHA-256 `cc3235ab6d698be85a2735d1fd59ba8f73b144cb763c00aaf173b68f0471a9c7`。上流の静的な`Outfit-Bold.ttf`とは輪郭が少し違う |
| 同梱するとき | フォントファイルに`OFL.txt`を添え、`licenses/outfit/NOTICE.md`にファイル名、版、サイズ、SHA-256を足す。OFLはフォント単体での販売を認めないが、ソフトウェアに同梱して再配布することは認める。同梱するときは、著作権表示とライセンス文を添える |

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

**Irodori-TTS v4 Large**：文章と説明を読むエンコーダーがGoogleの`google/t5gemma-2-1b-1b`に由来するので、モデルとGGUFはGemma Terms of Useに従って配布されている。2026-11-16にリポジトリ内の`GEMMA_TERMS_OF_USE.md`と`NOTICE`を確認した。この規約は利用を商用と非商用で分けておらず、再配布も認める。再配布するときは、規約の写しを渡し、禁止用途の制限を受け手にも拘束力のある条件として課し、変更したファイルにその旨を示し、`NOTICE`の表示を添える条件がある（3.1節）。Googleは規約違反と考える利用を制限できる（3.2節）。VRCT-VOXはファイルを再配布せず、利用者が提供元から直接取得するので、再配布の条件は当てはまらない。ただし禁止用途のポリシーは利用者の使い方に及ぶ。そこで同意画面に、Gemmaの規約と禁止用途のポリシーに従うことを書き、`GEMMA_TERMS_OF_USE.md`、`GEMMA_PROHIBITED_USE_POLICY.md`、`LICENSE-MIT`、`LICENSE-APACHE-2.0`へのリンクを個別に示す。OSIのライセンスではないので既定にはせず、一覧の最後に置いた。モデルカードには、無断の声の模倣やなりすまし、誤情報の生成の禁止も書かれている。公式の実行環境は聞こえない透かし（SilentCipher）を入れるが、speech.cppは入れない、とモデルカードにある。

**drama-3を対象外にした理由**：Fish Audio Community License 1.0（2026-10-13版）を2026-11-16に読んだ。研究と非商用の利用は無料だが、商用の利用は年間売上が50万米ドル未満の間だけ認められる。さらに、音声合成を第三者に使わせる場合は、規約と同等以上の制限を拘束力のある条件で相手に課す義務があり、製品や説明に「Built with Fish Audio」を目立つように示す義務もある。VRCT-VOXが取得を案内すると、この義務を誰が負うのかを判断する必要がある。その判断は独断でしない。既定の型でも20.79 GB、上流の測定でGPUメモリを約21 GiB使い、VRChatと並べて動かす前提にも合わない。条件を確認したうえで載せるかどうかは、保守担当者が決める。

同意画面で、Hugging Face上のライセンスファイルへのリンクをファイル名で示すようにした。1つのモデルに複数の条件があっても、どれがどの文書か区別できる。

## 話者分離モデル（2026-11-13）

ゲーム音声の字幕で話者を区別するために、取得できるモデルへNemotron 3 Diarization（Q8_0）を足した。配布物には含めない。利用者が同意画面で確認してから、Hugging Faceの固定revisionからこのPCへ取得する。

| 項目 | 内容 |
|---|---|
| 提供元 | NVIDIA（[nvidia/Nemotron-3-Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization)）。GGUFへの変換はsakasegawa |
| 取得元 | [sakasegawa/Nemotron-3-Diarization-GGUF](https://huggingface.co/sakasegawa/Nemotron-3-Diarization-GGUF/tree/9096d41cb78bba7ac882b96d453e25239eac692b) @ `9096d41cb78bba7ac882b96d453e25239eac692b` |
| ファイル | `Nemotron-3-Diarization-99M-Q8_0.gguf`、106,179,488 bytes、SHA-256 `336df6350dce2ea5ff06aa6e2b249d331a859ced13305fbb45c44bdb3c0abe20` |
| ライセンス | [OpenMDW-1.1](https://openmdw.ai/license/1-1/)。リポジトリに`LICENSE.OpenMDW-1.1`がある。取得にログインは要らない |

2026-11-13にOpenMDW-1.1の本文を読んだ。モデルと関連物を制限なく扱える許諾で、配布するときは契約の写しと著作権表示・出所の表示を残す条件である。特許や著作権の侵害を主張する訴訟を起こすと許諾が終わる。出力の利用には制限も義務も課さない。VRCT-VOXはこのモデルを再配布しないので、配布時の条件は当てはまらない。同意画面ではモデルカードとリポジトリ内のライセンス文へのリンクを示す。

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
