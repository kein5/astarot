//! The local translation on ONNX Runtime (`native/translate-onnx`), built with the
//! `onnx-translation` feature (on by default). ONNX Runtime is loaded at run time and shared
//! with chat reading; nothing is linked or fetched at build time.
//!
//! The settings keep their CTranslate2 names and values ("判断が要ること" 1 in
//! `docs/voice-stack/core-integration.md`), read like this:
//!
//! - `CTRANSLATE2_WEIGHT_TYPE` names the model: a built-in name (`m2m100_418M-ct2-int8`, the
//!   model `m2m100_418M`), a model the user put in `<data>/translation-models/<folder>/`
//!   (`custom:<folder>`) or an engine entry the user added to the translation catalog
//!   (`user:<id>`, #413), whose folder may be anywhere.
//! - `SELECTED_TRANSLATION_COMPUTE_DEVICE.device` is the ONNX Runtime execution provider
//!   (`cpu`, `directml`, `cuda`, `openvino`, `migraphx`, `webgpu`) and `device_index` its device.
//! - `SELECTED_TRANSLATION_COMPUTE_TYPE` chooses the quantization variant among the folders of
//!   the model that are on this PC (`auto`, `float32`, `float16`, `int8`, `int8_float32` = int8,
//!   `int4`). A user's model has one variant and runs it whatever the type says.
//!
//! A built-in model's folder is looked for as a verified download of the consent catalog
//! (`<state>/downloaded_models/<catalog id>/<revision>/`, none published yet), then as the
//! folder `tools/translation_onnx/export.py` writes, placed by hand in
//! `<data>/weights/translate-onnx/<model>-onnx-<variant>/`.

use super::translation::{LocalError, LocalSetup, LocalTranslation, Placement};
use crate::config::Environment;
use crate::languages::{self, TRANSLATION_WEIGHTS};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use vrct_ops::downloads::catalog::{self, TRANSLATION_TARGET};
use vrct_ops::downloads::translation_catalog::{self, TranslationCatalog};
use vrct_translate_onnx::accelerate::{self, compute_types};
use vrct_translate_onnx::{codes, runtime, Accelerator, Bundle, Fallback, Manifest, Provider, Translator, Variant};

/// Where a user's own models go, under the data folder.
pub const CUSTOM_DIR: &str = "translation-models";
/// The weight name of a user's model: this and its folder's name.
pub const CUSTOM_PREFIX: &str = "custom:";
/// A folder whose name is not plain (letters, digits, `.`, `_`, `-`, 64 at most).
pub const NAME_INVALID: &str = "translation_model_name_invalid";
/// A model whose languages the app cannot name (no `language_names`, and none of its codes in
/// the table of its architecture).
pub const LANGUAGES_UNKNOWN: &str = "translation_languages_unknown";
/// The fixed description sent with a GPU memory failure (`TRANSLATION_VRAM_*`).
const OUT_OF_MEMORY: &str = "The device ran out of memory while translating";

/// The model of a built-in weight (`m2m100_418M-ct2-int8` → `m2m100_418M`).
fn builtin_model(weight: &str) -> Option<&str> {
    TRANSLATION_WEIGHTS.contains(&weight).then(|| weight.strip_suffix("-ct2-int8")).flatten()
}

/// The download catalog's id of a model's variant: `m2m100-418m-onnx-int8`.
pub fn catalog_id(model: &str, variant: Variant) -> String {
    let model: String = model.chars().map(|c| if c == '_' || c == '.' { '-' } else { c.to_ascii_lowercase() }).collect();
    format!("{model}-onnx-{}", variant.name())
}

/// The built-in weight and variant a catalog entry installs, if it is a translation entry.
pub fn weight_of_catalog_id(id: &str) -> Option<(&'static str, Variant)> {
    TRANSLATION_WEIGHTS.iter().find_map(|weight| {
        let model = builtin_model(weight)?;
        Variant::ALL.into_iter().find(|v| catalog_id(model, *v) == id).map(|v| (*weight, v))
    })
}

