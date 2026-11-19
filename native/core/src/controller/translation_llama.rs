//! The local translation of a decoder-only translation LLM (TranslateGemma) on llama.cpp's
//! server (ADR-015, stage 3 of docs/voice-stack/translation-llm-runtime-plan.md).
//!
//! The user adds the model as an engine entry of the translation catalog with the runtime
//! `llamacpp`: one GGUF file of Gemma 3's architecture, whose source and licence the user answers
//! for, as for any model they add. Its weight is `user:<id>`, chosen like any other local weight;
//! choosing it makes the local translation run on llama.cpp's server instead of ONNX Runtime.
//! The server is not bundled: the user sets it up first (`vrct_voice_conversion::runtime`,
//! `llamacpp-vulkan` or `llamacpp-cpu`). It starts when the model loads (translation turned on,
//! or a message translated with it), never on its own, and stops when another model loads.
//!
//! [`Routed`] is the app's [`LocalTranslation`]: it hands every other weight to the ONNX
//! translation it wraps, and keeps one model loaded at a time across both. Texts, translations,
//! the file's path and the server's key never reach the log.

use super::translation::{LocalError, LocalSetup, LocalTranslation, Placement};
use crate::config::Environment;
use serde_json::{Map, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrct_ops::downloads::translation_catalog::{self, TranslationCatalog, LLAMACPP, LLAMACPP_DEVICE};
use vrct_speech_server::llama::{self, choose_device, list_devices, Device, LlamaServer, Options};
use vrct_speech_server::server::State;
use vrct_translation::http::Transport;
use vrct_translation::providers::Error as ProviderError;
use vrct_translation::translategemma;
use vrct_voice_conversion::runtime::{llama_servers, LlamaServerBuild, Target};

/// The file is not a GGUF file of Gemma 3's architecture (TranslateGemma's).
pub const GGUF_INVALID: &str = "translation_catalog_gguf_invalid";
/// None of the language codes the entry names is one TranslateGemma's template knows.
pub const LANGUAGES_UNKNOWN: &str = "translation_languages_unknown";
/// TranslateGemma's architecture in its GGUF files.
const ARCHITECTURE: &str = "gemma3";
/// The fixed description sent with a GPU memory failure (`TRANSLATION_VRAM_*`).
const OUT_OF_MEMORY: &str = "The device ran out of memory while loading the model";
/// How long a stop may take before the app goes on.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

// ------------------------------------------------------------------------- the model file

fn read_u32(file: &mut impl Read) -> Option<u32> {
    let mut bytes = [0u8; 4];
    file.read_exact(&mut bytes).ok()?;
    Some(u32::from_le_bytes(bytes))
}

fn read_u64(file: &mut impl Read) -> Option<u64> {
    let mut bytes = [0u8; 8];
    file.read_exact(&mut bytes).ok()?;
    Some(u64::from_le_bytes(bytes))
}

/// A GGUF string, at most `limit` bytes.
fn read_string(file: &mut impl Read, limit: u64) -> Option<String> {
    let length = read_u64(file)?;
    if length > limit {
        return None;
    }
    let mut bytes = vec![0u8; length as usize];
    file.read_exact(&mut bytes).ok()?;
    String::from_utf8(bytes).ok()
}

/// Skips one value of a GGUF type; None for a type it does not know or a value too large.
fn skip_value(file: &mut impl Read, kind: u32, depth: u8) -> Option<()> {
    let size = match kind {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        4..=6 => 4,
        10..=12 => 8,
        8 => {
            let length = read_u64(file)?;
            return (std::io::copy(&mut file.take(length), &mut std::io::sink()).ok()? == length).then_some(());
        }
        9 if depth == 0 => {
            let (inner, count) = (read_u32(file)?, read_u64(file)?);
            if count > 10_000_000 {
                return None;
            }
            for _ in 0..count {
                skip_value(file, inner, 1)?;
            }
            return Some(());
        }
        _ => return None,
    };
    (std::io::copy(&mut file.take(size), &mut std::io::sink()).ok()? == size).then_some(())
}

/// `general.architecture` of a GGUF file (version 2 or 3), read from its header; None when the
/// file is not GGUF or does not name one among its first keys.
pub fn gguf_architecture(path: &Path) -> Option<String> {
    let mut file = std::io::BufReader::new(std::fs::File::open(path).ok()?);
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).ok()?;
    if &magic != b"GGUF" || !matches!(read_u32(&mut file)?, 2 | 3) {
        return None;
    }
    let (_tensors, keys) = (read_u64(&mut file)?, read_u64(&mut file)?);
    for _ in 0..keys.min(64) {
        let key = read_string(&mut file, 65536)?;
        let kind = read_u32(&mut file)?;
        if key == "general.architecture" {
            return (kind == 8).then(|| read_string(&mut file, 256)).flatten();
        }
        skip_value(&mut file, kind, 0)?;
    }
    None
}

