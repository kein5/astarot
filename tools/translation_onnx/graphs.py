"""The ONNX graphs of an M2M100 / NLLB-200 model, written with torch.onnx.export.

The model's own layers (their weights and submodules) are used as they are; only the way
they are wired is written here, with the decoder's cache as plain tensors in and out
instead of transformers' cache objects. `verify` compares the graphs with transformers'
own forward pass, so a mistake in this wiring cannot pass unnoticed.

Three graphs, with the input and output names native/translate-onnx reads:

    encoder_model.onnx              input_ids, attention_mask -> last_hidden_state
    decoder_model.onnx              the first step: encoder_attention_mask, input_ids,
                                    encoder_hidden_states -> logits, present.N.{decoder,encoder}.{key,value}
    decoder_with_past_model.onnx    a cached step: the same, plus past_key_values.N.{decoder,encoder}.{key,value}

`merge_decoders` joins the two decoders into one graph that `use_cache_branch` switches,
keeping one copy of each weight they share.
"""
import gc
import hashlib
from pathlib import Path

import numpy as np
import torch
from torch import nn

OPSET = 18
# ONNX keeps a model in one protobuf message only below 2 GB.
PROTOBUF_LIMIT = 2 * 1024 * 1024 * 1024 - 64 * 1024 * 1024


def _negative(dtype):
    return torch.finfo(dtype).min


def _heads(x, attention):
    batch, length, _ = x.shape
    return x.view(batch, length, attention.num_heads, attention.head_dim).transpose(1, 2)


def _attend(attention, hidden, keys, values, mask):
    """Scaled dot-product attention with the layer's own projections, as transformers' eager path."""
    query = _heads(attention.q_proj(hidden), attention)
    scores = torch.matmul(query, keys.transpose(2, 3)) * attention.scaling
    if mask is not None:
        scores = scores + mask
    probabilities = torch.softmax(scores, dim=-1)
    out = torch.matmul(probabilities, values)
    batch, heads, length, size = out.shape
    return attention.out_proj(out.transpose(1, 2).reshape(batch, length, heads * size))


def _padding_mask(mask, dtype):
    """An attention mask of 1 (keep) and 0 (padding) as additive scores, [batch, 1, 1, length]."""
    return (1.0 - mask[:, None, None, :].to(dtype)) * _negative(dtype)


class _Embeddings(nn.Module):
    """Scaled token embeddings plus the sinusoidal positions, which skip padding tokens."""

    def __init__(self, tokens, positions):
        super().__init__()
        self.tokens = tokens
        self.padding = positions.padding_idx
        self.register_buffer("table", positions.weights.detach().clone(), persistent=False)

    def forward(self, input_ids, past_length=0):
        batch, length = input_ids.shape
        kept = input_ids.ne(self.padding).long()
        positions = (torch.cumsum(kept, dim=1) + past_length) * kept + self.padding
        found = self.table.index_select(0, positions.reshape(-1)).reshape(batch, length, -1)
        return self.tokens(input_ids) + found


class Encoder(nn.Module):
    def __init__(self, model):
        super().__init__()
        encoder = model.model.encoder
        self.embeddings = _Embeddings(encoder.embed_tokens, encoder.embed_positions)
        self.layers = encoder.layers
        self.layer_norm = encoder.layer_norm

    def forward(self, input_ids, attention_mask):
        hidden = self.embeddings(input_ids)
        mask = _padding_mask(attention_mask, hidden.dtype)
        for layer in self.layers:
            normed = layer.self_attn_layer_norm(hidden)
            attention = layer.self_attn
            hidden = hidden + _attend(attention, normed, _heads(attention.k_proj(normed), attention),
                                      _heads(attention.v_proj(normed), attention), mask)
            normed = layer.final_layer_norm(hidden)
            hidden = hidden + layer.fc2(layer.activation_fn(layer.fc1(normed)))
        return self.layer_norm(hidden)


