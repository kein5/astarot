//! The integrity check of the fixed speech.cpp package resource. No PATH lookup.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::{codes, Code};

/// The release the bundle has to be.
pub const VERSION: &str = "0.11.2";

/// SHA-256 of the executable of each variant, as in docs/voice-stack/speechcpp-bundle-artifacts.json.
pub const HASHES: [(&str, &str); 3] = [
    ("linux-x64-cpu", "e34eeb083306e7b01ecf16be89eb901f6308d6c6c20ee6f2ecd545aa22e1580e"),
    ("linux-x64-vulkan", "d598440999a2348d3b1ddb3090a9597085e85dccb672be17608828910e92238f"),
    ("windows-x64-vulkan", "89ffb275308a0ac4d1309be5865602497b5d029e5287e52ac65482348248d4c8"),
];

pub const EXECUTABLE: &str = if cfg!(windows) { "speech.exe" } else { "speech" };

/// The pinned (variant, SHA-256) pairs a bundle is checked against: [`HASHES`], or in tests
/// the hash of a stand-in executable.
pub type Pins = std::sync::Arc<[(String, String)]>;

/// [`HASHES`] as [`Pins`].
pub fn pinned() -> Pins {
    HASHES.iter().map(|(variant, hash)| ((*variant).to_owned(), (*hash).to_owned())).collect()
}

/// What a bundle's executable computes on, from the end of its variant's name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Build {
    /// `linux-x64-cpu`: the CPU only. It needs no Vulkan loader.
    Cpu,
    /// `linux-x64-vulkan`, `windows-x64-vulkan`: Vulkan GPUs and the CPU. The executable loads
    /// the Vulkan loader (`libvulkan.so.1`, `vulkan-1.dll`) when it starts.
    Vulkan,
}

impl Build {
    pub fn name(self) -> &'static str {
        match self {
            Build::Cpu => "cpu",
            Build::Vulkan => "vulkan",
        }
    }

    fn of_variant(variant: &str) -> Option<Build> {
        if variant.ends_with("-cpu") {
            Some(Build::Cpu)
        } else if variant.ends_with("-vulkan") {
            Some(Build::Vulkan)
        } else {
            None
        }
    }
}

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

/// The SHA-256 of a file in lowercase hex, as the pins hold it; None when it cannot be read.
pub fn file_sha256(path: &Path) -> Option<String> {
    let mut digest = Sha256::new();
    let mut source = File::open(path).ok()?;
    let mut block = vec![0u8; 1024 * 1024];
    loop {
        let read = source.read(&mut block).ok()?;
        if read == 0 {
            break;
        }
        digest.update(&block[..read]);
    }
    Some(hex(&digest.finalize()))
}

/// The executable in `bundle` (the app's `build/speechcpp`), once its release, variant
/// and SHA-256 match the pinned ones.
pub fn bundled_binary(bundle: &Path) -> Result<PathBuf, Code> {
    checked_bundle(bundle, &pinned()).map(|(binary, _)| binary)
}

/// The executable in `bundle` and what it computes on, once its release, variant and SHA-256
/// match one of `pins`.
pub fn checked_bundle(bundle: &Path, pins: &[(String, String)]) -> Result<(PathBuf, Build), Code> {
    let checked = || -> Option<(PathBuf, Build)> {
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
        let build = Build::of_variant(variant)?;
        let expected = &pins.iter().find(|(name, _)| name == variant)?.1;
        if &file_sha256(&binary)? != expected {
            return None;
        }
        Some((std::fs::canonicalize(&binary).ok()?, build))
    };
    checked().ok_or(codes::BUNDLE)
}
