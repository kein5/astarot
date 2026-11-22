//! The PP-OCR files the user downloaded through the consented catalog, and the
//! recogniser's character list.
//!
//! Layout (owned by the download manager): `<root>/<catalog id>/<revision>/<file>`, the
//! root being `downloaded_models` next to `config.json`. Only catalog entries are
//! resolved, and only after their size and SHA-256 match the catalog. Nothing here
//! downloads anything.
//!
//! The table below repeats the OCR block of [`src-python/models/model_downloads/catalog.py`]
//! (the download manager still lives there); `tests/catalog.rs` checks that they agree.
//!
//! [`src-python/models/model_downloads/catalog.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/model_downloads/catalog.py

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::languages::{OcrModelSpec, BASE_MODEL_ID};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Artifact {
    pub filename: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    /// "det", "rec", "dict" or "detector".
    pub role: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogEntry {
    pub id: &'static str,
    pub revision: &'static str,
    pub artifacts: &'static [Artifact],
}

pub const DETECTOR_MODEL_ID: &str = "vrct-vox-chatbox-detector";
pub const DETECTOR_FILE_NAME: &str = "vrct_vox_chatbox_yolox_tiny.onnx";

const fn rec(onnx: (u64, &'static str), yml: (u64, &'static str)) -> [Artifact; 2] {
    [Artifact { filename: "rec.onnx", size: onnx.0, sha256: onnx.1, role: "rec" }, Artifact { filename: "rec.yml", size: yml.0, sha256: yml.1, role: "dict" }]
}

const PPOCRV6_SMALL: [Artifact; 3] = [
    Artifact { filename: "det.onnx", size: 9880512, sha256: "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e", role: "det" },
    Artifact { filename: "rec.onnx", size: 21159378, sha256: "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634", role: "rec" },
    Artifact { filename: "rec.yml", size: 150579, sha256: "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1", role: "dict" },
];
const KOREAN: [Artifact; 2] = rec((13418787, "92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08"), (96039, "f757fa1c40e99edcf27e9cce879b93eb2a51fa46f5ef39095689b8c37dd75998"));
const CYRILLIC: [Artifact; 2] = rec((8048799, "5371ee1ddaa7983cc62d0818d99e982b6804638c85e4f960d59a574094e172e5"), (6991, "5c76cc91fa98410178a09f498db10050d0ec1634a660053d3005ab7be581f501"));
const THAI: [Artifact; 2] = rec((7891015, "27618be66018f8598ac0a526a593f9f1cebf794e7eded93428e8fb016e537f5f"), (4667, "f6ba7fefc38ca1ff398ddafa75d67d16e0b3757c4e6c833adffee98a981766c9"));
const ARABIC: [Artifact; 2] = rec((7998947, "799113ebf267fbe742deb99eb36e8d42c9ddc5291ceacf92add41b4d52a59110"), (6165, "21368419e6c016c31db55d316d59e11c128e1913e6e6fe10287084710043d3a6"));
const DEVANAGARI: [Artifact; 2] = rec((7912311, "cb789212ce96c69d3e74728ae4309d179281d68cb3945d0616b67cafab41c986"), (5027, "9bd172dd26440c8ce94d1cde5d5baea6aefdc7cf3c5c8492e0beedef656d4e54"));
const DETECTOR: [Artifact; 1] = [Artifact { filename: DETECTOR_FILE_NAME, size: 20184371, sha256: "160c4a505bee87d101564c569dff7f0bacd416b9006ec5aa70f8c9d221470ffd", role: "detector" }];

/// The OCR entries of the download catalog (`target == "ocr"`).
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry { id: BASE_MODEL_ID, revision: "b8f84f0b80c529de40b4fbb3544b84fa7233a513", artifacts: &PPOCRV6_SMALL },
    CatalogEntry { id: "ppocrv5-korean", revision: "5c6f574b8e2230adf4287b33e736d71b9fabd28e", artifacts: &KOREAN },
    CatalogEntry { id: "ppocrv5-cyrillic", revision: "2cef88145434beb8afa9dd82d77d799eb1ad7b29", artifacts: &CYRILLIC },
    CatalogEntry { id: "ppocrv5-thai", revision: "1d4adbbafb1034a2fd6618498575b81ea7b69f69", artifacts: &THAI },
    CatalogEntry { id: "ppocrv5-arabic", revision: "14aaedcd75825982689ecf5cd64ab33ee083215a", artifacts: &ARABIC },
    CatalogEntry { id: "ppocrv5-devanagari", revision: "251aec19e36739540d35e2cc943f6aa7503b98e5", artifacts: &DEVANAGARI },
    CatalogEntry { id: DETECTOR_MODEL_ID, revision: "3febea9f3ad213738730177c7907cc434dca2267", artifacts: &DETECTOR },
];

pub fn catalog_entry(model_id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|entry| entry.id == model_id)
}

fn artifact_path(root: &Path, entry: &CatalogEntry, artifact: &Artifact) -> PathBuf {
    root.join(entry.id).join(entry.revision).join(artifact.filename)
}

/// Every file of the download is present with the catalog size (no hashing).
pub fn is_installed(root: &Path, model_id: &str) -> bool {
    let Some(entry) = catalog_entry(model_id) else { return false };
    entry.artifacts.iter().all(|artifact| {
        let path = artifact_path(root, entry, artifact);
        match std::fs::symlink_metadata(&path) {
            Ok(meta) => meta.file_type().is_file() && meta.len() == artifact.size,
            Err(_) => false,
        }
    })
}

