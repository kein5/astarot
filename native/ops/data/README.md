# speech.cpp のモデルのデータ

`src/downloads/speechcpp.rs` が `include_str!` で読み込むデータです。モデル取得のカタログの音声認識の項目と、各モデルの比べるための情報（`profile`）をここから作ります。

## `speechcpp_models.json`

speech.cpp のカタログ（`speech models --json`）の写しです。`tools/speechcpp_models.py` が書きます。手で直さないでください。同梱する speech.cpp の版（`docs/voice-stack/speechcpp-bundle-artifacts.json`）でツールを実行し直します。

```sh
python tools/speechcpp_models.py --speech <同梱する版の speech の実行ファイル>
python tools/speechcpp_models.py --check   # ツールが書いた形のままかを確かめる
```

PC によって変わる値（ファイルの場所と取得済みかどうか）は入れません。

## `speechcpp_asr.json`

speech.cpp のカタログにないことだけを書きます。手で書くデータです。

- `offers`: ASTAROT が音声認識のモデルとして出す名前と、そのライセンスの審査です（`docs/voice-stack/licensing.md`、`licenses/speechcpp-models/NOTICE.md`）。`licenses` の各項目は、固定した版のリポジトリの中のパスか、決まった URL です。
- `id_prefixes`: この表より前からある項目の id の頭です（`haas-ja-v1.0` は `haas-ja-q8` など）。前に取得したファイルを `<root>/<id>/<revision>/` で見つけ直すためのものです。ほかの名前は名前から作ります（`qwen3-asr-06b`）。
- `tiers`: `profile` の `tier` を、計ったメモリーの最大値（バイト）から決める境目です。1.5 GiB までが `light`、4 GiB までが `medium`、それより上が `heavy` です。
- `profiles`: 利用者が選ぶ前に比べる情報で、キーは speech.cpp の名前です。
  - `summary`: 短い説明の文言のキーです（`locales/` の `model_downloads.summary.<key>`）。
  - `memory`: ファイルの種類ごとのメモリーの最大値です。固定した版のモデルカード（README.md の「Memory」）が `memory_measured_on` の機器で計った値です。モデルカードの GB は 10 進、GiB は 2 進です。
  - `cpu`: `slow` は ASTAROT が CPU で計り、動くが数秒遅れるもの（`docs/voice-stack/model-downloads.md`、2026-11-16）。`practical` は speech.cpp 自体が CPU で動かすもの。`impractical` は CPU で計り、声が途切れるか数秒遅れて始まるもの（読み上げのモデル、i7-1255U、2026-11-16）。`unverified` はそれ以外です。
  - `gpu`: `recommended` か `not_needed` です。
  - `id`、`ids`: VAD と話者の分離の項目は `catalog.rs` で id を固定しています（`id`）。読み上げの項目も `catalog.rs` で固定し、1 つの名前の複数のファイルにそれぞれの id があります（`ids` はファイルの種類から id への表）。
  - `recommended_for`: speech.cpp の開始の言語の代わりに使う言語です。日本語は Irodori、ほかの言語は Qwen3-TTS で読むためです（読み上げの `japanese` と `multilingual` のプロファイル）。開始の言語と同じく、speech.cpp が最初に取得するファイルにだけ付けます。

Python のバックエンド（[`src-python/models/model_downloads/speechcpp_asr.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/model_downloads/speechcpp_asr.py)、[`speechcpp_models.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/model_downloads/speechcpp_models.py)）も同じファイルを読んでいました。0.6.0 でバックエンドと一緒に消しました（#285）。

## `translation_models.json`

ローカル翻訳のモデル（`native/translate-onnx` のフォルダ）を取得する項目です。`src/downloads/catalog.rs` の `translation_models` が読み、カタログの末尾に足します。対象は `translation` で、ファイルには書きません。`notice` も既定は `translation` で書きませんが、モデルごとの確認の文面を使う項目だけは `notice` を書きます（`catalog.rs` の `TRANSLATION_NOTICES` にある名前だけ。NLLB の `translation_nllb_600m` と `translation_nllb_1_3b`）。2026-11-19 に M2M100 418M と NLLB-200 distilled 600M の int8 を、2026-11-21 に NLLB-200 distilled 1.3B の int8 を載せました。

項目は手で書かず、公開したリポジトリの固定した版から `tools/translation_onnx/publish.py catalog --write` で作ります（文面を変えるときは `--notice <名前>`）。道具は、公開されたファイルの大きさと SHA-256 をフォルダの `manifest.json` と照らし合わせてから書きます。

- `id`: `<モデル>-onnx-<形>` を小文字にし、`_` と `.` を `-` にしたものです（`m2m100-418m-onnx-int8`）。中核はこの id から組み込みのモデルと形を決めます（`controller/translation_onnx.rs` の `catalog_id`）。
- `artifacts`: `manifest.json` と、マニフェストにあるすべてのファイルです。役割は `manifest`、`encoder`、`decoder`、`tokenizer`、`vocabulary`、`weights`（`vocabulary.data`）、`data`（2 GB を超えるグラフの `.onnx_data`。グラフごとに 1 つ）です。
- `licenses`: 固定した版のモデルカードと、MIT なら `LICENSE`、CC-BY-NC-4.0 なら Creative Commons の説明のページです。

項目を足したり変えたりしたら、`catalog.rs` の `CATALOG_VERSION` を上げます。Python のカタログの写しと比べる試験は、0.6.0 で引退させました（#746）。
