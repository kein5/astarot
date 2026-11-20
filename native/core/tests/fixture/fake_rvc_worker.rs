//! A stand-in for `astarot-rvc-worker`, for the voice tests: the same arguments and pipe contract
//! ("VVC1"), no model and no ONNX Runtime. It is never part of an application build.
//!
//! - `--probe`: exits with the number in `<runtime>/probe-exit` (0 without the file).
//! - A conversion: the voice model file says how to behave. `cpu` answers ready on the CPU,
//!   `fail:<code>` refuses to start with that code, `silence` answers every block as silence,
//!   `stall` never answers a block, `block:<ms>` confirms that block instead of the one asked
//!   for (`--block-ms`); anything else converts on the "GPU". A converted block is the input
//!   with every sample's sign turned, plus one, so it is never the input itself. The block it
//!   was asked for is written to `<runtime>/asked-block-ms`.

use std::io::{Read, Write};

use serde_json::{Value, json};
use vrct_voice_conversion::protocol::{self as p, Info};

fn argument(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn send(out: &mut dyn Write, info: Info, pcm: &[u8]) {
    let packet = p::encode_packet(&info, pcm).expect("a valid packet");
    if out.write_all(&packet).and_then(|()| out.flush()).is_err() {
        std::process::exit(0);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let runtime = argument(&args, "--runtime").unwrap_or_default();
    if args.iter().any(|a| a == "--probe") {
        let code = std::fs::read_to_string(std::path::Path::new(&runtime).join("probe-exit")).ok().and_then(|t| t.trim().parse().ok()).unwrap_or(0);
        std::process::exit(code);
    }
    let session = argument(&args, "--session").expect("a session");
    let behaviour = argument(&args, "--model").and_then(|model| std::fs::read_to_string(model).ok()).unwrap_or_default();
    let behaviour = behaviour.trim();
    let mut stdout = std::io::stdout().lock();
    if let Some(code) = behaviour.strip_prefix("fail:") {
        send(&mut stdout, p::failed_info(&session, code).expect("a listed code"), &[]);
        return;
    }
    let (profile, latency) = if behaviour == "cpu" { ("cpu", 1182) } else { ("low", 52) };
    // The block the owner asked for (`--block-ms`), as the real worker confirms it; the
    // behaviour `block:<ms>` confirms another, which the owner must refuse.
    let asked = argument(&args, "--block-ms").and_then(|ms| ms.parse().ok()).and_then(p::Block::from_ms).unwrap_or_default();
    let block = behaviour.strip_prefix("block:").and_then(|ms| ms.parse().ok()).and_then(p::Block::from_ms).unwrap_or(asked);
    // For the tests: the block it was asked for.
    let _ = std::fs::write(std::path::Path::new(&runtime).join("asked-block-ms"), argument(&args, "--block-ms").unwrap_or_default());
    send(&mut stdout, p::ready_info(&session, "rvc", profile, latency, block).expect("a ready packet"), &[]);
    let mut stdin = std::io::stdin().lock();
    loop {
        let Ok((info, pcm)) = p::read_packet(&mut stdin as &mut dyn Read) else { return };
        if behaviour == "stall" {
            continue;
        }
        let mut answer = info.clone();
        answer.insert("type".into(), json!("output"));
        let output: Vec<u8> = if behaviour == "silence" {
            answer.insert("state".into(), Value::from("vad_silence"));
            vec![0; pcm.len()]
        } else {
            answer.insert("state".into(), Value::from("converted"));
            pcm.as_chunks::<2>().0.iter().flat_map(|s| (i16::from_le_bytes(*s).wrapping_neg().wrapping_add(1)).to_le_bytes()).collect()
        };
        answer.remove("pcm_bytes");
        send(&mut stdout, answer, &output);
    }
}
