//! Stands in for the speech.cpp executable in tests/speech_servers.rs. No model, GPU or audio.
//!
//! `fake-speech-core devices` lists one GPU. `fake-speech-core serve MODEL ...` serves the
//! readiness the owner checks; the stem of MODEL's file name picks what it does:
//!
//! - `asr...` serves recognition and detection, anything else synthesis (`/v1/audio/speech`
//!   answers 0.2 s of a tone as 24 kHz PCM, and keeps the last request's body in
//!   `MODEL.speech`);
//! - `...slow...` answers 3 s of the tone instead, at about a third of real time;
//! - `...crash...` exits at once with an error;
//! - `...gate...` prints its ready line only once `MODEL.go` exists;
//! - `...die...` exits with an error once `MODEL.die` exists.
//!
//! Each `serve` leaves `MODEL.started` with its process id, so a test can tell that a server
//! was launched and whether it is gone, and `MODEL.ran` with the name of the folder of the
//! copy that ran and its `--device`.
//!
//! A copy in a stand-in bundle (with `bundle.json` beside it) also answers `devices --json`;
//! `cpu-only` beside it lists no GPU, `no-loader` makes it fail as a Vulkan build without
//! `libvulkan.so.1` does.
//!
//! For the GPU check (`tests/gpu_check.rs`) it also answers the command line, with the lines
//! speech.cpp 0.11 prints on stderr:
//!
//! - `info MODEL --json`: a TTS model (Japanese, the voice `none`) or, for a stem starting
//!   with `asr`, a recognition model; `...unreadable...` fails.
//! - `tts MODEL -o FILE ... -- TEXT`: a short WAVE file, and the text in `FILE.text` for the
//!   fake recognition to hear. `...gpufail...` fails on a GPU with `out_of_memory`, and
//!   `...slow...` takes 20 s.
//! - `asr MODEL --format json --device D ... FILE`: the text of `FILE.text`; `...garble...`
//!   hears it backwards on a GPU.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn respond(stream: &mut TcpStream, status: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

