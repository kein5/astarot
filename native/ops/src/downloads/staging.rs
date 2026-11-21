//! One owner per download root, across processes and interrupted runs ([`staging.py`]).
//!
//! The lock is the same as the Python module's (`flock` on the whole file; on Windows a lock
//! on its first byte, which is what `msvcrt.locking` takes), so a Python and a Rust owner of
//! the same root exclude each other while both exist.
//!
//! [`staging.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/model_downloads/staging.py

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::catalog::Model;
use super::Error;
use crate::json::{Json, Object};
use app_identity::MODEL_DOWNLOAD_OWNER as PRODUCT;

pub const LOCK_NAME: &str = ".download.lock";
const MARKER: &str = "owner.json";
const MARKER_LIMIT: u64 = 4096;

/// The exclusive lease on a download root, held until [`RootLease::close`] or drop.
pub struct RootLease {
    path: PathBuf,
    file: Option<File>,
}

impl RootLease {
    pub fn new(root: &Path) -> Self {
        RootLease { path: root.join(LOCK_NAME), file: None }
    }

    /// Takes the lease without waiting. Another owner: `download_busy`. A lock path that is
    /// not a regular file: `unsafe_destination`.
    pub fn acquire(&mut self) -> Result<(), Error> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = options.open(&self.path).map_err(Error::Io)?;
        if !file.metadata().map_err(Error::Io)?.file_type().is_file() {
            return Err(Error::Code("unsafe_destination"));
        }
        lock(&mut file)?;
        self.file = Some(file);
        Ok(())
    }

    pub fn close(&mut self) {
        // Closing the handle releases the lock.
        self.file = None;
    }
}

#[cfg(unix)]
fn lock(file: &mut File) -> Result<(), Error> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::EWOULDBLOCK) | Some(libc::EACCES) => Err(Error::Code("download_busy")),
        _ => Err(Error::Io(error)),
    }
}

#[cfg(windows)]
fn lock(file: &mut File) -> Result<(), Error> {
    use std::io::{Seek, SeekFrom};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY};
    use windows_sys::Win32::System::IO::OVERLAPPED;
    // msvcrt.locking locks bytes from the current position; Python wrote one byte first.
    if file.metadata().map_err(Error::Io)?.len() == 0 {
        file.write_all(b"\0").map_err(Error::Io)?;
        file.seek(SeekFrom::Start(0)).map_err(Error::Io)?;
    }
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    let done = unsafe { LockFileEx(file.as_raw_handle() as HANDLE, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &mut overlapped) };
    if done != 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION as i32) || error.raw_os_error() == Some(33) {
        Err(Error::Code("download_busy"))
    } else {
        Err(Error::Io(error))
    }
}

/// The marker a staging directory carries, as Python's `mark_owned` writes it, naming `product`.
fn marker(product: &str, entry: &Model, directory: &str) -> Object {
    Object::new()
        .with("product", product)
        .with("id", entry.id.as_str())
        .with("revision", entry.revision.as_str())
        .with("files", entry.artifacts.iter().map(|a| Json::from(a.filename.as_str())).collect::<Vec<_>>())
        .with("directory", directory)
}

/// Writes `owner.json` (never over an existing one) and makes it durable.
pub fn mark_owned(path: &Path, entry: &Model) -> Result<(), Error> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let text = Json::from(marker(PRODUCT.current(), entry, name)).to_python_default();
    let mut out = OpenOptions::new().write(true).create_new(true).open(path.join(MARKER)).map_err(Error::Io)?;
    out.write_all(text.as_bytes()).map_err(Error::Io)?;
    out.flush().map_err(Error::Io)?;
    out.sync_all().map_err(Error::Io)
}

