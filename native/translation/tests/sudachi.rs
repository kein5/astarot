//! The Sudachi analyzer of the readings on a dictionary of a few words, built here with
//! sudachi.rs's own dictionary builder, so the tests need no SudachiDict download.

use std::path::{Path, PathBuf};

use sudachi::config::{Config, ConfigBuilder};
use sudachi::dic::build::DictBuilder;
use astarot_translation::transliteration::sudachi::{Sudachi, SudachiFile};
use astarot_translation::transliteration::{analyze, convert, Tokenizer, Unavailable};

/// Surface, left id, right id, cost, display form, six part-of-speech fields, reading,
/// normalized form, dictionary form, split mode and the split and structure fields.
const LEXICON: &str = "\
東京,0,0,1000,東京,名詞,固有名詞,地名,一般,*,*,トウキョウ,東京,*,A,*,*,*,*
に,0,0,1000,に,助詞,格助詞,*,*,*,*,ニ,に,*,A,*,*,*,*
行く,0,0,1000,行く,動詞,非自立可能,*,*,五段-カ行,終止形-一般,イク,行く,*,A,*,*,*,*
何,0,0,1000,何,代名詞,*,*,*,*,*,ナニ,何,*,A,*,*,*,*
です,0,0,1000,です,助動詞,*,*,*,助動詞-デス,終止形-一般,デス,です,*,A,*,*,*,*
か,0,0,1000,か,助詞,終助詞,*,*,*,*,カ,か,*,A,*,*,*,*
！,0,0,1000,！,補助記号,句点,*,*,*,*,！,！,*,A,*,*,*,*
";

/// Unknown text becomes a symbol of the few ids this dictionary has.
const SETTINGS: &str = r#"{
    "inputTextPlugin": [{ "class": "com.worksap.nlp.sudachi.DefaultInputTextPlugin" }],
    "oovProviderPlugin": [{
        "class": "com.worksap.nlp.sudachi.SimpleOovPlugin",
        "oovPOS": ["補助記号", "句点", "*", "*", "*", "*"],
        "leftId": 0, "rightId": 0, "cost": 30000
    }],
    "pathRewritePlugin": []
}"#;

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("sudachi-tests");
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

fn small_dictionary() -> PathBuf {
    let mut builder = DictBuilder::new_system();
    builder.set_description("test");
    builder.read_conn(b"1 1\n0 0 0\n".as_slice()).unwrap();
    builder.read_lexicon(LEXICON.as_bytes()).unwrap();
    builder.resolve().unwrap();
    let mut bytes = Vec::new();
    builder.compile(&mut bytes).unwrap();
    let path = scratch(&format!("system-{}.dic", std::process::id()));
    std::fs::write(&path, bytes).unwrap();
    path
}

fn settings() -> Config {
    ConfigBuilder::from_bytes(SETTINGS.as_bytes()).unwrap().build()
}

fn rows(tokenizer: &dyn Tokenizer, text: &str) -> Vec<(String, String, String)> {
    analyze(tokenizer, text, false).unwrap().into_iter().map(|r| (r.orig, r.hira, r.hepburn)).collect()
}

fn row(orig: &str, hira: &str, hepburn: &str) -> (String, String, String) {
    (orig.into(), hira.into(), hepburn.into())
}

#[test]
fn words_get_their_readings_split_over_kanji_and_kana() {
    let path = small_dictionary();
    let sudachi = Sudachi::open_with(settings(), &path).unwrap();
    assert_eq!(
        rows(&sudachi, "東京に行く"),
        [row("東京", "とうきょう", "toukyou"), row("に", "に", "ni"), row("行", "い", "i"), row("く", "く", "ku")]
    );
    // The context rule reads 何 before です as なん.
    assert_eq!(rows(&sudachi, "何ですか")[0], row("何", "なん", "nan"));
    // Unknown text keeps its surface.
    assert_eq!(rows(&sudachi, "東京！"), [row("東京", "とうきょう", "toukyou"), row("！", "！", "！")]);
    let json = serde_json::Value::Array(convert(&sudachi, "東京に", true, false).unwrap());
    assert_eq!(json.to_string(), r#"[{"orig":"東京","hira":"とうきょう"},{"orig":"に","hira":"に"}]"#);
    // The analyzer is shared between the message threads.
    std::thread::scope(|scope| {
        for _ in 0..4 {
            scope.spawn(|| assert_eq!(rows(&sudachi, "東京に行く").len(), 4));
        }
    });
}

#[test]
fn a_missing_or_broken_dictionary_leaves_no_readings() {
    let missing = SudachiFile::new(scratch("missing/system.dic"));
    assert_eq!(missing.unavailable_reason(), None, "nothing is known before the first text");
    assert_eq!(missing.tokenize("東京").err(), Some(Unavailable));
    assert!(missing.unavailable_reason().unwrap().starts_with("no dictionary at "));

    let broken = scratch(&format!("broken-{}.dic", std::process::id()));
    std::fs::write(&broken, b"not a dictionary").unwrap();
    let file = SudachiFile::new(broken.clone());
    assert_eq!(convert(&file, "東京", true, true).err(), Some(Unavailable));
    assert!(file.unavailable_reason().unwrap().starts_with("cannot read "));
    let _ = std::fs::remove_file(broken);
}
