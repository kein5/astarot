//! The two ONNX graphs on ONNX Runtime, and translation with them.

use std::borrow::Cow;
use std::path::Path;

use ort::ep::ExecutionProviderDispatch;
use ort::session::{HasSelectedOutputs, OutputSelector, RunOptions, Session, SessionInputValue};
use ort::value::Tensor;

use crate::accelerate::{self, Accelerator, Fallback, Provider, Variant};
use crate::beam::{self, Scorer};
use crate::bundle::Bundle;
use crate::runtime::environment;
use crate::tokens::Tokens;
use crate::{codes, Error, Result};

/// The CPU threads of one inference, as the app gave CTranslate2 (intra_threads=4).
const CPU_THREADS: usize = 4;

/// ONNX Runtime's words for running out of memory (CUDA, DirectML's E_OUTOFMEMORY, HIP,
/// OpenVINO, the CPU allocator). Only the message is looked at; it never holds user text.
const OUT_OF_MEMORY: [&str; 6] = ["out of memory", "outofmemory", "0x8007000e", "e_outofmemory", "failed to allocate", "bad_alloc"];

/// The fixed code of an ONNX Runtime error: running out of memory, or a failure.
fn failed<E: std::fmt::Display>(error: E) -> Error {
    let message = error.to_string().to_ascii_lowercase();
    if OUT_OF_MEMORY.iter().any(|words| message.contains(words)) {
        Error::new(codes::OUT_OF_MEMORY)
    } else {
        Error::new(codes::RUNTIME_FAILED)
    }
}

/// The provider's registration, failing instead of quietly running on the CPU.
fn provider(at: Accelerator) -> Result<ExecutionProviderDispatch> {
    let device = i32::try_from(at.device).map_err(|_| Error::new(codes::PROVIDER_UNAVAILABLE))?;
    let dispatch = match at.provider {
        Provider::Cpu => ort::ep::CPU::default().build(),
        #[cfg(windows)]
        Provider::DirectMl => ort::ep::DirectML::default().with_device_id(device).build(),
        #[cfg(not(windows))]
        Provider::DirectMl => return Err(Error::new(codes::PROVIDER_UNAVAILABLE)),
        Provider::Cuda => ort::ep::CUDA::default().with_device_id(device).build(),
        Provider::TensorRt => ort::ep::TensorRT::default().with_device_id(device).build(),
        Provider::OpenVino => {
            let device_type = if device == 0 { "GPU".to_string() } else { format!("GPU.{device}") };
            ort::ep::OpenVINO::default().with_device_type(device_type).build()
        }
        Provider::MiGraphX => ort::ep::MIGraphX::default().with_device_id(device).build(),
        Provider::WebGpu => ort::ep::WebGPU::default().with_device_id(device).build(),
    };
    Ok(dispatch.error_on_failure())
}

fn session(path: &Path, at: Accelerator) -> Result<Session> {
    let mut builder = Session::builder(environment()?).map_err(failed)?;
    builder = builder.with_log_level(ort::logging::LogLevel::Fatal).map_err(failed)?;
    if at.provider == Provider::Cpu {
        builder = builder.with_intra_threads(CPU_THREADS).map_err(failed)?;
    }
    if at.provider == Provider::DirectMl {
        // DirectML needs these two off (ONNX Runtime's DirectML documentation).
        builder = builder.with_memory_pattern(false).map_err(failed)?;
        builder = builder.with_parallel_execution(false).map_err(failed)?;
    }
    let mut builder = builder
        .with_execution_providers([provider(at)?])
        .map_err(|error| if failed(&error).code == codes::OUT_OF_MEMORY { failed(error) } else { Error::new(codes::PROVIDER_UNAVAILABLE) })?;
    builder.commit_from_file(path).map_err(failed)
}

