//! How long opening a speech output takes on PipeWire (#556): speech opens its output when its
//! first audio arrives, so this time is part of the wait before the voice is heard.
//!
//! Run it against a sink of a private PipeWire graph, never the desktop's:
//!
//! ```sh
//! cargo run --release --example output_open -- --sink <node name> --runs 20
//! ```
//!
//! Each run times the device lookup (`enumerate_outputs`), `PipeWireOutput::open` as speech
//! calls it (lookup included) and the first 10 ms write, then plays 200 ms of a quiet tone and
//! closes the stream. One JSON line per run, times in milliseconds.

#[cfg(all(target_os = "linux", feature = "pipewire"))]
fn main() {
    use std::time::{Duration, Instant};
    use astarot_audio_routing::pipewire::output::{PipeWireOutput, enumerate_outputs};
    use astarot_audio_routing::router::{CancelToken, Output};

    let mut sink = None;
    let mut runs = 20usize;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--sink" => sink = args.next(),
            "--runs" => runs = args.next().and_then(|v| v.parse().ok()).expect("--runs takes a number"),
            other => panic!("unknown argument {other}"),
        }
    }
    let sink = sink.expect("--sink is required");
    let rate = 24_000u32;
    let block: Vec<u8> = (0..rate / 100).flat_map(|i| (((i % 48) as i16 - 24) * 40).to_le_bytes()).collect();
    let token = CancelToken::default();
    for run in 1..=runs {
        let started = Instant::now();
        let listed = enumerate_outputs().expect("the outputs can be listed").iter().any(|o| o.id == sink);
        let lookup = started.elapsed();
        assert!(listed, "the sink is listed");
        let started = Instant::now();
        let mut output = PipeWireOutput::open(&sink, rate, 1, None, "astarot.tts").expect("the output opens");
        let opened = started.elapsed();
        output.write(&block, &token).expect("the first block is taken");
        let first = started.elapsed();
        for _ in 0..19 {
            output.write(&block, &token).expect("a block is taken");
        }
        output.close(true, &token).expect("the output closes");
        let ms = |d: Duration| (d.as_secs_f64() * 1e4).round() / 10.0;
        println!("{{\"run\": {run}, \"lookup_ms\": {}, \"open_ms\": {}, \"first_write_ms\": {}}}", ms(lookup), ms(opened), ms(first));
    }
}

#[cfg(not(all(target_os = "linux", feature = "pipewire")))]
fn main() {
    eprintln!("output_open measures PipeWire on Linux with the pipewire feature");
}
