//! Model downloads (`src-python/models/model_downloads/`).
//!
//! The user consents to one catalog entry; its pinned files are fetched into a staging
//! directory, checked for size and SHA-256, and only then renamed into
//! `<root>/<id>/<revision>/`. A failed, cancelled or interrupted download publishes nothing and
//! leaves no staging behind; what a killed process left is reclaimed by the next owner of the
//! root. A published entry whose files no longer pass the check is moved out of the way and
//! downloaded again when this app wrote everything in it; otherwise it is kept and the download
//! fails. Applying a download to the settings is a separate, explicit call.

pub mod catalog;
pub mod guidance;
pub mod hardware;
mod manager;
pub mod speechcpp;
pub mod staging;
pub mod translation_catalog;
pub mod transport;
pub mod user_models;
pub mod verification;

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

pub use manager::{Downloads, Options, ACTIVE};

/// A failed download operation.
#[derive(Debug)]
pub enum Error {
    /// A fixed code the backend answers as it is: `download_busy`, `hash_mismatch`, ...
    Code(&'static str),
    /// A file or network operation failed. The message is never shown or logged.
    Io(io::Error),
    /// Anything else: an HTTP error, a broken redirect, or a refusal of an `apply` callback.
    /// The text is a fixed description, never user data.
    Other(String),
}

impl Error {
    /// The fixed code, or `None` for an error a job reports as `download_failed` (or
    /// `insufficient_space` for a full disk).
    pub fn code(&self) -> Option<&'static str> {
        match self {
            Error::Code(code) => Some(code),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Code(code) => f.write_str(code),
            Error::Io(_) => f.write_str("input/output error"),
            Error::Other(text) => f.write_str(text),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(error: io::Error) -> Self {
        Error::Io(error)
    }
}

/// Whether an I/O error means the disk is full (Python maps these to `ENOSPC`).
pub(crate) fn is_disk_full(error: &io::Error) -> bool {
    if error.kind() == io::ErrorKind::StorageFull {
        return true;
    }
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(libc::ENOSPC)
    }
    #[cfg(windows)]
    {
        // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL
        matches!(error.raw_os_error(), Some(39) | Some(112))
    }
}

/// Creates a fixed directory and every missing parent (mode 0700), refusing to pass through
/// anything that is not a directory, a symbolic link included (`unsafe_destination`).
pub fn directory(path: &Path) -> Result<(), Error> {
    let mut ancestors: Vec<&Path> = path.ancestors().filter(|p| !p.as_os_str().is_empty()).collect();
    ancestors.reverse();
    for part in ancestors {
        let meta = match std::fs::symlink_metadata(part) {
            Ok(meta) => meta,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                create_private_dir(part)?;
                std::fs::symlink_metadata(part)?
            }
            Err(e) => return Err(Error::Io(e)),
        };
        if !meta.file_type().is_dir() {
            return Err(Error::Code("unsafe_destination"));
        }
    }
    Ok(())
}

/// Creates one directory, readable only by the user where the system has modes (0700).
pub(crate) fn create_private_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new().mode(0o700).create(path)
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir(path)
    }
}

/// Makes a rename inside `directory` durable where the system needs it (Linux: the folder's own
/// entry is flushed, so a power cut does not undo a publish). Best effort: the rename itself has
/// already succeeded, and Windows has no such step.
pub fn sync_directory(directory: &Path) {
    #[cfg(unix)]
    if let Ok(folder) = std::fs::File::open(directory) {
        let _ = folder.sync_all();
    }
    #[cfg(not(unix))]
    let _ = directory;
}

/// `Path(root).expanduser().absolute()`: `~` expanded, made absolute without resolving links.
pub(crate) fn absolute_root(root: &Path) -> PathBuf {
    let text = root.to_string_lossy();
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let expanded = match (text.strip_prefix('~'), home) {
        (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with('/') || (cfg!(windows) && rest.starts_with('\\')) => {
            let mut path = PathBuf::from(home);
            path.push(rest.trim_start_matches(['/', '\\']));
            path
        }
        _ => root.to_path_buf(),
    };
    std::path::absolute(&expanded).unwrap_or(expanded)
}

/// Free bytes on the volume holding `path`, as `shutil.disk_usage(path).free` reports them.
pub fn free_space(path: &Path) -> io::Result<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let c = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut stat) } != 0 {
            return Err(io::Error::last_os_error());
        }
        #[allow(clippy::unnecessary_cast)]
        Ok(stat.f_bavail as u64 * stat.f_frsize as u64)
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let (mut caller, mut total, mut free) = (0u64, 0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut caller, &mut total, &mut free) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // CPython's nt._getdiskusage reports the volume's free bytes, not the caller's quota.
        Ok(free)
    }
}
