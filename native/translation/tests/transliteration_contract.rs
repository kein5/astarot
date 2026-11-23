//! The contract of the readings (issue #277): `tests/contract/transliteration.json`, recorded
//! from the Python transliteration with SudachiPy and the full SudachiDict.
//!
//! The recorded morphemes of each text go into the Rust readings ([`analyze`]), which must give
//! the readings Python gave, with and without macrons; every kana string must give Python's
//! Hepburn. This needs no dictionary. With the path of a SudachiDict `system.dic` in
//! `ASTAROT_SUDACHI_DICTIONARY` (the version the file names), sudachi.rs must also give the recorded
//! morphemes; without it that part does nothing.

use serde_json::Value;
use astarot_translation::transliteration::sudachi::Sudachi;
use astarot_translation::transliteration::{analyze, katakana_to_hepburn, Morpheme, Reading, Tokenizer, Unavailable};

const CONTRACT: &str = include_str!("contract/transliteration.json");

fn document() -> Value {
    serde_json::from_str(CONTRACT).expect("the contract is JSON")
}

fn text(value: &Value) -> String {
    value.as_str().expect("a string").to_string()
}

fn morphemes(sentence: &Value) -> Vec<Morpheme> {
    sentence["morphemes"]
        .as_array()
        .expect("morphemes")
        .iter()
        .map(|m| Morpheme { surface: text(&m[0]), reading: text(&m[1]), part_of_speech: text(&m[2]) })
        .collect()
}

/// The morphemes as the analyzer gave them for one text.
struct Recorded(Vec<Morpheme>);

impl Tokenizer for Recorded {
    fn tokenize(&self, _text: &str) -> Result<Vec<Morpheme>, Unavailable> {
        Ok(self.0.clone())
    }
}

fn rows(readings: &[Reading]) -> Vec<[String; 4]> {
    readings.iter().map(|r| [r.orig.clone(), r.kana.clone(), r.hira.clone(), r.hepburn.clone()]).collect()
}

fn recorded_rows(value: &Value) -> Vec<[String; 4]> {
    value.as_array().expect("readings").iter().map(|r| [text(&r[0]), text(&r[1]), text(&r[2]), text(&r[3])]).collect()
}

#[test]
fn the_readings_of_every_text_are_python_s() {
    let document = document();
    let mut broken = Vec::new();
    for sentence in document["sentences"].as_array().expect("sentences") {
        let tokenizer = Recorded(morphemes(sentence));
        let input = sentence["text"].as_str().unwrap();
        for (macron, key) in [(false, "readings"), (true, "readings_macron")] {
            let got = rows(&analyze(&tokenizer, input, macron).expect("fixed morphemes"));
            if got != recorded_rows(&sentence[key]) {
                broken.push(format!("{input:?} ({key}): {got:?}"));
            }
        }
    }
    assert!(broken.is_empty(), "{} reading(s) differ from Python:\n{}", broken.len(), broken.join("\n"));
}

#[test]
fn every_kana_reads_as_python_reads_it() {
    let document = document();
    let mut broken = Vec::new();
    for row in document["hepburn"].as_array().expect("hepburn") {
        let kana = row[0].as_str().unwrap();
        for (macron, at) in [(false, 1), (true, 2)] {
            let got = katakana_to_hepburn(kana, macron);
            if got != row[at].as_str().unwrap() {
                broken.push(format!("{kana:?} (macron {macron}): {got:?}, Python {}", row[at]));
            }
        }
    }
    assert!(broken.is_empty(), "{} kana read differently:\n{}", broken.len(), broken.join("\n"));
}

#[test]
fn sudachi_gives_the_recorded_morphemes() {
    let Some(path) = std::env::var_os("ASTAROT_SUDACHI_DICTIONARY").filter(|p| !p.is_empty()) else {
        return;
    };
    let sudachi = Sudachi::open(std::path::Path::new(&path)).expect("the dictionary opens");
    let document = document();
    let mut broken = Vec::new();
    for sentence in document["sentences"].as_array().expect("sentences") {
        let input = sentence["text"].as_str().unwrap();
        let got = sudachi.tokenize(input).expect("analyzed");
        if got != morphemes(sentence) {
            broken.push(format!("{input:?}: {got:?}"));
        }
    }
    assert!(broken.is_empty(), "{} text(s) analyzed differently:\n{}", broken.len(), broken.join("\n"));
}