pub struct Translator {
    tokens: Tokens,
    encoder: Session,
    decoder: Session,
    used: Accelerator,
    fallback: Option<Fallback>,
    variant: Variant,
    start: u32,
    end: u32,
    language_token: String,
    languages: Vec<String>,
    beam_size: usize,
    max_input_length: usize,
    max_decoding_length: usize,
    shape: Shape,
}

/// The decoder's cache dimensions.
#[derive(Clone, Copy)]
struct Shape {
    layers: usize,
    heads: usize,
    head_size: usize,
}

/// Logits beyond the largest finite float16 (65504) mean the provider computed garbage: no
/// model's logits come near it, and a float16 graph could not even hold them.
const LOGIT_LIMIT: f32 = 65504.0;

/// Whether every logit is a finite number within [`LOGIT_LIMIT`].
fn sane(logits: &[f32]) -> bool {
    !logits.is_empty() && logits.iter().all(|value| value.is_finite() && value.abs() <= LOGIT_LIMIT)
}

/// The encoder's output for source ids, `1 × length × hidden`.
fn encode(encoder: &mut Session, source_ids: &[u32]) -> Result<Vec<f32>> {
    let length = source_ids.len();
    let input: Vec<i64> = source_ids.iter().map(|id| *id as i64).collect();
    let outputs = encoder
        .run(ort::inputs![
            "input_ids" => Tensor::from_array(([1, length], input)).map_err(failed)?,
            "attention_mask" => Tensor::from_array(([1, length], vec![1i64; length])).map_err(failed)?,
        ])
        .map_err(failed)?;
    let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(failed)?;
    Ok(data.to_vec())
}

/// One short translation on a provider that has just started (decision 76): the encoder, the
/// first decoder step and one cached step, the path every translation takes. A provider can
/// load the graphs and still fail on the first run, or run and give garbage (both seen with
/// DirectML, 2026-11-18). Either is [`codes::PROVIDER_CHECK_FAILED`], and the model is then
/// loaded on the CPU instead; running out of memory keeps its own code. The values are only
/// checked for being numbers of a sane size, not compared with the CPU's.
fn check(
    encoder: &mut Session,
    decoder: &mut Session,
    shape: Shape,
    source_ids: &[u32],
    tokens: [u32; 2],
) -> Result<()> {
    let refused = |error: Error| {
        if error.code == codes::OUT_OF_MEMORY {
            error
        } else {
            Error::new(codes::PROVIDER_CHECK_FAILED)
        }
    };
    let hidden = encode(encoder, source_ids).map_err(refused)?;
    if !sane(&hidden) {
        return Err(Error::new(codes::PROVIDER_CHECK_FAILED));
    }
    let mut steps = Steps::new(decoder, hidden, source_ids.len(), shape);
    steps.vocabulary = steps.probe_vocabulary().map_err(refused)?;
    for token in tokens {
        let logits = steps.run(&[token], &[0]).map_err(refused)?;
        if !sane(&logits) {
            return Err(Error::new(codes::PROVIDER_CHECK_FAILED));
        }
    }
    Ok(())
}

