"""Convert a local translation model to int8 ONNX files for native/translate-onnx.

    python tools/translation_onnx/export.py m2m100_418M --output OUT

The result is OUT/<name>-onnx-int8/ with:

    encoder_model_quantized.onnx          the encoder
    decoder_model_merged_quantized.onnx   the decoder: the first step and the cached steps
                                          in one graph (with a .onnx_data file when over 2 GB)
    tokenizer.json                        SentencePiece's normalization and segmentation
    vocab.json                            each piece and special token, and the model's id for it
    manifest.json                         where it came from, how to decode, each file's SHA-256

With --float32 the graphs are not quantized (<name>-onnx-float32/, encoder_model.onnx and
decoder_model_merged.onnx). That is for checking the decoding against CTranslate2 with the
same float32 weights on both sides, where the translations should agree; the app uses int8.

Every input is pinned to a commit of the model's own repository, and the Python packages
are the versions in requirements.txt next to this file, so that the same command gives the
same graphs. manifest.json records the hashes of the run that made them.

Nothing here is used by the app at run time. It needs PyTorch and several times the
model's size in memory: about 10 GB for the 418M/600M models, 20 GB for 1.2B/1.3B, and
more than 50 GB for 3.3B.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

# The commit of each source repository, recorded 2026-11-15 from its main branch.
MODELS = {
    "m2m100_418M": dict(repo="facebook/m2m100_418M", revision="55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636",
                        family="m2m100", license="MIT"),
    "m2m100_1.2B": dict(repo="facebook/m2m100_1.2B", revision="7b36184180524c1a1bbfa37f120a608046250b98",
                        family="m2m100", license="MIT"),
    "nllb-200-distilled-600M": dict(repo="facebook/nllb-200-distilled-600M",
                                    revision="f8d333a098d19b4fd9a8b18f94170487ad3f821d",
                                    family="nllb", license="CC-BY-NC-4.0"),
    "nllb-200-distilled-1.3B": dict(repo="facebook/nllb-200-distilled-1.3B",
                                    revision="7be3e24664b38ce1cac29b8aeed6911aa0cf0576",
                                    family="nllb", license="CC-BY-NC-4.0"),
    "nllb-200-3.3B": dict(repo="facebook/nllb-200-3.3B", revision="1a07f7d195896b2114afcb79b7b57ab512e7b43e",
                          family="nllb", license="CC-BY-NC-4.0"),
}
# The decoding the app has done through CTranslate2 (models/translation/translation_translator.py).
# M2M100 uses the num_beams of its generation_config.json (5). NLLB's names none and the
# app has decoded it with CTranslate2's default of 2.
CTRANSLATE2_DEFAULT_BEAM_SIZE = 2
MAX_INPUT_LENGTH = 1024
MAX_DECODING_LENGTH = 256
# How the app names a language to the tokenizer, and the token that stands for it.
LANGUAGE_TOKEN = {"m2m100": "__{}__", "nllb": "{}"}
ENCODER = "encoder_model_quantized.onnx"
DECODER = "decoder_model_merged_quantized.onnx"
# ONNX keeps a model in one protobuf message only below 2 GB.
PROTOBUF_LIMIT = 2 * 1024 * 1024 * 1024 - 64 * 1024 * 1024
# Text in several scripts for the segmentation check of a generated tokenizer.
SAMPLES = [
    "Hello, world! How are you today?",
    "今日はとてもいい天気ですね。明日も晴れるといいな。",
    "这是一个测试句子，用于检查分词。",
    "안녕하세요, 만나서 반갑습니다.",
    "Привет, как дела? Всё хорошо.",
    "Ich möchte heute Abend ins Kino gehen.",
    "C'est la vie, n'est-ce pas ?",
    "مرحبا بالعالم",
    "नमस्ते दुनिया",
    "Xin chào thế giới, tôi là người Việt Nam.",
    "ສະບາຍດີ ຄວາມ ຮູ້",
    "Hello    world   with   spaces  ",
    "ＦＵＬＬＷＩＤＴＨ ＡＢＣ　１２３ ｶﾀｶﾅ",
    "emoji 🙂🎉 and symbols ©®™ ½",
    "https://example.com/path?query=1&b=2",
    # Characters SentencePiece does not know: they come out as themselves, in a run.
    "官仲跻法、提炼铀。x 铀铀 y",
]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def onnx_size(path):
    """The graph file and its external data, if any (optimum names it .onnx_data, onnxruntime .data)."""
    extra = [*path.parent.glob(path.name + "_data"), *path.parent.glob(path.name + ".data")]
    return path.stat().st_size + sum(p.stat().st_size for p in extra)


def quantize(source, target):
    """Dynamic int8 quantization of the weights of every MatMul; activations stay float.

    Deterministic: the same weights give the same quantized tensors, which is what lets
    the two decoders share them once they are merged.
    """
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    large = onnx_size(source) > PROTOBUF_LIMIT or any(source.parent.glob("*.onnx_data")) or any(
        p.suffix not in (".onnx", ".json", ".model") for p in source.parent.iterdir() if p.is_file())
    quantize_dynamic(
        str(source), str(target), weight_type=QuantType.QUInt8, per_channel=False, reduce_range=False,
        use_external_data_format=large,
        extra_options={"MatMulConstBOnly": True, "DefaultTensorType": onnx.TensorProto.FLOAT})
    if large and onnx_size(target) < PROTOBUF_LIMIT:
        # Small enough once quantized: one self-contained file.
        model = onnx.load(str(target), load_external_data=True)
        for extra in target.parent.glob(target.name + "_data"):
            extra.unlink()
        for extra in target.parent.glob(target.name + ".data"):
            extra.unlink()
        onnx.save(model, str(target), save_as_external_data=False)


def merge(decoder, decoder_with_past, target):
    """optimum's merge of the two decoders, saved with its weights beside it when large.

    optimum's own saver measures the whole message first, which fails over 2 GB.
    """
    import onnx
    from optimum.onnx import graph_transformations

    large = max(onnx_size(decoder), onnx_size(decoder_with_past)) > PROTOBUF_LIMIT * 0.9

    def save(model, save_path):
        if large:
            onnx.save(model, str(save_path), save_as_external_data=True, all_tensors_to_one_file=True,
                      location=Path(save_path).name + "_data", size_threshold=1024, convert_attribute=True)
        else:
            onnx.checker.check_model(model)
            onnx.save(model, str(save_path))

    graph_transformations.check_and_save_model = save
    # The merged graph keeps one copy of each weight the two decoders share.
    graph_transformations.merge_decoders(decoder, decoder_with_past, save_path=str(target), strict=False)


def m2m100_tokenizer(source, target):
    """tokenizer.json for SentencePiece's segmentation, and vocab.json for the model's ids.

    The model's vocabulary (vocab.json) is not SentencePiece's: 390 pieces SentencePiece can
    produce are not in it, and the app's tokenizer turns them into <unk>. So the tokenizer
    gives pieces, and vocab.json gives their ids.
    """
    from types import SimpleNamespace
    import sentencepiece
    from tokenizers import AddedToken, Tokenizer
    from transformers.convert_slow_tokenizer import SpmConverter
    from transformers.models.m2m_100.tokenization_m2m_100 import FAIRSEQ_LANGUAGE_CODES

    spm_file = str(source / "sentencepiece.bpe.model")
    converted = SpmConverter(SimpleNamespace(vocab_file=spm_file, legacy=True, add_prefix_space=True)).converted()
    vocabulary = json.loads((source / "vocab.json").read_text(encoding="utf-8"))
    languages = [f"__{code}__" for code in FAIRSEQ_LANGUAGE_CODES["m2m100"]]
    base = len(vocabulary)
    for index, token in enumerate(languages):
        vocabulary[token] = base + index
    specials = ["<s>", "<pad>", "</s>", "<unk>", *languages]
    converted.add_special_tokens([AddedToken(token, special=True, normalized=False) for token in specials])
    converted.save(str(target / "tokenizer.json"))

    # The segmentation has to be SentencePiece's own. An unknown character is <unk> in the
    # tokenizer and itself in SentencePiece; native/translate-onnx turns it back the same way.
    reloaded = Tokenizer.from_file(str(target / "tokenizer.json"))
    processor = sentencepiece.SentencePieceProcessor(model_file=spm_file)
    for text in SAMPLES:
        expected = processor.encode(text, out_type=str)
        encoding = reloaded.encode(text, add_special_tokens=False)
        got = [reloaded.normalizer.normalize_str(text[start:end]) if token == "<unk>" else token
               for token, (start, end) in zip(encoding.tokens, encoding.offsets)]
        if got != expected:
            raise SystemExit(f"the generated tokenizer splits a sample differently: {got} != {expected}")
    return vocabulary, [code for code in FAIRSEQ_LANGUAGE_CODES["m2m100"]]


def nllb_tokenizer(source, target):
    from tokenizers import Tokenizer
    from transformers.models.nllb.tokenization_nllb import FAIRSEQ_LANGUAGE_CODES
    shutil.copyfile(source / "tokenizer.json", target / "tokenizer.json")
    tokenizer = Tokenizer.from_file(str(target / "tokenizer.json"))
    vocabulary = tokenizer.get_vocab(with_added_tokens=True)
    languages = [code for code in FAIRSEQ_LANGUAGE_CODES if code in vocabulary]
    if len(languages) != len(FAIRSEQ_LANGUAGE_CODES):
        raise SystemExit("the tokenizer lacks a language token")
    return vocabulary, languages


def decoder_io(path):
    import onnx
    model = onnx.load(str(path), load_external_data=False)
    initializers = {i.name for i in model.graph.initializer}
    return ([i.name for i in model.graph.input if i.name not in initializers], [o.name for o in model.graph.output])


def save_float(source, target):
    """A float32 graph as it is, in one file or with its weights next to it when over 2 GB."""
    import onnx
    model = onnx.load(str(source), load_external_data=True)
    large = onnx_size(source) > PROTOBUF_LIMIT
    onnx.save(model, str(target), save_as_external_data=large, all_tensors_to_one_file=True,
              location=target.name + "_data")


def export(name, output, work, quantized=True):
    from huggingface_hub import snapshot_download
    from optimum.exporters.onnx import main_export
    from importlib.metadata import version

    spec = MODELS[name]
    source = Path(snapshot_download(spec["repo"], revision=spec["revision"], allow_patterns=[
        "config.json", "generation_config.json", "pytorch_model*", "tokenizer.json", "tokenizer_config.json",
        "special_tokens_map.json", "sentencepiece.bpe.model", "vocab.json"]))
    float_dir = work / (name + "-onnx-float")
    if not (float_dir / "decoder_with_past_model.onnx").exists():
        # The decoders are merged after quantization: merged in float they pass 2 GB.
        main_export(str(source), output=float_dir, task="text2text-generation-with-past", opset=17,
                    device="cpu", no_post_process=True, do_validation=False)
    kind = "int8" if quantized else "float32"
    encoder, decoder = (ENCODER, DECODER) if quantized else ("encoder_model.onnx", "decoder_model_merged.onnx")
    target = output / f"{name}-onnx-{kind}"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    if quantized:
        quantize(float_dir / "encoder_model.onnx", target / encoder)
        with tempfile.TemporaryDirectory(dir=work) as temporary:
            temporary = Path(temporary)
            quantize(float_dir / "decoder_model.onnx", temporary / "decoder.onnx")
            quantize(float_dir / "decoder_with_past_model.onnx", temporary / "decoder_with_past.onnx")
            merge(temporary / "decoder.onnx", temporary / "decoder_with_past.onnx", target / decoder)
    else:
        save_float(float_dir / "encoder_model.onnx", target / encoder)
        merge(float_dir / "decoder_model.onnx", float_dir / "decoder_with_past_model.onnx", target / decoder)

    if spec["family"] == "m2m100":
        vocabulary, languages = m2m100_tokenizer(source, target)
    else:
        vocabulary, languages = nllb_tokenizer(source, target)
    (target / "vocab.json").write_text(json.dumps(vocabulary, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    config = json.loads((source / "config.json").read_text(encoding="utf-8"))
    generation = json.loads((source / "generation_config.json").read_text(encoding="utf-8"))
    inputs, outputs = decoder_io(target / decoder)
    files = {path.name: dict(size=path.stat().st_size, sha256=sha256(path))
             for path in sorted(target.iterdir()) if path.name != "manifest.json"}
    manifest = dict(
        schema=1,
        name=f"{name}-onnx-{kind}",
        family=spec["family"],
        license=spec["license"],
        source=dict(repository=spec["repo"], revision=spec["revision"]),
        encoder=encoder,
        decoder=decoder,
        decoder_inputs=inputs,
        decoder_outputs=outputs,
        decoder_layers=config["decoder_layers"],
        decoder_attention_heads=config["decoder_attention_heads"],
        hidden_size=config["d_model"],
        vocabulary_size=config["vocab_size"],
        decoder_start_token=next(t for t, i in vocabulary.items() if i == config["decoder_start_token_id"]),
        end_token=next(t for t, i in vocabulary.items() if i == config["eos_token_id"]),
        unknown_token="<unk>",
        language_token=LANGUAGE_TOKEN[spec["family"]],
        languages=languages,
        beam_size=generation.get("num_beams") or CTRANSLATE2_DEFAULT_BEAM_SIZE,
        max_input_length=MAX_INPUT_LENGTH,
        max_decoding_length=MAX_DECODING_LENGTH,
        files=files,
        made_with={package: version(package) for package in (
            "torch", "transformers", "optimum", "optimum-onnx", "onnx", "onnxruntime", "tokenizers", "sentencepiece")},
    )
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("model", choices=sorted(MODELS))
    parser.add_argument("--output", type=Path, required=True, help="folder to write <name>-onnx-int8 into")
    parser.add_argument("--float32", action="store_true", help="write float32 graphs, for checking the decoding")
    parser.add_argument("--work", type=Path,
                        help="folder for the float export, kept for a second run; OUTPUT/work unless given")
    args = parser.parse_args()
    work = args.work or args.output / "work"
    work.mkdir(parents=True, exist_ok=True)
    target = export(args.model, args.output, work, quantized=not args.float32)
    print(target)
    for name, pin in json.loads((target / "manifest.json").read_text(encoding="utf-8"))["files"].items():
        print(f"  {pin['sha256']}  {pin['size']:>12}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
