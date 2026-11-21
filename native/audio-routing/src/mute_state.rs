//! The durable mute intent, independent of the debounced application settings.
//!
//! Port of [`src-python/models/audio_routing/mute_state.py`]. The file holds
//! `{"version": 1, "muted": <bool>}` and is replaced atomically: written to a new
//! file next to it, flushed to disk, renamed over it, and (on Unix) the directory
//! flushed too.
//!
//! [`src-python/models/audio_routing/mute_state.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/mute_state.py

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::{Error, Result};

/// Where the mute intent is stored, and how it is read and written.
pub trait MuteStore: Send + Sync {
    fn read(&self) -> Result<bool>;
    fn write(&self, muted: bool) -> Result<()>;
}

pub struct MuteState {
    path: PathBuf,
}

impl MuteState {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn unavailable(_: std::io::Error) -> Error {
    Error::value("mute_state_unavailable")
}

fn temporary_name() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!(".voice-mute-{:012x}", hasher.finish() & 0xffff_ffff_ffff)
}

impl MuteStore for MuteState {
    /// `false` when no intent was saved; an unreadable or foreign file is an error.
    fn read(&self) -> Result<bool> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(unavailable(error)),
        };
        let invalid = || Error::value("invalid_mute_state");
        let value: Value = serde_json::from_str(&text).map_err(|_| invalid())?;
        // Python compares `version != 1`, which also accepts 1.0 and true.
        let version_ok = match value.get("version") {
            Some(Value::Number(n)) => n.as_f64() == Some(1.0),
            Some(Value::Bool(b)) => *b,
            _ => false,
        };
        match value.get("muted") {
            Some(Value::Bool(muted)) if version_ok && value.is_object() => Ok(*muted),
            _ => Err(invalid()),
        }
    }

    fn write(&self, muted: bool) -> Result<()> {
        let parent = self.path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(unavailable)?;
        let mut attempts = 0;
        let (temporary, mut file) = loop {
            let candidate = parent.join(temporary_name());
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600).custom_flags(libc_nofollow());
            }
            match options.open(&candidate) {
                Ok(file) => break (candidate, file),
                // Only a taken name is retried; a refused write fails at once.
                Err(error) if error.kind() == ErrorKind::AlreadyExists && attempts < 100 => attempts += 1,
                Err(error) => return Err(unavailable(error)),
            }
        };
        let result = (|| {
            file.write_all(format!("{{\"version\": 1, \"muted\": {muted}}}").as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, &self.path)?;
            #[cfg(unix)]
            fs::File::open(parent)?.sync_all()?;
            Ok(())
        })();
        if temporary.exists() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(unavailable)
    }
}

#[cfg(unix)]
fn libc_nofollow() -> i32 {
    #[cfg(target_os = "linux")]
    {
        libc::O_NOFOLLOW
    }
    #[cfg(not(target_os = "linux"))]
    {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vrct-mute-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_file_means_unmuted_and_writes_round_trip() {
        let dir = scratch("roundtrip");
        let state = MuteState::new(dir.join("sub/voice-mute.json"));
        assert!(!state.read().unwrap());
        state.write(true).unwrap();
        assert!(state.read().unwrap());
        assert_eq!(fs::read_to_string(state.path()).unwrap(), r#"{"version": 1, "muted": true}"#);
        state.write(false).unwrap();
        assert!(!state.read().unwrap());
        let leftovers: Vec<_> = fs::read_dir(dir.join("sub")).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(".voice-mute-")).collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn foreign_content_is_refused() {
        let dir = scratch("foreign");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("voice-mute.json");
        let state = MuteState::new(&path);
        for text in [r#"{"version": 2, "muted": true}"#, r#"{"version": 1, "muted": 1}"#, "[]", "nonsense"] {
            fs::write(&path, text).unwrap();
            assert_eq!(state.read().unwrap_err(), Error::value("invalid_mute_state"), "{text}");
        }
        fs::write(&path, r#"{"version": 1.0, "muted": false}"#).unwrap();
        assert!(!state.read().unwrap());
        let _ = fs::remove_dir_all(dir);
    }
}