impl Translator {
    /// Load a model checked with [`Bundle::open`] on `at`, or on the CPU when that provider
    /// cannot start ([`Translator::fallback`] says why). Call [`Bundle::verify`] first to check
    /// the files against their SHA-256.
    pub fn load(bundle: &Bundle, at: Accelerator) -> Result<Translator> {
        let manifest = bundle.manifest();
        let tokens = Tokens::load(bundle)?;
        let invalid = || Error::new(codes::BUNDLE_INVALID);
        let start = tokens.id(&manifest.decoder_start_token).ok_or_else(invalid)?;
        let end = tokens.id(&manifest.end_token).ok_or_else(invalid)?;
        let (encoder_path, decoder_path) = (bundle.path(&manifest.encoder), bundle.path(&manifest.decoder));
        let shape = Shape {
            layers: manifest.decoder_layers,
            heads: manifest.decoder_attention_heads,
            head_size: manifest.hidden_size / manifest.decoder_attention_heads,
        };
        // The check's source: a language token and the end token (Tokens::load found them all).
        let language = tokens.id(&manifest.language_token.replace("{}", &manifest.languages[0])).ok_or_else(invalid)?;
        // Both graphs on one provider: the encoder's output feeds the decoder. A provider other
        // than the CPU must also translate once before it is used (decision 76).
        let opened = accelerate::open_with_fallback(at, |at| {
            let mut encoder = session(&encoder_path, at)?;
            let mut decoder = session(&decoder_path, at)?;
            if at.provider != Provider::Cpu {
                check(&mut encoder, &mut decoder, shape, &[language, end], [start, language])?;
            }
            Ok((encoder, decoder))
        })?;
        let (encoder, decoder) = opened.value;
        Ok(Translator {
            tokens,
            encoder,
            decoder,
            used: opened.used,
            fallback: opened.fallback,
            variant: manifest.variant(),
            start,
            end,
            language_token: manifest.language_token.clone(),
            languages: manifest.languages.clone(),
            beam_size: manifest.beam_size,
            max_input_length: manifest.max_input_length,
            max_decoding_length: manifest.max_decoding_length,
            shape,
        })
    }

    /// Where it runs.
    pub fn backend(&self) -> Accelerator {
        self.used
    }

    /// The provider asked for and why it could not start, when the model runs on the CPU
    /// instead.
    pub fn fallback(&self) -> Option<&Fallback> {
        self.fallback.as_ref()
    }

    pub fn variant(&self) -> Variant {
        self.variant
    }

    fn language(&self, code: &str) -> Result<u32> {
        let unsupported = || Error::new(codes::LANGUAGE_UNSUPPORTED);
        if !self.languages.iter().any(|known| known == code) {
            return Err(unsupported());
        }
        self.tokens.id(&self.language_token.replace("{}", code)).ok_or_else(unsupported)
    }

    /// The source ids the encoder reads: the source language, the text and the end token.
    pub fn source_ids(&self, text: &str, source: &str) -> Result<Vec<u32>> {
        let mut ids = vec![self.language(source)?];
        ids.extend(self.tokens.encode(text)?);
        ids.push(self.end);
        Ok(ids)
    }

    /// The best hypothesis for source ids: the target language, the text and the end token
    /// when the sentence ended.
    pub fn translate_ids(&mut self, source_ids: &[u32], target: &str) -> Result<Vec<u32>> {
        let prefix = vec![self.language(target)?];
        if source_ids.len() > self.max_input_length {
            return Err(Error::new(codes::INPUT_TOO_LONG));
        }
        let hidden = encode(&mut self.encoder, source_ids)?;
        let settings = beam::Search {
            beam_size: self.beam_size,
            max_length: self.max_decoding_length,
            start: self.start,
            end: self.end,
            prefix,
        };
        let mut steps = Steps::new(&mut self.decoder, hidden, source_ids.len(), self.shape);
        steps.vocabulary = steps.probe_vocabulary()?;
        Ok(beam::search(&mut steps, &settings)?.tokens)
    }

    /// Translate `text` from `source` to `target`, both language codes as the app names them
    /// to the tokenizer (`ja` for M2M100, `jpn_Jpan` for NLLB).
    pub fn translate(&mut self, text: &str, source: &str, target: &str) -> Result<String> {
        let source_ids = self.source_ids(text, source)?;
        let hypothesis = self.translate_ids(&source_ids, target)?;
        self.text(&hypothesis)
    }

    /// The text of a hypothesis from [`Translator::translate_ids`]. A sentence the length
    /// limit cut is an error, as in the app.
    pub fn text(&self, hypothesis: &[u32]) -> Result<String> {
        if hypothesis.len() < 2 || hypothesis.last() != Some(&self.end) {
            return Err(Error::new(codes::UNFINISHED));
        }
        self.tokens.decode(&hypothesis[1..hypothesis.len() - 1])
    }
}

