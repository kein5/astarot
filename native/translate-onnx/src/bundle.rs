//! A model folder written by `tools/translation_onnx/export.py`, and its manifest.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::{codes, Error, Result};

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
    /// `m2m100` or `nllb`.
    pub family: String,
    pub license: String,
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
    pub beam_size: usize,
    pub max_input_length: usize,
    pub max_decoding_length: usize,
    pub files: BTreeMap<String, Pin>,
}

pub const TOKENIZER: &str = "tokenizer.json";
pub const VOCABULARY: &str = "vocab.json";
const MANIFEST: &str = "manifest.json";

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

impl Bundle {
    /// Read the manifest and check every file's presence and size. The hashes are checked
    /// by [`Bundle::verify`], which reads every byte.
    pub fn open(dir: impl AsRef<Path>) -> Result<Bundle> {
        let invalid = Error::new(codes::BUNDLE_INVALID);
        let dir = dir.as_ref().to_path_buf();
        let meta = dir.join(MANIFEST).symlink_metadata().map_err(|_| invalid.clone())?;
        if !meta.is_file() || meta.len() > 1024 * 1024 {
            return Err(invalid);
        }
        let text = std::fs::read(dir.join(MANIFEST)).map_err(|_| invalid.clone())?;
        let manifest: Manifest = serde_json::from_slice(&text).map_err(|_| invalid.clone())?;
        let languages_valid = manifest.languages.iter().all(|code| !code.is_empty() && code.len() <= 32);
        let valid = manifest.schema == 1
            && matches!(manifest.family.as_str(), "m2m100" | "nllb")
            && manifest.language_token.matches("{}").count() == 1
            && languages_valid
            && manifest.decoder_attention_heads > 0
            && manifest.hidden_size.is_multiple_of(manifest.decoder_attention_heads)
            && manifest.decoder_layers > 0
            && manifest.beam_size > 0
            && manifest.max_input_length > 0
            && manifest.max_decoding_length > 0
            && manifest.files.keys().all(|name| plain(name))
            && [&manifest.encoder, &manifest.decoder].iter().all(|name| manifest.files.contains_key(*name))
            && [TOKENIZER, VOCABULARY].iter().all(|name| manifest.files.contains_key(*name));
        if !valid {
            return Err(invalid);
        }
        for (name, pin) in &manifest.files {
            let meta = dir.join(name).symlink_metadata().map_err(|_| invalid.clone())?;
            if !meta.is_file() || meta.len() != pin.size {
                return Err(invalid);
            }
        }
        Ok(Bundle { dir, manifest })
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
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
