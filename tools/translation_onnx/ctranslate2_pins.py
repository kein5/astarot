"""Pinned revisions and file hashes of the CTranslate2 translation models the Python backend used.

compare.py downloads these commits and checks every file against its size and SHA-256 before it
translates with them, as the backend did. This was src-python/models/builtin_model_pins.py until
the backend went in 0.6.0 (#285); the app's own translation (native/translate-onnx) does not use
it.

To move a model to a newer upstream commit, update its revision and file list here
(sizes and SHA-256 from https://huggingface.co/api/models/<repo>/revision/<commit>?blobs=true;
files outside Git LFS have no SHA-256 there and must be hashed after downloading them).
Recorded 2026-11-03 from each repository's main branch.
"""

import hashlib
from os import path as os_path

# repo -> {"revision": commit, "files": {name: (size, sha256)}}
MODEL_PINS = {
    "JustFrederik/nllb-200-distilled-600M-ct2-int8": {
        "revision": "302d78f00e6fdb50a1064059df7c392b735e9d05",
        "files": {
            "README.md": (3435, "7c9ab4af8da4a3e82a1dcf6014318a540e3509f31051c470610767521f0b1993"),
            "config.json": (159, "0c2f6fa2057c7264d052fb4a62ba3476eeae70487acddfa8e779a53a00cbf44c"),
            "model.bin": (622595991, "ed1beaf75134de7505315a5223162f56acff397eff6b50638a500d3936fe707b"),
            "sentencepiece.bpe.model": (4852054, "14bb8dfb35c0ffdea7bc01e56cea38b9e3d5efcdcb9c251d6b40538e1aab555a"),
            "shared_vocabulary.txt": (2568098, "a132a83330f45514c2476eb81d1d69b3c41762264d16ce0a7ea982e5d6c728e5"),
            "special_tokens_map.json": (3548, "992bd4ed610d644d6823081937bcc91bb8878dd556cea4ae5327f2480361330e"),
            "tokenizer.json": (17331176, "e316b82de11d0f951f370943b3c438311629547285129b0b81dadabd01bca665"),
            "tokenizer_config.json": (564, "d1aa8c3697d3e35674f97b5b7e9c99d22b010f528e80140257d97316be90d044"),
        },
    },
    "OpenNMT/nllb-200-3.3B-ct2-int8": {
        "revision": "28d998cc8548ad62f4f98cf8860928c3af99b97b",
        "files": {
            "README.md": (8888, "a2575fd91f1b93f60bb85c4c1aba0f00e9d7a0e93296b117ba7143be24a09195"),
            "config.json": (1071, "fa393269e093784425d78115fa8c223722f6432fab71ae972e6e7b869ce916f2"),
            "generation_config.json": (189, "0bb604cdb8392649176935a447ce994128f170a6908c135a17d0e3dfb8113cb2"),
            "model.bin": (3356047962, "b7540c4e19aa2a5079c89241ffccb49711705ca8b1d255cea00c3216dc7d5165"),
            "shared_vocabulary.json": (5921176, "af53bfd0e6f726209e7325e45b87ab3b14e5856f7d42d7b9be91de3287c45267"),
            "special_tokens_map.json": (3548, "992bd4ed610d644d6823081937bcc91bb8878dd556cea4ae5327f2480361330e"),
            "tokenizer.json": (17331176, "e316b82de11d0f951f370943b3c438311629547285129b0b81dadabd01bca665"),
            "tokenizer_config.json": (564, "d1aa8c3697d3e35674f97b5b7e9c99d22b010f528e80140257d97316be90d044"),
        },
    },
    "OpenNMT/nllb-200-distilled-1.3B-ct2-int8": {
        "revision": "70f572adafa4794890ce7826156a4209717855af",
        "files": {
            "README.md": (8872, "b8db7e57036062a57959e8c9f38b73aa63d3820f06db76b80d51cc9f33707983"),
            "config.json": (1071, "bb11352c2579e31d4251500cd3d813beb6ab083c8a60268db52e9698c1c9cda2"),
            "generation_config.json": (189, "0bb604cdb8392649176935a447ce994128f170a6908c135a17d0e3dfb8113cb2"),
            "model.bin": (1377755738, "89dc4b9eb7f4dcd3ff36023c9b1c55fcecb47ddc0df97ab31b068ef9cf194940"),
            "shared_vocabulary.json": (5921176, "af53bfd0e6f726209e7325e45b87ab3b14e5856f7d42d7b9be91de3287c45267"),
            "special_tokens_map.json": (3548, "992bd4ed610d644d6823081937bcc91bb8878dd556cea4ae5327f2480361330e"),
            "tokenizer.json": (17331176, "e316b82de11d0f951f370943b3c438311629547285129b0b81dadabd01bca665"),
            "tokenizer_config.json": (564, "d1aa8c3697d3e35674f97b5b7e9c99d22b010f528e80140257d97316be90d044"),
        },
    },
    "jncraton/m2m100_1.2B-ct2-int8": {
        "revision": "e50078df6be13a88592b70ea42f4d74c2082e448",
        "files": {
            "README.md": (4603, "f4358f5d8ce691958a36ea897b7360c6ec8039dc5c275331d6953a2a8338d30f"),
            "config.json": (189, "4244772990e30069563e3ddfb4ad6dc95bdfd2ac3de667ea8858c9b0a8433fa8"),
            "generation_config.json": (233, "aed76366507333ddbb8bd49960f23c82fe6446b3319a46a54befdb45324ccf61"),
            "model.bin": (1249655149, "c97df052a558895317312470e1ff7cb8eae5416f7ae16214a2983c6853dd3ce5"),
            "sentencepiece.bpe.model": (2423393, "d8f7c76ed2a5e0822be39f0a4f95a55eb19c78f4593ce609e2edbc2aea4d380a"),
            "shared_vocabulary.json": (2796509, "7eb5d0ff184c6095c7c10f9911c0aea492250abd12854f9c3d787c64b1c6397e"),
            "special_tokens_map.json": (1140, "c1a4f86c3874d279ae1b2a05162858db5dd6c61665d84223ed886cbcff08fda6"),
            "tokenizer_config.json": (271, "1566a6cfa4f541a55594c9d5e090f530812d5de7c94882ea3af156962d9933ae"),
            "vocab.json": (3708092, "b6e77e474aeea8f441363aca7614317c06381f3eacfe10fb9856d5081d1074cc"),
        },
    },
    "jncraton/m2m100_418M-ct2-int8": {
        "revision": "7c1b2620a4e58dacecbd8bf89cfd6da7eb9eb7b0",
        "files": {
            "README.md": (4603, "1fd660f130aedc5ecf1796b47ab47d43d3c4b36541f5387b7adb3df75cb5dfdb"),
            "config.json": (189, "4244772990e30069563e3ddfb4ad6dc95bdfd2ac3de667ea8858c9b0a8433fa8"),
            "generation_config.json": (233, "aed76366507333ddbb8bd49960f23c82fe6446b3319a46a54befdb45324ccf61"),
            "model.bin": (490667713, "d6703dd9f920ff896e45c3d97b490761bed5944937b90bbe6a7245f5652542d4"),
            "sentencepiece.bpe.model": (2423393, "d8f7c76ed2a5e0822be39f0a4f95a55eb19c78f4593ce609e2edbc2aea4d380a"),
            "shared_vocabulary.json": (2796509, "7eb5d0ff184c6095c7c10f9911c0aea492250abd12854f9c3d787c64b1c6397e"),
            "special_tokens_map.json": (1140, "c1a4f86c3874d279ae1b2a05162858db5dd6c61665d84223ed886cbcff08fda6"),
            "tokenizer_config.json": (272, "ae54f15f0649bb05041cdadad8485ba1faf40bc33e6b4c2a74ae2d1ae5710fa2"),
            "vocab.json": (3708092, "b6e77e474aeea8f441363aca7614317c06381f3eacfe10fb9856d5081d1074cc"),
        },
    },
}

