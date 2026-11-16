//! The local translation on ONNX Runtime (`native/translate-onnx`), built only with the
//! `onnx-translation` feature: linking it brings ONNX Runtime into the app, which waits for a
//! decision ("判断が要ること" 1 and 2 in `docs/voice-stack/core-integration.md`).
//!
//! Until the models are in the download catalog, a model is looked for at
//! `<data>/weights/translate-onnx/<model>-onnx-int8/`, the folder `tools/translation_onnx/export.py`
//! writes (the place is not decided either). The saved compute settings are CTranslate2's: the
//! model always runs on the CPU here, and the compute type is not used ("判断が要ること" 1).

use super::translation::{LocalError, LocalSetup, LocalTranslation};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use vrct_translate_onnx::{codes, Bundle, Device, Translator};

/// The folder of a weight's model, by the name the settings keep (`m2m100_418M-ct2-int8`).
fn folder(data_dir: &Path, weight: &str) -> Option<PathBuf> {
    let model = weight.strip_suffix("-ct2-int8")?;
    Some(data_dir.join("weights").join("translate-onnx").join(format!("{model}-onnx-int8")))
}

/// Whether a weight's model folder with its manifest is on this PC.
pub fn bundle_present(data_dir: &Path, weight: &str) -> bool {
    folder(data_dir, weight).is_some_and(|f| Bundle::open(&f).is_ok())
}

pub struct OnnxTranslation {
    data_dir: PathBuf,
    loaded: Mutex<Option<(LocalSetup, Translator)>>,
}

impl OnnxTranslation {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir, loaded: Mutex::new(None) }
    }
}

impl LocalTranslation for OnnxTranslation {
    fn load(&self, setup: &LocalSetup) -> Result<(), LocalError> {
        let mut loaded = self.loaded.lock().unwrap();
        // Never two models at once: the old one goes first, even if the new one fails.
        *loaded = None;
        let folder = folder(&self.data_dir, &setup.weight).ok_or(LocalError::Missing)?;
        let bundle = Bundle::open(&folder).map_err(|_| LocalError::Missing)?;
        bundle.verify().map_err(|_| LocalError::Missing)?;
        let translator = Translator::load(&bundle, Device::Cpu).map_err(|_| LocalError::LoadFailed)?;
        *loaded = Some((setup.clone(), translator));
        Ok(())
    }

    fn loaded(&self) -> Option<LocalSetup> {
        self.loaded.lock().unwrap().as_ref().map(|(setup, _)| setup.clone())
    }

    fn translate(&self, text: &str, source: &str, target: &str) -> Result<String, LocalError> {
        let mut loaded = self.loaded.lock().unwrap();
        let (_, translator) = loaded.as_mut().ok_or(LocalError::Failed)?;
        translator.translate(text, source, target).map_err(|error| {
            if error.code == codes::LANGUAGE_UNSUPPORTED {
                LocalError::Unsupported
            } else {
                LocalError::Failed
            }
        })
    }
}