/// The folders where a built-in model's variant may be, in the order they are tried: the
/// download of the shipped catalog's revision, any other revision the download manager
/// published under that id (its manifest pins every file), then the hand-placed folder.
fn builtin_folders(env: &Environment, model: &str, variant: Variant) -> Vec<PathBuf> {
    let id = catalog_id(model, variant);
    let downloads = env.state_dir.join("downloaded_models").join(&id);
    let mut folders: Vec<PathBuf> = catalog::catalog()
        .into_iter()
        .filter(|entry| entry.target == TRANSLATION_TARGET && entry.id == id)
        .map(|entry| downloads.join(&entry.revision))
        .collect();
    let mut published: Vec<PathBuf> = std::fs::read_dir(&downloads)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()) && !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| !folders.contains(path))
        .collect();
    published.sort();
    folders.extend(published);
    folders.push(env.data_dir.join("weights").join("translate-onnx").join(format!("{model}-onnx-{}", variant.name())));
    folders
}

fn family_of(model: &str) -> &'static str {
    if model.starts_with("nllb") { "nllb" } else { "m2m100" }
}

/// The variants of a built-in model on this PC, each with its folder (sizes checked, not
/// hashes). A folder must hold what its name says: that variant of that architecture.
fn installed(env: &Environment, model: &str) -> Vec<(Variant, Bundle)> {
    Variant::ALL
        .into_iter()
        .filter_map(|variant| {
            builtin_folders(env, model, variant).into_iter().find_map(|folder| {
                let bundle = Bundle::open(&folder).ok()?;
                let fits = bundle.manifest().variant() == variant && bundle.manifest().family == family_of(model);
                fits.then_some((variant, bundle))
            })
        })
        .collect()
}

// ------------------------------------------------------------------------- the user's models

/// A model the user put in `<data>/translation-models/<folder>/`.
#[derive(Clone, Debug)]
pub struct CustomModel {
    /// `custom:<folder>`, the weight name the settings keep.
    pub id: String,
    pub bundle: Bundle,
    /// `{"source": {name: code}, "target": {name: code}}`, as the language table has it.
    pub languages: Value,
}

/// A plain folder name, so that the weight name stays a plain string.
fn plain_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// The language table of a user's model: its own names, else the built-in table of its
/// architecture limited to the codes it lists.
fn custom_languages(manifest: &Manifest) -> Value {
    let names: Map<String, Value> = match &manifest.language_names {
        Some(names) => names.iter().map(|(name, code)| (name.clone(), json!(code))).collect(),
        None => {
            let reference = if manifest.family == "nllb" { "nllb-200-distilled-600M-ct2-int8" } else { "m2m100_418M-ct2-int8" };
            let table = &languages::translation()["CTranslate2"][reference];
            let pick = |side: &str| -> Map<String, Value> {
                table[side]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter(|(_, code)| code.as_str().is_some_and(|c| manifest.languages.iter().any(|l| l == c)))
                    .map(|(name, code)| (name.clone(), code.clone()))
                    .collect()
            };
            return json!({ "source": pick("source"), "target": pick("target") });
        }
    };
    json!({ "source": names.clone(), "target": names })
}

