//! Reviewed public artifacts (`catalog.py`). Revision, size and hash change together, in a
//! review, never at run time; a change bumps [`CATALOG_VERSION`] so a stale consent fails.
//!
//! `tests/catalog_reference.rs` checks every entry against what the Python module answers
//! (`reference/dump_reference.py`), so the two cannot drift while both exist.

use serde::{Serialize, Serializer};

use super::speechcpp;
use crate::net::quote;

pub const CATALOG_VERSION: &str = "2026-11-16.3";

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

    /// What the user acknowledges for this entry apart from the general consent
    /// ([`license_restrictions`] of its license).
    pub fn restrictions(&self) -> Vec<&'static str> {
        license_restrictions(&self.license)
    }
}

/// The kinds of restriction a user acknowledges one by one, apart from the general consent,
/// before a download starts (`acknowledged` of `/run/start_model_download`), in the order they
/// are listed. `non_commercial`: a Creative Commons NonCommercial license (CC-BY-NC-4.0 and its
/// -SA and -ND variants). A new kind (terms such as Gemma's) is added here, in `catalog.py`'s
/// `RESTRICTIONS` and in the UI's texts.
pub const RESTRICTIONS: [&str; 1] = ["non_commercial"];

/// The restrictions a catalog license string carries, in [`RESTRICTIONS`] order. A license of
/// several parts (`MIT + Apache-2.0`) carries those of every part. Derived from the reviewed
/// string, so no field is added to [`Model`] or to `receipt.json`.
pub fn license_restrictions(license: &str) -> Vec<&'static str> {
    let non_commercial = license.split(['+', ',']).any(|part| {
        let words: Vec<String> = part.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_ascii_uppercase).collect();
        // "CC-BY-NC-SA-4.0", "CC BY-NC 4.0"; "Attribution-NonCommercial" spelled out.
        (words.first().is_some_and(|w| w == "CC") && words.iter().any(|w| w == "NC")) || words.concat().contains("NONCOMMERCIAL")
    });
    if non_commercial {
        vec!["non_commercial"]
    } else {
        Vec::new()
    }
}

pub const IRODORI_REV: &str = "9db7da1bec3d1069ef8e29732e0497be60c7b047";
pub const QWEN_REV: &str = "fd9df9364613a92a86b4137074bc281204823033";
pub const RVC_REV: &str = "7a61b17e4f014fc5013a489f2b5cd3a7ee9e2b1a";
/// The revision speech.cpp 0.10.0's own catalog pins for silero-vad.
pub const SILERO_REV: &str = "7fcb7aa2a70c312f8579fc987b3e1cdecf9321ca";
/// The files speech.cpp 0.10.0 names nemotron-3-diarization (docs/models/sortformer.md).
pub const NEMOTRON_DIARIZATION_REV: &str = "9096d41cb78bba7ac882b96d453e25239eac692b";
/// The revisions speech.cpp 0.10.0 and 0.11.0 both pin for irodori-tts, irodori-tts-large and
/// qwen3-tts-1.7b.
pub const IRODORI_SMALL_REV: &str = "66fe2cde1973fd44e7202fbe36df722103958188";
pub const IRODORI_LARGE_REV: &str = "79cae5947a97e941c62912749e1387c8b35ec16b";
pub const QWEN_17B_REV: &str = "a72e6c6575d67652488cdffc1c863215a9899978";

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

/// The local translation models (`native/translate-onnx` folders). Kept apart from [`TARGETS`],
/// which is Python's list: Python had no such entries. The entries are the reviewed data of
/// `data/translation_models.json` ([`translation_models`]), which is empty until the models are
/// published; an entry is one folder of `tools/translation_onnx/export.py`, its id
/// `<model>-onnx-<variant>` in lower case with `_` and `.` as `-` (`m2m100-418m-onnx-int8`),
/// its `notice` `translation` (the UI's `model_downloads.notice_translation`) unless the entry
/// names one of [`TRANSLATION_NOTICES`], and nothing goes into the settings when it is applied:
/// the local translation finds verified downloads by catalog id, as chat reading does.
pub const TRANSLATION_TARGET: &str = "translation";
/// The notices a translation entry may name (`model_downloads.notice_<notice>` in locales/):
/// the general one, and one per model whose download review says more, such as the size and
/// memory of an NLLB-200 model next to its non-commercial licence.
pub const TRANSLATION_NOTICES: [&str; 2] = [TRANSLATION_TARGET, "translation_nllb_600m"];
/// The roles of a translation entry's files. `manifest` is required: it names the rest. `data`
/// (the weights of a graph over 2 GB, `<graph>.onnx_data`) may come once per graph.
pub const TRANSLATION_ROLES: [&str; 7] = ["manifest", "encoder", "decoder", "tokenizer", "vocabulary", "weights", "data"];

