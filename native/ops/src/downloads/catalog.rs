//! Reviewed public artifacts (`catalog.py`). Revision, size and hash change together, in a
//! review, never at run time; a change bumps [`CATALOG_VERSION`] so a stale consent fails.
//!
//! `tests/catalog_reference.rs` checks every entry against what the Python module answers
//! (`reference/dump_reference.py`), so the two cannot drift while both exist.

use serde::{Serialize, Serializer};

use crate::net::quote;

pub const CATALOG_VERSION: &str = "2026-11-13.1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Artifact {
    pub filename: String,
    pub size: u64,
    pub sha256: String,
    pub role: String,
    /// Where the file comes from when that is another pinned repository or another name
    /// there. `None`: `<model.repo>@<model.revision>/<filename>`.
    #[serde(serialize_with = "remote_as_list")]
    pub remote: Option<Remote>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Remote {
    pub repo: String,
    pub revision: String,
    pub path: String,
}

/// Python writes the pin as a list of three, or an empty list.
fn remote_as_list<S: Serializer>(remote: &Option<Remote>, serializer: S) -> Result<S::Ok, S::Error> {
    match remote {
        Some(r) => [&r.repo, &r.revision, &r.path].serialize(serializer),
        None => <[&str; 0]>::default().serialize(serializer),
    }
}

/// One download the user consents to. Field order is `receipt.json`'s.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Model {
    pub id: String,
    pub target: String,
    pub name: String,
    pub provider: String,
    pub repo: String,
    pub revision: String,
    pub license: String,
    pub licenses: Vec<String>,
    pub notice: String,
    pub artifacts: Vec<Artifact>,
}

impl Model {
    pub fn total_bytes(&self) -> u64 {
        self.artifacts.iter().map(|a| a.size).sum()
    }
}

pub const IRODORI_REV: &str = "9db7da1bec3d1069ef8e29732e0497be60c7b047";
pub const QWEN_REV: &str = "fd9df9364613a92a86b4137074bc281204823033";
pub const RVC_REV: &str = "7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a";
/// Files before this revision hold no custom vocabulary; needs speech.cpp 0.9.4 or later.
pub const HAAS_REV: &str = "6b965d5007ba780585de51549d57a8c1c0d67c7e";
/// The revision speech.cpp 0.10.0's own catalog pins for qwen3-asr-0.6b and silero-vad.
pub const QWEN_ASR_REV: &str = "ee78f8709547f39bea3b924a16c72403826cac92";
pub const SILERO_REV: &str = "7fcb7aa2a70c312f8579fc987b3e1cdecf9321ca";
/// The files speech.cpp 0.10.0 names nemotron-3-diarization (docs/models/sortformer.md).
pub const NEMOTRON_DIARIZATION_REV: &str = "9096d41cb78bba7ac882b96d453e25239eac692b";

// OCR (chat reading): official PaddleOCR ONNX exports, Apache-2.0. det and rec live in separate
// upstream repositories, so their files carry remote pins and are stored under local names.
// RapidOCR needs the recogniser's character list, which PaddleOCR ships in inference.yml.
// Changing any pin changes the files in <id>/<revision>/: change the id too.
pub const OCR_DET_REPO: &str = "PaddlePaddle/PP-OCRv6_small_det_onnx";
pub const OCR_DET_REV: &str = "28fe5895c24fd108c19eb3e8479f4ab385fbfc62";
pub const OCR_REC_REPO: &str = "PaddlePaddle/PP-OCRv6_small_rec_onnx";
pub const OCR_REC_REV: &str = "b8f84f0b80c529de40b4fbb3544b84fa7233a513";