fn handle(mut stream: TcpStream, asr: bool, model: &Path, slow: bool) {
    let mut request = Vec::new();
    let mut block = [0u8; 8192];
    while !request.windows(4).any(|four| four == b"\r\n\r\n") {
        match stream.read(&mut block) {
            Ok(0) | Err(_) => return,
            Ok(read) => request.extend_from_slice(&block[..read]),
        }
    }
    let line = String::from_utf8_lossy(&request).lines().next().unwrap_or("").to_owned();
    if line.starts_with("GET /health ") {
        return respond(&mut stream, "200 OK", br#"{"status":"ok"}"#);
    }
    if line.starts_with("GET /v1/models ") {
        // On the CPU: the owner warms up only a GPU model, so readiness comes at once.
        let tasks: &[&str] = if asr { &["recognition", "detection"] } else { &["synthesis"] };
        let rows: Vec<String> = tasks
            .iter()
            .map(|task| format!(r#"{{"id":"{task}","speech":{{"task":"{task}","architecture":"other","device":"CPU"}}}}"#))
            .collect();
        return respond(&mut stream, "200 OK", format!(r#"{{"data":[{}]}}"#, rows.join(",")).as_bytes());
    }
    if line.starts_with("POST /v1/audio/speech ") && !asr {
        // The whole request first: closing with unread bytes would reset the connection.
        let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
        let head_end = request.windows(4).position(|four| four == b"\r\n\r\n").map_or(request.len(), |at| at + 4);
        let length: usize = text.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
        while request.len() < head_end + length {
            match stream.read(&mut block) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&block[..read]),
            }
        }
        let _ = std::fs::write(marker(model, ".speech"), &request[head_end.min(request.len())..]);
        let samples = if slow { 72000 } else { 4800 };
        let pcm: Vec<u8> = (0..samples).flat_map(|i: i32| (((i % 60) - 30) as i16 * 200).to_le_bytes()).collect();
        let head = format!("HTTP/1.1 200 OK\r\nContent-Type: audio/pcm\r\nX-Sample-Rate: 24000\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", pcm.len());
        let _ = stream.write_all(head.as_bytes());
        // 40 ms of speech every 15 ms when slow, so that a stop comes while it plays.
        for piece in pcm.chunks(if slow { 1920 } else { pcm.len() }) {
            if stream.write_all(piece).is_err() {
                return;
            }
            if slow {
                std::thread::sleep(Duration::from_millis(15));
            }
        }
        return;
    }
    respond(&mut stream, "404 Not Found", b"{}");
}

fn marker(model: &Path, suffix: &str) -> PathBuf {
    let mut name = model.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn wait_for(path: &Path) {
    while !path.exists() {
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// A copy of this executable that plays one bundled build is told how through files beside it:
/// `cpu-only` lists no GPU, and `no-loader` fails as a Vulkan build without `libvulkan.so.1`.
fn beside(name: &str) -> bool {
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(name).is_file())).unwrap_or(false)
}

fn option(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|arg| arg == name).and_then(|at| args.get(at + 1)).cloned()
}

/// The device as speech.cpp names it when it loads: `CPU` or the Vulkan device.
fn loaded_on(device: &str) -> String {
    if device == "cpu" { "CPU".into() } else { device.into() }
}

/// `speech info`, `speech tts` and `speech asr` for the GPU check.
fn command_line(args: &[String]) -> ! {
    let model = PathBuf::from(args.get(2).cloned().unwrap_or_default());
    let stem = model.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let device = option(args, "--device").unwrap_or_else(|| "auto".into());
    match args[1].as_str() {
        "info" => {
            if stem.contains("unreadable") {
                eprintln!("speech: model_invalid: {} is not a model", model.display());
                std::process::exit(1);
            }
            if stem.starts_with("asr") {
                println!(r#"{{"name":"Fake-ASR","weight_type":"Q8_0","task":"recognition","languages":["ja","en"],"options":[{{"name":"language"}}]}}"#);
            } else {
                println!(r#"{{"name":"Fake-TTS","weight_type":"Q8_0","task":"synthesis","languages":["ja"],"voices":[{{"name":"none"}}],"voice_files":true,"options":[{{"name":"voice"}},{{"name":"seed"}},{{"name":"language"}}]}}"#);
            }
        }
        "tts" => {
            let out = PathBuf::from(option(args, "-o").unwrap_or_default());
            let text = args.iter().position(|arg| arg == "--").and_then(|at| args.get(at + 1)).cloned().unwrap_or_default();
            if stem.contains("slow") {
                std::thread::sleep(Duration::from_secs(20));
            }
            eprintln!("Loaded Fake-TTS on {} in 0.10 s", loaded_on(&device));
            if stem.contains("gpufail") && device != "cpu" {
                eprintln!("speech: out_of_memory (device): vk::Device::allocateMemory failed for {}", out.display());
                std::process::exit(1);
            }
            // 0.5 s of silence, 16-bit mono at 16 kHz.
            let samples = 8000u32;
            let mut wave = Vec::new();
            wave.extend_from_slice(b"RIFF");
            wave.extend_from_slice(&(36 + samples * 2).to_le_bytes());
            wave.extend_from_slice(b"WAVEfmt ");
            wave.extend_from_slice(&[16, 0, 0, 0, 1, 0, 1, 0]);
            wave.extend_from_slice(&16000u32.to_le_bytes());
            wave.extend_from_slice(&32000u32.to_le_bytes());
            wave.extend_from_slice(&[2, 0, 16, 0]);
            wave.extend_from_slice(b"data");
            wave.extend_from_slice(&(samples * 2).to_le_bytes());
            wave.resize(wave.len() + samples as usize * 2, 0);
            std::fs::write(&out, wave).expect("the WAVE file");
            std::fs::write(marker(&out, ".text"), text).expect("the text");
            eprintln!("{}: 0.50 s of audio in 0.050 s, RTFx 10.0, time to first audio 0.020 s", out.display());
        }
        "asr" => {
            let file = PathBuf::from(args.last().cloned().unwrap_or_default());
            let mut text = std::fs::read_to_string(marker(&file, ".text")).unwrap_or_default();
            if stem.contains("garble") && device != "cpu" {
                text = text.chars().rev().collect();
            }
            eprintln!("Loaded Fake-ASR on {} in 0.10 s", loaded_on(&device));
            let answer = format!(r#"{{"file":{},"text":{},"stop":"end"}}"#, json_string(&file.display().to_string()), json_string(&text));
            println!("{answer}");
            eprintln!("{}: 0.50 s of audio in 0.040 s, RTFx 12.5", file.display());
        }
        _ => std::process::exit(2),
    }
    std::process::exit(0);
}

/// A JSON string of `text`.
fn json_string(text: &str) -> String {
    let mut quoted = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            c if (c as u32) < 0x20 => quoted.push_str(&format!("\\u{:04x}", c as u32)),
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if matches!(args.get(1).map(String::as_str), Some("info" | "tts" | "asr")) {
        command_line(&args);
    }
    if beside("no-loader") {
        eprintln!("speech: error while loading shared libraries: libvulkan.so.1: cannot open shared object file: No such file or directory");
        std::process::exit(127);
    }
    match args.get(1).map(String::as_str) {
        // `devices --json` answers only for a copy that plays a bundled build.
        Some("devices") if args.get(2).map(String::as_str) == Some("--json") && beside("bundle.json") => {
            let gpu = r#"{"name":"Vulkan0","description":"Fake GPU","kind":"gpu","memory_total":8000000000},"#;
            let gpu = if beside("cpu-only") { "" } else { gpu };
            println!(r#"{{"devices":[{gpu}{{"name":"CPU","description":"Fake CPU","kind":"cpu"}}]}}"#);
            return;
        }
        Some("devices") => {
            if !beside("cpu-only") {
                println!("Vulkan0    gpu   Fake GPU, 8.0 GB, 7.5 GB free");
            }
            println!("CPU        cpu   Fake CPU, 16.0 GB, 8.0 GB free");
            return;
        }
        Some("serve") => {}
        _ => std::process::exit(2),
    }
    let model = PathBuf::from(args.get(2).cloned().unwrap_or_default());
    let stem = model.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let _ = std::fs::write(marker(&model, ".started"), std::process::id().to_string());
    // Which copy ran (its folder's name) and with which `--device`.
    let folder = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.file_name()?.to_string_lossy().into_owned()));
    let device = args.iter().position(|arg| arg == "--device").and_then(|at| args.get(at + 1)).cloned().unwrap_or_default();
    let _ = std::fs::write(marker(&model, ".ran"), format!("{} {device}", folder.unwrap_or_default()));
    if stem.contains("crash") {
        std::process::exit(1);
    }
    if stem.contains("gate") {
        wait_for(&marker(&model, ".go"));
    }
    if stem.contains("die") {
        let trigger = marker(&model, ".die");
        std::thread::spawn(move || {
            wait_for(&trigger);
            std::process::exit(1);
        });
    }
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("address").port();
    eprintln!("    API at http://127.0.0.1:{port}/v1; Ctrl-C stops the server");
    let asr = stem.starts_with("asr");
    let slow = stem.contains("slow");
    for stream in listener.incoming().flatten() {
        let model = model.clone();
        std::thread::spawn(move || handle(stream, asr, &model, slow));
    }
}