/// The decoder, one token per beam at a time, with its cache.
struct Steps<'a> {
    decoder: &'a mut Session,
    /// The encoder's output, `1 × length × hidden`.
    hidden: Vec<f32>,
    length: usize,
    layers: usize,
    heads: usize,
    head_size: usize,
    vocabulary: usize,
    /// Per layer, key then value of the decoder's own attention: `beams × heads × past × head`.
    own: Vec<Vec<f32>>,
    /// Per layer, key then value of the attention to the source: `1 × heads × length × head`.
    cross: Vec<Vec<f32>>,
    past: usize,
    /// The outputs a cached step fetches, made at the first cached step.
    cached_step: Option<RunOptions<HasSelectedOutputs>>,
}

/// What a cached step fetches: every output but the source's keys and values. The graph gives
/// those with no rows after the first step (the first step's stay in use), and ONNX Runtime's
/// DirectML provider, asked for an output with no elements, gives wrong values for the other
/// outputs of the same run (seen with 1.24.4 on Intel and NVIDIA GPUs, 2026-11-18). Left out,
/// every provider computes the same logits and cache.
fn cached_step_options(layers: usize) -> Result<RunOptions<HasSelectedOutputs>> {
    let mut selector = OutputSelector::default();
    for layer in 0..layers {
        for kind in ["key", "value"] {
            selector = selector.without(format!("present.{layer}.encoder.{kind}"));
        }
    }
    Ok(RunOptions::new().map_err(failed)?.with_outputs(selector))
}

type Inputs = Vec<(Cow<'static, str>, SessionInputValue<'static>)>;

impl<'a> Steps<'a> {
    /// The steps of one translation, before the first: no cache yet. Set `vocabulary` with
    /// [`Steps::probe_vocabulary`] before the first step.
    fn new(decoder: &'a mut Session, hidden: Vec<f32>, length: usize, shape: Shape) -> Steps<'a> {
        Steps {
            decoder,
            hidden,
            length,
            layers: shape.layers,
            heads: shape.heads,
            head_size: shape.head_size,
            vocabulary: 0,
            own: Vec::new(),
            cross: Vec::new(),
            past: 0,
            cached_step: None,
        }
    }
}

impl Steps<'_> {
    /// The vocabulary is the logits' width; it is known from the graph's output.
    fn probe_vocabulary(&self) -> Result<usize> {
        let output =
            self.decoder.outputs().iter().find(|outlet| outlet.name() == "logits").ok_or_else(|| Error::new(codes::RUNTIME_FAILED))?;
        let width = output.dtype().tensor_shape().and_then(|shape| shape.last().copied()).unwrap_or(-1);
        usize::try_from(width).map_err(failed)
    }

