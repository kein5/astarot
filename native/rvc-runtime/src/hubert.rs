//! The content feature network (specification section 6) as an ONNX graph built from the
//! Transformers-format `hubert_base` checkpoint itself (`config.json` and
//! `pytorch_model.bin`), so the application needs no separately exported graph file.
//!
//! The layout is HuBERT base as published (a convolutional feature encoder followed by a
//! Transformer encoder with post-layer normalisation), in the configuration the
//! checkpoint names: group normalisation in the first convolution only
//! (`feat_extract_norm = "group"`) and `do_stable_layer_norm = false`. Other
//! configurations are refused rather than guessed.
//!
//! ```text
//! input   audio        [1, samples]      16 kHz, not normalised
//! output  features_v2  [1, frames, 768]  last encoder layer
//! output  features_v1  [1, frames, 256]  ninth encoder layer through final_proj
//! ```
//!
//! This is the same contract as the graph `reference/export_hubert_onnx.py` exports, so
//! [`crate::FeatureExtractor`] accepts either.

use std::collections::HashMap;
use std::path::Path;

use crate::error::{Error, Result};
use crate::onnx::{Attr, Dim, Graph};
use crate::pth::{self, Tensor, Value};

const KIND: &str = "feature extractor checkpoint";
/// Epsilon of the group normalisation in the first convolution (PyTorch's default).
const GROUP_NORM_EPSILON: f32 = 1e-5;
/// The encoder layer whose output, through `final_proj`, gives the v1 features (1-based).
const V1_LAYER: usize = 9;

fn bad(detail: impl std::fmt::Display) -> Error {
    Error::format(KIND, detail)
}

/// The part of `config.json` the graph depends on.
#[derive(Debug, Clone, PartialEq)]
pub struct HubertConfig {
    pub hidden_size: usize,
    pub num_hidden_layers: usize,
    pub num_attention_heads: usize,
    pub intermediate_size: usize,
    pub layer_norm_eps: f32,
    pub conv_kernel: Vec<usize>,
    pub conv_stride: Vec<usize>,
    pub num_conv_pos_embeddings: usize,
    pub num_conv_pos_embedding_groups: usize,
}

impl HubertConfig {
    pub fn parse(text: &str) -> Result<Self> {
        let json: serde_json::Value = serde_json::from_str(text).map_err(|error| bad(format!("config.json: {error}")))?;
        let field = |name: &str| json.get(name).ok_or_else(|| bad(format!("config.json has no `{name}`")));
        let int = |name: &str| field(name)?.as_u64().map(|n| n as usize).ok_or_else(|| bad(format!("`{name}` is not a whole number")));
        let ints = |name: &str| -> Result<Vec<usize>> {
            field(name)?
                .as_array()
                .ok_or_else(|| bad(format!("`{name}` is not a list")))?
                .iter()
                .map(|item| item.as_u64().map(|n| n as usize).ok_or_else(|| bad(format!("`{name}` holds a non-integer"))))
                .collect()
        };
        let text_field = |name: &str| field(name).map(|value| value.as_str().unwrap_or_default().to_string());
        let flag = |name: &str| json.get(name).and_then(|value| value.as_bool());
        // Refuse the variants this builder does not implement.
        if text_field("feat_extract_norm")? != "group" {
            return Err(Error::unsupported(KIND, "only `feat_extract_norm = group` is implemented"));
        }
        if flag("do_stable_layer_norm") != Some(false) {
            return Err(Error::unsupported(KIND, "only `do_stable_layer_norm = false` is implemented"));
        }
        for name in ["hidden_act", "feat_extract_activation"] {
            if text_field(name)? != "gelu" {
                return Err(Error::unsupported(KIND, format!("only `{name} = gelu` is implemented")));
            }
        }
        if flag("feat_proj_layer_norm") == Some(false) || flag("conv_pos_batch_norm") == Some(true) || flag("conv_bias") == Some(true) {
            return Err(Error::unsupported(KIND, "feature projection or positional convolution variant"));
        }
        let config = HubertConfig {
            hidden_size: int("hidden_size")?,
            num_hidden_layers: int("num_hidden_layers")?,
            num_attention_heads: int("num_attention_heads")?,
            intermediate_size: int("intermediate_size")?,
            layer_norm_eps: field("layer_norm_eps")?.as_f64().ok_or_else(|| bad("`layer_norm_eps` is not a number"))? as f32,
            conv_kernel: ints("conv_kernel")?,
            conv_stride: ints("conv_stride")?,
            num_conv_pos_embeddings: int("num_conv_pos_embeddings")?,
            num_conv_pos_embedding_groups: int("num_conv_pos_embedding_groups")?,
        };
        if config.num_attention_heads == 0
            || !config.hidden_size.is_multiple_of(config.num_attention_heads)
            || config.conv_kernel.is_empty()
            || config.conv_kernel.len() != config.conv_stride.len()
            || config.num_hidden_layers < V1_LAYER
            || config.num_conv_pos_embedding_groups == 0
            || !config.hidden_size.is_multiple_of(config.num_conv_pos_embedding_groups)
        {
            return Err(bad("inconsistent structure parameters"));
        }
        Ok(config)
    }
}

