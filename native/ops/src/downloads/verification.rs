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

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(data: &[u8]) -> String {
        hex(&Sha256::digest(data))
    }

    fn checked(path: &Path, size: u64, sha256: &str) -> Result<(), Error> {
        verify_file(path, size, sha256, || Ok(()))
    }

    fn code(result: Result<(), Error>) -> String {
        result.unwrap_err().to_string()
    }

    #[test]
    fn a_file_passes_only_as_a_regular_file_of_its_size_and_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.gguf");
        fs::write(&path, b"weights").unwrap();
        assert!(checked(&path, 7, &sha(b"weights")).is_ok());
        assert_eq!(code(checked(&path, 8, &sha(b"weights"))), "size_mismatch");
        assert_eq!(code(checked(&path, 7, &sha(b"weighTs"))), "hash_mismatch");
        assert_eq!(code(checked(dir.path(), 0, &sha(b""))), "unsafe_destination");
        assert!(matches!(checked(&dir.path().join("none.gguf"), 7, &sha(b"weights")), Err(Error::Io(_))));
        #[cfg(unix)]
        {
            let link = dir.path().join("link.gguf");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert_eq!(code(checked(&link, 7, &sha(b"weights"))), "unsafe_destination", "a link is not followed");
        }
    }

    #[test]
    fn the_checkpoint_runs_between_blocks_and_its_error_stops_the_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.gguf");
        let data = vec![7u8; 10];
        fs::write(&path, &data).unwrap();
        // Before, once per block of 4 bytes (three blocks) and after.
        let mut calls = 0;
        verify_file_chunked(&path, 10, &sha(&data), &mut || {
            calls += 1;
            Ok::<(), Error>(())
        }, 4)
        .unwrap();
        assert_eq!(calls, 5);
        // A cancel in the middle ends it with the checkpoint's own error.
        let mut calls = 0;
        let stopped = verify_file_chunked(&path, 10, &sha(&data), &mut || {
            calls += 1;
            if calls == 3 { Err(Error::Code("cancelled")) } else { Ok(()) }
        }, 4);
        assert_eq!(code(stopped), "cancelled");
        assert_eq!(calls, 3);
    }
}
