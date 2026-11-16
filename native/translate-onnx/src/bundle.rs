//! A model folder written by `tools/translation_onnx/export.py` (or put together by a user the
//! same way), and its manifest.
//!
//! Schema 1 is what `export.py` wrote first (int8 only). Schema 2 adds `variant` and the
//! optional `language_names`. Both are read.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::accelerate::Variant;
use crate::{codes, Error, Result};

/// The architectures the decoder in [`crate::model`] runs: the encoder–decoder transformer of
/// M2M100, which NLLB-200 shares (as `transformers` exports both).
pub const ARCHITECTURES: [&str; 2] = ["m2m100", "nllb"];

/// The size and SHA-256 of one file of the folder.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Pin {
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub name: String,
    /// The architecture: `m2m100` or `nllb`.
    pub family: String,
    /// The licence of the weights, as the folder's maker states it.
    pub license: String,
    /// `float32`, `float16`, `int8` or `int4`. Schema 1 has none and is int8.
    #[serde(default)]
    pub variant: Option<String>,
    pub encoder: String,
    pub decoder: String,
    pub decoder_layers: usize,
    pub decoder_attention_heads: usize,
    pub hidden_size: usize,
    pub decoder_start_token: String,
    pub end_token: String,
    pub unknown_token: String,
    /// How a language code becomes its token: `{}` is replaced by the code.
    pub language_token: String,
    /// The language codes the model takes, in the form the app names them.
    pub languages: Vec<String>,
    /// The app's language names (`Japanese`) and the code each one is (`ja`), for a model the
    /// app has no table for. Every code must be in `languages`.
    #[serde(default)]
    pub language_names: Option<BTreeMap<String, String>>,
    pub beam_size: usize,
    pub max_input_length: usize,
    pub max_decoding_length: usize,
    pub files: BTreeMap<String, Pin>,
}

impl Manifest {
    /// The variant, valid after [`Bundle::open`].
    pub fn variant(&self) -> Variant {
        self.variant.as_deref().map_or(Some(Variant::Int8), Variant::from_name).unwrap_or(Variant::Int8)
    }
}

pub const TOKENIZER: &str = "tokenizer.json";
pub const VOCABULARY: &str = "vocab.json";
pub const MANIFEST: &str = "manifest.json";
/// A manifest is small; anything larger is not one.
const MANIFEST_LIMIT: u64 = 1024 * 1024;

/// A model folder whose manifest is valid and whose files have the sizes it names.
#[derive(Clone, Debug)]
pub struct Bundle {
    dir: PathBuf,
    manifest: Manifest,
}

/// A plain file name: the manifest cannot point outside its folder.
fn plain(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0'])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn lowercase_hex(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The checks that need only the manifest, in the order a user would fix them.
fn check(manifest: &Manifest) -> Result<()> {
    let invalid = || Error::new(codes::BUNDLE_INVALID);
    if !matches!(manifest.schema, 1 | 2) {
        return Err(invalid());
    }
    if !ARCHITECTURES.contains(&manifest.family.as_str()) {
        return Err(Error::new(codes::ARCHITECTURE_UNSUPPORTED));
    }
    match (&manifest.variant, manifest.schema) {
        (None, 1) => {}
        (Some(variant), 2) if Variant::from_name(variant).is_some() => {}
        (Some(_), 2) => return Err(Error::new(codes::VARIANT_UNSUPPORTED)),
        _ => return Err(invalid()),
    }
    let languages_valid =
        !manifest.languages.is_empty() && manifest.languages.iter().all(|code| !code.is_empty() && code.len() <= 32);
    let names_valid = manifest.language_names.as_ref().is_none_or(|names| {
        !names.is_empty()
            && names.iter().all(|(name, code)| !name.is_empty() && name.len() <= 64 && manifest.languages.contains(code))
    });
    let valid = !manifest.name.is_empty()
        && manifest.language_token.matches("{}").count() == 1
        && languages_valid
        && names_valid
        && manifest.decoder_attention_heads > 0
        && manifest.hidden_size.is_multiple_of(manifest.decoder_attention_heads)
        && manifest.decoder_layers > 0
        && manifest.beam_size > 0
        && manifest.max_input_length > 0
        && manifest.max_decoding_length > 0
        && manifest.files.keys().all(|name| plain(name) && name != MANIFEST)
        && manifest.files.values().all(|pin| lowercase_hex(&pin.sha256))
        && [&manifest.encoder, &manifest.decoder].iter().all(|name| manifest.files.contains_key(*name))
        && [TOKENIZER, VOCABULARY].iter().all(|name| manifest.files.contains_key(*name));
    if valid { Ok(()) } else { Err(invalid()) }
}

impl Bundle {
    /// Read the manifest and check every file's presence and size. The hashes are checked
    /// by [`Bundle::verify`], which reads every byte.
    pub fn open(dir: impl AsRef<Path>) -> Result<Bundle> {
        let dir = dir.as_ref().to_path_buf();
        let missing = || Error::new(codes::MANIFEST_MISSING);
        let meta = dir.join(MANIFEST).symlink_metadata().map_err(|_| missing())?;
        if !meta.is_file() {
            return Err(missing());
        }
        let invalid = || Error::new(codes::BUNDLE_INVALID);
        if meta.len() > MANIFEST_LIMIT {
            return Err(invalid());
        }
        let text = std::fs::read(dir.join(MANIFEST)).map_err(|_| missing())?;
        let manifest: Manifest = serde_json::from_slice(&text).map_err(|_| invalid())?;
        check(&manifest)?;
        for (name, pin) in &manifest.files {
            let meta = dir.join(name).symlink_metadata().map_err(|_| Error::new(codes::FILE_MISSING))?;
            if !meta.is_file() {
                return Err(Error::new(codes::FILE_MISSING));
            }
            if meta.len() != pin.size {
                return Err(Error::new(codes::BUNDLE_MODIFIED));
            }
        }
        Ok(Bundle { dir, manifest })
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// Compare every file with its SHA-256.
    pub fn verify(&self) -> Result<()> {
        let modified = Error::new(codes::BUNDLE_MODIFIED);
        let mut block = vec![0u8; 1024 * 1024];
        for (name, pin) in &self.manifest.files {
            let mut source = File::open(self.dir.join(name)).map_err(|_| modified.clone())?;
            let mut digest = Sha256::new();
            loop {
                let read = source.read(&mut block).map_err(|_| modified.clone())?;
                if read == 0 {
                    break;
                }
                digest.update(&block[..read]);
            }
            if hex(&digest.finalize()) != pin.sha256 {
                return Err(modified);
            }
        }
        Ok(())
    }
}