class _Decoder(nn.Module):
    def __init__(self, model):
        super().__init__()
        decoder = model.model.decoder
        self.embeddings = _Embeddings(decoder.embed_tokens, decoder.embed_positions)
        self.layers = decoder.layers
        self.layer_norm = decoder.layer_norm
        # The output layer gets its own copy of the weights it shares with the embedding.
        # Shared, the quantizer cannot take them as a constant of the MatMul, and every step
        # turns the whole quantized vocabulary matrix back into floats (about 3 times slower).
        # Once quantized, share_vocabulary stores the two copies once again.
        head = nn.Linear(model.lm_head.in_features, model.lm_head.out_features, bias=False)
        head.weight = nn.Parameter(model.lm_head.weight.detach().clone(), requires_grad=False)
        self.lm_head = head

    def run(self, input_ids, encoder_attention_mask, encoder_hidden_states, past):
        """past: per layer (keys, values, encoder keys, encoder values), or None on the first step."""
        length = input_ids.shape[1]
        past_length = 0 if past is None else past[0][0].shape[2]
        hidden = self.embeddings(input_ids, past_length)
        dtype = hidden.dtype
        # Each new token sees the cached ones and the new ones up to itself.
        rows = torch.arange(length, device=input_ids.device).unsqueeze(1)
        columns = torch.arange(past_length + length, device=input_ids.device).unsqueeze(0)
        causal = torch.where(columns <= rows + past_length, 0.0, _negative(dtype)).to(dtype)[None, None]
        cross_mask = _padding_mask(encoder_attention_mask, dtype)
        presents = []
        for index, layer in enumerate(self.layers):
            normed = layer.self_attn_layer_norm(hidden)
            attention = layer.self_attn
            keys = _heads(attention.k_proj(normed), attention)
            values = _heads(attention.v_proj(normed), attention)
            if past is not None:
                keys = torch.cat([past[index][0], keys], dim=2)
                values = torch.cat([past[index][1], values], dim=2)
            hidden = hidden + _attend(attention, normed, keys, values, causal)

            normed = layer.encoder_attn_layer_norm(hidden)
            attention = layer.encoder_attn
            if past is None:
                cross_keys = _heads(attention.k_proj(encoder_hidden_states), attention)
                cross_values = _heads(attention.v_proj(encoder_hidden_states), attention)
                returned = (cross_keys, cross_values)
            else:
                # A cached step returns the encoder's keys and values with no rows: the caller
                # keeps the ones of the first step, so they are not copied at every step.
                cross_keys, cross_values = past[index][2], past[index][3]
                returned = (cross_keys[:0], cross_values[:0])
            hidden = hidden + _attend(attention, normed, cross_keys, cross_values, cross_mask)

            normed = layer.final_layer_norm(hidden)
            hidden = hidden + layer.fc2(layer.activation_fn(layer.fc1(normed)))
            presents += [keys, values, *returned]
        return (self.lm_head(self.layer_norm(hidden)), *presents)


class FirstStep(_Decoder):
    def forward(self, encoder_attention_mask, input_ids, encoder_hidden_states):
        return self.run(input_ids, encoder_attention_mask, encoder_hidden_states, None)


class NextStep(_Decoder):
    def forward(self, encoder_attention_mask, input_ids, encoder_hidden_states, past_key_values):
        past = [past_key_values[i:i + 4] for i in range(0, len(past_key_values), 4)]
        return self.run(input_ids, encoder_attention_mask, encoder_hidden_states, past)


def past_names(layers, prefix):
    return [f"{prefix}.{layer}.{part}.{kind}" for layer in range(layers)
            for part in ("decoder", "encoder") for kind in ("key", "value")]


