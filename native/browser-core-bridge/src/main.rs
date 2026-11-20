//! Runs the backend core for the screens in a browser (the integration tests, ADR-017).
//!
//! vrct-browser-core-bridge --state <settings folder> [--port <port>]
//!
//! It listens on 127.0.0.1 and prints `ws://127.0.0.1:<port>` once ready. Over the WebSocket the
//! page's stand-in for Tauri's IPC sends what the app's `backend_start`, `backend_write` and
//! `backend_kill` commands carry (`src-tauri/src/backend_host.rs`), as JSON text frames:
//!
//! - `{"op": "start"}`: a new run of the core on the settings folder, answered `{"op": "started"}`.
//!   A run that is still going is stopped first, its settings saved.
//! - `{"op": "write", "line": "..."}`: one request line.
//! - `{"op": "kill"}`: the run ends.
//!
//! The core answers with `{"op": "line", "line": "..."}` and, when the run ends,
//! `{"op": "exit", "code": n}`. When the page goes away, or standard input closes, the run is
//! stopped and its settings saved, as the app does when it quits.

mod services;

use serde_json::{Value, json};
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tungstenite::protocol::Role;
use tungstenite::{Message, WebSocket};
use vrct_core::config::{Environment, Platform};
use vrct_core::{Backend, Options, Sink};

/// How long a stopping run may take to save its settings.
const STOP_LIMIT: Duration = Duration::from_secs(15);

struct Args {
    state: PathBuf,
    port: u16,
}

fn args() -> Args {
    let mut state = None;
    let mut port = 0;
    let mut list = std::env::args().skip(1);
    while let Some(flag) = list.next() {
        let value = list.next().unwrap_or_else(|| usage(&format!("{flag} needs a value")));
        match flag.as_str() {
            "--state" => state = Some(PathBuf::from(value)),
            "--port" => port = value.parse().unwrap_or_else(|_| usage("--port needs a number")),
            _ => usage(&format!("unknown argument {flag}")),
        }
    }
    Args { state: state.unwrap_or_else(|| usage("--state is required")), port }
}

fn usage(problem: &str) -> ! {
    eprintln!("{problem}\nusage: vrct-browser-core-bridge --state <settings folder> [--port <port>]");
    std::process::exit(2);
}

/// The folders of a run, all inside the test's settings folder.
fn environment(state: &PathBuf) -> Environment {
    Environment {
        version: "0.0.0".into(),
        state_dir: state.clone(),
        app_dir: state.join("app"),
        data_dir: state.join("data"),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: None,
    }
}

/// The run of the core, shared by the connections one after another.
type Current = Arc<Mutex<Option<Backend>>>;

fn stop(current: &Current) {
    if let Some(backend) = current.lock().unwrap().take() {
        backend.kill_and_wait(STOP_LIMIT);
    }
}

fn start(state: &PathBuf, current: &Current, to_page: Sender<Value>) {
    stop(current);
    let lines = to_page.clone();
    let sink = Sink {
        line: Arc::new(move |line| {
            let _ = lines.send(json!({"op": "line", "line": line}));
        }),
        exit: Arc::new(move |code| {
            let _ = to_page.send(json!({"op": "exit", "code": code}));
        }),
    };
    let mut options = Options::new(environment(state));
    options.services = services::stand_ins();
    *current.lock().unwrap() = Some(Backend::start(options, sink));
}

/// One page: its frames in, the core's lines out, until it goes away.
fn serve(stream: TcpStream, state: &PathBuf, current: &Current) {
    let writer_stream = match stream.try_clone() {
        Ok(stream) => stream,
        Err(_) => return,
    };
    let mut reader = match tungstenite::accept(stream) {
        Ok(socket) => socket,
        Err(_) => return,
    };
    let (to_page, outgoing) = channel::<Value>();
    let writer = std::thread::spawn(move || {
        let mut socket = WebSocket::from_raw_socket(writer_stream, Role::Server, None);
        for message in outgoing {
            if socket.send(Message::text(message.to_string())).is_err() {
                break;
            }
        }
    });
    while let Ok(message) = reader.read() {
        let Message::Text(text) = message else {
            if matches!(message, Message::Close(_)) {
                break;
            }
            continue;
        };
        let Ok(request) = serde_json::from_str::<Value>(text.as_str()) else { continue };
        match request["op"].as_str() {
            Some("start") => {
                start(state, current, to_page.clone());
                let _ = to_page.send(json!({"op": "started"}));
            }
            Some("write") => {
                if let (Some(line), Some(backend)) = (request["line"].as_str(), current.lock().unwrap().as_ref()) {
                    backend.write_line(line);
                }
            }
            Some("kill") => {
                if let Some(backend) = current.lock().unwrap().as_ref() {
                    backend.kill();
                }
            }
            _ => {}
        }
    }
    // The page went away: the run stops and saves its settings, as when the app quits.
    stop(current);
    drop(to_page);
    let _ = writer.join();
}

fn main() {
    let Args { state, port } = args();
    std::fs::create_dir_all(&state).unwrap_or_else(|error| usage(&format!("cannot make {}: {error}", state.display())));
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap_or_else(|error| usage(&format!("cannot listen: {error}")));
    let current: Current = Arc::new(Mutex::new(None));
    // Standard input closing is the test's request to stop: the run saves its settings first.
    let stopping = Arc::clone(&current);
    std::thread::spawn(move || {
        let _ = std::io::stdin().read_to_end(&mut Vec::new());
        stop(&stopping);
        std::process::exit(0);
    });
    println!("ws://{}", listener.local_addr().expect("a listening address"));
    for stream in listener.incoming().flatten() {
        serve(stream, &state, &current);
    }
}
