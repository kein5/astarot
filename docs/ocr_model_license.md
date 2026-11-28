# Chatbox detection model: license and origin

[日本語版](#チャットボックス検出モデルのライセンスと出自日本語版)

> **Removed in 0.2.0**: The upstream VRCT model covered here (`chatbox_yolox_tiny.onnx`) was removed from the repository in 0.2.0. VRCT-VOX had become an independent project, so it no longer counted as a "fork for improving VRCT", which the license allows. What follows is kept as a record of the same file in the commits up to 0.1.0. ASTAROT (formerly VRCT-VOX) has its own detection model, trained separately and published under MIT.

This document sets out the rights that apply to `src-python/models/ocr/onnx/chatbox_yolox_tiny.onnx`. The repository as a whole is under MIT, but **this one file is not covered by MIT**: a VRCT-only license applies to it. The formal notice is in [`NOTICE.md`](../NOTICE.md), and the terms are in [`LICENSE.txt`](https://github.com/kein5/astarot/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.txt) (Japanese, the authoritative text) and [`LICENSE.en.txt`](https://github.com/kein5/astarot/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.en.txt) (English translation). The links point to the commit just before the removal.

## State up to 0.1.0

| Component | Source | License |
|---|---|---|
| `weights/yolox_tiny.pth` (initial weights for training, COCO-pretrained) | Megvii ([YOLOX](https://github.com/Megvii-BaseDetection/YOLOX)) | Apache-2.0 |
| YOLOX 0.3.0 (training and export) | Megvii | Apache-2.0 |
| Training data (VRChat screenshots + annotations confirmed by hand) | Collected by the project itself (upstream VRCT's `tools/ocr_dataset_collector.py`) | Not public, not distributed |
| **`chatbox_yolox_tiny.onnx` (the output)** | Derived from the above | **VRCT-only license** |
| RapidOCR / PP-OCR ONNX (text recognition side) | RapidAI | Apache-2.0 |

Apache-2.0 does not claim that weights trained with the software are derivative works too. Unlike Ultralytics, no such position has been published for it, so **the terms for the output can be set independently**.

The line chosen was "**block only taking the model out to other projects**". Specifically:

| | |
|---|---|
| Allowed | Run it as VRCT / **run it in a fork made to develop, fix or test VRCT** / fork or mirror the repository and keep it with the model included / redistribute the official distribution as it is |
| Not allowed | Bundle the model with a fork's own release / use it in software other than VRCT or its forks / redistribute it on its own / make derivative models / use its output for training, evaluation or distillation |

Running the model in a fork is allowed explicitly **so as not to get in the way of work that improves VRCT**. GitHub's fork feature copies the whole repository, so Article 3(2) of the terms has exception (b) to keep such a copy from formally counting as 「公衆送信」 (transmission to the public).

VRCT itself stays under MIT, and it builds and runs without the model (only chat bubble detection is turned off). A fork that wants to distribute the detection feature too can train its own detector (the procedure, the training configuration and the preprocessing scripts are all published).

`rapidocr==3.9.2` is under Apache-2.0, and so are the PP-OCR weights that `tools/fetch_ocr_models.py` fetches. These impose no restriction.

## What to do when distributing

The obligation that remains is to include the full license text and the copyright notice with the distribution.

- The full text is in `src-python/models/ocr/onnx/LICENSE.txt` and `LICENSE.en.txt` in the commits up to 0.1.0.
- `spec/backend.spec` / `spec/backend_cuda.spec` bundle the whole `src-python/models/ocr/onnx` directory as `ocr_onnx/`, so these two files and `NOTICE.txt` **go into the distribution automatically**. Do not delete them when replacing the model. (This describes 0.4.x and earlier. From 0.5.0 there is no PyInstaller spec, and the OCR weights are in no distribution.)

## Background: why the model was replaced

The first version, `chatbox_yolov8n.onnx` (2026-09-17), started its training from `yolov8n.pt`, **the COCO-pretrained weights that Ultralytics distributes under AGPL-3.0**, and was also trained and exported with `ultralytics==8.3.203` (AGPL-3.0).

Ultralytics has published its position that weights trained with its software are also derivative works under AGPL-3.0, and that using them under any other terms requires an Enterprise License. VRCT does not hold that license, so **it cannot grant third parties broader permission than the terms it received**. Distributing the model under MIT meant granting rights that VRCT did not have.

There is a counterargument from the general principle that the output of a program is not a derivative work (GNU's GPL FAQ). But this was continued training that started from the AGPL-distributed weights themselves, not from an output, so it was the case where that counterargument is weakest.

In 2026-09 the options were considered in this order.

1. The first decision was to impose no restrictions of VRCT's own and to comply with the YOLOv8 license (AGPL-3.0). AGPL section 13 (offering the source to users over a network) does not come into force, because VRCT is a desktop app that runs locally and does not offer the model over a network. However, this meant **distributing an AGPL model in the same installer as an MIT app**. That could be read as mere aggregation, but Ultralytics reads it more broadly. Also, the AGPL asks for 「改変に適した形式」 (in the AGPL's words, "the preferred form of the work for making modifications"), but only the `.onnx` file was distributed.
2. The next idea was to stop bundling the model and download it at run time, so that VRCT would not distribute the model. The GPL/AGPL obligations attach to distribution, not to an end user running the software locally, so the reasoning holds. It was set aside, though, because it would give up offline operation and the design decision stated in `fetch_ocr_models.py` and in this document: "do not create a path that goes out to the network at run time". Fetching the model at build time would not have this effect, because the model would then be in the shipped product.
3. The decision was to **retrain on an Apache-2.0 base so that the rights are the project's own again**. This resolves at once whether the model may be bundled, the Corresponding Source, the mix with MIT and the taint on past releases.

The candidates were YOLOX / RT-DETR / RF-DETR (all Apache-2.0), and YOLOX-Tiny was chosen. The records of the accuracy, speed and integration checks are in [docs/ocr_yolox_migration_2026-09-22.md in upstream VRCT](https://github.com/misyaguziya/VRCT/blob/develop/docs/ocr_yolox_migration_2026-09-22.md).

The replacement was completed on 2026-09-22, and `chatbox_yolov8n.onnx` was deleted from the repository.

## Remaining risks

1. **Past releases.** From `51e60af` (2026-09) on, there was a period when `chatbox_yolov8n.onnx` was distributed without an AGPL notice. Copies already downloaded cannot be recalled. `NOTICE.md` states that a copy received under AGPL-3.0 stays under AGPL-3.0.
2. **The VRCT-only license is not an OSS license.** It bundles a closed model with a main program under MIT, so it cannot go through redistribution channels that require the whole to be OSS, such as Linux distributions. A fork can use the model for development and testing, but it cannot distribute its own release with the model bundled; to go that far, it has to train its own detector (the procedure, settings and preprocessing scripts are all published: [docs/ocr_yolo_training.md in upstream VRCT](https://github.com/misyaguziya/VRCT/blob/develop/docs/ocr_yolo_training.md)). The terms cannot fully draw the line between where a VRCT fork ends and a separate project begins. The assumption is that if room for abuse shows up, it is handled case by case under Article 6 (Separate Licensing).
3. **The terms were not written by a legal professional.** `LICENSE.txt` names Japanese law as the governing law and the Tokyo District Court as the court with jurisdiction. Having a lawyer review them once before publication is recommended.

---

# チャットボックス検出モデルのライセンスと出自（日本語版）

> **0.2.0で削除**: ここで扱う上流VRCTのモデル（`chatbox_yolox_tiny.onnx`）は、0.2.0でリポジトリから消した。VRCT-VOXは独立したプロジェクトになり、許諾が認める「VRCTの改善のためのフォーク」に当たらなくなったためである。以下は、0.1.0までのコミットにある同じファイルについての記録として残す。ASTAROT（旧名VRCT-VOX）独自の検出モデルは別に学習したもので、MITで公開している。

`src-python/models/ocr/onnx/chatbox_yolox_tiny.onnx` の権利関係をまとめる。
リポジトリ全体は MIT だが、**このファイルだけは MIT の対象外**で、VRCT 専用の
利用許諾が適用される。正式な表記は [`NOTICE.md`](../NOTICE.md)、条文は
[`LICENSE.txt`](https://github.com/kein5/astarot/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.txt)（日本語・正文）と
[`LICENSE.en.txt`](https://github.com/kein5/astarot/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.en.txt)（英訳）。リンク先は削除の直前のコミット。

## 0.1.0 までの状態

| 要素 | 出所 | ライセンス |
|---|---|---|
| `weights/yolox_tiny.pth`（学習の初期値、COCO事前学習） | Megvii ([YOLOX](https://github.com/Megvii-BaseDetection/YOLOX)) | Apache-2.0 |
| YOLOX 0.3.0（学習・エクスポート） | Megvii | Apache-2.0 |
| 学習データ（VRChat のスクリーンショット + 人手確定アノテーション） | 自前収集（上流 VRCT の `tools/ocr_dataset_collector.py`） | 非公開・未配布 |
| **`chatbox_yolox_tiny.onnx`（成果物）** | 上記の派生 | **VRCT 専用の利用許諾** |
| RapidOCR / PP-OCR の ONNX（文字認識側） | RapidAI | Apache-2.0 |

Apache-2.0 は「そのソフトウェアで学習した重みも派生物」という主張をしていない。
Ultralytics と違ってその立場が公表されていないので、**成果物の条件は自分で決められる**。

決めたのは「**別プロジェクトへの持ち出しだけを止める**」という線引き。具体的には:

| | |
|---|---|
| できる | VRCT として実行する / **VRCT の開発・修正・検証のためのフォークで実行する** / リポジトリをフォーク・ミラーしてモデルを含んだまま持つ / 公式配布物をそのまま再配布する |
| できない | フォーク独自のリリース版にモデルを同梱する / VRCT・そのフォーク以外のソフトウェアで使う / 単体で再配布する / 派生モデルを作る / 出力を学習・評価・蒸留に使う |

フォークでの実行を明示的に許しているのは、**VRCT を良くするための作業を妨げないため**。
GitHub のフォーク機能はリポジトリごと複製するので、それが形式的に「公衆送信」に当たって
しまわないよう、条文の第3条(2)に例外 (b) を置いてある。

VRCT 本体は MIT のままで、モデルが無くてもビルドも実行もできる（吹き出し検出だけが無効になる）。
フォークが検出機能ごと配布したい場合は、自前で検出器を学習すればよい
（手順・学習設定・前処理スクリプトはすべて公開してある）。

`rapidocr==3.9.2` は Apache-2.0 で、`tools/fetch_ocr_models.py` が取得する
PP-OCR の重みも同じく Apache-2.0。こちらは制約にならない。

## 配布時にやること

義務として残るのは、配布物へのライセンス全文と著作権表示の添付。

- 全文は0.1.0までのコミットの `src-python/models/ocr/onnx/LICENSE.txt` と `LICENSE.en.txt` にある。
- `spec/backend.spec` / `spec/backend_cuda.spec` は `src-python/models/ocr/onnx`
  ディレクトリごと `ocr_onnx/` として同梱するので、この2ファイルと `NOTICE.txt` は
  **自動的に配布物へ入る**。モデルを差し替えるときにこれらを消さないこと。
  （0.4.x までの記述。0.5.0 から PyInstaller の spec はなく、OCR の重みはどの配布物にも入らない）

## 経緯: なぜ載せ替えたか

初版 `chatbox_yolov8n.onnx`（2026-09-17）は、学習の起点が
**Ultralytics が AGPL-3.0 で配布している COCO 事前学習重み** `yolov8n.pt` で、
学習・エクスポートも `ultralytics==8.3.203`（AGPL-3.0）で行っていた。

Ultralytics は「自社ソフトウェアで学習した重みも AGPL-3.0 の派生物であり、
それ以外の条件で使うには Enterprise License が必要」という立場を公表している。
VRCT はそのライセンスを持っていないので、**自分が受け取った条件より広い許諾を
第三者に出すことはできない**。MIT で配るのは、持っていない権利を許諾している状態だった。

「プログラムの出力は派生物ではない」（GNU の GPL FAQ）という一般論による反論はあるが、
出力ではなく AGPL で配布された重みそのものを初期値にした継続学習なので、
その反論が最も効きにくいケースに当たっていた。

2026-09 に次の順で検討した。

1. まず独自の制限は課さず、YOLOv8 のライセンス (AGPL-3.0) に準拠することにした。
   AGPL 13条（ネットワーク越しの利用者へのソース提供）は、VRCT がローカルで動く
   デスクトップアプリでモデルをネットワーク越しに提供していないので発動しない。
   ただし **AGPL のモデルを MIT のアプリと同じインストーラで配る**形になり、
   単なる集積（mere aggregation）と解する余地はあるものの Ultralytics 側の解釈はより広い。
   また AGPL は「改変に適した形式」を求めるのに、配布していたのは `.onnx` だけだった。
2. 同梱をやめて実行時ダウンロードにすれば VRCT はモデルの頒布者にならない、という
   案を検討した。GPL/AGPL の義務は頒布に付きエンドユーザーのローカル実行には付かないので
   理屈は通るが、`fetch_ocr_models.py` と本 doc に明記してきた「実行時にネットワークへ出る
   経路を作らない」という設計判断とオフライン動作を手放す取引になるため見送った。
   なお、ビルド時取得では出荷物にモデルが入るのでこの効果は得られない。
3. **Apache-2.0 の基盤で再学習して権利を自前に戻す**ことにした。同梱の可否、
   Corresponding Source、MIT との混在、過去リリースの汚染がまとめて解消するため。

候補は YOLOX / RT-DETR / RF-DETR（いずれも Apache-2.0）で、YOLOX-Tiny を選んだ。
精度・速度・組み込みの検証記録は
[上流 VRCT の docs/ocr_yolox_migration_2026-09-22.md](https://github.com/misyaguziya/VRCT/blob/develop/docs/ocr_yolox_migration_2026-09-22.md)。

2026-09-22 に載せ替えを完了し、`chatbox_yolov8n.onnx` はリポジトリから削除した。

## 残っているリスク

1. **過去のリリース**。`51e60af`（2026-09）以降、AGPL の表記なしで `chatbox_yolov8n.onnx` を
   配布していた期間がある。すでに取得された分は取り消せない。`NOTICE.md` に、
   AGPL-3.0 で受け取った複製はそのまま AGPL-3.0 である旨を書いてある。
2. **VRCT 専用の利用許諾は OSS ライセンスではない**。MIT の本体にクローズドなモデルを
   同梱する形なので、Linux ディストリビューションのような「全体が OSS であること」を
   求める再配布経路には乗らない。フォークは開発・検証には使えるが、モデルを同梱した
   自前のリリースは配れないので、そこまでやるなら自前で検出器を学習する必要がある
   （手順・設定・前処理スクリプトはすべて公開済み: [上流 VRCT の docs/ocr_yolo_training.md](https://github.com/misyaguziya/VRCT/blob/develop/docs/ocr_yolo_training.md)）。
   「どこからが VRCT のフォークで、どこからが別プロジェクトか」の線引きは条文では
   引ききれない。悪用の余地が見えたら第6条（個別の許諾）で個別に対応する前提。
3. **条文は法律の専門家が書いたものではない**。`LICENSE.txt` は準拠法を日本法、
   管轄を東京地裁としている。公開前に一度弁護士の確認を受けることを勧める。