# Historical tokenizer cache revisions. Kept as provenance; acquisition and
# inference now use the tokenizer files pinned in the CTranslate2 bundles above.
TOKENIZER_REVISIONS = {
    "facebook/m2m100_1.2B": "7b36184180524c1a1bbfa37f120a608046250b98",
    "facebook/m2m100_418M": "55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636",
    "facebook/nllb-200-3.3B": "1a07f7d195896b2114afcb79b7b57ab512e7b43e",
    "facebook/nllb-200-distilled-1.3B": "7be3e24664b38ce1cac29b8aeed6911aa0cf0576",
    "facebook/nllb-200-distilled-600M": "f8d333a098d19b4fd9a8b18f94170487ad3f821d",
}


def tokenizerFilePins(repo: str) -> dict:
    """The tokenizer projection contains only these pinned bundle files."""
    names = ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
             "sentencepiece.bpe.model", "vocab.json")
    return {name: pin for name, pin in MODEL_PINS[repo]["files"].items() if name in names}


def verifyPinnedFile(file_path: str, size: int, sha256: str) -> bool:
    """True when the file has exactly the pinned size and SHA-256."""
    try:
        if os_path.getsize(file_path) != size:
            return False
        digest = hashlib.sha256()
        with open(file_path, "rb") as fp:
            for block in iter(lambda: fp.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest() == sha256
    except OSError:
        return False
