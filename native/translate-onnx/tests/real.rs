//! Real models, on a PC that has them. Each variable names a folder that
//! tools/translation_onnx/export.py wrote; the test is skipped without it.
//!
//!     VRCT_TRANSLATE_M2M100=.../m2m100_418M-onnx-int8
//!     VRCT_TRANSLATE_NLLB=.../nllb-200-distilled-600M-onnx-int8

use vrct_translate_onnx::{codes, Accelerator, Bundle, Translator};

fn translator(variable: &str) -> Option<Translator> {
    let folder = std::env::var_os(variable)?;
    let bundle = Bundle::open(folder).unwrap();
    bundle.verify().unwrap();
    Some(Translator::load(&bundle, Accelerator::CPU).unwrap())
}

fn check(translator: &mut Translator, english: &str, japanese: &str) {
    assert_eq!(translator.backend(), Accelerator::CPU);
    let text = translator.translate("Thank you very much.", english, japanese).unwrap();
    assert!(!text.is_empty() && text.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c)), "{text}");
    let text = translator.translate("ありがとうございます。", japanese, english).unwrap();
    assert!(text.to_lowercase().contains("thank"), "{text}");
    // The empty text is translated, as in the app.
    assert!(translator.translate("", english, japanese).is_ok());
    assert_eq!(translator.translate("x", "xx", japanese).unwrap_err().code, codes::LANGUAGE_UNSUPPORTED);
    assert_eq!(translator.translate("x", english, "xx").unwrap_err().code, codes::LANGUAGE_UNSUPPORTED);
    // Over 1024 source tokens, as the app refuses it.
    let long = "word ".repeat(1100);
    assert_eq!(translator.translate(&long, english, japanese).unwrap_err().code, codes::INPUT_TOO_LONG);
}

#[test]
fn m2m100_translates_both_ways() {
    let Some(mut translator) = translator("VRCT_TRANSLATE_M2M100") else { return };
    check(&mut translator, "en", "ja");
    // A character SentencePiece does not know keeps the id the app's tokenizer gives it
    // through vocab.json ("跻" is one), not the unknown token.
    let ids = translator.source_ids("官仲跻法", "zh").unwrap();
    assert!(!ids.contains(&3), "{ids:?}");
}

#[test]
fn nllb_translates_both_ways() {
    let Some(mut translator) = translator("VRCT_TRANSLATE_NLLB") else { return };
    check(&mut translator, "eng_Latn", "jpn_Jpan");
}
