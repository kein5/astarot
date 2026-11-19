//! Stands in for llama.cpp's `llama-server` in the tests: `fake-llama -m MODEL ...`.
//! The stem of MODEL's file name picks what it does. No model, GPU or translation.
//!
//! - `--list-devices`: the GPUs of `devices.txt` beside this executable, as llama.cpp prints them.
//! - `ok`: listens on 127.0.0.1 port 0, says so as llama.cpp does, answers `/health` and, with
//!   the key of `LLAMA_API_KEY`, `/completion` (the prompt's last line in upper case, so a
//!   test sees what was sent without a model). `/props` answers the arguments it was given.
//! - `loading`: `/health` answers 503 twice before it is ready.
//! - `bad_model`, `oom`: llama.cpp's failure lines, then exit 1. `crash`: exit 1 at once.
//! - `wait`: never listens. `die`: ends after its first `/completion`.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
    let mut request = Vec::new();
    let mut block = [0u8; 65536];
    let (head_end, length) = loop {
        let read = stream.read(&mut block).ok()?;
        if read == 0 {
            return None;
        }
        request.extend_from_slice(&block[..read]);
        if let Some(end) = request.windows(4).position(|four| four == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
            let length = head.lines().find_map(|line| line.strip_prefix("content-length:")).and_then(|value| value.trim().parse::<usize>().ok()).unwrap_or(0);
            break (end, length);
        }
    };
    while request.len() < head_end + 4 + length {
        let read = stream.read(&mut block).ok()?;
        if read == 0 {
            return None;
        }
        request.extend_from_slice(&block[..read]);
    }
    let head = String::from_utf8_lossy(&request[..head_end]).into_owned();
    let line = head.lines().next().unwrap_or("").to_owned();
    Some((line, head, request[head_end + 4..].to_vec()))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--list-devices") {
        let beside = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("devices.txt")));
        println!("Available devices:");
        if let Some(text) = beside.and_then(|path| std::fs::read_to_string(path).ok()) {
            print!("{text}");
        }
        return;
    }
    let model = args.iter().position(|arg| arg == "-m").and_then(|at| args.get(at + 1)).cloned().unwrap_or_default();
    let mode = Path::new(&model).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    eprintln!("0.00.000.100 I srv  llama_server: initializing ...");
    eprintln!("0.00.000.200 I srv    load_model: loading model '{model}'");
    match mode.as_str() {
        "crash" => std::process::exit(1),
        "bad_model" => {
            eprintln!("0.00.000.300 E llama_model_load: error loading model: llama_model_loader: failed to load model from {model}");
            std::process::exit(1);
        }
        "oom" => {
            eprintln!("\x1b[31m0.00.000.300 E ggml_vulkan: Device memory allocation of size 3000000000 failed: ErrorOutOfDeviceMemory\x1b[0m");
            std::process::exit(1);
        }
        "wait" => {
            std::thread::sleep(Duration::from_secs(60));
            return;
        }
        _ => {}
    }
    let key = std::env::var("LLAMA_API_KEY").unwrap_or_default();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("address").port();
    eprintln!("0.00.000.400 I srv  server_on_li: listening on http://127.0.0.1:{port}");
    let loading = Arc::new(AtomicUsize::new(if mode == "loading" { 2 } else { 0 }));
    let arguments = serde_json::to_string(&args[1..]).unwrap();
    for stream in listener.incoming().flatten() {
        let (loading, key, mode, arguments) = (loading.clone(), key.clone(), mode.clone(), arguments.clone());
        std::thread::spawn(move || {
            let mut stream = stream;
            let Some((line, head, body)) = read_request(&mut stream) else { return };
            if line.starts_with("GET /health ") {
                if loading.load(Ordering::SeqCst) > 0 {
                    loading.fetch_sub(1, Ordering::SeqCst);
                    return respond(&mut stream, "503 Service Unavailable", r#"{"error":{"code":503,"message":"Loading model","type":"unavailable_error"}}"#);
                }
                return respond(&mut stream, "200 OK", r#"{"status":"ok"}"#);
            }
            let authorized = head.lines().any(|line| line.to_ascii_lowercase().starts_with("authorization:") && line.split_once(':').map(|(_, value)| value.trim()) == Some(format!("Bearer {key}").as_str()));
            if !authorized || key.is_empty() {
                return respond(&mut stream, "401 Unauthorized", r#"{"error":{"code":401,"message":"Invalid API Key","type":"authentication_error"}}"#);
            }
            if line.starts_with("GET /props ") {
                return respond(&mut stream, "200 OK", &format!(r#"{{"arguments":{arguments}}}"#));
            }
            if line.starts_with("POST /completion ") {
                let request: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
                let prompt = request["prompt"].as_str().unwrap_or_default();
                let text = prompt.trim_end_matches("<end_of_turn>\n<start_of_turn>model\n").rsplit("\n\n\n").next().unwrap_or_default().to_uppercase();
                let answer = serde_json::json!({ "content": text, "stop": true, "stop_type": "eos", "request": request });
                respond(&mut stream, "200 OK", &answer.to_string());
                if mode == "die" {
                    // The answer reaches the client before the process goes.
                    let _ = stream.shutdown(std::net::Shutdown::Write);
                    std::thread::sleep(Duration::from_millis(300));
                    std::process::exit(3);
                }
                return;
            }
            respond(&mut stream, "404 Not Found", r#"{"error":{"code":404}}"#);
        });
    }
}
