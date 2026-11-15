//! A model folder is admitted only with a valid manifest and the files it names.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{json, Value};
use vrct_translate_onnx::{codes, Bundle};

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
fn an_invalid_manifest_or_a_missing_file_is_refused() {
    let edits: Vec<Edit> = vec![
        Box::new(|m| m["schema"] = 2.into()),
        Box::new(|m| m["family"] = "marian".into()),
        Box::new(|m| m["language_token"] = "__lang__".into()),
        Box::new(|m| m["hidden_size"] = 15.into()),
        Box::new(|m| m["beam_size"] = 0.into()),
        Box::new(|m| m["encoder"] = "absent.onnx".into()),
        Box::new(|m| m["files"]["../outside"] = json!({"size": 1, "sha256": HASHES[0]})),
        Box::new(|m| m["files"]["encoder.onnx"]["size"] = 2.into()),
        Box::new(|m| m["files"]["absent.bin"] = json!({"size": 1, "sha256": HASHES[0]})),
        Box::new(|m| {
            m["files"].as_object_mut().unwrap().remove("vocab.json");
        }),
        Box::new(|m| {
            m.as_object_mut().unwrap().remove("languages");
        }),
    ];
    for (index, edit) in edits.iter().enumerate() {
        let folder = Folder::new();
        let mut value = manifest();
        edit(&mut value);
        write(&folder, &value);
        assert_eq!(Bundle::open(&folder.0).unwrap_err().code, codes::BUNDLE_INVALID, "edit {index}");
    }
    assert_eq!(
        Bundle::open(std::env::temp_dir().join("vrct-translate-absent")).unwrap_err().code,
        codes::BUNDLE_INVALID
    );
}