    fn tensor(shape: Vec<usize>, data: Vec<f32>) -> Result<SessionInputValue<'static>> {
        Ok(Tensor::from_array((shape, data)).map_err(failed)?.into())
    }

    fn run(&mut self, tokens: &[u32], origins: &[usize]) -> Result<Vec<f32>> {
        let beams = tokens.len();
        let first = self.own.is_empty();
        let (heads, head, length, hidden_size) =
            (self.heads, self.head_size, self.length, self.hidden.len() / self.length);
        let mut inputs: Inputs = vec![
            (
                "input_ids".into(),
                Tensor::from_array(([beams, 1], tokens.iter().map(|t| *t as i64).collect::<Vec<_>>()))
                    .map_err(failed)?
                    .into(),
            ),
            (
                "encoder_attention_mask".into(),
                Tensor::from_array(([beams, length], vec![1i64; beams * length])).map_err(failed)?.into(),
            ),
            (
                "encoder_hidden_states".into(),
                Self::tensor(vec![beams, length, hidden_size], self.hidden.repeat(beams))?,
            ),
            ("use_cache_branch".into(), Tensor::from_array(([1], vec![!first])).map_err(failed)?.into()),
        ];
        let block = heads * self.past * head;
        for layer in 0..self.layers {
            for (index, kind) in ["key", "value"].iter().enumerate() {
                let own = if first {
                    Self::tensor(vec![beams, heads, 0, head], Vec::new())?
                } else {
                    let previous = &self.own[layer * 2 + index];
                    let mut gathered = Vec::with_capacity(beams * block);
                    for origin in origins {
                        gathered.extend_from_slice(&previous[origin * block..(origin + 1) * block]);
                    }
                    Self::tensor(vec![beams, heads, self.past, head], gathered)?
                };
                let cross = if first {
                    Self::tensor(vec![beams, heads, 0, head], Vec::new())?
                } else {
                    Self::tensor(vec![beams, heads, length, head], self.cross[layer * 2 + index].repeat(beams))?
                };
                inputs.push((format!("past_key_values.{layer}.decoder.{kind}").into(), own));
                inputs.push((format!("past_key_values.{layer}.encoder.{kind}").into(), cross));
            }
        }
        if !first && self.cached_step.is_none() {
            self.cached_step = Some(cached_step_options(self.layers)?);
        }
        let outputs = match (&self.cached_step, first) {
            (Some(options), false) => self.decoder.run_with_options(inputs, options),
            _ => self.decoder.run(inputs),
        }
        .map_err(failed)?;
        let (shape, logits) = outputs["logits"].try_extract_tensor::<f32>().map_err(failed)?;
        if shape.len() != 3 || shape[0] as usize != beams || shape[1] != 1 || shape[2] as usize != self.vocabulary {
            return Err(Error::new(codes::RUNTIME_FAILED));
        }
        let logits = logits.to_vec();
        let mut own = Vec::with_capacity(self.layers * 2);
        let mut cross = Vec::with_capacity(self.layers * 2);
        for layer in 0..self.layers {
            for kind in ["key", "value"] {
                let (_, data) = outputs[format!("present.{layer}.decoder.{kind}").as_str()]
                    .try_extract_tensor::<f32>()
                    .map_err(failed)?;
                own.push(data.to_vec());
                if first {
                    let (_, data) = outputs[format!("present.{layer}.encoder.{kind}").as_str()]
                        .try_extract_tensor::<f32>()
                        .map_err(failed)?;
                    cross.push(data.to_vec());
                }
            }
        }
        drop(outputs);
        self.own = own;
        if first {
            self.cross = cross;
        }
        self.past += 1;
        Ok(logits)
    }
}

impl Scorer for Steps<'_> {
    type Error = Error;

    fn vocabulary(&self) -> usize {
        self.vocabulary
    }

    fn step(&mut self, tokens: &[u32], origins: &[usize]) -> Result<Vec<f32>> {
        self.run(tokens, origins)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_finite_logits_of_a_sane_size_pass_the_check() {
        assert!(sane(&[-30.5, 0.0, 12.25, LOGIT_LIMIT, -LOGIT_LIMIT]));
        assert!(!sane(&[]));
        assert!(!sane(&[1.0, f32::NAN]));
        assert!(!sane(&[f32::INFINITY]));
        assert!(!sane(&[f32::NEG_INFINITY, 0.0]));
        // What DirectML gave from a cached step with an output of no elements (2026-11-18).
        assert!(!sane(&[0.5, 1.8e34]));
        assert!(!sane(&[LOGIT_LIMIT * 2.0]));
    }

    #[test]
    fn a_failed_check_falls_back_to_the_cpu_and_says_why() {
        // A provider every platform builds in (DirectML is Windows only: elsewhere it is
        // unavailable before any check runs).
        let gpu = Accelerator::new(Provider::Cuda, 1);
        let opened = accelerate::open_with_fallback(gpu, |at| {
            if at.provider == Provider::Cpu {
                Ok(at)
            } else {
                Err(Error::new(codes::PROVIDER_CHECK_FAILED))
            }
        })
        .unwrap();
        assert_eq!(opened.used, Accelerator::CPU);
        assert_eq!(opened.fallback, Some(Fallback { requested: gpu, code: codes::PROVIDER_CHECK_FAILED }));
    }
}
