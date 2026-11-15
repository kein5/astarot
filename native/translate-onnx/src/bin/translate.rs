//! Translate JSON lines with a model folder: the tool behind the comparison with the app's
//! CTranslate2 translator (tools/translation_onnx/compare.py). Not used by the app.
//!
//!     vrct-translate MODEL_FOLDER [--device cpu|auto] [--verify] < requests > results
//!
//! Each request is `{"text": ..., "from": ..., "to": ...}` with the language codes the app
//! gives the tokenizer. Each result is `{"text": ..., "source_ids": [...], "target_ids": [...]}`
//! or `{"error": CODE}`. The backend used is written to stderr as `{"backend": ...}`.

use std::io::{BufRead, Write};

use serde_json::{json, Value};
use vrct_translate_onnx::{Bundle, Device, Translator};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let usage = || -> ! {
        eprintln!("usage: vrct-translate MODEL_FOLDER [--device cpu|auto] [--verify]");
        std::process::exit(2);
    };
    let Some(folder) = args.get(1) else { usage() };
    let mut device = Device::Cpu;
    let mut verify = false;
    let mut rest = args[2..].iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--verify" => verify = true,
            "--device" => {
                device = match rest.next().map(String::as_str) {
                    Some("cpu") => Device::Cpu,
                    Some("auto") => Device::Auto,
                    _ => usage(),
                }
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
    eprintln!("{}", json!({"backend": translator.backend().name()}));

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
