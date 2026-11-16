//! Translate JSON lines with a model folder: the tool behind the comparison with the app's
//! CTranslate2 translator (tools/translation_onnx/compare.py). Not used by the app.
//!
//!     vrct-translate MODEL_FOLDER [--device PROVIDER[:INDEX]] [--verify] < requests > results
//!     vrct-translate --providers
//!
//! Each request is `{"text": ..., "from": ..., "to": ...}` with the language codes the app
//! gives the tokenizer. Each result is `{"text": ..., "source_ids": [...], "target_ids": [...]}`
//! or `{"error": CODE}`. Where it runs is written to stderr as
//! `{"backend": ..., "variant": ..., "fallback": ...}`; a provider that cannot start falls
//! back to the CPU and names why.

use std::io::{BufRead, Write};

use serde_json::{json, Value};
use vrct_translate_onnx::{Accelerator, Bundle, Provider, Translator};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let usage = || -> ! {
        eprintln!("usage: vrct-translate MODEL_FOLDER [--device PROVIDER[:INDEX]] [--verify] | --providers");
        std::process::exit(2);
    };
    let Some(folder) = args.get(1) else { usage() };
    if folder == "--providers" {
        // The execution providers of the ONNX Runtime library this process loads.
        match vrct_translate_onnx::runtime::available_providers() {
            Ok(providers) => println!("{}", json!(providers.iter().map(|p| p.name()).collect::<Vec<_>>())),
            Err(error) => {
                eprintln!("{}", json!({"error": error.code}));
                std::process::exit(1);
            }
        }
        return;
    }
    let mut device = Accelerator::CPU;
    let mut verify = false;
    let mut rest = args[2..].iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--verify" => verify = true,
            "--device" => {
                // cpu, directml, cuda, openvino, migraphx, webgpu, tensorrt; optionally ":1".
                let value = rest.next().map(String::as_str).unwrap_or_else(|| usage());
                let (name, index) = value.split_once(':').unwrap_or((value, "0"));
                let provider = Provider::from_name(name).unwrap_or_else(|| usage());
                device = Accelerator::new(provider, index.parse().unwrap_or_else(|_| usage()));
            }
            _ => usage(),
        }
    }
    let fail = |code: &str| -> ! {
        eprintln!("{}", json!({"error": code}));
        std::process::exit(1);
    };
    let bundle = Bundle::open(folder).unwrap_or_else(|error| fail(error.code));
    if verify {
        bundle.verify().unwrap_or_else(|error| fail(error.code));
    }
    let mut translator = Translator::load(&bundle, device).unwrap_or_else(|error| fail(error.code));
    let fallback = translator.fallback().map(|f| f.code);
    eprintln!("{}", json!({"backend": translator.backend().provider.name(), "variant": translator.variant().name(), "fallback": fallback}));

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let field = |name: &str| request.get(name).and_then(Value::as_str);
        let result = match (field("text"), field("from"), field("to")) {
            (Some(text), Some(from), Some(to)) => match translator.source_ids(text, from) {
                Err(error) => json!({"error": error.code}),
                Ok(source) => match translator.translate_ids(&source, to) {
                    Err(error) => json!({"error": error.code, "source_ids": source}),
                    Ok(target) => match translator.text(&target) {
                        Ok(text) => json!({"text": text, "source_ids": source, "target_ids": target}),
                        Err(error) => json!({"error": error.code, "source_ids": source, "target_ids": target}),
                    },
                },
            },
            _ => json!({"error": "request_invalid"}),
        };
        if writeln!(out, "{result}").and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}