/// The user's models, sorted by folder name, and the folders refused with their reason (one
/// of `vrct_translate_onnx::codes`, [`NAME_INVALID`] or [`LANGUAGES_UNKNOWN`]). Sizes are
/// checked here; hashes when a model is loaded.
pub fn discover(data_dir: &Path) -> (Vec<CustomModel>, Vec<(String, &'static str)>) {
    let (mut models, mut refused) = (Vec::new(), Vec::new());
    let Ok(entries) = std::fs::read_dir(data_dir.join(CUSTOM_DIR)) else { return (models, refused) };
    let mut folders: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .map(|entry| (entry.file_name().to_string_lossy().into_owned(), entry.path()))
        .collect();
    folders.sort();
    for (name, path) in folders {
        if !plain_name(&name) {
            refused.push((name, NAME_INVALID));
            continue;
        }
        let bundle = match Bundle::open(&path) {
            Ok(bundle) => bundle,
            Err(error) => {
                refused.push((name, error.code));
                continue;
            }
        };
        let languages = custom_languages(bundle.manifest());
        if languages["source"].as_object().is_none_or(Map::is_empty) {
            refused.push((name, LANGUAGES_UNKNOWN));
            continue;
        }
        models.push(CustomModel { id: format!("{CUSTOM_PREFIX}{name}"), bundle, languages });
    }
    (models, refused)
}

/// The weight name of an engine entry of the translation catalog (#413): this and its id.
pub const USER_PREFIX: &str = "user:";

/// The weight name of a translation catalog entry.
pub fn entry_weight(id: &str) -> String {
    format!("{USER_PREFIX}{id}")
}

/// The language table of a model, limited to the codes an entry offers.
fn offered_table(manifest: &Manifest, entry: &Value) -> Value {
    let mut table = custom_languages(manifest);
    let offered = translation_catalog::offered_languages(entry, &manifest.languages);
    for side in ["source", "target"] {
        if let Some(names) = table[side].as_object_mut() {
            names.retain(|_, code| code.as_str().is_some_and(|c| offered.iter().any(|o| o == c)));
        }
    }
    table
}

/// Whether a folder holds a model the `onnx` runtime can run with at least one language the
/// entry offers: the check made before an engine entry is added. The error is a fixed code
/// (`vrct_translate_onnx::codes`, [`LANGUAGES_UNKNOWN`]). Sizes are checked; hashes when it loads.
pub fn inspect(folder: &Path, entry: &Value) -> Result<(), &'static str> {
    let bundle = Bundle::open(folder).map_err(|error| error.code)?;
    let table = offered_table(bundle.manifest(), entry);
    if table["source"].as_object().is_none_or(Map::is_empty) {
        return Err(LANGUAGES_UNKNOWN);
    }
    Ok(())
}

