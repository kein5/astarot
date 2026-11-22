//! A model folder is admitted only with a valid manifest and the files it names.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{json, Value};
use astarot_translate_onnx::{codes, Accelerator, Bundle, Provider, Translator, Variant};

struct Folder(PathBuf);

impl Folder {
    fn new() -> Folder {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!("vrct-translate-bundle-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
        let path = std::env::temp_dir().join(name);
        std::fs::create_dir_all(&path).unwrap();
        Folder(path)
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// SHA-256 of "a", "b", "c" and "d".
const HASHES: [&str; 4] = [
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
    "2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6",
    "18ac3e7343f016890c510e93f935261169d9e3f565436429830faf0934f4f8e4",
];

fn manifest() -> Value {
    let names = ["encoder.onnx", "decoder.onnx", "tokenizer.json", "vocab.json"];
    let files: serde_json::Map<String, Value> =
        names.iter().zip(HASHES).map(|(name, hash)| (name.to_string(), json!({"size": 1, "sha256": hash}))).collect();
    json!({
        "schema": 1, "name": "test", "family": "nllb", "license": "MIT",
        "encoder": "encoder.onnx", "decoder": "decoder.onnx",
        "decoder_layers": 2, "decoder_attention_heads": 4, "hidden_size": 16,
        "decoder_start_token": "</s>", "end_token": "</s>", "unknown_token": "<unk>",
        "language_token": "{}", "languages": ["eng_Latn", "jpn_Jpan"],
        "beam_size": 2, "max_input_length": 1024, "max_decoding_length": 256,
        "files": files,
    })
}

fn write(folder: &Folder, manifest: &Value) {
    for (name, content) in [("encoder.onnx", "a"), ("decoder.onnx", "b"), ("tokenizer.json", "c"), ("vocab.json", "d")]
    {
        std::fs::write(folder.0.join(name), content).unwrap();
    }
    std::fs::write(folder.0.join("manifest.json"), manifest.to_string()).unwrap();
}

#[test]
fn a_folder_with_its_files_is_admitted_and_verified() {
    let folder = Folder::new();
    write(&folder, &manifest());
    let bundle = Bundle::open(&folder.0).unwrap();
    assert_eq!(bundle.manifest().beam_size, 2);
    assert_eq!(bundle.verify(), Ok(()));
    // The same size, other bytes.
    std::fs::write(folder.0.join("decoder.onnx"), "x").unwrap();
    assert_eq!(Bundle::open(&folder.0).unwrap().verify().unwrap_err().code, codes::BUNDLE_MODIFIED);
}

type Edit = Box<dyn Fn(&mut Value)>;

#[test]
fn an_invalid_manifest_or_a_missing_file_is_refused_with_its_reason() {
    let edits: Vec<(&str, Edit)> = vec![
        (codes::BUNDLE_INVALID, Box::new(|m| m["schema"] = 3.into())),
        // Schema 2 names its variant; schema 1 must not.
        (codes::BUNDLE_INVALID, Box::new(|m| m["schema"] = 2.into())),
        (codes::BUNDLE_INVALID, Box::new(|m| m["variant"] = "int8".into())),
        (codes::ARCHITECTURE_UNSUPPORTED, Box::new(|m| m["family"] = "marian".into())),
        (codes::VARIANT_UNSUPPORTED, Box::new(|m| {
            m["schema"] = 2.into();
            m["variant"] = "int8_float16".into();
        })),
        (codes::BUNDLE_INVALID, Box::new(|m| m["language_token"] = "__lang__".into())),
        (codes::BUNDLE_INVALID, Box::new(|m| m["languages"] = json!([]))),
        (codes::BUNDLE_INVALID, Box::new(|m| m["language_names"] = json!({"Klingon": "tlh_Latn"}))),
        (codes::BUNDLE_INVALID, Box::new(|m| m["hidden_size"] = 15.into())),
        (codes::BUNDLE_INVALID, Box::new(|m| m["beam_size"] = 0.into())),
        (codes::BUNDLE_INVALID, Box::new(|m| m["encoder"] = "absent.onnx".into())),
        (codes::BUNDLE_INVALID, Box::new(|m| m["files"]["../outside"] = json!({"size": 1, "sha256": HASHES[0]}))),
        (codes::BUNDLE_INVALID, Box::new(|m| m["files"]["encoder.onnx"]["sha256"] = "ABC".into())),
        (codes::BUNDLE_MODIFIED, Box::new(|m| m["files"]["encoder.onnx"]["size"] = 2.into())),
        (codes::FILE_MISSING, Box::new(|m| m["files"]["absent.bin"] = json!({"size": 1, "sha256": HASHES[0]}))),
        (codes::BUNDLE_INVALID, Box::new(|m| {
            m["files"].as_object_mut().unwrap().remove("vocab.json");
        })),
        (codes::BUNDLE_INVALID, Box::new(|m| {
            m.as_object_mut().unwrap().remove("languages");
        })),
    ];
    for (index, (code, edit)) in edits.iter().enumerate() {
        let folder = Folder::new();
        let mut value = manifest();
        edit(&mut value);
        write(&folder, &value);
        assert_eq!(Bundle::open(&folder.0).unwrap_err().code, *code, "edit {index}");
    }
    let folder = Folder::new();
    std::fs::write(folder.0.join("manifest.json"), "{ not json").unwrap();
    assert_eq!(Bundle::open(&folder.0).unwrap_err().code, codes::BUNDLE_INVALID);
    assert_eq!(
        Bundle::open(std::env::temp_dir().join("vrct-translate-absent")).unwrap_err().code,
        codes::MANIFEST_MISSING
    );
}

#[test]
fn schema_1_is_int8_and_schema_2_names_its_variant_and_language_names() {
    let folder = Folder::new();
    write(&folder, &manifest());
    assert_eq!(Bundle::open(&folder.0).unwrap().manifest().variant(), Variant::Int8);
    let mut value = manifest();
    value["schema"] = 2.into();
    value["variant"] = "float16".into();
    value["language_names"] = json!({"English": "eng_Latn", "Japanese": "jpn_Jpan"});
    write(&folder, &value);
    let bundle = Bundle::open(&folder.0).unwrap();
    assert_eq!(bundle.manifest().variant(), Variant::Float16);
    assert_eq!(bundle.manifest().language_names.as_ref().unwrap()["Japanese"], "jpn_Jpan");
}

#[test]
fn loading_without_onnx_runtime_or_with_a_broken_graph_is_an_error_value() {
    // The files are not ONNX graphs and, on a test machine, no ONNX Runtime library sits
    // beside the test executable: either way loading fails with a code, without a panic, on
    // the CPU and after a GPU provider's fallback alike.
    let folder = Folder::new();
    write(&folder, &manifest());
    let bundle = Bundle::open(&folder.0).unwrap();
    for at in [Accelerator::CPU, Accelerator::new(Provider::Cuda, 0)] {
        let code = Translator::load(&bundle, at).err().expect("a fake model never loads").code;
        assert!(
            [codes::BUNDLE_INVALID, codes::TOKENIZER_FAILED, codes::RUNTIME_MISSING, codes::RUNTIME_FAILED].contains(&code),
            "{code}"
        );
    }
}
