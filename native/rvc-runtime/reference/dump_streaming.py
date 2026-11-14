#!/usr/bin/env python3
"""Run the reference's real-time engine block by block and record what the streaming
conformance tests compare (specification sections 9.3 and 12).

Like `dump_reference.py`, this drives the reference as a black box: it calls the public
entry points (the real-time engine's per-block `infer` and the synthesizer's `infer` with
a window) and records the values that cross them. Nothing from the reference is copied
into the runtime.

Two kinds of case are written under `<reference>/fixtures/`:

- `window_<model>`: the synthesizer alone, given the features and pitch of an offline
  fixture, asked for `return_length` frames after `skip_head` frames of context.
- `stream_<model>`: a whole input converted block by block. The input buffer is moved by
  one block per call, as the reference's real-time window does at a 16 kHz device rate;
  every block's window, pitch extraction, synthesizer inputs and output are stored. No
  input filter is applied (the reference's real-time path has none).

All noise is zero. Run it with the reference environment's interpreter:

    <reference>/venv/bin/python dump_streaming.py
"""
import argparse
import json
import sys
import types
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dump_reference import Reference, load_speech  # noqa: E402
from setup_reference import reference_dir  # noqa: E402

# Block layout in 10 ms frames: the reference GUI's defaults are 0.25 s blocks, 0.05 s
# crossfade and 2.5 s extra context; the context is shortened here to keep the run small.
LAYOUT = dict(block=25, crossfade=5, search=1, extra=100)


def zero_noise(torch):
    saved = torch.randn_like, torch.rand, torch.randn

    def zeros(*size, **k):
        return torch.zeros(*size, **{key: k[key] for key in ('device', 'dtype') if key in k})

    torch.randn_like = lambda tensor, *a, **k: torch.zeros_like(tensor)
    torch.rand = zeros
    torch.randn = zeros
    return saved


def window_case(reference, name, model_path, offline_case, skip_head, return_length, sid):
    torch = reference.torch
    source = reference.root / 'fixtures' / offline_case
    out = reference.root / 'fixtures' / name
    out.mkdir(parents=True, exist_ok=True)
    checkpoint = torch.load(model_path, map_location='cpu', weights_only=True)
    net = reference.synthesizer(checkpoint)
    if_f0 = checkpoint.get('f0', 1)
    feats = np.load(source / 'synth_feats_0.npy')
    frames = feats.shape[0]
    arguments = [torch.from_numpy(feats)[None], torch.LongTensor([frames])]
    if if_f0 == 1:
        pitch, pitchf = np.load(source / 'synth_pitch_0.npy'), np.load(source / 'synth_pitchf_0.npy')
        arguments += [torch.from_numpy(pitch)[None], torch.from_numpy(pitchf)[None]]
    arguments.append(torch.LongTensor([sid]))
    saved = zero_noise(torch)
    try:
        head, length = torch.LongTensor([skip_head]), torch.LongTensor([return_length])
        audio = net.infer(*arguments, head, length, length)[0]
    finally:
        torch.randn_like, torch.rand, torch.randn = saved
    np.save(out / 'audio.npy', audio.detach().cpu().numpy().astype(np.float32).reshape(-1))
    case = {'model': str(model_path), 'source': offline_case, 'skip_head': skip_head,
            'return_length': return_length, 'sid': sid, 'frames': frames, 'f0': int(if_f0),
            'sample_rate': int(checkpoint['config'][-1])}
    (out / 'case.json').write_text(json.dumps(case, indent=2) + '\n')
    print(f'{name}: {return_length} frames after {skip_head}', flush=True)