/// The engine entries of the translation catalog that the `onnx` runtime runs, and the entries
/// refused with their reason (keyed by the entry's id, never its name or folder).
pub fn registered(env: &Environment) -> (Vec<CustomModel>, Vec<(String, &'static str)>) {
    let (mut models, mut refused) = (Vec::new(), Vec::new());
    let rows = TranslationCatalog::new(env.state_dir.join(translation_catalog::FILE_NAME)).rows();
    for row in rows.iter().filter(|row| row["group"] == "engine" && row["runtime"] == "onnx") {
        let Some(id) = row["id"].as_str() else { continue };
        let folder = Path::new(row["folder"].as_str().unwrap_or_default());
        let bundle = match Bundle::open(folder) {
            Ok(bundle) => bundle,
            Err(error) => {
                refused.push((id.to_string(), error.code));
                continue;
            }
        };
        let languages = offered_table(bundle.manifest(), row);
        if languages["source"].as_object().is_none_or(Map::is_empty) {
            refused.push((id.to_string(), LANGUAGES_UNKNOWN));
            continue;
        }
        models.push(CustomModel { id: entry_weight(id), bundle, languages });
    }
    (models, refused)
}

/// The user's models of both kinds: the folders in `<data>/translation-models/`, then the
/// engine entries of the translation catalog.
fn every_custom(env: &Environment) -> Vec<CustomModel> {
    let mut models = discover(&env.data_dir).0;
    models.extend(registered(env).0);
    models
}

/// Every weight the settings may name: the built-in ones, then the user's models.
pub fn weight_ids(env: &Environment) -> Vec<String> {
    let mut ids: Vec<String> = TRANSLATION_WEIGHTS.iter().map(|w| w.to_string()).collect();
    ids.extend(every_custom(env).into_iter().map(|m| m.id));
    ids
}

/// Whether a weight's model is on this PC: some variant of a built-in model, or a user's
/// model that passed [`discover`] or [`registered`].
pub fn weight_available(env: &Environment, weight: &str) -> bool {
    if weight.starts_with(CUSTOM_PREFIX) {
        return discover(&env.data_dir).0.iter().any(|m| m.id == weight);
    }
    if weight.starts_with(USER_PREFIX) {
        return registered(env).0.iter().any(|m| m.id == weight);
    }
    builtin_model(weight).is_some_and(|model| !installed(env, model).is_empty())
}

/// Whether a weight is one of the user's models (a folder or a catalog entry).
pub fn is_users(weight: &str) -> bool {
    weight.starts_with(CUSTOM_PREFIX) || weight.starts_with(USER_PREFIX)
}

// ------------------------------------------------------------------------- devices

/// The accelerator a saved compute device names; anything unknown is the CPU.
pub fn accelerator(device: &Value) -> Accelerator {
    let provider = device["device"].as_str().and_then(Provider::from_name).unwrap_or(Provider::Cpu);
    let index = device["device_index"].as_u64().and_then(|i| u32::try_from(i).ok()).unwrap_or(0);
    if provider == Provider::Cpu { Accelerator::CPU } else { Accelerator::new(provider, index) }
}

/// One entry of `SELECTABLE_COMPUTE_DEVICE_LIST`. The CPU keeps the name the settings always
/// saved (`cpu`).
pub fn device_entry(provider: Provider, index: u32) -> Value {
    json!({ "device": provider.name(), "device_index": index, "device_name": provider.label(), "compute_types": compute_types(provider) })
}

/// The devices the local translation can run on: the CPU, and the GPU providers of the ONNX
/// Runtime library the process loads. The shipped library is the CPU build, which brings no
/// other, and the GPU build the start chose brings its own
/// ([`crate::shipped_libraries::use_libraries`]); neither is loaded to ask. Any other library
/// (`ORT_DYLIB_PATH`, or one beside the executable) is loaded and asked; without one only the CPU
/// is listed. A provider listed here may still fail to start, and then the model runs on the CPU
/// and the user is told ([`Placement::fallback`]).
pub fn compute_devices() -> Vec<Value> {
    use crate::shipped_libraries::{onnx_runtime_library, OnnxRuntimeLibrary};
    let mut devices = vec![device_entry(Provider::Cpu, 0)];
    match onnx_runtime_library() {
        OnnxRuntimeLibrary::Shipped => {}
        OnnxRuntimeLibrary::Gpu(device) => devices.extend(Provider::from_name(device).map(|p| device_entry(p, 0))),
        OnnxRuntimeLibrary::Other => {
            if vrct_onnx_runtime::library_present()
                && let Ok(providers) = runtime::available_providers()
            {
                devices.extend(providers.into_iter().filter(|p| p.offered() && *p != Provider::Cpu).map(|p| device_entry(p, 0)));
            }
        }
    }
    devices
}

/// `devices`, then the devices of the GPU builds the user set up under `state_dir` that it lacks
/// ([`crate::shipped_libraries::gpu_builds`]): those this run did not load. These carry
/// `restart_required`: the app loads its ONNX Runtime library when it starts, so choosing one
/// takes effect at the next start, and until then the model runs on the CPU.
pub fn with_gpu_builds(devices: Vec<Value>, state_dir: &Path) -> Vec<Value> {
    with_restart_devices(devices, crate::shipped_libraries::gpu_builds(state_dir).iter().map(|build| build.device))
}

/// The devices of `builds` that `devices` lacks, added with `restart_required`.
fn with_restart_devices<'a>(mut devices: Vec<Value>, builds: impl IntoIterator<Item = &'a str>) -> Vec<Value> {
    for provider in builds.into_iter().filter_map(Provider::from_name) {
        if devices.iter().any(|device| device["device"] == provider.name()) {
            continue;
        }
        let mut entry = device_entry(provider, 0);
        entry["restart_required"] = json!(true);
        devices.push(entry);
    }
    devices
}

// ------------------------------------------------------------------------- loading

struct Loaded {
    setup: LocalSetup,
    translator: Translator,
    placement: Placement,
}