def _example(config, batch=2, encoder_length=7, length=3, past=5):
    """Example inputs of distinct sizes, so that no dimension is taken for another."""
    heads, size = config.decoder_attention_heads, config.d_model // config.decoder_attention_heads
    ids = torch.full((batch, length), 5, dtype=torch.long)
    hidden = torch.zeros(batch, encoder_length, config.d_model)
    mask = torch.ones(batch, encoder_length, dtype=torch.long)
    cached = []
    for _ in range(config.decoder_layers):
        cached += [torch.zeros(batch, heads, past, size), torch.zeros(batch, heads, past, size),
                   torch.zeros(batch, heads, encoder_length, size), torch.zeros(batch, heads, encoder_length, size)]
    return mask, ids, hidden, tuple(cached)


def export_float(model, folder):
    """Write the three float32 graphs into `folder` (weights in .data files beside them)."""
    from torch.export import Dim

    config = model.config
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    batch, encoder_length = Dim("batch"), Dim("encoder_sequence_length")
    length, past = Dim("decoder_sequence_length"), Dim("past_decoder_sequence_length")
    mask, ids, hidden, cached = _example(config)
    layers = config.decoder_layers
    outputs = ["logits", *past_names(layers, "present")]

    def write(module, args, path, input_names, output_names, shapes):
        program = torch.onnx.export(module.eval(), args, str(path), input_names=input_names,
                                    output_names=output_names, dynamic_shapes=shapes, dynamo=True,
                                    opset_version=OPSET, external_data=True, optimize=True)
        if program is None:
            raise SystemExit(f"the export of {path.name} failed")

    with torch.no_grad():
        source = torch.full((2, 7), 5, dtype=torch.long)
        write(Encoder(model), (source, torch.ones_like(source)), folder / "encoder_model.onnx",
              ["input_ids", "attention_mask"], ["last_hidden_state"],
              ({0: batch, 1: encoder_length}, {0: batch, 1: encoder_length}))
        common = ({0: batch, 1: encoder_length}, {0: batch, 1: length}, {0: batch, 1: encoder_length})
        write(FirstStep(model), (mask, ids, hidden), folder / "decoder_model.onnx",
              ["encoder_attention_mask", "input_ids", "encoder_hidden_states"], outputs, common)
        past_shapes = tuple({0: batch, 2: past} if index % 4 < 2 else {0: batch, 2: encoder_length}
                            for index in range(len(cached)))
        write(NextStep(model), (mask, ids[:, :2], hidden, cached), folder / "decoder_with_past_model.onnx",
              ["encoder_attention_mask", "input_ids", "encoder_hidden_states", *past_names(layers, "past_key_values")],
              outputs, (*common, past_shapes))


