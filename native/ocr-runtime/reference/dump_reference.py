#!/usr/bin/env python3
"""Build the OCR test picture set and record what the Python implementation reads.

Run with the reference environment's Python after setup_reference.py:

    $REF/venv/bin/python native/ocr-runtime/reference/dump_reference.py [--lab DIR]

Writes, under $REF (~/.cache/vrct-vox/ocr-reference):

  images/<set>/*.png         the pictures
  fixtures/engine/<set>.json what src-python/models/ocr reads from them: per picture the
                             language, RapidOCR's boxes, texts and scores, and the
                             readtext_bgr_or_raise words (min_confidence 0.55)

Picture sets:

  synthetic-*   VRChat-like frames drawn here: chatbox bubbles (dark panel, white text)
                and world text, in Japanese/English/Chinese and in the five scripts that
                need their own models. Fonts: the repository's Noto Sans JP/KR/SC and the
                system's Noto Sans (Latin/Cyrillic), Thai, Arabic and Devanagari.
  lab-crops     chatbox crops (detector bounds plus 4 px) from the chatbox lab's
                validation frames, read the way the detector path reads them
  lab-frames    whole validation frames, read the way the region path reads them

The lab frames are VRCT-VOX's own captures (tools/chatbox_lab) and may not be published;
they are only read locally, and only counts are printed. Without --lab or the default
~/.cache/vrct-vox-chatbox-lab/dataset the lab sets are skipped.

The application's code is used as it is: models.ocr.ocr_engine_rapidocr.getReader with
the files ocr_models.resolveModelFiles verified, so this records exactly what the
application reads. Recognised text goes to the fixture files only.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO_ROOT / 'src-python'))
from setup_reference import reference_dir  # noqa: E402

REPO_FONTS = REPO_ROOT / 'src-python' / 'models' / 'overlay' / 'fonts'
SYSTEM_FONTS = Path('/usr/share/fonts/noto')

# (set name, language setting, font, lines per bubble)
SCRIPTS = (
    ('synthetic-ja', 'auto', REPO_FONTS / 'NotoSansJP-Regular.ttf', [
        ['こんにちは！'], ['今日はいい天気ですね。', 'どこから来ましたか？'], ['Hello, nice to meet you!'],
        ['ワールドの移動、', 'ちょっと待ってて'], ['I am from Japan.', 'How about you?'], ['ありがとう'],
        ['VRChat歴は2年くらいです'], ['Let\'s go to the next world'], ['また明日ね〜'], ['OK!'],
        ['フレンド申請送ってもいい？'], ['Where is the mirror?'], ['すごい！', 'きれいな景色だね'],
        ['音声が聞こえないので', 'チャットで話します'], ['gg'], ['集合写真撮ろう！'],
    ]),
    ('synthetic-zh', 'auto', REPO_FONTS / 'NotoSansSC-Regular.ttf', [
        ['你好！'], ['今天天气很好。'], ['我们去下一个世界吧'], ['谢谢你的帮助'], ['你从哪里来？'],
    ]),
    ('synthetic-ko', 'Korean', REPO_FONTS / 'NotoSansKR-Regular.ttf', [
        ['안녕하세요!'], ['오늘 날씨가 좋네요.'], ['어디에서 왔어요?'], ['다음 월드로 가자'], ['감사합니다'],
    ]),
    ('synthetic-ru', 'Russian', SYSTEM_FONTS / 'NotoSans-Regular.ttf', [
        ['Привет!'], ['Как дела?'], ['Откуда ты?'], ['Пойдём в следующий мир'], ['Спасибо большое'],
    ]),
    ('synthetic-th', 'Thai', SYSTEM_FONTS / 'NotoSansThai-Regular.ttf', [
        ['สวัสดีครับ'], ['วันนี้อากาศดี'], ['คุณมาจากไหน'], ['ขอบคุณมาก'], ['ไปโลกถัดไปกัน'],
    ]),
    ('synthetic-ar', 'Arabic', SYSTEM_FONTS / 'NotoSansArabic-Regular.ttf', [
        ['مرحبا'], ['كيف حالك؟'], ['من أين أنت؟'], ['شكرا جزيلا'], ['هيا نذهب'],
    ]),
    ('synthetic-hi', 'Hindi', SYSTEM_FONTS / 'NotoSansDevanagari-Regular.ttf', [
        ['नमस्ते'], ['आप कैसे हैं?'], ['आप कहाँ से हैं?'], ['बहुत धन्यवाद'], ['चलो चलते हैं'],
    ]),
)
SIGNS = ['EXIT', 'Welcome to the club', '営業中', 'MENU 500円', 'Photo spot →']
PANEL = (18, 18, 22, 205)


def scene(rng, width, height):
    base = np.zeros((height, width, 3), np.uint8)
    base[:] = np.linspace(rng.integers(20, 90), rng.integers(150, 230), width)[None, :, None].astype(np.uint8)
    base = (base.astype(np.int16) + rng.integers(-25, 25, (height, width, 3))).clip(0, 255).astype(np.uint8)
    return Image.fromarray(base).convert('RGBA')


def bubble(img, font, center_x, top, lines):
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    boxes, y = [], top
    for line in lines:
        left, t, right, bottom = draw.textbbox((0, 0), line, font=font)
        boxes.append((line, center_x - (right - left) // 2, y, right - left, bottom - t, left, t))
        y += bottom - t + 6
    x0, x1 = min(b[1] for b in boxes) - 18, max(b[1] + b[3] for b in boxes) + 18
    rect = (x0, top - 12, x1, y - 6 + 12)
    draw.rounded_rectangle(rect, radius=14, fill=PANEL)
    for line, x, y, _w, _h, left, t in boxes:
        draw.text((x - left, y - t), line, font=font, fill=(255, 255, 255, 255))
    return Image.alpha_composite(img, overlay), rect


def sign(img, font, x, y, text):
    draw = ImageDraw.Draw(img)
    left, t, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.rectangle((x - 10, y - 8, x + right - left + 10, y + bottom - t + 8), fill=(235, 225, 200, 255))
    draw.text((x - left, y - t), text, font=font, fill=(40, 30, 20, 255))


def bgr(img):
    return np.ascontiguousarray(np.array(img.convert('RGB'))[:, :, ::-1])


def synthetic_sets(root):
    """{set: [(file, language)]}; the frames and per-bubble crops of each script."""
    out = {}
    for name, language, font_path, texts in SCRIPTS:
        if not font_path.is_file():
            print(f'{name}: font missing, skipped')
            continue
        rng = np.random.default_rng(sum(map(ord, name)))
        folder = root / name
        folder.mkdir(parents=True, exist_ok=True)
        items = []
        for index in range(0, len(texts), 2):
            size = int(rng.integers(20, 34))
            font = ImageFont.truetype(str(font_path), size)
            width, height = int(rng.integers(900, 1500)), int(rng.integers(520, 860))
            img = scene(rng, width, height)
            rects = []
            for k, lines in enumerate(texts[index:index + 2]):
                img, rect = bubble(img, font, int(width * (0.3 + 0.4 * k)), int(rng.integers(60, height // 2)), lines)
                rects.append(rect)
            sign(img, ImageFont.truetype(str(REPO_FONTS / 'NotoSansJP-Regular.ttf'), size), int(rng.integers(20, width // 3)),
                 int(rng.integers(height // 2 + 60, height - 60)), SIGNS[index % len(SIGNS)])
            frame = bgr(img)
            file = f'frame-{index:02d}.png'
            cv2.imwrite(str(folder / file), frame)
            items.append((file, language))
            for k, (x0, y0, x1, y1) in enumerate(rects):
                crop = frame[max(0, y0 - 4):y1 + 4, max(0, x0 - 4):x1 + 4]
                file = f'crop-{index:02d}-{k}.png'
                cv2.imwrite(str(folder / file), crop)
                items.append((file, language))
        out[name] = items
    return out


def lab_sets(root, lab, crops_limit, frames_limit):
    annotations = lab / 'annotations' / 'instances_val.json'
    if not annotations.is_file():
        print('lab sets skipped (no chatbox lab dataset)')
        return {}
    data = json.loads(annotations.read_text())
    images = {image['id']: image for image in data['images']}
    out = {'lab-crops': [], 'lab-frames': []}
    (root / 'lab-crops').mkdir(parents=True, exist_ok=True)
    (root / 'lab-frames').mkdir(parents=True, exist_ok=True)
    frames_done = set()
    for annotation in data['annotations']:
        image = images[annotation['image_id']]
        frame = cv2.imread(str(lab / image['file_name']), cv2.IMREAD_COLOR)
        if frame is None:
            continue
        if len(out['lab-crops']) < crops_limit:
            x, y, w, h = (int(round(v)) for v in annotation['bbox'])
            crop = frame[max(0, y - 4):min(frame.shape[0], y + h + 4), max(0, x - 4):min(frame.shape[1], x + w + 4)]
            if crop.size:
                file = f'{annotation["id"]:05d}.png'
                cv2.imwrite(str(root / 'lab-crops' / file), crop)
                out['lab-crops'].append((file, 'auto'))
        if len(frames_done) < frames_limit and image['id'] not in frames_done:
            frames_done.add(image['id'])
            # The region path reads the whole view, longest side at most 2560 (INTER_AREA).
            longest = max(frame.shape[:2])
            if longest > 2560:
                scale = 2560 / float(longest)
                frame = cv2.resize(frame, (max(1, int(frame.shape[1] * scale)), max(1, int(frame.shape[0] * scale))),
                                   interpolation=cv2.INTER_AREA)
            file = f'{image["id"]:05d}.png'
            cv2.imwrite(str(root / 'lab-frames' / file), frame)
            out['lab-frames'].append((file, 'auto'))
        if len(out['lab-crops']) >= crops_limit and len(frames_done) >= frames_limit:
            break
    return out


def record(sets, root, fixtures, model_root):
    from models.ocr import ocr_engine_rapidocr as engine
    from models.ocr.ocr_languages import resolveModelSpec
    from models.ocr.ocr_models import resolveModelFiles

    readers = {}
    for name, items in sets.items():
        results = []
        for file, language in items:
            if language not in readers:
                spec = resolveModelSpec(language)
                readers[language] = engine.getReader(spec, resolveModelFiles(model_root, spec))
            reader = readers[language]
            img = cv2.imread(str(root / name / file), cv2.IMREAD_COLOR)
            result = reader(img)
            boxes = getattr(result, 'boxes', None)
            words = engine.readtext_bgr_or_raise(reader, img, 0.55)
            results.append({
                'file': file, 'language': language,
                'boxes': [] if boxes is None else np.asarray(boxes, np.float32).tolist(),
                'texts': list(getattr(result, 'txts', None) or []),
                'scores': [float(s) for s in (getattr(result, 'scores', None) or [])],
                'words': words,
            })
        (fixtures / f'{name}.json').write_text(json.dumps({'threads': engine.ocr_onnx_threads(), 'pictures': results},
                                                          ensure_ascii=False))
        print(f'{name}: {len(results)} pictures, {sum(len(r["texts"]) for r in results)} lines')


def record_characters(fixtures, model_root):
    """Every recogniser's character list as ocr_models reads it from inference.yml."""
    from models.model_downloads.catalog import CATALOG
    from models.ocr.ocr_models import _characters

    lists = {}
    for model in CATALOG:
        for artifact in model.artifacts:
            if model.target == 'ocr' and artifact.role == 'dict':
                lists[model.id] = _characters(model_root / model.id / model.revision / artifact.filename)
    (fixtures / 'characters.json').write_text(json.dumps(lists, ensure_ascii=False))
    print(f'characters: {len(lists)} lists')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--lab', type=Path, default=Path.home() / '.cache' / 'vrct-vox-chatbox-lab' / 'dataset')
    parser.add_argument('--lab-crops', type=int, default=150)
    parser.add_argument('--lab-frames', type=int, default=40)
    args = parser.parse_args()
    ref = reference_dir()
    images = ref / 'images'
    fixtures = ref / 'fixtures' / 'engine'
    fixtures.mkdir(parents=True, exist_ok=True)
    sets = synthetic_sets(images)
    sets.update(lab_sets(images, args.lab, args.lab_crops, args.lab_frames))
    record(sets, images, fixtures, ref / 'downloaded_models')
    record_characters(fixtures, ref / 'downloaded_models')
    print(f'written to {fixtures}')


if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '1')
    main()
