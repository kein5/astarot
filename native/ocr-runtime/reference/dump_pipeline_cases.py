#!/usr/bin/env python3
"""Record what the Python pipeline's pure steps return (tests/pipeline_conformance.rs).

Run after dump_reference.py, with the reference environment's Python:

    $REF/venv/bin/python native/ocr-runtime/reference/dump_pipeline_cases.py

For every picture of the engine fixtures it takes the words the Python reader returned
and records, with the application's own functions:

  frames (region path):   groupLines → per block: line indices, blockBounds,
                          looksLikeChatbox and _mergeWords
  crops (detector path):  looksLikeChatbox and _mergeWords of all words

plus _similar and the case-insensitive key on generated string pairs, and the
chatbox detector's output (BubbleDetector.detect) on the lab frames when the detector
download is present. Writes $REF/fixtures/pipeline/*.json; prints counts only.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[2] / 'src-python'))
from setup_reference import reference_dir  # noqa: E402


def blocks_case(img, words, splits):
    from models.ocr.ocr_detection import blockBounds, groupLines, looksLikeChatbox
    from models.ocr.ocr_pipeline import OcrPipeline

    if not splits:
        return {'chatbox': bool(looksLikeChatbox(img, words)), 'merged': OcrPipeline._mergeWords(words)}
    ids = {id(w): i for i, w in enumerate(words)}
    out = []
    for block in groupLines(words):
        bounds = blockBounds(block)
        out.append({'lines': [ids[id(w)] for w in block], 'bounds': list(bounds) if bounds else None,
                    'chatbox': bool(looksLikeChatbox(img, block)), 'merged': OcrPipeline._mergeWords(block)})
    return {'blocks': out}


def text_cases(rng):
    from models.ocr.ocr_pipeline import _similar, _textHash

    alphabet = list('abcdeABCDE ') + list('はいいえこんにちは') + ['ß', 'SS', 'ẞ', 'İ', 'ς', 'σ', 'Σ', 'ﬁ']
    pairs = []
    for _ in range(3000):
        a = ''.join(rng.choice(alphabet, int(rng.integers(0, 14))))
        b = list(a)
        for _ in range(int(rng.integers(0, 4))):
            op = rng.integers(0, 3)
            if op == 0 and b:
                del b[int(rng.integers(0, len(b)))]
            elif op == 1:
                b.insert(int(rng.integers(0, len(b) + 1)), str(rng.choice(alphabet)))
            elif b:
                b[int(rng.integers(0, len(b)))] = str(rng.choice(alphabet))
        b = ''.join(b)
        if rng.random() < 0.2:
            b = b.upper() if rng.random() < 0.5 else b.lower()
        pairs.append({'a': a, 'b': b, 'similar': _similar(a, b), 'same_key': _textHash(a) == _textHash(b)})
    return pairs


def detector_cases(ref):
    from models.ocr.ocr_bubble_detector import BubbleDetector
    from models.ocr.ocr_models import OcrModelsMissing, resolveArtifact
    from models.model_downloads.catalog import DETECTOR_MODEL_ID

    try:
        path = resolveArtifact(ref / 'downloaded_models', DETECTOR_MODEL_ID, 'detector')
    except OcrModelsMissing:
        return None
    detector = BubbleDetector(model_path=path, confidence=0.7)
    out = []
    for file in sorted((ref / 'images' / 'lab-frames').glob('*.png')) + sorted((ref / 'images' / 'synthetic-ja').glob('frame-*.png')):
        frame = cv2.imread(str(file), cv2.IMREAD_COLOR)
        tensor, scale = detector._letterbox(frame)
        found = detector.detect(frame)
        out.append({'set': file.parent.name, 'file': file.name, 'canvas': list(tensor.shape), 'scale': scale,
                    'boxes': [list(map(int, bbox)) for bbox, _crop in found]})
    return out


def main():
    ref = reference_dir()
    out = ref / 'fixtures' / 'pipeline'
    out.mkdir(parents=True, exist_ok=True)
    cases = []
    for fixture in sorted((ref / 'fixtures' / 'engine').glob('*.json')):
        if fixture.name == 'characters.json':
            continue
        data = json.loads(fixture.read_text())
        for picture in data['pictures']:
            img = cv2.imread(str(ref / 'images' / fixture.stem / picture['file']), cv2.IMREAD_COLOR)
            splits = picture['file'].startswith('frame') or fixture.stem == 'lab-frames'
            cases.append({'set': fixture.stem, 'file': picture['file'], 'splits': splits,
                          **blocks_case(img, picture['words'], splits)})
    (out / 'blocks.json').write_text(json.dumps(cases, ensure_ascii=False))
    print(f'blocks: {len(cases)} pictures')
    pairs = text_cases(np.random.default_rng(281))
    (out / 'text.json').write_text(json.dumps(pairs, ensure_ascii=False))
    print(f'text: {len(pairs)} pairs')
    detections = detector_cases(ref)
    if detections is not None:
        (out / 'detector.json').write_text(json.dumps(detections))
        print(f'detector: {len(detections)} frames, {sum(len(d["boxes"]) for d in detections)} chatboxes')


if __name__ == '__main__':
    main()