/// An engine entry of the `llamacpp` runtime that can run.
#[derive(Clone, Debug)]
pub struct LlamaModel {
    /// `user:<id>`, the weight the settings keep.
    pub weight: String,
    pub file: PathBuf,
    /// `auto`, `cpu` or a Vulkan device, as the speech servers name them.
    pub device: String,
    /// `{"source": {name: code}, "target": ...}` with TranslateGemma's codes.
    pub languages: Value,
}

/// The entry's model, or why it cannot run (a fixed code).
fn model_of(row: &Value) -> Result<LlamaModel, &'static str> {
    let file = PathBuf::from(row["folder"].as_str().unwrap_or_default());
    if !file.is_file() {
        return Err(translation_catalog::codes::FILE_MISSING);
    }
    if gguf_architecture(&file).as_deref() != Some(ARCHITECTURE) {
        return Err(GGUF_INVALID);
    }
    let named: Vec<String> = row["languages"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect();
    let known: Vec<String> = named.iter().filter(|code| translategemma::language_name(code).is_some()).cloned().collect();
    if !named.is_empty() && known.is_empty() {
        return Err(LANGUAGES_UNKNOWN);
    }
    let languages = translategemma::language_table(&known);
    if languages["source"].as_object().is_none_or(Map::is_empty) {
        return Err(LANGUAGES_UNKNOWN);
    }
    Ok(LlamaModel {
        weight: format!("user:{}", row["id"].as_str().unwrap_or_default()),
        file,
        device: row["device"].as_str().unwrap_or(LLAMACPP_DEVICE).to_owned(),
        languages,
    })
}

/// The check made before a `llamacpp` entry is added: the file is a Gemma 3 GGUF file and
/// the entry offers a language TranslateGemma knows.
pub fn inspect(row: &Value) -> Result<(), &'static str> {
    model_of(row).map(|_| ())
}