const TRANSLATION_TEXT: &str = include_str!("../../data/translation_models.json");

/// `data/translation_models.json`.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TranslationModels {
    models: Vec<TranslationModel>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TranslationModel {
    id: String,
    name: String,
    provider: String,
    repo: String,
    revision: String,
    license: String,
    licenses: Vec<String>,
    /// One of [`TRANSLATION_NOTICES`]; left out, the general `translation`.
    #[serde(default)]
    notice: Option<String>,
    artifacts: Vec<TranslationFile>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TranslationFile {
    filename: String,
    size: u64,
    sha256: String,
    role: String,
}

/// The entries of a `translation_models.json` text, in its order. A notice that is not one of
/// [`TRANSLATION_NOTICES`] is refused: the review would show a text the UI does not have.
fn parse_translation_models(text: &str) -> Result<Vec<Model>, String> {
    let data: TranslationModels = serde_json::from_str(text).map_err(|error| error.to_string())?;
    data.models
        .into_iter()
        .map(|entry| {
            let notice = entry.notice.unwrap_or_else(|| TRANSLATION_TARGET.into());
            if !TRANSLATION_NOTICES.contains(&notice.as_str()) {
                return Err(format!("{}: unknown notice {notice}", entry.id));
            }
            Ok(Model {
                id: entry.id,
                target: TRANSLATION_TARGET.into(),
                name: entry.name,
                provider: entry.provider,
                repo: entry.repo,
                revision: entry.revision,
                license: entry.license,
                licenses: entry.licenses,
                notice,
                artifacts: entry.artifacts.into_iter().map(|file| artifact(&file.filename, file.size, &file.sha256, &file.role)).collect(),
            })
        })
        .collect()
}

/// The published local translation models, from `data/translation_models.json` (written by
/// `tools/translation_onnx/publish.py catalog`, reviewed like the rest of the catalog).
pub fn translation_models() -> Vec<Model> {
    parse_translation_models(TRANSLATION_TEXT).unwrap_or_else(|error| panic!("translation_models.json: {error}"))
}

/// Whether a catalog entry may name this target.
pub fn known_target(target: &str) -> bool {
    TARGETS.contains(&target) || target == TRANSLATION_TARGET
}

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
    let mut models = vec![
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
    ];
    // Recognizers: every file of each offered speech.cpp name (data/speechcpp_asr.json,
    // speechcpp.rs). Ids made before keep their folders.
    models.extend(speechcpp::asr_models());
    models.extend(vec![
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
        // More speech.cpp TTS models (TTS_CATALOG in catalog.py): what speech.cpp 0.10.0 and 0.11.0 fetch
        // for irodori-tts, irodori-tts-large and qwen3-tts-1.7b. drama-3 is left out.
        model(
            "irodori-v41-small-f16",
            "japanese",
            "Irodori-TTS v4.1 Small · F16",
            "Aratako / sakasegawa",
            "sakasegawa/Irodori-TTS-v4.1-Small-GGUF",
            IRODORI_SMALL_REV,
            "MIT + Apache-2.0",
            &[
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-GGUF/blob/{IRODORI_SMALL_REV}/README.md"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-GGUF/blob/{IRODORI_SMALL_REV}/LICENSE-MIT"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4.1-Small-GGUF/blob/{IRODORI_SMALL_REV}/LICENSE-APACHE-2.0"),
            ],
            "irodori",
            vec![artifact("Irodori-TTS-859M-v4.1-F16.gguf", 1905903936, "f334932bdf166579bada0a3c8bdabb7199af85682fdcefb6f1cb7e444f5c75b3", "model")],
        ),
        model(
            "irodori-v4-large-q8",
            "japanese",
            "Irodori-TTS v4 Large · Q8_0",
            "Aratako / sakasegawa",
            "sakasegawa/Irodori-TTS-v4-Large-GGUF",
            IRODORI_LARGE_REV,
            "Gemma Terms of Use + MIT + Apache-2.0",
            &[
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/{IRODORI_LARGE_REV}/README.md"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/{IRODORI_LARGE_REV}/GEMMA_TERMS_OF_USE.md"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/{IRODORI_LARGE_REV}/GEMMA_PROHIBITED_USE_POLICY.md"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/{IRODORI_LARGE_REV}/LICENSE-MIT"),
                &format!("https://huggingface.co/sakasegawa/Irodori-TTS-v4-Large-GGUF/blob/{IRODORI_LARGE_REV}/LICENSE-APACHE-2.0"),
            ],
            "irodori_large",
            vec![artifact("Irodori-TTS-3.4B-v4-Q8_0.gguf", 3875154272, "836a2deda5115e4400d25674612ff30d704a358d0b16cf96a3eb510dc416bc4e", "model")],
        ),
        model(
            "qwen3-17b-q8",
            "multilingual",
            "Qwen3-TTS 12Hz 1.7B CustomVoice · Q8_0",
            "Qwen / sakasegawa",
            "sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF",
            QWEN_17B_REV,
            "Apache-2.0",
            &[&format!("https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/blob/{QWEN_17B_REV}/README.md"), "https://www.apache.org/licenses/LICENSE-2.0"],
            "qwen",
            vec![artifact("Qwen3-TTS-12Hz-1.7B-CustomVoice-Q8_0.gguf", 2287780352, "1bc0ef69547c003507b6536639a6080c8856382f4d0963b15d4475528330592d", "model")],
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
    ]);
    models.extend(translation_models());
    models
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
            || !known_target(&model.target)
            || model.artifacts.is_empty()
        {
            return Err("catalog_invalid");
        }
        ids.insert(model.id.clone());
        let (suffixes, roles): (&[&str], &[&str]) = match model.target.as_str() {
            "ocr" => (&["onnx", "yml"], &["det", "rec", "dict", "detector"]),
            // Graphs over 2 GB keep their weights in `<graph>.onnx_data` (or `.data`).
            TRANSLATION_TARGET => (&["onnx", "json", "onnx_data", "data"], &TRANSLATION_ROLES),
            _ => (&["gguf", "pth", "index"], &["model", "index"]),
        };
        if model.target == TRANSLATION_TARGET && !model.artifacts.iter().any(|a| a.role == "manifest" && a.filename == "manifest.json") {
            return Err("catalog_invalid");
        }
        let (mut names, mut seen_roles) = (std::collections::HashSet::new(), std::collections::HashSet::new());
        for artifact in &model.artifacts {
            let suffix_ok = artifact.filename.rsplit_once('.').is_some_and(|(stem, suffix)| valid_name(stem) && suffixes.contains(&suffix));
            let remote_ok = artifact.remote.as_ref().is_none_or(|r| valid_repo(&r.repo) && hex(&r.revision, 40) && valid_name(&r.path) && !r.path.contains(".."));
            let repeatable = model.target == TRANSLATION_TARGET && artifact.role == "data";
            if !suffix_ok
                || artifact.filename.contains("..")
                || names.contains(&artifact.filename)
                || (seen_roles.contains(&artifact.role) && !repeatable)
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

#[cfg(test)]
mod translation_tests {
    use super::*;

    fn entry(artifacts: Vec<Artifact>) -> Model {
        model("m2m100-418m-onnx-int8", TRANSLATION_TARGET, "M2M100 418M · int8", "Meta / VRCT-VOX", "owner/m2m100_418M-onnx", &"a".repeat(40), "MIT", &["https://www.apache.org/licenses/LICENSE-2.0"], "m2m100", artifacts)
    }

    fn file(name: &str, role: &str) -> Artifact {
        artifact(name, 1, &"b".repeat(64), role)
    }

    #[test]
    fn a_translation_entry_is_one_export_folder_with_its_manifest() {
        let complete = vec![
            file("manifest.json", "manifest"),
            file("encoder_model_quantized.onnx", "encoder"),
            file("decoder_model_merged_quantized.onnx", "decoder"),
            file("decoder_model_merged_quantized.onnx_data", "data"),
            file("vocabulary.data", "weights"),
            file("tokenizer.json", "tokenizer"),
            file("vocab.json", "vocabulary"),
        ];
        assert_eq!(validate_catalog(&[entry(complete.clone())]), Ok(()));
        // Without its manifest, with a file type or a role no translation folder has.
        assert_eq!(validate_catalog(&[entry(complete[1..].to_vec())]), Err("catalog_invalid"));
        assert_eq!(validate_catalog(&[entry(vec![file("manifest.json", "manifest"), file("model.gguf", "encoder")])]), Err("catalog_invalid"));
        assert_eq!(validate_catalog(&[entry(vec![file("manifest.json", "manifest"), file("encoder.onnx", "model")])]), Err("catalog_invalid"));
        // Two graphs over 2 GB each keep their weights beside them; no other role repeats.
        let large = vec![
            file("manifest.json", "manifest"),
            file("encoder_model.onnx", "encoder"),
            file("encoder_model.onnx_data", "data"),
            file("decoder_model_merged.onnx", "decoder"),
            file("decoder_model_merged.onnx_data", "data"),
            file("tokenizer.json", "tokenizer"),
            file("vocab.json", "vocabulary"),
        ];
        assert_eq!(validate_catalog(&[entry(large)]), Ok(()));
        let twice = vec![file("manifest.json", "manifest"), file("a.onnx", "encoder"), file("b.onnx", "encoder")];
        assert_eq!(validate_catalog(&[entry(twice)]), Err("catalog_invalid"));
        assert!(!TARGETS.contains(&TRANSLATION_TARGET) && known_target(TRANSLATION_TARGET));
    }

    #[test]
    fn the_shipped_translation_entries_are_the_reviewed_data() {
        let shipped: Vec<Model> = catalog().into_iter().filter(|m| m.target == TRANSLATION_TARGET).collect();
        assert_eq!(shipped, translation_models());
        assert_eq!(validate_catalog(&shipped), Ok(()));
        for model in &shipped {
            assert!(TRANSLATION_NOTICES.contains(&model.notice.as_str()), "{}", model.id);
            let variant = model.id.rsplit_once("-onnx-").map(|(_, variant)| variant);
            assert!(matches!(variant, Some("float32" | "float16" | "int8" | "int4")), "{}", model.id);
            assert!(!model.licenses.is_empty(), "{}", model.id);
        }
    }

    #[test]
    fn a_data_file_entry_becomes_a_translation_entry() {
        let text = format!(
            r#"{{"models": [{{"id": "m2m100-418m-onnx-int8", "name": "M2M100 418M · int8", "provider": "Meta / VRCT-VOX",
                "repo": "owner/m2m100_418M-onnx-int8", "revision": "{revision}", "license": "MIT",
                "licenses": ["https://huggingface.co/owner/m2m100_418M-onnx-int8/blob/{revision}/LICENSE"],
                "artifacts": [{{"filename": "manifest.json", "size": 3, "sha256": "{hash}", "role": "manifest"}},
                              {{"filename": "encoder_model_quantized.onnx", "size": 5, "sha256": "{hash}", "role": "encoder"}}]}}]}}"#,
            revision = "a".repeat(40),
            hash = "b".repeat(64)
        );
        let models = parse_translation_models(&text).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!((models[0].target.as_str(), models[0].notice.as_str()), (TRANSLATION_TARGET, TRANSLATION_TARGET));
        assert_eq!(models[0].artifacts[1], artifact("encoder_model_quantized.onnx", 5, &"b".repeat(64), "encoder"));
        assert_eq!(validate_catalog(&models), Ok(()));
        // A field the data file does not know is refused, not dropped.
        assert!(parse_translation_models(r#"{"models": [], "extra": 1}"#).is_err());
        // An entry may name a notice of its own, but only one the UI has words for.
        let named = text.replace(r#""license": "MIT","#, r#""license": "MIT", "notice": "translation_nllb_600m","#);
        assert_eq!(parse_translation_models(&named).unwrap()[0].notice, "translation_nllb_600m");
        let unknown = text.replace(r#""license": "MIT","#, r#""license": "MIT", "notice": "something_else","#);
        assert!(parse_translation_models(&unknown).unwrap_err().contains("unknown notice"));
    }

    #[test]
    fn a_non_commercial_license_is_a_restriction_and_the_others_are_not() {
        let non_commercial = ["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC-BY-NC-ND-4.0", "CC BY-NC 4.0", "CC BY-NC-SA 4.0", "cc-by-nc-4.0", "MIT + CC-BY-NC-4.0"];
        for license in non_commercial.into_iter().chain(["Creative Commons Attribution-NonCommercial 4.0"]) {
            assert_eq!(license_restrictions(license), ["non_commercial"], "{license}");
        }
        for license in ["MIT + Apache-2.0", "CC BY 4.0", "CC-BY-SA-4.0", "CC0-1.0", "Gemma Terms of Use + MIT + Apache-2.0", "OpenMDW-1.1", "MIT", "Apache-2.0", ""] {
            assert!(license_restrictions(license).is_empty(), "{license}");
        }
        assert_eq!(entry(Vec::new()).restrictions(), Vec::<&str>::new());
        assert_eq!(Model { license: "CC-BY-NC-4.0".into(), ..entry(Vec::new()) }.restrictions(), ["non_commercial"]);
        // Only a translation model (NLLB-200, translation_models.json) may carry one; the speech,
        // voice and chat-reading models the catalog offers carry none.
        assert!(catalog().iter().filter(|m| m.target != TRANSLATION_TARGET).all(|m| m.restrictions().is_empty()));
    }
}
