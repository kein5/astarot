//! File verification shared by catalog and built-in model transactions (`verification.py`).

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::Error;

pub const CHUNK: usize = 1024 * 1024;

/// Opens a regular file without following a link at its own name (`O_NOFOLLOW` where the
/// system has it; on Windows the type was checked just before, as in Python).
pub(crate) fn open_regular(path: &Path) -> std::io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// Checks that `path` is a regular file of exactly `size` bytes whose SHA-256 is `sha256`.
/// `checkpoint` runs before, between blocks and after, so a cancel stops a long hash.
///
/// Errors: `unsafe_destination` (not a regular file), `size_mismatch`, `hash_mismatch`, an
/// I/O error (a missing file among them), or whatever `checkpoint` returns.
pub fn verify_file<E: From<Error>>(path: &Path, size: u64, sha256: &str, mut checkpoint: impl FnMut() -> Result<(), E>) -> Result<(), E> {
    verify_file_chunked(path, size, sha256, &mut checkpoint, CHUNK)
}

pub(crate) fn verify_file_chunked<E: From<Error>>(path: &Path, size: u64, sha256: &str, checkpoint: &mut impl FnMut() -> Result<(), E>, chunk: usize) -> Result<(), E> {
    checkpoint()?;
    let meta = fs::symlink_metadata(path).map_err(Error::Io)?;
    if !meta.file_type().is_file() {
        return Err(Error::Code("unsafe_destination").into());
    }
    let mut file = open_regular(path).map_err(Error::Io)?;
    if file.metadata().map_err(Error::Io)?.len() != size {
        return Err(Error::Code("size_mismatch").into());
    }
    let mut digest = Sha256::new();
    let mut block = vec![0u8; chunk];
    loop {
        let n = file.read(&mut block).map_err(Error::Io)?;
        if n == 0 {
            break;
        }
        checkpoint()?;
        digest.update(&block[..n]);
    }
    checkpoint()?;
    if hex(&digest.finalize()) != sha256 {
        return Err(Error::Code("hash_mismatch").into());
    }
    Ok(())
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