/// The checkpoint folder's two files, read and checked.
pub struct HubertCheckpoint {
    pub config: HubertConfig,
    weights: HashMap<String, Tensor>,
}

impl HubertCheckpoint {
    /// Reads `config.json` and `pytorch_model.bin` from `folder`.
    pub fn load(folder: &Path) -> Result<Self> {
        let config = HubertConfig::parse(&std::fs::read_to_string(folder.join("config.json"))?)?;
        Self::from_parts(config, pth::load(&folder.join("pytorch_model.bin"))?)
    }

    fn from_parts(config: HubertConfig, state: Value) -> Result<Self> {
        let Value::Dict(entries) = state else {
            return Err(bad("the weights are not a state dictionary"));
        };
        let mut weights = HashMap::with_capacity(entries.len());
        for (name, tensor) in entries {
            if let (Value::Str(name), Value::Tensor(tensor)) = (name, tensor) {
                if tensor.data.iter().any(|value| !value.is_finite()) {
                    return Err(bad(format!("weight {name} holds non-finite values")));
                }
                weights.insert(name, tensor);
            }
        }
        let checkpoint = HubertCheckpoint { config, weights };
        checkpoint.check()?;
        Ok(checkpoint)
    }

    fn tensor(&self, name: &str) -> Result<&Tensor> {
        self.weights.get(name).ok_or_else(|| bad(format!("missing weight {name}")))
    }

    fn expect_shape(&self, name: &str, shape: &[usize]) -> Result<()> {
        let tensor = self.tensor(name)?;
        if tensor.shape != shape {
            return Err(bad(format!("weight {name} has shape {:?}, expected {shape:?}", tensor.shape)));
        }
        Ok(())
    }