fn is_partial_name(name: &str) -> bool {
    name.strip_prefix(".partial-").is_some_and(|rest| rest.len() == 32 && rest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// Removes staging directories an interrupted owner left behind. The caller holds the lease.
///
/// Only a `.partial-<32 hex>` directory whose marker names an entry of `entries` exactly, and
/// that holds nothing but that entry's files, the marker and the receipt (all regular files),
/// is removed. Links are never followed and anything unrecognized stays. A file that vanishes
/// meanwhile, or a marker that is not one, skips the directory; any other I/O error stops.
pub fn recover_owned(root: &Path, entries: &[Model], extra_files: &[&str]) -> Result<(), Error> {
    let listing = match fs::read_dir(root) {
        Ok(listing) => listing,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(Error::Io(e)),
    };
    for item in listing {
        let item = item.map_err(Error::Io)?;
        let name = item.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(".partial-") {
            continue;
        }
        let path = item.path();
        match recover_one(&path, name, entries, extra_files) {
            Ok(()) => {}
            Err(Error::Io(e)) if e.kind() == io::ErrorKind::NotFound => {}
            Err(Error::Code("skip")) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

const SKIP: Error = Error::Code("skip");

/// The marker of `path` as an object, or `skip` when there is none that could be one.
fn read_marker(path: &Path) -> Result<Object, Error> {
    let marker_path = path.join(MARKER);
    let meta = fs::symlink_metadata(&marker_path).map_err(Error::Io)?;
    if !meta.file_type().is_file() || fs::metadata(&marker_path).map_err(Error::Io)?.len() > MARKER_LIMIT {
        return Err(SKIP);
    }
    let text = fs::read(&marker_path).map_err(Error::Io)?;
    let data = Json::parse_slice(&text).map_err(|_| SKIP)?;
    data.as_object().cloned().ok_or(SKIP)
}

/// Moves a published entry whose files failed their check out of the way, so that it can be
/// downloaded again. Answers whether it moved.
///
/// Only a folder this app wrote is moved: its marker names `entry` exactly and the staging name
/// it was published from, and it holds nothing but the entry's files, the marker and the receipt
/// (all regular files). It goes back to that staging name, which makes it what an interrupted
/// download leaves, and is removed by the same rule as [`recover_owned`]; if the process stops in
/// between, the next owner of the root removes it. Anything else stays where it is (`false`), as
/// does a folder that cannot be moved now (a file in use on Windows). The caller holds the lease.
pub fn reclaim_published(root: &Path, destination: &Path, entry: &Model) -> Result<bool, Error> {
    let entries = std::slice::from_ref(entry);
    let name = match read_marker(destination) {
        Ok(data) => match data.get("directory").and_then(Json::as_str) {
            Some(name) if is_partial_name(name) => name.to_string(),
            _ => return Ok(false),
        },
        Err(Error::Io(e)) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(Error::Code("skip")) => return Ok(false),
        Err(error) => return Err(error),
    };
    match check_owned(destination, &name, entries, &[]) {
        Ok(_) => {}
        Err(Error::Io(e)) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(Error::Code("skip")) => return Ok(false),
        Err(error) => return Err(error),
    }
    let aside = root.join(&name);
    if fs::symlink_metadata(&aside).is_ok() || fs::rename(destination, &aside).is_err() {
        return Ok(false);
    }
    // A failure here leaves a staging folder the next owner of the root removes.
    let _ = recover_one(&aside, &name, entries, &[]);
    Ok(true)
}

fn recover_one(path: &Path, name: &str, entries: &[Model], extra_files: &[&str]) -> Result<(), Error> {
    if !is_partial_name(name) || !fs::symlink_metadata(path).map_err(Error::Io)?.file_type().is_dir() {
        return Err(SKIP);
    }
    let children = check_owned(path, name, entries, extra_files)?;
    for child in &children {
        fs::remove_file(child).map_err(Error::Io)?;
    }
    fs::remove_dir(path).map_err(Error::Io)
}

/// The children of `path` when its marker names an entry of `entries` and the staging name
/// `name` exactly, and every child is a regular file the entry owns. `skip` otherwise.
///
/// The marker's product may have either spelling (ADR-014, 2.11): this build writes the VRCT-VOX
/// one, and a build that moved to ASTAROT takes back what an older one left, and the other way
/// round.
fn check_owned(path: &Path, name: &str, entries: &[Model], extra_files: &[&str]) -> Result<Vec<PathBuf>, Error> {
    let data = read_marker(path)?;
    let entry = data.get("id").and_then(Json::as_str).and_then(|id| entries.iter().find(|e| e.id == id)).ok_or(SKIP)?;
    let product = data.get("product").and_then(Json::as_str).filter(|product| PRODUCT.accepts(product)).ok_or(SKIP)?;
    if !data.same_as(&marker(product, entry, name)) {
        return Err(SKIP);
    }
    let mut children = Vec::new();
    for child in fs::read_dir(path).map_err(Error::Io)? {
        children.push(child.map_err(Error::Io)?);
    }
    for child in &children {
        let child_name = child.file_name();
        let child_name = child_name.to_str().unwrap_or_default();
        let allowed = child_name == MARKER || child_name == "receipt.json" || extra_files.contains(&child_name) || entry.artifacts.iter().any(|a| a.filename == child_name);
        if !allowed || !fs::symlink_metadata(child.path()).map_err(Error::Io)?.file_type().is_file() {
            return Err(SKIP);
        }
    }
    Ok(children.iter().map(fs::DirEntry::path).collect())
}