pub struct OnnxTranslation {
    env: Environment,
    /// The user's models as last found: at start and after the catalog changes ([`refresh`]).
    ///
    /// [`refresh`]: LocalTranslation::refresh
    custom: Mutex<Vec<CustomModel>>,
    loaded: Mutex<Option<Loaded>>,
}

impl OnnxTranslation {
    pub fn new(env: &Environment) -> Self {
        Self { env: env.clone(), custom: Mutex::new(every_custom(env)), loaded: Mutex::new(None) }
    }

    fn custom(&self, weight: &str) -> Option<CustomModel> {
        self.custom.lock().unwrap().iter().find(|m| m.id == weight).cloned()
    }

    /// The folder to load for a setup, where to run it, and a fallback already decided (a
    /// GPU without a variant for it runs a CPU variant).
    fn choose(&self, setup: &LocalSetup) -> Result<(Bundle, Accelerator, Option<Fallback>), LocalError> {
        let requested = accelerator(&setup.device);
        if is_users(&setup.weight) {
            let model = self.custom(&setup.weight).ok_or(LocalError::Missing)?;
            let variant = model.bundle.manifest().variant();
            if accelerate::support(variant, requested.provider) == vrct_translate_onnx::Support::No {
                let fallback = Fallback { requested, code: codes::VARIANT_UNSUPPORTED };
                return Ok((model.bundle, Accelerator::CPU, Some(fallback)));
            }
            return Ok((model.bundle, requested, None));
        }
        let model = builtin_model(&setup.weight).ok_or(LocalError::Missing)?;
        let mut installed = installed(&self.env, model);
        let variants: Vec<Variant> = installed.iter().map(|(v, _)| *v).collect();
        let (variant, at, fallback) = match accelerate::choose_variant(&setup.compute_type, requested.provider, &variants) {
            Some(variant) => (variant, requested, None),
            None if requested.provider != Provider::Cpu => {
                let variant = accelerate::choose_variant("auto", Provider::Cpu, &variants).ok_or(LocalError::Missing)?;
                (variant, Accelerator::CPU, Some(Fallback { requested, code: codes::VARIANT_UNSUPPORTED }))
            }
            None => return Err(LocalError::Missing),
        };
        let index = installed.iter().position(|(v, _)| *v == variant).ok_or(LocalError::Missing)?;
        Ok((installed.swap_remove(index).1, at, fallback))
    }
}

fn local_error(code: &str) -> LocalError {
    if code == codes::OUT_OF_MEMORY { LocalError::OutOfMemory(OUT_OF_MEMORY.into()) } else { LocalError::LoadFailed }
}

impl LocalTranslation for OnnxTranslation {
    fn load(&self, setup: &LocalSetup) -> Result<(), LocalError> {
        let mut loaded = self.loaded.lock().unwrap();
        // Never two models at once: the old one goes first, even if the new one fails.
        *loaded = None;
        let (bundle, at, chosen_fallback) = self.choose(setup)?;
        bundle.verify().map_err(|_| LocalError::Missing)?;
        let translator = Translator::load(&bundle, at).map_err(|error| local_error(error.code))?;
        let fallback = chosen_fallback.or_else(|| translator.fallback().cloned());
        let used = translator.backend();
        let placement = Placement {
            device: used.provider.name().into(),
            device_index: used.device,
            variant: translator.variant().name().into(),
            fallback: fallback.map(|f| (f.requested.provider.name().to_string(), f.code)),
        };
        *loaded = Some(Loaded { setup: setup.clone(), translator, placement });
        Ok(())
    }

    fn loaded(&self) -> Option<LocalSetup> {
        self.loaded.lock().unwrap().as_ref().map(|l| l.setup.clone())
    }

    fn placement(&self) -> Option<Placement> {
        self.loaded.lock().unwrap().as_ref().map(|l| l.placement.clone())
    }

    fn languages(&self, weight: &str) -> Option<Value> {
        self.custom(weight).map(|m| m.languages)
    }

    fn refresh(&self) {
        *self.custom.lock().unwrap() = every_custom(&self.env);
    }

