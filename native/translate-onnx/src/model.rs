//! The two ONNX graphs on ONNX Runtime, and translation with them.

use std::borrow::Cow;
use std::path::Path;

use ort::ep::ExecutionProviderDispatch;
use ort::session::{Session, SessionInputValue};
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
    layers: usize,
    heads: usize,
    head_size: usize,
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
        // Both graphs on one provider: the encoder's output feeds the decoder.
        let opened = accelerate::open_with_fallback(at, |at| Ok((session(&encoder_path, at)?, session(&decoder_path, at)?)))?;
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
            layers: manifest.decoder_layers,
            heads: manifest.decoder_attention_heads,
            head_size: manifest.hidden_size / manifest.decoder_attention_heads,
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
        let length = source_ids.len();
        let input: Vec<i64> = source_ids.iter().map(|id| *id as i64).collect();
        let mask = vec![1i64; length];
        let hidden = {
            let outputs = self
                .encoder
                .run(ort::inputs![
                    "input_ids" => Tensor::from_array(([1, length], input)).map_err(failed)?,
                    "attention_mask" => Tensor::from_array(([1, length], mask.clone())).map_err(failed)?,
                ])
                .map_err(failed)?;
            let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(failed)?;
            data.to_vec()
        };
        let settings = beam::Search {
            beam_size: self.beam_size,
            max_length: self.max_decoding_length,
            start: self.start,
            end: self.end,
            prefix,
        };
        let mut steps = Steps {
            decoder: &mut self.decoder,
            hidden,
            length,
            layers: self.layers,
            heads: self.heads,
            head_size: self.head_size,
            vocabulary: 0,
            own: Vec::new(),
            cross: Vec::new(),
            past: 0,
        };
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
}

type Inputs = Vec<(Cow<'static, str>, SessionInputValue<'static>)>;

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
        let outputs = self.decoder.run(inputs).map_err(failed)?;
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
