//! Stands in for the speech.cpp executable in tests/speech_servers.rs. No model, GPU or audio.
//!
//! `fake-speech-core devices` lists one GPU. `fake-speech-core serve MODEL ...` serves the
//! readiness the owner checks; the stem of MODEL's file name picks what it does:
//!
//! - `asr...` serves recognition and detection, anything else synthesis (`/v1/audio/speech`
//!   answers 0.2 s of a tone as 24 kHz PCM);
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

fn handle(mut stream: TcpStream, asr: bool) {
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
        let pcm: Vec<u8> = (0..4800).flat_map(|i: i32| (((i % 60) - 30) as i16 * 200).to_le_bytes()).collect();
        let head = format!("HTTP/1.1 200 OK\r\nContent-Type: audio/pcm\r\nX-Sample-Rate: 24000\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", pcm.len());
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(&pcm);
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
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
    for stream in listener.incoming().flatten() {
        std::thread::spawn(move || handle(stream, asr));
    }
}