/// The `llamacpp` entries that can run, and those refused with their reason (by id).
pub fn registered(env: &Environment) -> (Vec<LlamaModel>, Vec<(String, &'static str)>) {
    let (mut models, mut refused) = (Vec::new(), Vec::new());
    let rows = TranslationCatalog::new(env.state_dir.join(translation_catalog::FILE_NAME)).rows();
    for row in rows.iter().filter(|row| row["group"] == "engine" && row["runtime"] == LLAMACPP) {
        match model_of(row) {
            Ok(model) => models.push(model),
            Err(code) => refused.push((row["id"].as_str().unwrap_or_default().to_owned(), code)),
        }
    }
    (models, refused)
}

/// The weights of the `llamacpp` entries that can run.
pub fn weight_ids(env: &Environment) -> Vec<String> {
    registered(env).0.into_iter().map(|model| model.weight).collect()
}

/// The llama.cpp servers set up for this PC, the Vulkan build first.
pub fn servers(env: &Environment) -> Vec<LlamaServerBuild> {
    Target::current().map(|target| llama_servers(&env.state_dir.join("vc_runtimes"), target)).unwrap_or_default()
}

/// Whether this platform can run the `llamacpp` runtime at all (one of its servers is offered).
pub fn offered() -> bool {
    Target::current().is_some()
}

/// Whether a `llamacpp` weight can run now: its entry passes and a server is set up.
pub fn weight_available(env: &Environment, weight: &str) -> bool {
    registered(env).0.iter().any(|model| model.weight == weight) && !servers(env).is_empty()
}

// ------------------------------------------------------------------------- the server

/// The server build for a device: the CPU build for `cpu` when there is one, else the Vulkan
/// build; the Vulkan build for a GPU, and for `auto` the CPU build when there is no Vulkan build.
fn build_for(builds: &[LlamaServerBuild], device: &str) -> Option<LlamaServerBuild> {
    let vulkan = builds.iter().find(|b| b.vulkan).cloned();
    let cpu = builds.iter().find(|b| !b.vulkan).cloned();
    match device {
        "cpu" => cpu.or(vulkan),
        "auto" => vulkan.or(cpu),
        _ => vulkan,
    }
}

/// A key for one start: 128 random bits as hex.
fn new_key() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// What `speech devices --json` of the bundled Vulkan build lists, for [`choose_device`].
type SpeechRows = Arc<dyn Fn() -> Option<Vec<Value>> + Send + Sync>;

struct Loaded {
    setup: LocalSetup,
    model: LlamaModel,
    server: LlamaServer,
    key: String,
    base: String,
    placement: Placement,
}

/// The app's local translation: llama.cpp's server for the `llamacpp` weights, the wrapped
/// translation (ONNX Runtime) for every other one, never two models loaded at once.
pub struct Routed {
    env: Environment,
    inner: Arc<dyn LocalTranslation>,
    models: Mutex<Vec<LlamaModel>>,
    loaded: Mutex<Option<Loaded>>,
    transport: Transport,
    speech_rows: SpeechRows,
    start_timeout: Duration,
}

impl Routed {
    pub fn new(env: &Environment, inner: Arc<dyn LocalTranslation>) -> Routed {
        let bundled = env.clone();
        let speech_rows: SpeechRows = Arc::new(move || {
            let binary = super::speech::bundled_launch(&bundled).builds().vulkan?;
            vrct_speech_server::devices::device_rows(&binary, &None)
        });
        Routed {
            env: env.clone(),
            inner,
            models: Mutex::new(registered(env).0),
            loaded: Mutex::new(None),
            transport: vrct_translation::http::direct(),
            speech_rows,
            start_timeout: llama::START_TIMEOUT,
        }
    }

    fn model(&self, weight: &str) -> Option<LlamaModel> {
        self.models.lock().unwrap().iter().find(|model| model.weight == weight).cloned()
    }

    /// Stops the server of the loaded model, if one runs.
    fn stop(&self) {
        if let Some(loaded) = self.loaded.lock().unwrap().take() {
            loaded.server.close(CLOSE_TIMEOUT);
        }
    }

    /// Starts a server for `model` and waits until it answers.
    fn start(&self, setup: &LocalSetup, model: &LlamaModel) -> Result<Loaded, LocalError> {
        let build = build_for(&servers(&self.env), &model.device).ok_or(LocalError::Missing)?;
        let device = if build.vulkan && model.device != "cpu" {
            let listed = list_devices(&build.binary, &None).unwrap_or_default();
            let rows = (self.speech_rows)();
            choose_device(&model.device, rows.as_deref(), &listed).map_err(|_| LocalError::LoadFailed)?
        } else {
            Device::Cpu
        };
        let key = new_key();
        let options = Options { binary: build.binary, model: model.file.clone(), device: device.clone(), api_key: key.clone(), environment: None, start_timeout: self.start_timeout };
        let server = LlamaServer::new(options, None);
        server.start().map_err(|_| LocalError::LoadFailed)?;
        let base = match server.wait_ready(self.start_timeout + Duration::from_secs(5)) {
            Ok(base) => base,
            Err(code) => {
                server.close(CLOSE_TIMEOUT);
                return Err(if code == llama::codes::OUT_OF_MEMORY { LocalError::OutOfMemory(OUT_OF_MEMORY.into()) } else { LocalError::LoadFailed });
            }
        };
        let placement = match &device {
            Device::Gpu(name) => Placement {
                device: "vulkan".into(),
                device_index: name.trim_start_matches("Vulkan").parse().unwrap_or(0),
                variant: "gguf".into(),
                fallback: None,
            },
            Device::Cpu => Placement { device: "cpu".into(), device_index: 0, variant: "gguf".into(), fallback: None },
        };
        Ok(Loaded { setup: setup.clone(), model: model.clone(), server, key, base, placement })
    }

    /// One request; when the server has ended since, it is started again once.
    fn translate_on_server(&self, text: &str, source: &str, target: &str) -> Result<String, LocalError> {
        let mut slot = self.loaded.lock().unwrap();
        for attempt in 0..2 {
            let loaded = slot.as_ref().ok_or(LocalError::Failed)?;
            if loaded.server.health().state != State::Ready {
                if attempt > 0 {
                    return Err(LocalError::Failed);
                }
                let (setup, model) = (loaded.setup.clone(), loaded.model.clone());
                if let Some(old) = slot.take() {
                    old.server.close(CLOSE_TIMEOUT);
                }
                *slot = Some(self.start(&setup, &model).map_err(|_| LocalError::Failed)?);
                continue;
            }
            match translategemma::translate(&self.transport, &loaded.base, &loaded.key, text, source, target) {
                Ok(text) => return Ok(text),
                Err(ProviderError::UnsupportedPair) => return Err(LocalError::Unsupported),
                // The server may have ended under the request: look again.
                Err(ProviderError::Http(_)) if attempt == 0 && loaded.server.health().state != State::Ready => continue,
                Err(_) => return Err(LocalError::Failed),
            }
        }
        Err(LocalError::Failed)
    }
}

impl Drop for Routed {
    fn drop(&mut self) {
        self.stop();
    }
}

impl LocalTranslation for Routed {
    fn load(&self, setup: &LocalSetup) -> Result<(), LocalError> {
        // Never two models at once: the old one goes first, even if the new one fails.
        self.stop();
        let Some(model) = self.model(&setup.weight) else { return self.inner.load(setup) };
        self.inner.unload();
        let loaded = self.start(setup, &model)?;
        *self.loaded.lock().unwrap() = Some(loaded);
        Ok(())
    }

    fn loaded(&self) -> Option<LocalSetup> {
        match self.loaded.lock().unwrap().as_ref() {
            Some(loaded) => Some(loaded.setup.clone()),
            None => self.inner.loaded(),
        }
    }

    fn translate(&self, text: &str, source: &str, target: &str) -> Result<String, LocalError> {
        if self.loaded.lock().unwrap().is_some() {
            return self.translate_on_server(text, source, target);
        }
        self.inner.translate(text, source, target)
    }

    fn placement(&self) -> Option<Placement> {
        match self.loaded.lock().unwrap().as_ref() {
            Some(loaded) => Some(loaded.placement.clone()),
            None => self.inner.placement(),
        }
    }

    fn languages(&self, weight: &str) -> Option<Value> {
        self.model(weight).map(|model| model.languages).or_else(|| self.inner.languages(weight))
    }

    fn refresh(&self) {
        *self.models.lock().unwrap() = registered(&self.env).0;
        self.inner.refresh();
    }

    fn unload(&self) {
        self.stop();
        self.inner.unload();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A GGUF header with these string keys, then nothing.
    pub(crate) fn gguf(keys: &[(&str, &str)]) -> Vec<u8> {
        let mut data = b"GGUF".to_vec();
        data.extend(3u32.to_le_bytes());
        data.extend(0u64.to_le_bytes());
        data.extend((keys.len() as u64 + 1).to_le_bytes());
        // A number and an array before them, as converters write `general.*` keys in any order.
        data.extend(("general.alignment".len() as u64).to_le_bytes());
        data.extend(b"general.alignment");
        data.extend(4u32.to_le_bytes());
        data.extend(32u32.to_le_bytes());
        for (key, value) in keys {
            data.extend((key.len() as u64).to_le_bytes());
            data.extend(key.as_bytes());
            data.extend(8u32.to_le_bytes());
            data.extend((value.len() as u64).to_le_bytes());
            data.extend(value.as_bytes());
        }
        data
    }

    #[test]
    fn the_architecture_is_read_from_the_header() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("m.gguf");
        std::fs::write(&file, gguf(&[("general.name", "Translategemma 4b It"), ("general.architecture", "gemma3")])).unwrap();
        assert_eq!(gguf_architecture(&file).as_deref(), Some("gemma3"));
        std::fs::write(&file, gguf(&[("general.architecture", "qwen3")])).unwrap();
        assert_eq!(gguf_architecture(&file).as_deref(), Some("qwen3"));
        std::fs::write(&file, gguf(&[("general.name", "x")])).unwrap();
        assert_eq!(gguf_architecture(&file), None);
        std::fs::write(&file, b"GGUF\x01\0\0\0").unwrap();
        assert_eq!(gguf_architecture(&file), None);
        std::fs::write(&file, b"not a model").unwrap();
        assert_eq!(gguf_architecture(&file), None);
    }

    #[test]
    fn an_entry_runs_a_gemma3_file_with_the_languages_it_names() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("translategemma.gguf");
        std::fs::write(&file, gguf(&[("general.architecture", "gemma3")])).unwrap();
        let row = |languages: Value| serde_json::json!({ "id": "tr-1", "group": "engine", "runtime": "llamacpp", "folder": file.to_string_lossy(), "languages": languages, "device": "cpu" });
        let model = model_of(&row(serde_json::json!(["ja", "en", "xx"]))).unwrap();
        assert_eq!((model.weight.as_str(), model.device.as_str()), ("user:tr-1", "cpu"));
        assert_eq!(model.languages["source"], serde_json::json!({ "English": "en", "Japanese": "ja" }));
        assert_eq!(model_of(&row(serde_json::json!([]))).unwrap().languages["target"].as_object().unwrap().len(), translategemma::APP_LANGUAGES.len());
        assert_eq!(model_of(&row(serde_json::json!(["jpn_Jpan"]))).unwrap_err(), LANGUAGES_UNKNOWN);
        std::fs::write(&file, gguf(&[("general.architecture", "llama")])).unwrap();
        assert_eq!(model_of(&row(serde_json::json!([]))).unwrap_err(), GGUF_INVALID);
        std::fs::remove_file(&file).unwrap();
        assert_eq!(model_of(&row(serde_json::json!([]))).unwrap_err(), translation_catalog::codes::FILE_MISSING);
    }

    #[test]
    fn the_build_follows_the_device() {
        let vulkan = LlamaServerBuild { binary: "v".into(), vulkan: true };
        let cpu = LlamaServerBuild { binary: "c".into(), vulkan: false };
        let both = [vulkan.clone(), cpu.clone()];
        assert_eq!(build_for(&both, "cpu"), Some(cpu.clone()));
        assert_eq!(build_for(&both, "auto"), Some(vulkan.clone()));
        assert_eq!(build_for(&both, "Vulkan1"), Some(vulkan.clone()));
        assert_eq!(build_for(std::slice::from_ref(&cpu), "auto"), Some(cpu.clone()));
        assert_eq!(build_for(std::slice::from_ref(&cpu), "Vulkan1"), None);
        assert_eq!(build_for(std::slice::from_ref(&vulkan), "cpu"), Some(vulkan));
        assert_eq!(build_for(&[], "auto"), None);
        assert_eq!(new_key().len(), 32);
        assert_ne!(new_key(), new_key());
    }
}
