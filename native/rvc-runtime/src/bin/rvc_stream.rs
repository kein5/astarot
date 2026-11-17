//! Streaming voice conversion of a WAV file, block by block as a live input would be fed,
//! with the processing time of every block measured (specification 13.3).
//!
//! Blocks are processed back to back, not paced in real time; the real-time factor is
//! the processing time of a block divided by the block's duration.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use rvc_runtime::{audio, Converter, Device, FeatureExtractor, FeatureIndex, Layout, NoiseMode, Rmvpe, Stream, StreamOptions, Synthesizer, VoiceModel};

const USAGE: &str = "\
Usage: rvc-stream --model <voice.pth> --hubert <hubert.onnx | hubert_base folder> --rmvpe <rmvpe.onnx>
                  --input <in.wav> [--output <out.wav>] [options]

Options:
  --index <file.index>     retrieval index of the voice model
  --index-rate <0..1>      share of retrieved features (default 0.75; needs --index)
  --transpose <semitones>  key change (default 0)
  --speaker <n>            speaker number (default 0)
  --seed <n>               fix the synthesis noise so the output is reproducible
  --device <cpu|cuda>      where the networks run (default cpu)
  --block-ms <ms>          block length (default 250)
  --crossfade-ms <ms>      crossfade length (default 50)
  --search-ms <ms>         crossfade search range (default 10)
  --extra-ms <ms>          left context (default 2500)
  --highpass <on|off>      causal input high-pass (default on)
  --warmup <n>             blocks of silence processed and not timed first (default 3)
  --threads <n>            CPU threads per network (default: ONNX Runtime's, one per core)

All lengths are rounded to whole 10 ms frames.
";

struct Arguments {
    model: PathBuf,
    hubert: PathBuf,
    rmvpe: PathBuf,
    input: PathBuf,
    output: Option<PathBuf>,
    index: Option<PathBuf>,
    device: Device,
    options: StreamOptions,
    warmup: usize,
    threads: Option<usize>,
}

fn parse() -> Result<Arguments, String> {
    let mut values = std::collections::HashMap::new();
    let mut arguments = std::env::args().skip(1);
    while let Some(flag) = arguments.next() {
        let name = flag.strip_prefix("--").ok_or_else(|| format!("unexpected argument `{flag}`"))?.to_string();
        let value = arguments.next().ok_or_else(|| format!("`{flag}` needs a value"))?;
        values.insert(name, value);
    }
    let mut path = |name: &str| values.remove(name).map(PathBuf::from);
    let mut required = |name: &str| path(name).ok_or_else(|| format!("`--{name}` is required"));
    let (model, hubert, rmvpe, input) = (required("model")?, required("hubert")?, required("rmvpe")?, required("input")?);
    let (output, index) = (path("output"), path("index"));
    fn number<T: std::str::FromStr>(values: &mut std::collections::HashMap<String, String>, name: &str, default: T) -> Result<T, String> {
        match values.remove(name) {
            Some(text) => text.parse().map_err(|_| format!("`--{name}` has an invalid value")),
            None => Ok(default),
        }
    }
    let defaults = StreamOptions::default();
    let frames = |ms: f64| (ms / 10.0).round() as usize;
    let layout = Layout {
        block: frames(number(&mut values, "block-ms", defaults.layout.block as f64 * 10.0)?),
        crossfade: frames(number(&mut values, "crossfade-ms", defaults.layout.crossfade as f64 * 10.0)?),
        search: frames(number(&mut values, "search-ms", defaults.layout.search as f64 * 10.0)?),
        extra: frames(number(&mut values, "extra-ms", defaults.layout.extra as f64 * 10.0)?),
    };
    let mut options = StreamOptions {
        transpose: number(&mut values, "transpose", defaults.transpose)?,
        index_rate: number(&mut values, "index-rate", defaults.index_rate)?,
        speaker: number(&mut values, "speaker", defaults.speaker)?,
        layout,
        ..defaults
    };
    if let Some(seed) = values.remove("seed") {
        options.noise = NoiseMode::Seeded(seed.parse().map_err(|_| "`--seed` has an invalid value".to_string())?);
    }
    options.highpass = match values.remove("highpass").as_deref() {
        None | Some("on") => true,
        Some("off") => false,
        Some(_) => return Err("`--highpass` must be on or off".into()),
    };
    let device = match values.remove("device").as_deref() {
        None | Some("cpu") => Device::Cpu,
        Some("cuda") => Device::Cuda,
        Some(_) => return Err("`--device` must be cpu or cuda".into()),
    };
    let warmup = number(&mut values, "warmup", 3)?;
    let threads = values.remove("threads").map(|text| text.parse::<usize>().map_err(|_| "`--threads` has an invalid value".to_string())).transpose()?;
    if let Some(unknown) = values.keys().next() {
        return Err(format!("unknown option `--{unknown}`"));
    }
    Ok(Arguments { model, hubert, rmvpe, input, output, index, device, options, warmup, threads })
}

fn run(arguments: Arguments) -> rvc_runtime::Result<()> {
    rvc_runtime::backend::set_intra_threads(arguments.threads);
    let model = VoiceModel::load(&arguments.model)?;
    let index = arguments.index.as_deref().map(FeatureIndex::load).transpose()?;
    let converter = Converter {
        // A folder is the hubert_base checkpoint the application uses; a file an exported graph.
        features: if arguments.hubert.is_dir() { FeatureExtractor::from_checkpoint(&arguments.hubert, arguments.device)? } else { FeatureExtractor::load(&arguments.hubert, arguments.device)? },
        pitch: Box::new(Rmvpe::load(&arguments.rmvpe, arguments.device)?),
        synthesizer: Synthesizer::new(&model, arguments.device)?,
        index,
        version: model.version,
    };
    let layout = arguments.options.layout;
    let mut stream = Stream::new(converter, arguments.options)?;
    let (samples, rate) = audio::read_wav(&arguments.input)?;
    let input = audio::resample(&samples, rate, rvc_runtime::pipeline::INPUT_RATE);
    let block = layout.block_samples();

    // The first runs of each graph are slower (allocation, kernel selection); a live
    // stream pays that once at start, so it is not counted.
    let silence = vec![0.0f32; block];
    for _ in 0..arguments.warmup {
        stream.process(&silence)?;
    }
    stream.reset();

    let mut output = Vec::with_capacity(input.len() / block * stream.output_block());
    let mut times = Vec::new();
    for chunk in input.chunks_exact(block) {
        let started = Instant::now();
        output.extend(stream.process(chunk)?);
        times.push(started.elapsed().as_secs_f64());
    }
    if times.is_empty() {
        return Err(rvc_runtime::Error::Invalid("the input is shorter than one block".into()));
    }
    let duration = layout.block as f64 / 100.0;
    let mut sorted = times.clone();
    sorted.sort_by(f64::total_cmp);
    let mean = times.iter().sum::<f64>() / times.len() as f64;
    let percentile = |p: f64| sorted[((sorted.len() - 1) as f64 * p).round() as usize];
    let late = times.iter().filter(|&&time| time > duration).count();
    // Numbers only: nothing about the audio content is printed.
    eprintln!(
        "model {:?} {} Hz f0={} | block {} ms, crossfade {} ms, search {} ms, extra {} ms | {} blocks | per block mean {:.1} ms, p95 {:.1} ms, max {:.1} ms | RTF mean {:.3}, p95 {:.3}, max {:.3} | {} blocks over time | latency {:.0} ms + processing",
        model.version,
        model.config.sample_rate,
        model.f0,
        layout.block * 10,
        layout.crossfade * 10,
        layout.search * 10,
        layout.extra * 10,
        times.len(),
        mean * 1e3,
        percentile(0.95) * 1e3,
        sorted[sorted.len() - 1] * 1e3,
        mean / duration,
        percentile(0.95) / duration,
        sorted[sorted.len() - 1] / duration,
        late,
        layout.latency() * 1e3,
    );
    if let Some(path) = &arguments.output {
        let gain = audio::peak_gain(&output);
        audio::write_wav(path, &output, stream.sample_rate(), gain)?;
    }
    Ok(())
}

fn main() -> ExitCode {
    // SAFETY: first thing in main, before any other thread starts.
    unsafe { rvc_runtime::backend::disable_telemetry_for_process() };
    let arguments = match parse() {
        Ok(arguments) => arguments,
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(arguments) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
