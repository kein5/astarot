//! The pipeline's pure steps against the Python functions on the same inputs
//! (`reference/dump_pipeline_cases.py`): line grouping, block bounds, the chatbox style
//! check and message merging on the words the Python reader returned for the test
//! pictures, the near-duplicate check and case-insensitive keys, and the chatbox
//! detector's boxes. Only counts are printed.

mod common;

use common::{fixture, reference_dir};
use astarot_ocr_runtime::chatbox::ChatboxDetector;
use astarot_ocr_runtime::detection::{block_bounds, group_lines, looks_like_chatbox};
use astarot_ocr_runtime::engine::Word;
use astarot_ocr_runtime::models::{resolve_artifact, DETECTOR_MODEL_ID};
use astarot_ocr_runtime::text::{merge_words, similar, text_key};
use astarot_ocr_runtime::BgrImage;

fn words_of(set: &str, file: &str) -> Vec<Word> {
    let data = fixture(&format!("engine/{set}.json")).unwrap();
    let picture = data["pictures"].as_array().unwrap().iter().find(|p| p["file"] == file).unwrap();
    picture["words"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| Word {
            text: w["text"].as_str().unwrap().to_string(),
            confidence: w["confidence"].as_f64().unwrap(),
            bounds: Some((w["left"].as_f64().unwrap(), w["right"].as_f64().unwrap(), w["top"].as_f64().unwrap(), w["bottom"].as_f64().unwrap())),
        })
        .collect()
}

#[test]
fn grouping_style_check_and_merging_match_python() {
    let Some(cases) = fixture("pipeline/blocks.json") else { return };
    let (mut pictures, mut blocks, mut chatboxes) = (0, 0, 0);
    for case in cases.as_array().unwrap() {
        let (set, file) = (case["set"].as_str().unwrap(), case["file"].as_str().unwrap());
        let words = words_of(set, file);
        let image = BgrImage::read_png(&reference_dir().join("images").join(set).join(file)).unwrap();
        if case["splits"].as_bool().unwrap() {
            let groups = group_lines(&words);
            let expected = case["blocks"].as_array().unwrap();
            assert_eq!(groups.len(), expected.len(), "{set}/{file}: block count");
            for (group, block) in groups.iter().zip(expected) {
                let lines: Vec<usize> = block["lines"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
                let expected_words: Vec<&Word> = lines.iter().map(|&i| &words[i]).collect();
                assert!(group.iter().zip(&expected_words).all(|(a, b)| a == *b) && group.len() == expected_words.len(), "{set}/{file}: block lines");
                let bounds = block_bounds(group).map(|b| vec![b.0, b.1, b.2, b.3]);
                let expected_bounds = block["bounds"].as_array().map(|b| b.iter().map(|v| v.as_i64().unwrap()).collect::<Vec<_>>());
                assert_eq!(bounds, expected_bounds, "{set}/{file}: block bounds");
                let chatbox = looks_like_chatbox(&image, group);
                assert_eq!(chatbox, block["chatbox"].as_bool().unwrap(), "{set}/{file}: chatbox check");
                assert!(merge_words(group) == block["merged"].as_str().unwrap(), "{set}/{file}: merged text differs");
                blocks += 1;
                chatboxes += usize::from(chatbox);
            }
        } else {
            let chatbox = looks_like_chatbox(&image, &words);
            assert_eq!(chatbox, case["chatbox"].as_bool().unwrap(), "{set}/{file}: chatbox check");
            assert!(merge_words(&words) == case["merged"].as_str().unwrap(), "{set}/{file}: merged text differs");
            blocks += 1;
            chatboxes += usize::from(chatbox);
        }
        pictures += 1;
    }
    println!("METRIC bubbles: {pictures} pictures, {blocks} blocks ({chatboxes} judged chatboxes): grouping, bounds, style check and merged text identical");
}

#[test]
fn near_duplicates_and_case_insensitive_keys_match_python() {
    let Some(pairs) = fixture("pipeline/text.json") else { return };
    let pairs = pairs.as_array().unwrap();
    for (index, pair) in pairs.iter().enumerate() {
        let (a, b) = (pair["a"].as_str().unwrap(), pair["b"].as_str().unwrap());
        assert_eq!(similar(a, b, 2), pair["similar"].as_bool().unwrap(), "pair {index}: similar");
        assert_eq!(text_key(a) == text_key(b), pair["same_key"].as_bool().unwrap(), "pair {index}: case-insensitive key");
    }
    println!("METRIC text: {} pairs identical (near-duplicate check, case folding)", pairs.len());
}

#[test]
fn chatbox_detector_matches_python() {
    let Some(cases) = fixture("pipeline/detector.json") else { return };
    let path = resolve_artifact(&reference_dir().join("downloaded_models"), DETECTOR_MODEL_ID, "detector").unwrap();
    let mut detector = ChatboxDetector::new(path, 4).unwrap();
    let (mut frames, mut identical, mut boxes, mut max_diff) = (0, 0, 0, 0i64);
    for case in cases.as_array().unwrap() {
        let image = BgrImage::read_png(&reference_dir().join("images").join(case["set"].as_str().unwrap()).join(case["file"].as_str().unwrap())).unwrap();
        let (_, h, w, scale) = detector.letterbox(&image);
        let canvas: Vec<usize> = case["canvas"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
        assert_eq!(vec![1, 3, h, w], canvas);
        assert_eq!(scale, case["scale"].as_f64().unwrap());
        let found: Vec<[i64; 4]> = detector.detect(&image).unwrap().into_iter().map(|(b, _)| [b.0, b.1, b.2, b.3]).collect();
        let expected: Vec<[i64; 4]> = case["boxes"].as_array().unwrap().iter().map(|b| std::array::from_fn(|i| b[i].as_i64().unwrap())).collect();
        assert_eq!(found.len(), expected.len(), "{}: chatbox count", case["file"]);
        for (a, b) in found.iter().zip(&expected) {
            max_diff = max_diff.max((0..4).map(|i| (a[i] - b[i]).abs()).max().unwrap());
        }
        identical += usize::from(found == expected);
        boxes += expected.len();
        frames += 1;
    }
    println!("METRIC detector: {frames} frames, {boxes} chatboxes; boxes identical in {identical}/{frames} frames (max difference {max_diff} px)");
    assert!(max_diff <= 1, "a detected box moved by {max_diff} px");
}
