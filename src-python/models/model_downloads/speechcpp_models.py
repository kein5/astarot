"""speech.cpp's model catalog (`speech models --json`), as tools/speechcpp_models.py wrote it.

The snapshot is native/ops/data/speechcpp_models.json, which native/ops compiles in. Run the tool
again with the bundled speech.cpp release instead of editing it.
"""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[3] / 'native' / 'ops' / 'data' / 'speechcpp_models.json'
SNAPSHOT = json.loads(PATH.read_text(encoding='utf-8'))