pub fn missing_models(root: &Path, spec: &OcrModelSpec) -> Vec<String> {
    spec.model_ids().into_iter().filter(|id| !is_installed(root, id)).map(str::to_string).collect()
}

/// (path, size, mtime) → SHA-256 already verified in this process. Hashing ~31 MB takes
/// tens of milliseconds: cheap at start-up, pointless on every language switch.
type VerifiedFiles = Mutex<HashMap<(PathBuf, u64, i128), &'static str>>;

fn verified() -> &'static VerifiedFiles {
    static VERIFIED: std::sync::OnceLock<VerifiedFiles> = std::sync::OnceLock::new();
    VERIFIED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn mtime_ns(meta: &std::fs::Metadata) -> i128 {
    meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos() as i128).unwrap_or(-1)
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

fn verify(path: &Path, artifact: &Artifact) -> Result<()> {
    let meta = std::fs::metadata(path)?;
    let key = (path.to_path_buf(), meta.len(), mtime_ns(&meta));
    if verified().lock().map(|cache| cache.get(&key) == Some(&artifact.sha256)).unwrap_or(false) {
        return Ok(());
    }
    if meta.len() != artifact.size {
        return Err(Error::ModelsInvalid(format!("size mismatch: {}", file_name(path))));
    }
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)?;
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if digest != artifact.sha256 {
        return Err(Error::ModelsInvalid(format!("hash mismatch: {}", file_name(path))));
    }
    if let Ok(mut cache) = verified().lock() {
        cache.insert(key, artifact.sha256);
    }
    Ok(())
}

/// The verified path of one file of a download (`resolveArtifact`).
pub fn resolve_artifact(root: &Path, model_id: &str, role: &str) -> Result<PathBuf> {
    let missing = || Error::ModelsMissing(vec![model_id.to_string()]);
    let entry = catalog_entry(model_id).ok_or_else(missing)?;
    if !is_installed(root, model_id) {
        return Err(missing());
    }
    let artifact = entry.artifacts.iter().find(|artifact| artifact.role == role).ok_or_else(missing)?;
    let path = artifact_path(root, entry, artifact);
    verify(&path, artifact)?;
    Ok(path)
}

/// Verified files for one language's models.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ModelFiles {
    pub det: PathBuf,
    pub rec: PathBuf,
    pub dict: PathBuf,
}

/// `resolveModelFiles`: every file of every download `spec` needs, verified.
pub fn resolve_model_files(root: Option<&Path>, spec: &OcrModelSpec) -> Result<ModelFiles> {
    let Some(root) = root else {
        return Err(Error::ModelsMissing(spec.model_ids().into_iter().map(str::to_string).collect()));
    };
    let missing = missing_models(root, spec);
    if !missing.is_empty() {
        return Err(Error::ModelsMissing(missing));
    }
    let (mut det, mut rec, mut dict) = (None, None, None);
    for model_id in spec.model_ids() {
        let entry = catalog_entry(model_id).ok_or_else(|| Error::ModelsMissing(vec![model_id.to_string()]))?;
        for artifact in entry.artifacts {
            let path = artifact_path(root, entry, artifact);
            verify(&path, artifact)?;
            if model_id == BASE_MODEL_ID && artifact.role == "det" {
                det = Some(path.clone());
            }
            if model_id == spec.rec_model_id {
                match artifact.role {
                    "rec" => rec = Some(path.clone()),
                    "dict" => dict = Some(path.clone()),
                    _ => {}
                }
            }
        }
    }
    match (det, rec, dict) {
        (Some(det), Some(rec), Some(dict)) => Ok(ModelFiles { det, rec, dict }),
        _ => Err(Error::ModelsMissing(spec.model_ids().into_iter().map(str::to_string).collect())),
    }
}

/// `PostProcess.character_dict` of a PaddleOCR `inference.yml`, read the way
/// `yaml.safe_load` and `str()` read the pinned files: one character per list item,
/// plain or single-quoted. Anything else is refused rather than guessed.
pub fn characters(dict_yml: &Path) -> Result<Vec<String>> {
    let name = file_name(dict_yml);
    let text = std::fs::read_to_string(dict_yml)?;
    let invalid = |detail: &str| Error::ModelsInvalid(format!("{detail} in {name}"));
    let mut in_post = false;
    let mut in_dict = false;
    let mut out = Vec::new();
    for line in text.lines() {
        if !line.starts_with(' ') && !line.is_empty() {
            if in_dict {
                break;
            }
            in_post = line.trim_end() == "PostProcess:";
            continue;
        }
        if !in_post {
            continue;
        }
        if !in_dict {
            in_dict = line.trim_end() == "  character_dict:";
            continue;
        }
        let Some(item) = line.strip_prefix("  - ") else {
            break;
        };
        out.push(yaml_scalar(item).ok_or_else(|| invalid("unsupported character entry"))?);
    }
    if out.is_empty() {
        return Err(invalid("no character_dict"));
    }
    Ok(out)
}

fn yaml_scalar(item: &str) -> Option<String> {
    if let Some(inner) = item.strip_prefix('\'') {
        let inner = inner.strip_suffix('\'')?;
        if inner.contains('\n') || inner.contains('\r') {
            return None;
        }
        return Some(inner.replace("''", "'"));
    }
    if item.starts_with('"') {
        return None;
    }
    let mut chars = item.chars();
    let c = chars.next()?;
    if chars.next().is_some() {
        // Multi-character plain scalars could resolve to numbers, booleans or dates.
        return None;
    }
    Some(if c == '~' { "None".to_string() } else { c.to_string() })
}
