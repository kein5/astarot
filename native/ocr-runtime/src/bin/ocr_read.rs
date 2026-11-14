//! Read PNG pictures with the OCR engine and write what it found to a JSON file.
//!
//! ```sh
//! ocr-read --models <downloaded_models> [--language auto] [--threads N] \
//!          --output result.json picture.png...
//! ```
//!
//! The recognised text goes only to `--output`; the terminal gets counts and timings.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use ocr_runtime::engine::{Engine, EngineConfig};
use ocr_runtime::languages::resolve_model_spec;
use ocr_runtime::models::{characters, resolve_model_files};
use ocr_runtime::BgrImage;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("ocr-read: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut models: Option<PathBuf> = None;
    let mut language = "auto".to_string();
    let mut output: Option<PathBuf> = None;
    let mut threads: Option<usize> = None;
    let mut pictures = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or_else(|| format!("{name} needs a value"));
        match arg.as_str() {
            "--models" => models = Some(PathBuf::from(value("--models")?)),
            "--language" => language = value("--language")?,
            "--output" => output = Some(PathBuf::from(value("--output")?)),
            "--threads" => threads = Some(value("--threads")?.parse().map_err(|_| "--threads needs a number")?),
            "-h" | "--help" => {
                println!("usage: ocr-read --models <downloaded_models> [--language auto] [--threads N] --output result.json picture.png...");
                return Ok(());
            }
            _ => pictures.push(PathBuf::from(arg)),
        }
    }
    let output = output.ok_or("--output is required")?;
    let spec = resolve_model_spec(&language).ok_or_else(|| format!("unsupported language {language:?}"))?;
    let files = resolve_model_files(models.as_deref(), &spec).map_err(|e| e.to_string())?;
    let dictionary = characters(&files.dict).map_err(|e| e.to_string())?;
    let mut config = EngineConfig::default();
    if let Some(threads) = threads {
        config.threads = threads;
    }
    let started = Instant::now();
    let mut engine = Engine::load(&files.det, &files.rec, dictionary, spec.right_to_left(), config).map_err(|e| e.to_string())?;
    eprintln!("loaded {} in {:.2} s", spec.label(), started.elapsed().as_secs_f64());

    let mut results = Vec::new();
    let mut lines = 0;
    let started = Instant::now();
    for path in &pictures {
        let image = BgrImage::read_png(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let out = engine.run(&image).map_err(|e| format!("{}: {e}", path.display()))?;
        lines += out.texts.len();
        results.push(serde_json::json!({
            "file": path.file_name().map(|n| n.to_string_lossy().into_owned()),
            "boxes": out.boxes.iter().map(|q| q.iter().map(|p| [p.0, p.1]).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "texts": out.texts,
            "scores": out.scores,
        }));
    }
    let elapsed = started.elapsed().as_secs_f64();
    std::fs::write(&output, serde_json::to_string(&results).map_err(|e| e.to_string())?).map_err(|e| format!("{}: {e}", output.display()))?;
    eprintln!("{} pictures, {lines} lines, {:.1} ms per picture", pictures.len(), elapsed * 1000.0 / pictures.len().max(1) as f64);
    Ok(())
}