    fn translate(&self, text: &str, source: &str, target: &str) -> Result<String, LocalError> {
        let mut loaded = self.loaded.lock().unwrap();
        let loaded = loaded.as_mut().ok_or(LocalError::Failed)?;
        loaded.translator.translate(text, source, target).map_err(|error| match error.code {
            codes::LANGUAGE_UNSUPPORTED => LocalError::Unsupported,
            codes::OUT_OF_MEMORY => LocalError::OutOfMemory(OUT_OF_MEMORY.into()),
            _ => LocalError::Failed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gpu_build_this_run_did_not_load_is_listed_for_after_a_restart() {
        let cpu = device_entry(Provider::Cpu, 0);
        let directml = device_entry(Provider::DirectMl, 0);
        // The CUDA build loaded, the DirectML build set up too.
        let devices = with_restart_devices(vec![cpu.clone(), device_entry(Provider::Cuda, 0)], ["cuda", "directml"]);
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[1].get("restart_required"), None);
        assert_eq!(devices[2]["device"], "directml");
        assert_eq!(devices[2]["device_name"], directml["device_name"]);
        assert_eq!(devices[2]["compute_types"], directml["compute_types"]);
        assert_eq!(devices[2]["restart_required"], true);
        // The shipped CPU build loaded: both wait for a restart, in the order they were found.
        let devices = with_restart_devices(vec![cpu.clone()], ["cuda", "directml"]);
        assert_eq!(devices.iter().map(|d| (d["device"].as_str().unwrap(), d["restart_required"] == true)).collect::<Vec<_>>(), [("cpu", false), ("cuda", true), ("directml", true)]);
        // Nothing set up: the list is as it was.
        assert_eq!(with_restart_devices(vec![cpu.clone()], []), vec![cpu]);
    }

    #[test]
    fn catalog_ids_are_lower_case_and_map_back_to_their_weight() {
        assert_eq!(catalog_id("m2m100_418M", Variant::Int8), "m2m100-418m-onnx-int8");
        assert_eq!(catalog_id("nllb-200-distilled-1.3B", Variant::Float16), "nllb-200-distilled-1-3b-onnx-float16");
        assert_eq!(weight_of_catalog_id("m2m100-1-2b-onnx-int4"), Some(("m2m100_1.2B-ct2-int8", Variant::Int4)));
        assert_eq!(weight_of_catalog_id("ppocrv6-small"), None);
        for weight in TRANSLATION_WEIGHTS {
            let id = catalog_id(builtin_model(weight).unwrap(), Variant::Int8);
            assert!(id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "{id}");
        }
    }

    #[test]
    fn a_saved_device_names_its_provider_and_anything_else_is_the_cpu() {
        assert_eq!(accelerator(&json!({"device": "directml", "device_index": 1})), Accelerator::new(Provider::DirectMl, 1));
        assert_eq!(accelerator(&json!({"device": "cuda", "device_index": 0, "device_name": "RTX"})), Accelerator::new(Provider::Cuda, 0));
        assert_eq!(accelerator(&json!({"device": "cpu", "device_index": 3})), Accelerator::CPU);
        assert_eq!(accelerator(&json!({"device": "rocm"})), Accelerator::CPU);
        assert_eq!(accelerator(&Value::Null), Accelerator::CPU);
    }

    #[test]
    fn the_cpu_entry_matches_what_the_settings_saved() {
        let cpu = device_entry(Provider::Cpu, 0);
        let saved = crate::config::Environment::cpu_device();
        for key in ["device", "device_index", "device_name"] {
            assert_eq!(cpu[key], saved[key], "{key}");
        }
        for compute_type in saved["compute_types"].as_array().unwrap() {
            assert!(cpu["compute_types"].as_array().unwrap().contains(compute_type));
        }
    }

    #[test]
    fn folder_names_stay_plain() {
        assert!(plain_name("my-model_v2.1"));
        for name in ["", ".hidden", "a b", "日本語", "a:b", &"x".repeat(65)] {
            assert!(!plain_name(name), "{name}");
        }
    }
}