def stream_case(reference, name, model_path, audio, *, index_path=None, index_rate=0.0, transpose=0, layout=LAYOUT):
    torch = reference.torch
    import infer.rtrvc as rtrvc
    out = reference.root / 'fixtures' / name
    out.mkdir(parents=True, exist_ok=True)
    config = types.SimpleNamespace(device=torch.device('cpu'), is_half=False, use_jit=False, dml=False, n_cpu=1)
    rvc = rtrvc.RVC(transpose, 0, str(model_path), str(index_path) if index_path else '', index_rate, config)
    if rvc.net_g is None:
        raise RuntimeError('the reference engine did not load the model')
    if rvc.if_f0 == 1:
        # The engine would load the extractor from a path relative to its own folder.
        from infer.rmvpe import RMVPE
        rvc.model_rmvpe = RMVPE(str(reference.root / 'assets' / 'rmvpe' / 'rmvpe.pt'), is_half=False, device=config.device)
    block_16k = layout['block'] * 160
    window_frames = layout['extra'] + layout['crossfade'] + layout['search'] + layout['block']
    skip_head = layout['extra']
    return_length = layout['block'] + layout['crossfade'] + layout['search']
    record = {'f0': [], 'hubert': [], 'synth': []}

    real_features = rtrvc.extract_hubert_features

    def features(model, source, version, *a, **k):
        result = real_features(model, source, version, *a, **k)
        record['hubert'].append(result.detach().cpu().numpy().copy())
        return result

    real_get_f0 = rvc.get_f0

    def get_f0(x, f0_up_key, *a, **k):
        result = real_get_f0(x, f0_up_key, *a, **k)
        record['f0'].append((np.asarray(x.detach().cpu() if hasattr(x, 'detach') else x).copy(),
                             [np.asarray(value.detach().cpu() if hasattr(value, 'detach') else value).copy() for value in result]))
        return result

    real_infer = rvc.net_g.infer

    def infer(*arguments, **keywords):
        result = real_infer(*arguments, **keywords)
        tensors = [value.detach().cpu().numpy().copy() for value in arguments if hasattr(value, 'detach')]
        record['synth'].append(tensors)
        return result

    rtrvc.extract_hubert_features = features
    rvc.get_f0 = get_f0
    rvc.net_g.infer = infer
    saved = zero_noise(torch)
    window = np.zeros(window_frames * 160, dtype=np.float32)
    blocks = len(audio) // block_16k
    try:
        for number in range(blocks):
            window[:-block_16k] = window[block_16k:]
            window[-block_16k:] = audio[number * block_16k:(number + 1) * block_16k]
            output = rvc.infer(torch.from_numpy(window.copy()), block_16k, skip_head, return_length, 'rmvpe')
            np.save(out / f'window_{number}.npy', window.copy())
            np.save(out / f'output_{number}.npy', output.detach().cpu().numpy().astype(np.float32).reshape(-1))
            np.save(out / f'hubert_{number}.npy', record['hubert'][-1].astype(np.float32).reshape(-1, record['hubert'][-1].shape[-1]))
            tensors = record['synth'][-1]
            np.save(out / f'synth_feats_{number}.npy', tensors[0].astype(np.float32).reshape(-1, tensors[0].shape[-1]))
            if rvc.if_f0 == 1:
                np.save(out / f'synth_pitch_{number}.npy', tensors[2].astype(np.int64).reshape(-1))
                np.save(out / f'synth_pitchf_{number}.npy', tensors[3].astype(np.float32).reshape(-1))
                x, (pitch, pitchf) = record['f0'][-1][0], record['f0'][-1][1][:2]
                np.save(out / f'f0_input_{number}.npy', x.astype(np.float32).reshape(-1))
                np.save(out / f'f0_pitch_{number}.npy', pitch.astype(np.int64).reshape(-1))
                np.save(out / f'f0_pitchf_{number}.npy', pitchf.astype(np.float32).reshape(-1))
    finally:
        torch.randn_like, torch.rand, torch.randn = saved
        rtrvc.extract_hubert_features = real_features
    np.save(out / 'input_16k.npy', audio.astype(np.float32))
    case = {'model': str(model_path), 'index': str(index_path) if index_path else None, 'index_rate': index_rate,
            'transpose': transpose, 'blocks': blocks, 'layout': layout, 'skip_head': skip_head,
            'return_length': return_length, 'f0': int(rvc.if_f0), 'version': rvc.version,
            'sample_rate': int(rvc.tgt_sr)}
    (out / 'case.json').write_text(json.dumps(case, indent=2) + '\n')
    print(f'{name}: {blocks} blocks', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--only', help='run only the cases whose name contains this text')
    arguments = parser.parse_args()
    root = reference_dir()
    reference = Reference(root)
    speech = load_speech(root)
    models = root / 'fixtures' / 'models'
    voice, index = root / 'model' / 'model.pth', root / 'model' / 'model.index'
    windows = [
        ('window_saisho_48k', voice, 'saisho_48k_zero', 0),
        ('window_pretrained_40k', models / 'pretrained_v2_40k.pth', 'pretrained_40k_zero', 0),
        ('window_random_v1_f0_40k', models / 'random_v1_f0_40k.pth', 'random_v1_f0_40k_zero', 2),
        ('window_random_v2_nof0_48k', models / 'random_v2_nof0_48k.pth', 'random_v2_nof0_48k_zero', 2),
    ]
    # Two layouts: a window that starts inside the flow context, and one that starts after it.
    for name, model, source, sid in windows:
        for skip_head, return_length in ((10, 31), (300, 31)):
            case = f'{name}_{skip_head}'
            if arguments.only and arguments.only not in case:
                continue
            if model.exists() and (root / 'fixtures' / source / 'case.json').exists():
                window_case(reference, case, model, source, skip_head, return_length, sid)
            else:
                print(f'{case}: skipped, model or offline fixture missing', flush=True)
    streams = [
        ('stream_saisho_48k', dict(model_path=voice, index_path=index, index_rate=0.75, transpose=0)),
        ('stream_pretrained_40k', dict(model_path=models / 'pretrained_v2_40k.pth', transpose=3)),
        ('stream_random_v2_nof0_48k', dict(model_path=models / 'random_v2_nof0_48k.pth')),
    ]
    for name, options in streams:
        if arguments.only and arguments.only not in name:
            continue
        if not Path(options['model_path']).exists():
            print(f'{name}: skipped, model file is missing', flush=True)
            continue
        stream_case(reference, name, audio=speech, **options)


if __name__ == '__main__':
    main()
