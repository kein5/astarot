//! The reading engine against what the Python implementation (RapidOCR 3.9.2 through
//! `models.ocr.ocr_engine_rapidocr`) read from the same pictures
//! (`reference/dump_reference.py`). Only counts and differences are printed, never text.
//!
//! Texts and boxes must be identical. Scores are rounded to five decimals from the
//! network's probabilities, and the ONNX Runtime build bundled by `ort` (1.31.0) differs
//! from the application's Python wheel (1.31.1) by about 1e-6 in those probabilities, so
//! a score may differ by one unit in the last decimal. With `OCR_EXACT_REFERENCE=1`
//! (run against the wheel's library through `--features ort/load-dynamic` and
//! `ORT_DYLIB_PATH`) everything must be identical.

mod common;

use std::collections::HashMap;

use common::{fixture, reference_dir};
use ocr_runtime::engine::{Engine, EngineConfig};
use ocr_runtime::languages::resolve_model_spec;
use ocr_runtime::models::{characters, resolve_model_files};
use ocr_runtime::BgrImage;

const SETS: &[&str] = &["synthetic-ja", "synthetic-zh", "synthetic-ko", "synthetic-ru", "synthetic-th", "synthetic-ar", "synthetic-hi", "lab-crops", "lab-frames"];

/// One unit in the fifth decimal, with room for the binary representation.
const SCORE_TOLERANCE: f64 = 1.000_1e-5;

fn exact() -> bool {
    std::env::var_os("OCR_EXACT_REFERENCE").is_some()
}

#[derive(Default)]
struct Tally {
    pictures: usize,
    identical_pictures: usize,
    lines_reference: usize,
    lines_runtime: usize,
    identical_texts: usize,
    identical_scores: usize,
    identical_boxes: usize,
    max_score_diff: f64,
    max_box_diff: f64,
    identical_words: usize,
    differing: Vec<String>,
}

fn engine_for<'a>(language: &str, threads: usize, engines: &'a mut HashMap<String, Engine>) -> &'a mut Engine {
    engines.entry(language.to_string()).or_insert_with(|| {
        let spec = resolve_model_spec(language).expect("supported language");
        let files = resolve_model_files(Some(&reference_dir().join("downloaded_models")), &spec).expect("models from setup_reference.py");
        let dictionary = characters(&files.dict).expect("character list");
        let config = EngineConfig { threads, ..EngineConfig::default() };
        Engine::load(&files.det, &files.rec, dictionary, spec.right_to_left(), config).expect("engine")
    })
}

#[test]
fn engine_matches_the_python_implementation() {
    let mut engines = HashMap::new();
    let mut all = Tally::default();
    let mut ran = false;
    for set in SETS {
        let Some(data) = fixture(&format!("engine/{set}.json")) else { continue };
        ran = true;
        let threads = data["threads"].as_u64().unwrap_or(4) as usize;
        let mut tally = Tally::default();
        for picture in data["pictures"].as_array().unwrap() {
            let file = picture["file"].as_str().unwrap();
            let language = picture["language"].as_str().unwrap();
            let image = BgrImage::read_png(&reference_dir().join("images").join(set).join(file)).unwrap();
            let engine = engine_for(language, threads, &mut engines);
            let out = engine.run(&image).unwrap();
            let words = engine.read(&image, 0.55).unwrap();

            let texts: Vec<String> = picture["texts"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
            let scores: Vec<f64> = picture["scores"].as_array().unwrap().iter().map(|s| s.as_f64().unwrap()).collect();
            let boxes: Vec<Vec<(f32, f32)>> =
                picture["boxes"].as_array().unwrap().iter().map(|b| b.as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32)).collect()).collect();
            tally.pictures += 1;
            tally.lines_reference += texts.len();
            tally.lines_runtime += out.texts.len();
            let mut same = texts.len() == out.texts.len();
            for (i, text) in texts.iter().enumerate() {
                if out.texts.get(i) == Some(text) {
                    tally.identical_texts += 1;
                } else {
                    same = false;
                }
                if let Some(score) = out.scores.get(i) {
                    let diff = (score - scores[i]).abs();
                    tally.max_score_diff = tally.max_score_diff.max(diff);
                    tally.identical_scores += usize::from(diff == 0.0);
                    same &= if exact() { diff == 0.0 } else { diff <= SCORE_TOLERANCE };
                }
                if let Some(quad) = out.boxes.get(i) {
                    let diff = quad.iter().zip(&boxes[i]).map(|(a, b)| (a.0 - b.0).abs().max((a.1 - b.1).abs()) as f64).fold(0.0, f64::max);
                    tally.max_box_diff = tally.max_box_diff.max(diff);
                    tally.identical_boxes += usize::from(diff == 0.0);
                    same &= diff == 0.0;
                }
            }
            let expected_words: Vec<(String, f64, [f64; 4])> = picture["words"]
                .as_array()
                .unwrap()
                .iter()
                .map(|w| {
                    (
                        w["text"].as_str().unwrap().to_string(),
                        w["confidence"].as_f64().unwrap(),
                        [w["left"].as_f64().unwrap(), w["right"].as_f64().unwrap(), w["top"].as_f64().unwrap(), w["bottom"].as_f64().unwrap()],
                    )
                })
                .collect();
            let found_words: Vec<(String, f64, [f64; 4])> = words.iter().map(|w| (w.text.clone(), w.confidence, w.bounds.map(|(l, r, t, b)| [l, r, t, b]).unwrap_or([f64::NAN; 4]))).collect();
            if expected_words == found_words {
                tally.identical_words += 1;
            } else {
                // Only the confidences may differ, within the score tolerance (a word close
                // to the 0.55 cut could also come and go; none does in this set).
                let close = expected_words.len() == found_words.len() && expected_words.iter().zip(&found_words).all(|(a, b)| a.0 == b.0 && a.2 == b.2 && (a.1 - b.1).abs() <= SCORE_TOLERANCE);
                same &= !exact() && close;
            }
            if same {
                tally.identical_pictures += 1;
            } else {
                tally.differing.push(format!("{set}/{file}"));
            }
        }
        println!(
            "METRIC {set}: pictures {}/{} as required; lines {} (runtime {}); texts {}/{}; scores {}/{} (max diff {:.1e}); boxes {}/{} (max diff {}); readtext words identical in {}/{} pictures",
            tally.identical_pictures,
            tally.pictures,
            tally.lines_reference,
            tally.lines_runtime,
            tally.identical_texts,
            tally.lines_reference,
            tally.identical_scores,
            tally.lines_reference,
            tally.max_score_diff,
            tally.identical_boxes,
            tally.lines_reference,
            tally.max_box_diff,
            tally.identical_words,
            tally.pictures
        );
        for name in &tally.differing {
            println!("DIFFERS {name}");
        }
        all.pictures += tally.pictures;
        all.identical_pictures += tally.identical_pictures;
        all.lines_reference += tally.lines_reference;
        all.identical_texts += tally.identical_texts;
        all.differing.extend(tally.differing);
    }
    if !ran {
        return;
    }
    println!(
        "METRIC all ({}): pictures {}/{} as required, texts {}/{} identical",
        if exact() { "exact" } else { "scores within 1e-5" },
        all.identical_pictures,
        all.pictures,
        all.identical_texts,
        all.lines_reference
    );
    assert!(all.differing.is_empty(), "{} pictures differ from the reference", all.differing.len());
}
