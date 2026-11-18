"""A tiny model with random weights, written through export.py, to check where models run.

    python tools/translation_onnx/tiny.py --output OUT [--variants int8,float32,float16,int4]

OUT/tiny-nllb-onnx-<variant>/ is a folder native/translate-onnx loads like a real one: the
NLLB form (M2M100ForConditionalGeneration, 2 layers, width 64, 4400 tokens), a word-level
tokenizer whose words are w206, w207, ... and every NLLB language code. Nothing is downloaded,
so it serves to check a graph on an execution provider (DirectML, CUDA, ...) on any PC, and to
compare the providers with each other: `vrct-translate --device` runs it, and the test
`a_device_decodes_as_the_cpu_does` (native/translate-onnx/tests/real.rs) compares the ids.

Its translations mean nothing and its speed says nothing about a real model's.
"""
import argparse
import json
import sys
from pathlib import Path

import export

SEED = 0
VOCABULARY_SIZE = 4400
SPECIALS = ["<s>", "<pad>", "</s>", "<unk>"]


def write_source(folder):
    """The transformers folder: random weights, config, and the word-level tokenizer."""
    import torch
    from tokenizers import Tokenizer, models, pre_tokenizers, decoders
    from transformers import M2M100Config, M2M100ForConditionalGeneration
    from transformers.models.nllb.tokenization_nllb import FAIRSEQ_LANGUAGE_CODES

    folder.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    config = M2M100Config(vocab_size=VOCABULARY_SIZE, d_model=64, encoder_layers=2, decoder_layers=2,
                          encoder_attention_heads=4, decoder_attention_heads=4, encoder_ffn_dim=128,
                          decoder_ffn_dim=128, max_position_embeddings=1024, pad_token_id=1, bos_token_id=0,
                          eos_token_id=2, decoder_start_token_id=2, scale_embedding=True, activation_function="relu")
    model = M2M100ForConditionalGeneration(config).eval()
    model.save_pretrained(str(folder))

    tokens = SPECIALS + list(FAIRSEQ_LANGUAGE_CODES)
    tokens += [f"w{index}" for index in range(len(tokens), VOCABULARY_SIZE)]
    tokenizer = Tokenizer(models.WordLevel({token: index for index, token in enumerate(tokens)}, unk_token="<unk>"))
    tokenizer.pre_tokenizer = pre_tokenizers.WhitespaceSplit()
    tokenizer.decoder = decoders.WordPiece(prefix="##")
    tokenizer.save(str(folder / "tokenizer.json"))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--variants", default=",".join(export.VARIANTS))
    args = parser.parse_args()
    source = args.output / "work" / "tiny-nllb-source"
    if not (source / "config.json").exists():
        write_source(source)
    spec = dict(family="nllb", license="none (random weights, for tests only)",
                source=dict(generated="tools/translation_onnx/tiny.py", seed=SEED))
    for variant in args.variants.split(","):
        target = export.build("tiny-nllb", spec, source, args.output, args.output / "work", variant)
        manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
        print(target, manifest["verified_max_difference"], manifest.get("variant_max_difference"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
