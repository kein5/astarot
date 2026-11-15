#!/usr/bin/env python3
"""Generate the tiny HuBERT checkpoint under tests/data/tiny_hubert.

A Transformers-format folder (config.json, pytorch_model.bin) with random weights and a
tiny layout, saved in half precision like the real `hubert_base`, plus the stock
`transformers.HubertModel` output for a random input. It lets the graph built from a
checkpoint (src/hubert.rs) be tested without downloading anything. No trained weights.

Run with the reference environment's interpreter.
"""
import json
from pathlib import Path

import numpy as np
import torch
from transformers import HubertConfig, HubertModel

DATA = Path(__file__).resolve().parent.parent / 'tests' / 'data' / 'tiny_hubert'
CONFIG = dict(hidden_size=16, num_hidden_layers=9, num_attention_heads=2, intermediate_size=32,
              conv_dim=[8, 8], conv_kernel=[10, 3], conv_stride=[5, 2], conv_bias=False,
              num_conv_pos_embeddings=4, num_conv_pos_embedding_groups=2, classifier_proj_size=4,
              feat_extract_norm='group', feat_extract_activation='gelu', hidden_act='gelu',
              do_stable_layer_norm=False, feat_proj_layer_norm=True, layer_norm_eps=1e-5,
              model_type='hubert')


def main():
    torch.manual_seed(20261115)
    torch.set_grad_enabled(False)
    DATA.mkdir(parents=True, exist_ok=True)
    config = HubertConfig(**CONFIG)
    model = HubertModel(config).eval()
    final_proj = torch.nn.Linear(config.hidden_size, config.classifier_proj_size)
    # Random layer norms too, so a swapped weight and bias would show.
    for name, tensor in model.state_dict().items():
        if 'norm' in name:
            tensor.copy_(torch.randn_like(tensor) * 0.3 + (1.0 if name.endswith('weight') else 0.0))
    state = {key: value.half() for key, value in model.state_dict().items()}
    state.update({'final_proj.' + key: value.half() for key, value in final_proj.state_dict().items()})
    torch.save(state, DATA / 'pytorch_model.bin')
    (DATA / 'config.json').write_text(json.dumps(CONFIG, indent=1) + '\n')
    # Run with the rounded weights, as a reader of the saved file would.
    model.load_state_dict({key: value.float() for key, value in state.items() if not key.startswith('final_proj.')})
    final_proj.load_state_dict({key.removeprefix('final_proj.'): value.float() for key, value in state.items() if key.startswith('final_proj.')})
    audio = np.random.default_rng(7).standard_normal((1, 1234)).astype(np.float32) * 0.1
    output = model(torch.from_numpy(audio), output_hidden_states=True)
    np.save(DATA / 'audio.npy', audio[0])
    np.save(DATA / 'features_v2.npy', output.last_hidden_state[0].numpy())
    np.save(DATA / 'features_v1.npy', final_proj(output.hidden_states[9])[0].numpy())
    print('wrote', DATA)


if __name__ == '__main__':
    main()