    /// Every weight the graph reads exists with the shape the configuration implies, so a
    /// truncated or mismatched file fails here and not halfway through a conversion.
    fn check(&self) -> Result<()> {
        let config = &self.config;
        let hidden = config.hidden_size;
        let mut channels = 1;
        for (layer, &kernel) in config.conv_kernel.iter().enumerate() {
            let weight = self.tensor(&format!("feature_extractor.conv_layers.{layer}.conv.weight"))?;
            if weight.shape.len() != 3 || weight.shape[1] != channels || weight.shape[2] != kernel {
                return Err(bad(format!("convolution {layer} does not match the configuration")));
            }
            channels = weight.shape[0];
        }
        for name in ["weight", "bias"] {
            self.expect_shape(&format!("feature_extractor.conv_layers.0.layer_norm.{name}"), &[self.tensor("feature_extractor.conv_layers.0.conv.weight")?.shape[0]])?;
            self.expect_shape(&format!("feature_projection.layer_norm.{name}"), &[channels])?;
            self.expect_shape(&format!("encoder.layer_norm.{name}"), &[hidden])?;
        }
        self.expect_shape("feature_projection.projection.weight", &[hidden, channels])?;
        self.expect_shape("feature_projection.projection.bias", &[hidden])?;
        self.pos_conv_weight()?;
        self.expect_shape("encoder.pos_conv_embed.conv.bias", &[hidden])?;
        for layer in 0..config.num_hidden_layers {
            let prefix = format!("encoder.layers.{layer}");
            for projection in ["q_proj", "k_proj", "v_proj", "out_proj"] {
                self.expect_shape(&format!("{prefix}.attention.{projection}.weight"), &[hidden, hidden])?;
                self.expect_shape(&format!("{prefix}.attention.{projection}.bias"), &[hidden])?;
            }
            for norm in ["layer_norm", "final_layer_norm"] {
                self.expect_shape(&format!("{prefix}.{norm}.weight"), &[hidden])?;
                self.expect_shape(&format!("{prefix}.{norm}.bias"), &[hidden])?;
            }
            self.expect_shape(&format!("{prefix}.feed_forward.intermediate_dense.weight"), &[config.intermediate_size, hidden])?;
            self.expect_shape(&format!("{prefix}.feed_forward.intermediate_dense.bias"), &[config.intermediate_size])?;
            self.expect_shape(&format!("{prefix}.feed_forward.output_dense.weight"), &[hidden, config.intermediate_size])?;
            self.expect_shape(&format!("{prefix}.feed_forward.output_dense.bias"), &[hidden])?;
        }
        let projection = self.tensor("final_proj.weight")?;
        if projection.shape.len() != 2 || projection.shape[1] != hidden {
            return Err(bad("final_proj does not match the hidden size"));
        }
        self.expect_shape("final_proj.bias", &[projection.shape[0]])?;
        Ok(())
    }

    /// The positional convolution's weight. It is stored weight-normalised over the kernel
    /// axis (`dim = 2`): `w[:, :, k] = g[k] * v[:, :, k] / |v[:, :, k]|`.
    fn pos_conv_weight(&self) -> Result<Tensor> {
        let prefix = "encoder.pos_conv_embed.conv";
        if let Some(weight) = self.weights.get(&format!("{prefix}.weight")) {
            return Ok(weight.clone());
        }
        let pair = [("weight_g", "weight_v"), ("parametrizations.weight.original0", "parametrizations.weight.original1")]
            .iter()
            .find_map(|(g, v)| Some((self.weights.get(&format!("{prefix}.{g}"))?, self.weights.get(&format!("{prefix}.{v}"))?)));
        let (magnitude, direction) = pair.ok_or_else(|| bad("missing positional convolution weight"))?;
        let hidden = self.config.hidden_size;
        let kernel = self.config.num_conv_pos_embeddings;
        let group_width = hidden / self.config.num_conv_pos_embedding_groups;
        if direction.shape != [hidden, group_width, kernel] || magnitude.shape != [1, 1, kernel] {
            return Err(bad("positional convolution does not match the configuration"));
        }
        let mut norms = vec![0.0f64; kernel];
        for (position, &value) in direction.data.iter().enumerate() {
            norms[position % kernel] += value as f64 * value as f64;
        }
        let data = direction.data.iter().enumerate().map(|(position, &value)| (value as f64 * magnitude.data[position % kernel] as f64 / norms[position % kernel].sqrt()) as f32).collect();
        Ok(Tensor { shape: direction.shape.clone(), data })
    }

    /// Builds the ONNX model (see the module documentation for its inputs and outputs).
    pub fn build_graph(&self) -> Result<Vec<u8>> {
        let mut builder = Builder { checkpoint: self, graph: Graph::new() };
        builder.build()?;
        Ok(builder.graph.into_model())
    }
}

struct Builder<'a> {
    checkpoint: &'a HubertCheckpoint,
    graph: Graph,
}

