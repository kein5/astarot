//! The analyzer of the readings: Sudachi (sudachi.rs) with a SudachiDict system dictionary in
//! split mode C, the analysis Python ran through SudachiPy.
//!
//! The dictionary is a file shipped beside the app (`system.dic` of SudachiDict full, core or
//! small; decision 3 in `docs/voice-stack/core-integration.md`). It is memory-mapped, so only
//! the pages a text touches are read. The settings and the character definitions are the ones
//! built into sudachi.rs, the same files SudachiPy ships.

use std::fs::File;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use sudachi::analysis::stateless_tokenizer::StatelessTokenizer;
use sudachi::analysis::{Mode, Tokenize};
use sudachi::config::Config;
use sudachi::dic::dictionary::JapaneseDictionary;
use sudachi::dic::storage::{Storage, SudachiDicData};

use super::{Morpheme, Tokenizer, Unavailable};

/// A loaded SudachiDict system dictionary.
pub struct Sudachi {
    tokenizer: StatelessTokenizer<Arc<JapaneseDictionary>>,
}

/// Why a dictionary could not be opened. Names the file, never any text.
#[derive(Debug)]
pub struct OpenError(String);

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for OpenError {}

impl Sudachi {
    /// Opens the system dictionary at `path` with the settings built into sudachi.rs.
    pub fn open(path: &Path) -> Result<Self, OpenError> {
        let config = Config::new_embedded().map_err(|e| OpenError(format!("sudachi settings: {e}")))?;
        Self::open_with(config, path)
    }

    /// Opens the dictionary with settings of the caller's (the tests' small dictionaries need
    /// their own part-of-speech ids for unknown words).
    pub fn open_with(config: Config, path: &Path) -> Result<Self, OpenError> {
        let failed = |what: &str, e: &dyn std::fmt::Display| OpenError(format!("{what} {}: {e}", path.display()));
        let file = File::open(path).map_err(|e| failed("cannot open", &e))?;
        // SAFETY: the dictionary is a read-only file of the app's own folder; nothing writes it
        // while the app runs (an update replaces the folder only after the app has quit).
        let mapping = unsafe { memmap2::Mmap::map(&file) }.map_err(|e| failed("cannot map", &e))?;
        let storage = SudachiDicData::new(Storage::File(mapping));
        // The character definitions built into sudachi.rs: a path would be looked up beside the
        // sources sudachi.rs was built from and in the working folder. sudachi.rs panics on some
        // damaged files (a cut-off copy) instead of answering an error.
        let dictionary = catch_unwind(AssertUnwindSafe(|| {
            JapaneseDictionary::from_cfg_storage_with_embedded_chardef(&config, storage).map_err(|e| e.to_string())
        }))
        .map_err(|_| failed("cannot read", &"damaged dictionary"))?
        .map_err(|e| failed("cannot read", &e))?;
        Ok(Self { tokenizer: StatelessTokenizer::new(Arc::new(dictionary)) })
    }
}

impl Tokenizer for Sudachi {
    fn tokenize(&self, text: &str) -> Result<Vec<Morpheme>, Unavailable> {
        let analyzed = catch_unwind(AssertUnwindSafe(|| {
            let morphemes = self.tokenizer.tokenize(text, Mode::C, false).map_err(|_| Unavailable)?;
            Ok(morphemes
                .iter()
                .map(|m| Morpheme {
                    surface: m.surface().to_string(),
                    reading: m.reading_form().to_string(),
                    part_of_speech: m.part_of_speech().first().cloned().unwrap_or_default(),
                })
                .collect())
        }));
        analyzed.unwrap_or(Err(Unavailable))
    }
}

/// The dictionary file, opened on the first text. When it is missing or cannot be read there
/// are no readings ([`Unavailable`]) until the app starts again; [`SudachiFile::status`] says why.
pub struct SudachiFile {
    path: PathBuf,
    opened: OnceLock<Result<Sudachi, OpenError>>,
}

impl SudachiFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path, opened: OnceLock::new() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn opened(&self) -> &Result<Sudachi, OpenError> {
        self.opened.get_or_init(|| {
            if self.path.is_file() {
                Sudachi::open(&self.path)
            } else {
                Err(OpenError(format!("no dictionary at {}", self.path.display())))
            }
        })
    }

    /// Why there are no readings, once the dictionary has been looked for; `None` while it
    /// works or before the first text.
    pub fn status(&self) -> Option<String> {
        match self.opened.get() {
            Some(Err(e)) => Some(e.to_string()),
            _ => None,
        }
    }
}

impl Tokenizer for SudachiFile {
    fn tokenize(&self, text: &str) -> Result<Vec<Morpheme>, Unavailable> {
        match self.opened() {
            Ok(sudachi) => sudachi.tokenize(text),
            Err(_) => Err(Unavailable),
        }
    }

    fn unavailable_reason(&self) -> Option<String> {
        self.status()
    }
}
