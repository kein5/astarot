"""Convert a local translation model to ONNX files for native/translate-onnx.

    python tools/translation_onnx/export.py m2m100_418M --output OUT [--variant int8]
    python tools/translation_onnx/export.py NAME --source FOLDER --family m2m100|nllb --license LICENCE --output OUT

The second form converts a model folder on this disk (a fine-tuned M2M100 or NLLB in the
transformers layout) instead of a pinned download; the result is a folder a user can add with
"Add a model of your own" in the translation catalog. Its licence is the one given, written to manifest.json as it is.

The result is OUT/<name>-onnx-<variant>/ with (for int8):

    encoder_model_quantized.onnx          the encoder
    decoder_model_merged_quantized.onnx   the decoder: the first step and the cached steps
                                          in one graph (with a .onnx_data file when over 2 GB)
    vocabulary.data                       the quantized vocabulary matrix, which both graphs
                                          read: the embeddings, and the output layer transposed
    tokenizer.json                        SentencePiece's normalization and segmentation
    vocab.json                            each piece and special token, and the model's id for it
    manifest.json                         where it came from, how to decode, each file's SHA-256

The variants (--variant; manifest.json names it, schema 2), one folder each:

    int8     dynamic int8 weights of every MatMul (MatMulInteger), activations float. For
             the CPU; measured against CTranslate2 (README).
    float32  not quantized (encoder_model.onnx, decoder_model_merged.onnx). For GPUs, and for
             checking the decoding against CTranslate2 with the same weights on both sides.
             --float32 is the old spelling of --variant float32.
    float16  float16 weights and activations, float32 inputs and outputs (keep_io_types), so
             that the app reads the same tensors (encoder_model_fp16.onnx,
             decoder_model_merged_fp16.onnx). For GPU execution providers; ONNX Runtime's CPU
             provider lacks most float16 kernels, so it is not run here.
    int4     int4 weights in blocks of 32 (MatMulNBits, symmetric), activations float
             (encoder_model_int4.onnx, decoder_model_merged_int4.onnx). Smaller still; run here
             on the CPU and its largest difference from float32 recorded.

Only int8 has been made and measured with real models (2026-11-15). The others are written the
same way from the same checked float32 graphs; all four have been made from the tiny model of
tiny.py (2026-11-18), not yet from a real one.

Every Reshape is written with allowzero=0 (graphs.clear_reshape_allowzero): ONNX Runtime's
DirectML provider refuses the allowzero=1 torch.onnx.export writes. A folder made before
2026-11-18 has allowzero=1 and does not run on DirectML.

The graphs are written with torch.onnx.export from the model's own layers (graphs.py),
and compared with transformers' forward pass before they are quantized: the encoder output
and the logits of the first and of every cached decoder step have to agree. manifest.json
records the largest difference seen. The vocabulary matrix is then stored once
(graphs.share_vocabulary); the quantized graphs have to give exactly the same outputs
before and after.

Every input is pinned to a commit of the model's own repository, and the Python packages
are the versions in requirements.txt next to this file, so that the same command gives the
same graphs. manifest.json records the hashes of the run that made them.

Nothing here is used by the app at run time. It needs PyTorch and several times the
model's size in memory: about 15 GB for the 418M/600M models, 30 GB for 1.2B/1.3B, and
more than 50 GB for 3.3B.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

import graphs
import numpy as np

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
# The folder name a user's model may have (native/translate-onnx, "自分で用意したモデル").
NAME = re.compile(r"(?!\.)[A-Za-z0-9._-]{1,64}")
ENCODER = "encoder_model_quantized.onnx"
DECODER = "decoder_model_merged_quantized.onnx"
PROTOBUF_LIMIT = graphs.PROTOBUF_LIMIT
# Token ids for the check against transformers: two sources, one padded (id 1), and the
# decoder input from its start token (id 2). Any ids of the vocabulary serve.
CHECK_SOURCE = [[5, 100, 200, 300, 400, 2], [5, 150, 250, 2, 1, 1]]
CHECK_TARGET = [[2, 5, 77, 88, 99, 1234], [2, 5, 66, 55, 44, 4321]]
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
    """The graph file and its external data, if any (named .onnx_data or .data)."""
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


def sentencepiece_bpe(spm_file):
    """A `tokenizers` Tokenizer that segments as a SentencePiece BPE model does.

    Built from the model file the way transformers' converter built it up to 4.57 (its
    5.x converter fails for BPE models): the pieces in id order, the merges ordered by
    the score of the piece they make, SentencePiece's own normalization, and Metaspace.
    The result is the tokenizer.json 4.57 made, byte for byte.
    """
    from sentencepiece import sentencepiece_model_pb2
    from tokenizers import Regex, Tokenizer, decoders, models, normalizers, pre_tokenizers

    proto = sentencepiece_model_pb2.ModelProto()
    proto.ParseFromString(Path(spm_file).read_bytes())
    if proto.trainer_spec.model_type != sentencepiece_model_pb2.TrainerSpec.BPE:
        raise SystemExit("the SentencePiece model is not a BPE model")
    scores = [(piece.piece, piece.score) for piece in proto.pieces]
    vocabulary = {piece: index for index, (piece, _) in enumerate(scores)}
    merges = []
    for piece, score in dict(scores).items():
        local = [(piece[:cut], piece[cut:], score) for cut in range(1, len(piece))
                 if piece[:cut] in vocabulary and piece[cut:] in vocabulary]
        merges += sorted(local, key=lambda merge: (vocabulary[merge[0]], vocabulary[merge[1]]))
    # By score, then the longer left piece, then the longer right piece, highest first.
    merges.sort(key=lambda merge: (merge[2], len(merge[0]), len(merge[1])), reverse=True)
    merges = [(left, right) for left, right, _ in merges]
    tokenizer = Tokenizer(models.BPE(vocabulary, merges, unk_token=proto.trainer_spec.unk_piece,
                                     fuse_unk=True, byte_fallback=False, dropout=None))
    tokenizer.normalizer = normalizers.Sequence([
        normalizers.Precompiled(proto.normalizer_spec.precompiled_charsmap),
        normalizers.Strip(left=False, right=True),
        normalizers.Replace(Regex(" {2,}"), "\u2581"),
    ])
    tokenizer.pre_tokenizer = pre_tokenizers.Metaspace(replacement="\u2581", prepend_scheme="always", split=True)
    tokenizer.decoder = decoders.Metaspace(replacement="\u2581", prepend_scheme="always", split=True)
    return tokenizer


def m2m100_tokenizer(source, target):
    """tokenizer.json for SentencePiece's segmentation, and vocab.json for the model's ids.

    The model's vocabulary (vocab.json) is not SentencePiece's: 390 pieces SentencePiece can
    produce are not in it, and the app's tokenizer turns them into <unk>. So the tokenizer
    gives pieces, and vocab.json gives their ids.
    """
    import sentencepiece
    from tokenizers import AddedToken, Tokenizer
    from transformers.models.m2m_100.tokenization_m2m_100 import FAIRSEQ_LANGUAGE_CODES

    spm_file = str(source / "sentencepiece.bpe.model")
    converted = sentencepiece_bpe(spm_file)
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


def float_graphs(source, float_dir):
    """The float32 graphs, written and checked against transformers; the largest difference."""
    import torch
    from transformers import M2M100ForConditionalGeneration

    model = M2M100ForConditionalGeneration.from_pretrained(
        str(source), dtype=torch.float32, attn_implementation="eager").eval()
    if not (float_dir / "decoder_with_past_model.onnx").exists():
        graphs.export_float(model, float_dir)
        gc.collect()
    difference = graphs.verify(model, float_dir, CHECK_SOURCE, CHECK_TARGET)
    # The quantization that follows needs the memory the model holds.
    del model
    gc.collect()
    return difference


VARIANTS = ("int8", "float32", "float16", "int4")
GRAPH_NAMES = {
    "int8": (ENCODER, DECODER),
    "float32": ("encoder_model.onnx", "decoder_model_merged.onnx"),
    "float16": ("encoder_model_fp16.onnx", "decoder_model_merged_fp16.onnx"),
    "int4": ("encoder_model_int4.onnx", "decoder_model_merged_int4.onnx"),
}


def save_model(model, target):
    """One file, or the weights beside it when over 2 GB."""
    import onnx
    large = sum(tensor.ByteSize() for tensor in model.graph.initializer) > PROTOBUF_LIMIT * 0.9
    onnx.save(model, str(target), save_as_external_data=large, all_tensors_to_one_file=True,
              location=target.name + "_data")


def to_float16(source, target):
    """float16 weights and computation; the inputs and outputs stay float32."""
    import onnx
    from onnxruntime.transformers.float16 import convert_float_to_float16
    model = onnx.load(str(source), load_external_data=True)
    # Softmax over the vocabulary and the layer norms keep float32 where ONNX Runtime's
    # converter keeps them by default.
    converted = convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=True)
    # The converter leaves the Cast of each float32 input after the nodes that read it.
    graphs.sort_nodes(converted.graph)
    save_model(converted, target)


def to_int4(source, target):
    """int4 weights of every MatMul with a constant weight, blocks of 32, symmetric."""
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    model = onnx.load(str(source), load_external_data=True)
    quantizer = MatMulNBitsQuantizer(model, block_size=32, is_symmetric=True, bits=4)
    quantizer.process()
    save_model(quantizer.model.model, target)


def export(name, output, work, variant="int8"):
    """A model of MODELS, fetched at its pinned commit."""
    from huggingface_hub import snapshot_download

    spec = MODELS[name]
    source = Path(snapshot_download(spec["repo"], revision=spec["revision"], allow_patterns=[
        "config.json", "generation_config.json", "pytorch_model*", "tokenizer.json", "tokenizer_config.json",
        "special_tokens_map.json", "sentencepiece.bpe.model", "vocab.json"]))
    return build(name, dict(spec, source=dict(repository=spec["repo"], revision=spec["revision"])), source,
                 output, work, variant)


def local_spec(source, family, license):
    """The spec of a model folder on this disk (a fine-tuned M2M100 or NLLB, for instance)."""
    if family not in LANGUAGE_TOKEN:
        raise SystemExit(f"the family is one of {sorted(LANGUAGE_TOKEN)}")
    if not license.strip():
        raise SystemExit("name the licence of the weights (--license)")
    return dict(family=family, license=license.strip(), source=dict(folder=Path(source).name))


def build(name, spec, source, output, work, variant="int8"):
    """Write OUTPUT/<name>-onnx-<variant>/ from a transformers model folder (`source`).

    `spec` names the family, the licence and, for manifest.json, where the weights came from.
    """
    from importlib.metadata import version

    if not NAME.fullmatch(f"{name}-onnx-{variant}"):
        raise SystemExit("the name may hold letters, digits, '.', '_' and '-' (the folder name, 64 at most)")
    float_dir = work / (name + "-onnx-float")
    # The decoders are merged after quantization: merged in float they pass 2 GB.
    difference = float_graphs(source, float_dir)
    config = json.loads((source / "config.json").read_text(encoding="utf-8"))
    kind = variant
    encoder, decoder = GRAPH_NAMES[variant]
    target = output / f"{name}-onnx-{kind}"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    variant_difference = None
    if variant in ("float16", "int4"):
        convert = to_float16 if variant == "float16" else to_int4
        convert(float_dir / "encoder_model.onnx", target / encoder)
        with tempfile.TemporaryDirectory(dir=work) as temporary:
            temporary = Path(temporary)
            convert(float_dir / "decoder_model.onnx", temporary / "decoder.onnx")
            convert(float_dir / "decoder_with_past_model.onnx", temporary / "decoder_with_past.onnx")
            graphs.merge_decoders(temporary / "decoder.onnx", temporary / "decoder_with_past.onnx", target / decoder)
        if variant == "int4":
            # The largest difference from the float32 graphs on the check input, for the record.
            float_target = work / (name + "-onnx-float32-check")
            if not (float_target / "decoder_model_merged.onnx").exists():
                float_target.mkdir(parents=True, exist_ok=True)
                save_float(float_dir / "encoder_model.onnx", float_target / "encoder_model.onnx")
                graphs.merge_decoders(float_dir / "decoder_model.onnx", float_dir / "decoder_with_past_model.onnx",
                                      float_target / "decoder_model_merged.onnx")
            args = (CHECK_SOURCE, CHECK_TARGET, config["pad_token_id"], config["decoder_layers"])
            reference = graphs.run_graphs(float_target, "encoder_model.onnx", "decoder_model_merged.onnx", *args)
            got = graphs.run_graphs(target, encoder, decoder, *args)
            variant_difference = max(float(np.max(np.abs(a - b))) for a, b in zip(got, reference))
    elif variant == "int8":
        quantize(float_dir / "encoder_model.onnx", target / encoder)
        with tempfile.TemporaryDirectory(dir=work) as temporary:
            temporary = Path(temporary)
            quantize(float_dir / "decoder_model.onnx", temporary / "decoder.onnx")
            quantize(float_dir / "decoder_with_past_model.onnx", temporary / "decoder_with_past.onnx")
            graphs.merge_decoders(temporary / "decoder.onnx", temporary / "decoder_with_past.onnx", target / decoder)
        for graph in (encoder, decoder):
            graphs.check_quantized(target / graph)
        # The vocabulary matrix once on the disk; the outputs have to stay exactly the same.
        def run():
            return graphs.run_graphs(target, encoder, decoder, CHECK_SOURCE, CHECK_TARGET,
                                     config["pad_token_id"], config["decoder_layers"])
        before = run()
        graphs.share_vocabulary(target, encoder, decoder, config["vocab_size"], config["d_model"])
        after = run()
        if len(before) != len(after) or not all(np.array_equal(a, b) for a, b in zip(before, after)):
            raise SystemExit("storing the vocabulary once changed the outputs")
    else:
        save_float(float_dir / "encoder_model.onnx", target / encoder)
        graphs.merge_decoders(float_dir / "decoder_model.onnx", float_dir / "decoder_with_past_model.onnx",
                              target / decoder)

    if spec["family"] == "m2m100":
        vocabulary, languages = m2m100_tokenizer(source, target)
    else:
        vocabulary, languages = nllb_tokenizer(source, target)
    (target / "vocab.json").write_text(json.dumps(vocabulary, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    generation_file = source / "generation_config.json"
    generation = json.loads(generation_file.read_text(encoding="utf-8")) if generation_file.is_file() else {}
    inputs, outputs = decoder_io(target / decoder)
    files = {path.name: dict(size=path.stat().st_size, sha256=sha256(path))
             for path in sorted(target.iterdir()) if path.name != "manifest.json"}
    manifest = dict(
        schema=2,
        name=f"{name}-onnx-{kind}",
        family=spec["family"],
        variant=variant,
        license=spec["license"],
        source=spec["source"],
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
        # The largest difference from transformers' forward pass of the float32 graphs.
        verified_max_difference=difference,
        # int4 only: the largest difference of its outputs from the float32 graphs'.
        variant_max_difference=variant_difference,
        made_with={package: version(package) for package in (
            "torch", "transformers", "onnx", "onnxscript", "onnxruntime", "tokenizers", "sentencepiece")},
    )
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("model", help=f"one of {', '.join(sorted(MODELS))}; with --source, the name of the folder to write")
    parser.add_argument("--output", type=Path, required=True, help="folder to write <name>-onnx-<variant> into")
    parser.add_argument("--variant", choices=VARIANTS, default="int8", help="the quantization (default int8)")
    parser.add_argument("--float32", action="store_true", help="the same as --variant float32")
    parser.add_argument("--work", type=Path,
                        help="folder for the float export, kept for a second run; OUTPUT/work unless given")
    parser.add_argument("--source", type=Path,
                        help="a transformers model folder on this disk instead of a pinned download "
                             "(M2M100ForConditionalGeneration: config.json, the weights, and the tokenizer files)")
    parser.add_argument("--family", choices=sorted(LANGUAGE_TOKEN), help="with --source: m2m100 or nllb")
    parser.add_argument("--license", help="with --source: the licence of the weights, written to manifest.json")
    args = parser.parse_args()
    work = args.work or args.output / "work"
    work.mkdir(parents=True, exist_ok=True)
    variant = "float32" if args.float32 else args.variant
    if args.source is not None:
        if args.family is None or args.license is None:
            parser.error("--source needs --family and --license")
        target = build(args.model, local_spec(args.source, args.family, args.license), args.source, args.output, work,
                       variant)
    elif args.model in MODELS:
        target = export(args.model, args.output, work, variant=variant)
    else:
        parser.error(f"unknown model {args.model}; give --source for a model folder of your own")
    print(target)
    for name, pin in json.loads((target / "manifest.json").read_text(encoding="utf-8"))["files"].items():
        print(f"  {pin['sha256']}  {pin['size']:>12}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
