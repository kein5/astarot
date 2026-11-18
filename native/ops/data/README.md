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

- `offers`: VRCT-VOX が音声認識のモデルとして出す名前と、そのライセンスの審査です（`docs/voice-stack/licensing.md`、`licenses/speechcpp-models/NOTICE.md`）。`licenses` の各項目は、固定した版のリポジトリの中のパスか、決まった URL です。
- `id_prefixes`: この表より前からある項目の id の頭です（`haas-ja-v1.0` は `haas-ja-q8` など）。前に取得したファイルを `<root>/<id>/<revision>/` で見つけ直すためのものです。ほかの名前は名前から作ります（`qwen3-asr-06b`）。
- `tiers`: `profile` の `tier` を、計ったメモリーの最大値（バイト）から決める境目です。1.5 GiB までが `light`、4 GiB までが `medium`、それより上が `heavy` です。
- `profiles`: 利用者が選ぶ前に比べる情報で、キーは speech.cpp の名前です。
  - `summary`: 短い説明の文言のキーです（`locales/` の `model_downloads.summary.<key>`）。
  - `memory`: ファイルの種類ごとのメモリーの最大値です。固定した版のモデルカード（README.md の「Memory」）が `memory_measured_on` の機器で計った値です。モデルカードの GB は 10 進、GiB は 2 進です。
  - `cpu`: `slow` は VRCT-VOX が CPU で計り、動くが数秒遅れるもの（`docs/voice-stack/model-downloads.md`、2026-11-16）。`practical` は speech.cpp 自体が CPU で動かすもの。`impractical` は CPU で計り、声が途切れるか数秒遅れて始まるもの（読み上げのモデル、i7-1255U、2026-11-16）。`unverified` はそれ以外です。
  - `gpu`: `recommended` か `not_needed` です。
  - `id`、`ids`: VAD と話者の分離の項目は `catalog.rs` で id を固定しています（`id`）。読み上げの項目も `catalog.rs` で固定し、1 つの名前の複数のファイルにそれぞれの id があります（`ids` はファイルの種類から id への表）。
  - `recommended_for`: speech.cpp の開始の言語の代わりに使う言語です。日本語は Irodori、ほかの言語は Qwen3-TTS で読むためです（読み上げの `japanese` と `multilingual` のプロファイル）。開始の言語と同じく、speech.cpp が最初に取得するファイルにだけ付けます。

Python のバックエンド（`src-python/models/model_downloads/speechcpp_asr.py`、`speechcpp_models.py`）も、`src-python/` を消すまでは同じファイルを読みます。