def _session(path):
    import onnxruntime
    options = onnxruntime.SessionOptions()
    options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_DISABLE_ALL
    return onnxruntime.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def verify(model, folder, source_ids, target_ids, tolerance=1e-3):
    """Compare the float graphs with transformers' own forward pass.

    source_ids: [batch, n] with padding where shorter; target_ids: [batch, m], the decoder
    input from its start token. The encoder output and the logits of every decoder step,
    the first and each cached one, have to agree within `tolerance`. Returns the largest
    difference seen.
    """
    folder = Path(folder)
    source = torch.tensor(source_ids, dtype=torch.long)
    mask = source.ne(model.config.pad_token_id).long()
    target = torch.tensor(target_ids, dtype=torch.long)
    with torch.no_grad():
        expected_hidden = model.model.encoder(input_ids=source, attention_mask=mask).last_hidden_state.numpy()
        expected_logits = model(input_ids=source, attention_mask=mask, decoder_input_ids=target).logits.numpy()
    worst = 0.0

    def compare(what, got, want):
        nonlocal worst
        difference = float(np.max(np.abs(got - want)))
        worst = max(worst, difference)
        if not difference <= tolerance:
            raise SystemExit(f"{what} differs from transformers by {difference}")

    # One session at a time: for the 3.3B model each holds several GB.
    hidden = _session(folder / "encoder_model.onnx").run(
        None, {"input_ids": source.numpy(), "attention_mask": mask.numpy()})[0]
    gc.collect()
    compare("the encoder output", hidden, expected_hidden)
    layers = model.config.decoder_layers
    common = {"encoder_attention_mask": mask.numpy(), "encoder_hidden_states": hidden}
    out = _session(folder / "decoder_model.onnx").run(None, {**common, "input_ids": target[:, :1].numpy()})
    gc.collect()
    compare("the first step's logits", out[0][:, 0], expected_logits[:, 0])
    following = _session(folder / "decoder_with_past_model.onnx")
    cached = out[1:]
    encoder_cache = [cached[i] for i in range(len(cached)) if i % 4 >= 2]
    for step in range(1, target.shape[1]):
        feeds = dict(common, input_ids=target[:, step:step + 1].numpy())
        for index, name in enumerate(past_names(layers, "past_key_values")):
            feeds[name] = cached[index] if index % 4 < 2 else encoder_cache[(index // 4) * 2 + index % 4 - 2]
        out = following.run(None, feeds)
        compare(f"step {step}'s logits", out[0][:, 0], expected_logits[:, step])
        cached = out[1:]
    return worst


def check_quantized(path):
    """Fail if a MatMul of the decoder takes a weight in floats rather than through MatMulInteger.

    Every weight of a quantized graph has to reach its product as an integer constant; a
    float MatMul fed from a constant means the weight is dequantized at every step. Only
    the attention products (two activations) stay float MatMuls.
    """
    import onnx

    model = onnx.load(str(path), load_external_data=False)
    constants = set()

    def walk(graph):
        constants.update(tensor.name for tensor in graph.initializer)
        for node in graph.node:
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.GRAPH:
                    walk(attribute.g)

    walk(model.graph)
    # Values computed from constants alone (a Transpose or a DequantizeLinear of a weight).
    derived = set(constants)

    def spread(graph):
        changed = True
        while changed:
            changed = False
            for node in graph.node:
                if node.op_type in ("Transpose", "DequantizeLinear", "Identity", "Cast", "Reshape") and node.input \
                        and node.input[0] in derived and not set(node.output) <= derived:
                    derived.update(node.output)
                    changed = True
        for node in graph.node:
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.GRAPH:
                    spread(attribute.g)

    spread(model.graph)
    found = []

    def find(graph):
        for node in graph.node:
            if node.op_type in ("MatMul", "Gemm") and any(name in derived for name in node.input[:2]):
                found.append(node.name or node.output[0])
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.GRAPH:
                    find(attribute.g)

    find(model.graph)
    if found:
        raise SystemExit(f"{Path(path).name}: weights reach a float MatMul: {found[:5]}")


def _content_name(tensor):
    from onnx import numpy_helper
    digest = hashlib.sha256()
    digest.update(f"{tensor.data_type}:{tuple(tensor.dims)}".encode())
    digest.update(np.ascontiguousarray(numpy_helper.to_array(tensor)).tobytes())
    return "shared_" + digest.hexdigest()[:32]


def _rename_inputs(graph, renames):
    from onnx import AttributeProto
    for node in graph.node:
        node.input[:] = [renames.get(name, name) for name in node.input]
        for attribute in node.attribute:
            if attribute.type == AttributeProto.GRAPH:
                _rename_inputs(attribute.g, renames)
            elif attribute.type == AttributeProto.GRAPHS:
                for sub in attribute.graphs:
                    _rename_inputs(sub, renames)


def merge_decoders(first_path, next_path, target):
    """One decoder graph: `use_cache_branch` false runs the first step, true a cached one.

    Each weight is moved to the outer graph under a name made from its contents, so a
    weight both decoders have (they are made from the same layers and quantized the same
    way) is stored once. Scalars and small integer constants stay in their branch.
    """
    import onnx
    from onnx import TensorProto, helper, inliner, numpy_helper

    def load(path):
        model = onnx.load(str(path))
        if not model.functions:
            return model
        # Inlining serializes the whole model, which over 2 GB cannot be.
        if sum(tensor.ByteSize() for tensor in model.graph.initializer) > PROTOBUF_LIMIT:
            raise SystemExit(f"{Path(path).name} has local functions and is too large to inline them")
        return inliner.inline_local_functions(model)

    first = load(first_path)
    following = load(next_path)
    shared = {}

    def lift(graph):
        kept, renames = [], {}
        for tensor in graph.initializer:
            small = len(tensor.dims) == 0 or (len(tensor.dims) == 1 and tensor.data_type in (
                TensorProto.INT32, TensorProto.INT64))
            if small:
                kept.append(tensor)
                continue
            name = _content_name(tensor)
            renames[tensor.name] = name
            if name not in shared:
                shared[name] = numpy_helper.from_array(numpy_helper.to_array(tensor), name)
        _rename_inputs(graph, renames)
        for info in graph.value_info:
            info.name = renames.get(info.name, info.name)
        del graph.initializer[:]
        graph.initializer.extend(kept)
        return helper.make_graph(list(graph.node), graph.name, [], list(graph.output), kept, value_info=list(graph.value_info))

    else_branch = lift(first.graph)
    then_branch = lift(following.graph)
    first_inputs = {info.name: info for info in first.graph.input}
    inputs = list(first.graph.input) + [info for info in following.graph.input if info.name not in first_inputs]
    inputs.append(helper.make_tensor_value_info("use_cache_branch", TensorProto.BOOL, [1]))
    names = [output.name for output in first.graph.output]
    switch = helper.make_node("If", ["use_cache_branch"], names, name="use_cache_branch_if",
                              then_branch=then_branch, else_branch=else_branch)
    # The two branches give the cache other lengths (and the cached step no encoder rows),
    # so those dimensions are named per output. The vocabulary stays a fixed size.
    vocabulary = first.graph.output[0].type.tensor_type.shape.dim[2].dim_value
    outputs = [helper.make_tensor_value_info("logits", TensorProto.FLOAT,
                                             ["batch", "decoder_sequence_length", vocabulary])]
    for output in first.graph.output[1:]:
        dims = output.type.tensor_type.shape.dim
        outputs.append(helper.make_tensor_value_info(
            output.name, TensorProto.FLOAT,
            [f"{output.name}.batch", dims[1].dim_value, f"{output.name}.length", dims[3].dim_value]))
    graph = helper.make_graph([switch], "decoder_merged", inputs, outputs, list(shared.values()))
    imports = {}
    for model in (first, following):
        for entry in model.opset_import:
            imports[entry.domain] = max(imports.get(entry.domain, 0), entry.version)
    merged = helper.make_model(graph, opset_imports=[helper.make_opsetid(d, v) for d, v in imports.items()],
                               producer_name="vrct-vox translation_onnx")
    merged.ir_version = max(first.ir_version, following.ir_version)
    large = sum(tensor.ByteSize() for tensor in shared.values()) > PROTOBUF_LIMIT * 0.9
    target = Path(target)
    if large:
        onnx.save(merged, str(target), save_as_external_data=True, all_tensors_to_one_file=True,
                  location=target.name + "_data", size_threshold=1024)
    else:
        onnx.checker.check_model(merged)
        onnx.save(merged, str(target))


VOCABULARY_DATA = "vocabulary.data"


def run_graphs(folder, encoder, decoder, source_ids, target_ids, pad_id, layers):
    """The encoder output and the logits of each decoder step, as ONNX Runtime gives them."""
    source = np.asarray(source_ids, dtype=np.int64)
    mask = (source != pad_id).astype(np.int64)
    target = np.asarray(target_ids, dtype=np.int64)
    folder = Path(folder)
    hidden = _session(folder / encoder).run(None, {"input_ids": source, "attention_mask": mask})[0]
    gc.collect()
    session = _session(folder / decoder)
    feeds = {"encoder_attention_mask": mask, "encoder_hidden_states": hidden}
    names = past_names(layers, "past_key_values")
    shape = next(info.shape for info in session.get_inputs() if info.name == names[0])
    # The first step reads no cache; it is given an empty one.
    empty = np.zeros((source.shape[0], shape[1], 0, shape[3]), dtype=np.float32)
    results = [hidden]
    cached = None
    encoder_cache = None
    for step in range(target.shape[1]):
        step_feeds = dict(feeds, input_ids=target[:, step:step + 1], use_cache_branch=np.array([step > 0]))
        for index, name in enumerate(names):
            if cached is None:
                step_feeds[name] = empty
            elif index % 4 < 2:
                step_feeds[name] = cached[index]
            else:
                step_feeds[name] = encoder_cache[(index // 4) * 2 + index % 4 - 2]
        out = session.run(None, step_feeds)
        results.append(out[0])
        cached = out[1:]
        if encoder_cache is None:
            encoder_cache = [cached[i] for i in range(len(cached)) if i % 4 >= 2]
    return results


def share_vocabulary(folder, encoder, decoder, vocabulary_size, hidden_size):
    """Store the vocabulary matrix once for the encoder's embedding, the decoder's embedding
    and the output layer, without changing a single weight.

    Quantized the same way, the three hold the same bytes (the output layer transposed).
    Both graphs then read the embedding from one external file, vocabulary.data, and the
    output layer is a Transpose of it, which ONNX Runtime folds into a constant when it
    loads the graph: the products stay MatMulInteger. Fails if the bytes are not the same.
    """
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    from onnx.external_data_helper import set_external_data

    folder = Path(folder)
    encoder_model = onnx.load(str(folder / encoder))
    decoder_model = onnx.load(str(folder / decoder))

    def quantized(graph, dims):
        return [tensor for tensor in graph.initializer
                if tensor.data_type == TensorProto.UINT8 and list(tensor.dims) == dims]

    rows, columns = vocabulary_size, hidden_size
    found = (quantized(encoder_model.graph, [rows, columns]), quantized(decoder_model.graph, [rows, columns]),
             quantized(decoder_model.graph, [columns, rows]))
    if [len(tensors) for tensors in found] != [1, 1, 1]:
        raise SystemExit("the graphs do not hold one quantized embedding each and one output layer")
    (encoder_tensor,), (embedding,), (head,) = found
    values = numpy_helper.to_array(encoder_tensor)
    if not (np.array_equal(values, numpy_helper.to_array(embedding))
            and np.array_equal(values.T, numpy_helper.to_array(head))):
        raise SystemExit("the vocabulary matrices differ; they cannot be stored once")

    # The output layer becomes a Transpose of the embedding, ahead of the If node.
    transposed = head.name + "_from_embedding"
    _rename_inputs(decoder_model.graph, {head.name: transposed})
    decoder_model.graph.node.insert(0, helper.make_node(
        "Transpose", [embedding.name], [transposed], name="output_layer_from_embedding", perm=[1, 0]))
    decoder_model.graph.initializer.remove(head)

    (folder / VOCABULARY_DATA).write_bytes(values.tobytes())
    for tensor in (encoder_tensor, embedding):
        set_external_data(tensor, VOCABULARY_DATA, offset=0, length=values.nbytes)
        tensor.ClearField("raw_data")
    for model in (encoder_model, decoder_model):
        external = [t for t in model.graph.initializer if t.data_location == TensorProto.EXTERNAL]
        if [t.name for t in external] != [encoder_tensor.name if model is encoder_model else embedding.name]:
            raise SystemExit("the vocabulary matrix was not moved to its file")
    for path, model in ((folder / encoder, encoder_model), (folder / decoder, decoder_model)):
        for extra in (*path.parent.glob(path.name + "_data"), *path.parent.glob(path.name + ".data")):
            extra.unlink()
        inline = sum(len(tensor.raw_data) for tensor in model.graph.initializer)
        if inline > PROTOBUF_LIMIT:
            onnx.save(model, str(path), save_as_external_data=True, all_tensors_to_one_file=True,
                      location=path.name + "_data", size_threshold=1024)
        else:
            onnx.save(model, str(path))