impl Builder<'_> {
    fn constant(&mut self, name: &str) -> Result<String> {
        let tensor = self.checkpoint.tensor(name)?;
        Ok(self.graph.f32s(&tensor.shape, &tensor.data))
    }

    /// `x @ W^T + b` over the last axis, for a stored `[out, in]` weight.
    fn linear(&mut self, x: &str, prefix: &str) -> Result<String> {
        let weight = self.checkpoint.tensor(&format!("{prefix}.weight"))?;
        let (out, input) = (weight.shape[0], weight.shape[1]);
        let mut transposed = vec![0.0f32; weight.len()];
        for o in 0..out {
            for i in 0..input {
                transposed[i * out + o] = weight.data[o * input + i];
            }
        }
        let w = self.graph.f32s(&[input, out], &transposed);
        let bias = self.constant(&format!("{prefix}.bias"))?;
        let product = self.graph.matmul(x, &w);
        Ok(self.graph.add(&product, &bias))
    }

    fn layer_norm(&mut self, x: &str, prefix: &str, epsilon: f32) -> Result<String> {
        let gamma = self.constant(&format!("{prefix}.weight"))?;
        let beta = self.constant(&format!("{prefix}.bias"))?;
        Ok(self.graph.op("LayerNormalization", &[x, &gamma, &beta], vec![Attr::Int("axis", -1), Attr::Float("epsilon", epsilon)]))
    }

    /// The exact (error function) GELU; opset 17 has no Gelu operator.
    fn gelu(&mut self, x: &str) -> String {
        let root_half = self.graph.scalar(std::f32::consts::FRAC_1_SQRT_2);
        let scaled = self.graph.mul(x, &root_half);
        let erf = self.graph.op("Erf", &[&scaled], vec![]);
        let one = self.graph.scalar(1.0);
        let shifted = self.graph.add(&erf, &one);
        let half = self.graph.scalar(0.5);
        let gated = self.graph.mul(x, &shifted);
        self.graph.mul(&gated, &half)
    }

    fn build(&mut self) -> Result<()> {
        let config = self.checkpoint.config.clone();
        let hidden = config.hidden_size;
        let audio = self.graph.input_f32("audio", &[Dim::Fixed(1), Dim::Named("samples")]);
        let axis = self.graph.i64s(&[1]);
        let mut x = self.graph.op("Unsqueeze", &[&audio, &axis], vec![]);

        // Feature encoder: [1, 1, samples] -> [1, channels, frames].
        for (layer, (&kernel, &stride)) in config.conv_kernel.iter().zip(&config.conv_stride).enumerate() {
            let prefix = format!("feature_extractor.conv_layers.{layer}");
            let weight = self.constant(&format!("{prefix}.conv.weight"))?;
            x = self.graph.conv(&x, &weight, None, kernel, stride, 1, (0, 0));
            if layer == 0 {
                // Group normalisation with one channel per group: each channel normalised
                // over time, which is instance normalisation.
                let scale = self.constant(&format!("{prefix}.layer_norm.weight"))?;
                let bias = self.constant(&format!("{prefix}.layer_norm.bias"))?;
                x = self.graph.op("InstanceNormalization", &[&x, &scale, &bias], vec![Attr::Float("epsilon", GROUP_NORM_EPSILON)]);
            }
            x = self.gelu(&x);
        }
        x = self.graph.transpose(&x, &[0, 2, 1]);

        // Feature projection.
        x = self.layer_norm(&x, "feature_projection.layer_norm", config.layer_norm_eps)?;
        x = self.linear(&x, "feature_projection.projection")?;

        // Positional convolution (grouped, "same" padding with the even kernel's extra
        // trailing frame removed), added before the encoder's layer norm.
        let kernel = config.num_conv_pos_embeddings;
        let pos_weight = self.checkpoint.pos_conv_weight()?;
        let pos_weight = self.graph.f32s(&pos_weight.shape, &pos_weight.data);
        let pos_bias = self.constant("encoder.pos_conv_embed.conv.bias")?;
        let channels_first = self.graph.transpose(&x, &[0, 2, 1]);
        let pad = (kernel / 2) as i64;
        let mut position = self.graph.op(
            "Conv",
            &[&channels_first, &pos_weight, &pos_bias],
            vec![Attr::Ints("kernel_shape", vec![kernel as i64]), Attr::Ints("pads", vec![pad, pad]), Attr::Int("group", config.num_conv_pos_embedding_groups as i64)],
        );
        if kernel.is_multiple_of(2) {
            position = self.graph.slice(&position, &[0], &[-1], &[2]);
        }
        position = self.gelu(&position);
        let position = self.graph.transpose(&position, &[0, 2, 1]);
        x = self.graph.add(&x, &position);
        x = self.layer_norm(&x, "encoder.layer_norm", config.layer_norm_eps)?;

        let heads = config.num_attention_heads as i64;
        let width = (hidden / config.num_attention_heads) as i64;
        let split = self.graph.i64s(&[1, -1, heads, width]);
        let merge = self.graph.i64s(&[1, -1, hidden as i64]);
        let scale = self.graph.scalar(1.0 / (width as f32).sqrt());
        let mut v1 = None;
        for layer in 0..config.num_hidden_layers {
            let prefix = format!("encoder.layers.{layer}");
            let project = |builder: &mut Self, name: &str| -> Result<String> {
                let projected = builder.linear(&x, &format!("{prefix}.attention.{name}"))?;
                let reshaped = builder.graph.reshape(&projected, &split);
                Ok(builder.graph.transpose(&reshaped, &[0, 2, 1, 3]))
            };
            let query = project(self, "q_proj")?;
            let key = project(self, "k_proj")?;
            let value = project(self, "v_proj")?;
            let query = self.graph.mul(&query, &scale);
            let key_t = self.graph.transpose(&key, &[0, 1, 3, 2]);
            let scores = self.graph.matmul(&query, &key_t);
            let weights = self.graph.op("Softmax", &[&scores], vec![Attr::Int("axis", -1)]);
            let attended = self.graph.matmul(&weights, &value);
            let attended = self.graph.transpose(&attended, &[0, 2, 1, 3]);
            let attended = self.graph.reshape(&attended, &merge);
            let attended = self.linear(&attended, &format!("{prefix}.attention.out_proj"))?;
            let sum = self.graph.add(&x, &attended);
            x = self.layer_norm(&sum, &format!("{prefix}.layer_norm"), config.layer_norm_eps)?;
            let inner = self.linear(&x, &format!("{prefix}.feed_forward.intermediate_dense"))?;
            let inner = self.gelu(&inner);
            let fed = self.linear(&inner, &format!("{prefix}.feed_forward.output_dense"))?;
            let sum = self.graph.add(&x, &fed);
            x = self.layer_norm(&sum, &format!("{prefix}.final_layer_norm"), config.layer_norm_eps)?;
            if layer + 1 == V1_LAYER {
                v1 = Some(self.linear(&x, "final_proj")?);
            }
        }
        let projected = self.checkpoint.tensor("final_proj.weight")?.shape[0];
        let frames = Dim::Named("frames");
        self.graph.output_f32("features_v2", &x, &[Dim::Fixed(1), frames, Dim::Fixed(hidden)]);
        self.graph.output_f32("features_v1", &v1.expect("V1_LAYER is checked against the layer count"), &[Dim::Fixed(1), frames, Dim::Fixed(projected)]);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = r#"{"hidden_size": 8, "num_hidden_layers": 9, "num_attention_heads": 2,
        "intermediate_size": 16, "layer_norm_eps": 1e-5, "conv_kernel": [10, 3], "conv_stride": [5, 2],
        "num_conv_pos_embeddings": 4, "num_conv_pos_embedding_groups": 2, "feat_extract_norm": "group",
        "do_stable_layer_norm": false, "hidden_act": "gelu", "feat_extract_activation": "gelu"}"#;

    #[test]
    fn configuration_variants_it_does_not_build_are_refused() {
        assert!(HubertConfig::parse(CONFIG).is_ok());
        for (from, to) in [
            ("\"group\"", "\"layer\""),
            ("\"do_stable_layer_norm\": false", "\"do_stable_layer_norm\": true"),
            ("\"hidden_act\": \"gelu\"", "\"hidden_act\": \"relu\""),
            ("\"num_hidden_layers\": 9", "\"num_hidden_layers\": 4"),
        ] {
            assert!(HubertConfig::parse(&CONFIG.replace(from, to)).is_err(), "{to}");
        }
    }

    #[test]
    fn a_checkpoint_missing_a_weight_is_refused_before_building() {
        let config = HubertConfig::parse(CONFIG).unwrap();
        let error = HubertCheckpoint::from_parts(config, Value::Dict(Vec::new())).err().unwrap();
        assert!(error.to_string().contains("missing weight"), "{error}");
    }
}
