//! The integrity check of the fixed speech.cpp package resource. No PATH lookup.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::{codes, Code};

/// The release the bundle has to be.
pub const VERSION: &str = "0.11.0";

/// SHA-256 of the executable of each variant, as in docs/voice-stack/speechcpp-bundle-artifacts.json.
pub const HASHES: [(&str, &str); 3] = [
    ("linux-x64-cpu", "bcd1a7b27dd9185a93eb0d8847524ae967d5ba35b315858d445c3317d5e5e768"),
    ("linux-x64-vulkan", "9b765a785150bbbaf8297b51244f1d58581969f38110265533562a60b220f6fb"),
    ("windows-x64-vulkan", "c88e3248f9a43ae1dac0e7c5a525c3cd6f245120110992d1b79df609aa8f9100"),
];

pub const EXECUTABLE: &str = if cfg!(windows) { "speech.exe" } else { "speech" };

#[cfg(unix)]
fn executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_metadata: &std::fs::Metadata) -> bool {
    true
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The executable in `bundle` (the app's `build/speechcpp`), once its release, variant
/// and SHA-256 match the pinned ones.
pub fn bundled_binary(bundle: &Path) -> Result<PathBuf, Code> {
    let checked = || -> Option<PathBuf> {
        let meta = bundle.join("bundle.json");
        let binary = bundle.join(EXECUTABLE);
        if bundle.symlink_metadata().ok()?.file_type().is_symlink() {
            return None;
        }
        // lstat: neither file may be a link out of the bundle.
        let meta_stat = meta.symlink_metadata().ok()?;
        let binary_stat = binary.symlink_metadata().ok()?;
        if !meta_stat.is_file() || meta_stat.len() > 65536 || !binary_stat.is_file() || !executable(&binary_stat) {
            return None;
        }
        let data: serde_json::Value = serde_json::from_slice(&std::fs::read(&meta).ok()?).ok()?;
        let schema = data.get("schema")?;
        if !(schema.is_u64() && schema.as_u64() == Some(1)) || data.get("version")?.as_str()? != VERSION {
            return None;
        }
        let variant = data.get("variant")?.as_str()?;
        let expected = HASHES.iter().find(|(name, _)| *name == variant)?.1;
        let mut digest = Sha256::new();
        let mut source = File::open(&binary).ok()?;
        let mut block = vec![0u8; 1024 * 1024];
        loop {
            let read = source.read(&mut block).ok()?;
            if read == 0 {
                break;
            }
            digest.update(&block[..read]);
        }
        if hex(&digest.finalize()) != expected {
            return None;
        }
        std::fs::canonicalize(&binary).ok()
    };
    checked().ok_or(codes::BUNDLE)
}