// VRCT-VOX's own chatbox detector (YOLOX-Tiny, MIT), trained from VRCT-VOX's own frames with
// tools/chatbox_lab. It is not the upstream VRCT detector, which may never be offered here: the
// file name differs on purpose. A new upload needs a new revision, size and hash here, and a
// CATALOG_VERSION bump.
pub const DETECTOR_MODEL_ID: &str = "vrct-vox-chatbox-detector";
pub const DETECTOR_FILE_NAME: &str = "vrct_vox_chatbox_yolox_tiny.onnx";
pub const DETECTOR_REPO: &str = "kein5/vrct-vox-chatbox-detector";
pub const DETECTOR_REVISION: &str = "3febea9f3ad213738730177c7907cc434dca2267";
pub const DETECTOR_SIZE: u64 = 20184371;
pub const DETECTOR_SHA256: &str = "160c4a505bee87d101564c569dff7f0bacd416b9006ec5aa70f8c9d221470ffd";

pub const TARGETS: [&str; 7] = ["japanese", "multilingual", "asr", "vad", "diarization", "rvc", "ocr"];

/// Where an applied file goes: (speech server profile, settings field). RVC is separate.
pub fn speech_field(target: &str) -> Option<(&'static str, &'static str)> {
    match target {
        "japanese" => Some(("japanese", "model")),
        "multilingual" => Some(("multilingual", "model")),
        "asr" => Some(("asr", "model")),
        "vad" => Some(("asr", "vad_model")),
        "diarization" => Some(("asr", "diarization_model")),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
fn model(id: &str, target: &str, name: &str, provider: &str, repo: &str, revision: &str, license: &str, licenses: &[&str], notice: &str, artifacts: Vec<Artifact>) -> Model {
    Model {
        id: id.into(),
        target: target.into(),
        name: name.into(),
        provider: provider.into(),
        repo: repo.into(),
        revision: revision.into(),
        license: license.into(),
        licenses: licenses.iter().map(|s| s.to_string()).collect(),
        notice: notice.into(),
        artifacts,
    }
}

fn artifact(filename: &str, size: u64, sha256: &str, role: &str) -> Artifact {
    Artifact { filename: filename.into(), size, sha256: sha256.into(), role: role.into(), remote: None }
}

fn remote(filename: &str, size: u64, sha256: &str, role: &str, (repo, revision, path): (&str, &str, &str)) -> Artifact {
    Artifact { remote: Some(Remote { repo: repo.into(), revision: revision.into(), path: path.into() }), ..artifact(filename, size, sha256, role) }
}

/// The catalog in the order the backend lists it. Comments for single entries are in
/// `catalog.py`: Q8_0 for Qwen3-ASR and Nemotron is the file speech.cpp fetches for that name;
/// the VAD and diarization entries apply to fields of the asr profile, not to its recognizer.
pub fn catalog() -> Vec<Model> {
    vec![
        model(
            "irodori-v41-f16",
            "japanese",
            "Irodori-TTS v4.1 Small MF · F16",
            "Aratako / sakasegawa",
            "sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF",
            IRODORI_REV,
            "MIT + Apache-2.0",
            &[
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/{IRODORI_REV}/README.md"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/{IRODORI_REV}/LICENSE-MIT"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/{IRODORI_REV}/LICENSE-APACHE-2.0"),
            ],
            "irodori",
            vec![artifact("Irodori-TTS-866M-MF-v4.1-F16.gguf", 1920321792, "e237dc3eefe469b8bba87872beacf12fb7fe00dbdf85767edca8ec04ab910d13", "model")],
        ),
        model(
            "qwen3-06b-q8",
            "multilingual",
            "Qwen3-TTS 12Hz 0.6B CustomVoice · Q8_0",
            "Qwen / sakasegawa",
            "sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF",
            QWEN_REV,
            "Apache-2.0",
            &[&format!("https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/blob/{QWEN_REV}/README.md"), "https://www.apache.org/licenses/LICENSE-2.0"],
            "qwen",
            vec![artifact("Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf", 1213534464, "f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6", "model")],
        ),
        model(
            "rvc-saisho",
            "rvc",
            "Saisho Utane · RVC v2",
            "Saisho Utane",
            "Saisho-Utane/Saisho-Model-RVC",
            RVC_REV,
            "CC BY 4.0",
            &[&format!("https://huggingface.co/Saisho-Utane/Saisho-Model-RVC/blob/{RVC_REV}/README.md"), "https://creativecommons.org/licenses/by/4.0/"],
            "rvc",
            vec![
                artifact("model.pth", 57577658, "82312a29a3996a451aaa3d3776566cec85b47b5414fce53da82b2d66b04f3d35", "model"),
                artifact("model.index", 278065619, "e9f7396e5db3077274c720d055e43abb8f1eac5609cbdf48b198ca4f4a35cad5", "index"),
            ],
        ),
        model(
            "haas-ja-q8",
            "asr",
            "Haas-ja v1.0 · Q8_0",
            "Third Intelligence / sakasegawa",
            "sakasegawa/Haas-ja-v1.0-GGUF",
            HAAS_REV,
            "Apache-2.0",
            &[&format!("https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/{HAAS_REV}/README.md"), &format!("https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/{HAAS_REV}/LICENSE")],
            "haas",
            vec![artifact("Haas-616M-ja-v1.0-Q8_0.gguf", 656381472, "cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb", "model")],
        ),
        model(
            "qwen3-asr-06b-q8",
            "asr",
            "Qwen3-ASR 0.6B · Q8_0 (30 languages)",
            "Qwen / sakasegawa",
            "sakasegawa/Qwen3-ASR-0.6B-GGUF",
            QWEN_ASR_REV,
            "Apache-2.0",
            &[&format!("https://huggingface.co/sakasegawa/Qwen3-ASR-0.6B-GGUF/blob/{QWEN_ASR_REV}/README.md"), "https://www.apache.org/licenses/LICENSE-2.0"],
            "qwen_asr",
            vec![artifact("Qwen3-ASR-0.6B-Q8_0.gguf", 841502336, "416e10c15b4a3d9002bd337d18fc450233fdf68502b6e10d1379d2789838afd0", "model")],
        ),
        model(
            "silero-vad-v62",
            "vad",
            "Silero VAD v6.2 · F32",
            "Silero Team / sakasegawa",
            "sakasegawa/silero-vad-GGUF",
            SILERO_REV,
            "MIT",
            &[&format!("https://huggingface.co/sakasegawa/silero-vad-GGUF/blob/{SILERO_REV}/README.md"), &format!("https://huggingface.co/sakasegawa/silero-vad-GGUF/blob/{SILERO_REV}/LICENSE")],
            "silero",
            vec![artifact("silero-vad-309K-v6.2-F32.gguf", 1238624, "2fc312514e5fc4fa4ffd02b25c76a4853fa4130e8fb9777d01502183b01238cb", "model")],
        ),
        model(
            "nemotron-3-diarization-q8",
            "diarization",
            "Nemotron 3 Diarization · Q8_0 (up to 8 speakers)",
            "NVIDIA / sakasegawa",
            "sakasegawa/Nemotron-3-Diarization-GGUF",
            NEMOTRON_DIARIZATION_REV,
            "OpenMDW-1.1",
            &[
                &format!("https://huggingface.co/sakasegawa/Nemotron-3-Diarization-GGUF/blob/{NEMOTRON_DIARIZATION_REV}/README.md"),
                &format!("https://huggingface.co/sakasegawa/Nemotron-3-Diarization-GGUF/blob/{NEMOTRON_DIARIZATION_REV}/LICENSE.OpenMDW-1.1"),
            ],
            "nemotron_diarization",
            vec![artifact("Nemotron-3-Diarization-99M-Q8_0.gguf", 106179488, "336df6350dce2ea5ff06aa6e2b249d331a859ced13305fbb45c44bdb3c0abe20", "model")],
        ),
        model(
            "irodori-v41-q8",
            "japanese",
            "Irodori-TTS v4.1 Small MF · Q8_0",
            "Aratako / sakasegawa",
            "sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF",
            IRODORI_REV,
            "MIT + Apache-2.0",
            &[
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/{IRODORI_REV}/README.md"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/{IRODORI_REV}/LICENSE-MIT"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF/blob/{IRODORI_REV}/LICENSE-APACHE-2.0"),
            ],
            "irodori",
            vec![artifact("Irodori-TTS-866M-MF-v4.1-Q8_0.gguf", 1207133984, "2d161b0bbcd74f906f6b07e03d031075f8ae916db1b8bd4daf16cb37b451086a", "model")],
        ),
        model(
            "qwen3-06b-q5",
            "multilingual",
            "Qwen3-TTS 12Hz 0.6B CustomVoice · Q5_K",
            "Qwen / sakasegawa",
            "sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF",
            QWEN_REV,
            "Apache-2.0",
            &[&format!("https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/blob/{QWEN_REV}/README.md"), "https://www.apache.org/licenses/LICENSE-2.0"],
            "qwen",
            vec![artifact("Qwen3-TTS-12Hz-0.6B-CustomVoice-Q5_K.gguf", 873894144, "4bb9ba9e822ab614798c416c7f0187994f349be41221966fa911aca24f237930", "model")],
        ),
        model(
            "ppocrv6-small",
            "ocr",
            "PP-OCRv6 small · Japanese, English, Chinese, Latin",
            "PaddlePaddle (PaddleOCR)",
            "PaddlePaddle/PP-OCRv6_small_rec_onnx",
            OCR_REC_REV,
            "Apache-2.0",
            &[
                &format!("https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/blob/{OCR_REC_REV}/README.md"),
                &format!("https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/blob/{OCR_DET_REV}/README.md"),
                "https://www.apache.org/licenses/LICENSE-2.0",
            ],
            "ppocr",
            vec![
                remote("det.onnx", 9880512, "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e", "det", ("PaddlePaddle/PP-OCRv6_small_det_onnx", OCR_DET_REV, "inference.onnx")),
                remote("rec.onnx", 21159378, "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634", "rec", ("PaddlePaddle/PP-OCRv6_small_rec_onnx", OCR_REC_REV, "inference.onnx")),
                remote("rec.yml", 150579, "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1", "dict", ("PaddlePaddle/PP-OCRv6_small_rec_onnx", OCR_REC_REV, "inference.yml")),
            ],
        ),
        model(
            "ppocrv5-korean",
            "ocr",
            "PP-OCRv5 mobile · Korean",
            "PaddlePaddle (PaddleOCR)",
            "PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx",
            "5c6f574b8e2230adf4287b33e736d71b9fabd28e",
            "Apache-2.0",
            &["https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx/blob/5c6f574b8e2230adf4287b33e736d71b9fabd28e/README.md", "https://www.apache.org/licenses/LICENSE-2.0"],
            "ppocr",
            vec![
                remote(
                    "rec.onnx",
                    13418787,
                    "92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08",
                    "rec",
                    ("PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx", "5c6f574b8e2230adf4287b33e736d71b9fabd28e", "inference.onnx"),
                ),
                remote(
                    "rec.yml",
                    96039,
                    "f757fa1c40e99edcf27e9cce879b93eb2a51fa46f5ef39095689b8c37dd75998",
                    "dict",
                    ("PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx", "5c6f574b8e2230adf4287b33e736d71b9fabd28e", "inference.yml"),
                ),
            ],
        ),
        model(
            "ppocrv5-cyrillic",
            "ocr",
            "PP-OCRv5 mobile · Cyrillic",
            "PaddlePaddle (PaddleOCR)",
            "PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx",
            "2cef88145434beb8afa9dd82d77d799eb1ad7b29",
            "Apache-2.0",
            &["https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx/blob/2cef88145434beb8afa9dd82d77d799eb1ad7b29/README.md", "https://www.apache.org/licenses/LICENSE-2.0"],
            "ppocr",
            vec![
                remote(
                    "rec.onnx",
                    8048799,
                    "5371ee1ddaa7983cc62d0818d99e982b6804638c85e4f960d59a574094e172e5",
                    "rec",
                    ("PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx", "2cef88145434beb8afa9dd82d77d799eb1ad7b29", "inference.onnx"),
                ),
                remote(
                    "rec.yml",
                    6991,
                    "5c76cc91fa98410178a09f498db10050d0ec1634a660053d3005ab7be581f501",
                    "dict",
                    ("PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx", "2cef88145434beb8afa9dd82d77d799eb1ad7b29", "inference.yml"),
                ),
            ],
        ),
        model(
            "ppocrv5-thai",
            "ocr",
            "PP-OCRv5 mobile · Thai",
            "PaddlePaddle (PaddleOCR)",
            "PaddlePaddle/th_PP-OCRv5_mobile_rec_onnx",
            "1d4adbbafb1034a2fd6618498575b81ea7b69f69",
            "Apache-2.0",
            &["https://huggingface.co/PaddlePaddle/th_PP-OCRv5_mobile_rec_onnx/blob/1d4adbbafb1034a2fd6618498575b81ea7b69f69/README.md", "https://www.apache.org/licenses/LICENSE-2.0"],
            "ppocr",
            vec![
                remote(
                    "rec.onnx",
                    7891015,
                    "27618be66018f8598ac0a526a593f9f1cebf794e7eded93428e8fb016e537f5f",
                    "rec",
                    ("PaddlePaddle/th_PP-OCRv5_mobile_rec_onnx", "1d4adbbafb1034a2fd6618498575b81ea7b69f69", "inference.onnx"),
                ),
                remote(
                    "rec.yml",
                    4667,
                    "f6ba7fefc38ca1ff398ddafa75d67d16e0b3757c4e6c833adffee98a981766c9",
                    "dict",
                    ("PaddlePaddle/th_PP-OCRv5_mobile_rec_onnx", "1d4adbbafb1034a2fd6618498575b81ea7b69f69", "inference.yml"),
                ),
            ],
        ),
        model(
            "ppocrv5-arabic",
            "ocr",
            "PP-OCRv5 mobile · Arabic",
            "PaddlePaddle (PaddleOCR)",
            "PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx",
            "14aaedcd75825982689ecf5cd64ab33ee083215a",
            "Apache-2.0",
            &["https://huggingface.co/PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx/blob/14aaedcd75825982689ecf5cd64ab33ee083215a/README.md", "https://www.apache.org/licenses/LICENSE-2.0"],
            "ppocr",
            vec![
                remote(
                    "rec.onnx",
                    7998947,
                    "799113ebf267fbe742deb99eb36e8d42c9ddc5291ceacf92add41b4d52a59110",
                    "rec",
                    ("PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx", "14aaedcd75825982689ecf5cd64ab33ee083215a", "inference.onnx"),
                ),
                remote(
                    "rec.yml",
                    6165,
                    "21368419e6c016c31db55d316d59e11c128e1913e6e6fe10287084710043d3a6",
                    "dict",
                    ("PaddlePaddle/arabic_PP-OCRv5_mobile_rec_onnx", "14aaedcd75825982689ecf5cd64ab33ee083215a", "inference.yml"),
                ),
            ],
        ),
        model(
            "ppocrv5-devanagari",
            "ocr",
            "PP-OCRv5 mobile · Devanagari",
            "PaddlePaddle (PaddleOCR)",
            "PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx",
            "251aec19e36739540d35e2cc943f6aa7503b98e5",
            "Apache-2.0",
            &["https://huggingface.co/PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx/blob/251aec19e36739540d35e2cc943f6aa7503b98e5/README.md", "https://www.apache.org/licenses/LICENSE-2.0"],
            "ppocr",
            vec![
                remote(
                    "rec.onnx",
                    7912311,
                    "cb789212ce96c69d3e74728ae4309d179281d68cb3945d0616b67cafab41c986",
                    "rec",
                    ("PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx", "251aec19e36739540d35e2cc943f6aa7503b98e5", "inference.onnx"),
                ),
                remote(
                    "rec.yml",
                    5027,
                    "9bd172dd26440c8ce94d1cde5d5baea6aefdc7cf3c5c8492e0beedef656d4e54",
                    "dict",
                    ("PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx", "251aec19e36739540d35e2cc943f6aa7503b98e5", "inference.yml"),
                ),
            ],
        ),
        model(
            "vrct-vox-chatbox-detector",
            "ocr",
            "VRCT-VOX chatbox detector · YOLOX-Tiny",
            "VRCT-VOX",
            "kein5/vrct-vox-chatbox-detector",
            DETECTOR_REVISION,
            "MIT",
            &[
                &format!("https://huggingface.co/kein5/vrct-vox-chatbox-detector/blob/{DETECTOR_REVISION}/README.md"),
                &format!("https://huggingface.co/kein5/vrct-vox-chatbox-detector/blob/{DETECTOR_REVISION}/LICENSE"),
            ],
            "chatbox",
            vec![artifact("vrct_vox_chatbox_yolox_tiny.onnx", 20184371, "160c4a505bee87d101564c569dff7f0bacd416b9006ec5aa70f8c9d221470ffd", "detector")],
        ),
    ]
}

/// `https://huggingface.co/<repo>/resolve/<revision>/<path>`, the path quoted.
pub fn artifact_url(model: &Model, artifact: &Artifact) -> String {
    let (repo, revision, path) = match &artifact.remote {
        Some(r) => (r.repo.as_str(), r.revision.as_str(), r.path.as_str()),
        None => (model.repo.as_str(), model.revision.as_str(), artifact.filename.as_str()),
    };
    format!("https://huggingface.co/{repo}/resolve/{revision}/{}", quote(path, "/"))
}

fn full(text: &str, allowed: impl Fn(usize, char) -> bool) -> bool {
    !text.is_empty() && text.chars().enumerate().all(|(i, c)| allowed(i, c))
}

/// `[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+`
fn valid_repo(repo: &str) -> bool {
    repo.split_once('/').is_some_and(|(owner, name)| full(owner, |_, c| c.is_ascii_alphanumeric() || "_-".contains(c)) && full(name, |_, c| c.is_ascii_alphanumeric() || "_.-".contains(c)))
}

fn hex(text: &str, length: usize) -> bool {
    text.len() == length && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `[a-zA-Z0-9][a-zA-Z0-9_.-]*`
fn valid_name(name: &str) -> bool {
    full(name, |i, c| c.is_ascii_alphanumeric() || (i > 0 && "_.-".contains(c)))
}

/// Refuses a catalog whose ids, repositories, pins, file names or roles could address
/// anything but a fixed public file under a fixed local name (`catalog_invalid`).
pub fn validate_catalog(catalog: &[Model]) -> Result<(), &'static str> {
    let mut ids = std::collections::HashSet::new();
    for model in catalog {
        if ids.contains(&model.id)
            || !full(&model.id, |i, c| c.is_ascii_lowercase() || c.is_ascii_digit() || (i > 0 && c == '-'))
            || !valid_repo(&model.repo)
            || !hex(&model.revision, 40)
            || !TARGETS.contains(&model.target.as_str())
            || model.artifacts.is_empty()
        {
            return Err("catalog_invalid");
        }
        ids.insert(model.id.clone());
        let ocr = model.target == "ocr";
        let (suffixes, roles): (&[&str], &[&str]) = if ocr { (&["onnx", "yml"], &["det", "rec", "dict", "detector"]) } else { (&["gguf", "pth", "index"], &["model", "index"]) };
        let (mut names, mut seen_roles) = (std::collections::HashSet::new(), std::collections::HashSet::new());
        for artifact in &model.artifacts {
            let suffix_ok = artifact.filename.rsplit_once('.').is_some_and(|(stem, suffix)| valid_name(stem) && suffixes.contains(&suffix));
            let remote_ok = artifact.remote.as_ref().is_none_or(|r| valid_repo(&r.repo) && hex(&r.revision, 40) && valid_name(&r.path) && !r.path.contains(".."));
            if !suffix_ok
                || artifact.filename.contains("..")
                || names.contains(&artifact.filename)
                || seen_roles.contains(&artifact.role)
                || !roles.contains(&artifact.role.as_str())
                || artifact.size == 0
                || !hex(&artifact.sha256, 64)
                || !remote_ok
            {
                return Err("catalog_invalid");
            }
            names.insert(artifact.filename.clone());
            seen_roles.insert(artifact.role.clone());
        }
    }
    Ok(())
}
