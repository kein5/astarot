//! Real models, on a PC that has them. Each variable names a folder that
//! tools/translation_onnx/export.py wrote; the test is skipped without it.
//!
//!     ASTAROT_TRANSLATE_M2M100=.../m2m100_418M-onnx-int8
//!     ASTAROT_TRANSLATE_NLLB=.../nllb-200-distilled-600M-onnx-int8
//!
//! A GPU against the CPU, with any such folder (tools/translation_onnx/tiny.py writes small
//! ones) and an ONNX Runtime library that has the provider (ORT_DYLIB_PATH):
//!
//!     ASTAROT_TRANSLATE_DEVICE=directml:1 ASTAROT_TRANSLATE_DEVICE_MODEL=.../tiny-nllb-onnx-float32
//!
//! A folder the provider loads but cannot run (on DirectML: one written before 2026-11-18,
//! whose Reshape nodes have allowzero=1):
//!
//!     ASTAROT_TRANSLATE_DEVICE=directml:1 ASTAROT_TRANSLATE_UNRUNNABLE_MODEL=.../folder

use astarot_translate_onnx::{codes, Accelerator, Bundle, Provider, Translator};

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
    let Some(mut translator) = translator("ASTAROT_TRANSLATE_M2M100") else { return };
    check(&mut translator, "en", "ja");
    // A character SentencePiece does not know keeps the id the app's tokenizer gives it
    // through vocab.json ("跻" is one), not the unknown token.
    let ids = translator.source_ids("官仲跻法", "zh").unwrap();
    assert!(!ids.contains(&3), "{ids:?}");
}

#[test]
fn nllb_translates_both_ways() {
    let Some(mut translator) = translator("ASTAROT_TRANSLATE_NLLB") else { return };
    check(&mut translator, "eng_Latn", "jpn_Jpan");
}

fn device() -> Option<Accelerator> {
    let device = std::env::var("ASTAROT_TRANSLATE_DEVICE").ok()?;
    let (name, index) = device.split_once(':').unwrap_or((&device, "0"));
    Some(Accelerator::new(Provider::from_name(name).expect("a provider name"), index.parse().expect("a device index")))
}

/// The provider loads the graphs, the short translation after loading fails on it, and the
/// model runs on the CPU, saying why (decision 76). It then translates as the CPU does.
#[test]
fn a_folder_the_device_cannot_run_falls_back_to_the_cpu() {
    let (Some(at), Some(folder)) = (device(), std::env::var_os("ASTAROT_TRANSLATE_UNRUNNABLE_MODEL")) else {
        return;
    };
    let bundle = Bundle::open(folder).unwrap();
    bundle.verify().unwrap();
    let mut translator = Translator::load(&bundle, at).unwrap();
    assert_eq!(translator.backend(), Accelerator::CPU);
    let fallback = translator.fallback().map(|f| (f.requested, f.code));
    assert_eq!(fallback, Some((at, codes::PROVIDER_CHECK_FAILED)));
    let manifest = bundle.manifest();
    let ids = translator.source_ids("", &manifest.languages[0]).unwrap();
    assert!(!translator.translate_ids(&ids, &manifest.languages[manifest.languages.len() - 1]).unwrap().is_empty());
}

/// The provider runs the model without falling back to the CPU, and its beam search ends with
/// the CPU's ids, over a sentence long enough for the cached steps to matter. float16 is
/// compared on its first ids only: its rounding can turn a near tie the other way.
#[test]
fn a_device_decodes_as_the_cpu_does() {
    let (Some(device), Some(folder)) =
        (std::env::var("ASTAROT_TRANSLATE_DEVICE").ok(), std::env::var_os("ASTAROT_TRANSLATE_DEVICE_MODEL"))
    else {
        return;
    };
    let (name, index) = device.split_once(':').unwrap_or((&device, "0"));
    let at =
        Accelerator::new(Provider::from_name(name).expect("a provider name"), index.parse().expect("a device index"));
    let bundle = Bundle::open(folder).unwrap();
    bundle.verify().unwrap();
    let mut cpu = Translator::load(&bundle, Accelerator::CPU).unwrap();
    let mut gpu = Translator::load(&bundle, at).unwrap();
    assert_eq!((gpu.backend(), gpu.fallback()), (at, None), "the provider did not start");
    let manifest = bundle.manifest();
    let (source, target) = (&manifest.languages[0], &manifest.languages[manifest.languages.len() - 1]);
    let texts = [cpu.source_ids("", source).unwrap(), {
        // Words of the tiny model, or whatever a real model makes of them.
        let words: Vec<String> = (0..24).map(|index| format!("w{}", 300 + index * 37)).collect();
        cpu.source_ids(&words.join(" "), source).unwrap()
    }];
    for ids in texts {
        let want = cpu.translate_ids(&ids, target).unwrap();
        let got = gpu.translate_ids(&ids, target).unwrap();
        if manifest.variant.as_deref() == Some("float16") {
            assert_eq!(got[..2], want[..2], "{device}");
        } else {
            assert_eq!(got, want, "{device}");
        }
    }
}
