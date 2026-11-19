//! llama.cpp's server owned through a stand-in (`fake-llama`): real processes, ports and HTTP;
//! no model, GPU or translation.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use vrct_speech_server::llama::{codes, list_devices, Device, LlamaServer, Listed, Options};
use vrct_speech_server::server::State;

const FAKE: &str = env!("CARGO_BIN_EXE_fake-llama");

struct Folder(PathBuf);

impl Folder {
    fn new() -> Folder {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!("vrct-llama-server-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
        let path = std::env::temp_dir().join(name);
        std::fs::create_dir_all(&path).unwrap();
        Folder(path.canonicalize().unwrap())
    }

    fn gguf(&self, name: &str) -> PathBuf {
        let path = self.0.join(format!("{name}.gguf"));
        std::fs::write(&path, b"GGUF\x03\0\0\0").unwrap();
        path
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn options(model: PathBuf, device: Device) -> Options {
    Options { binary: FAKE.into(), model, device, api_key: "key-for-this-start".into(), environment: None, start_timeout: Duration::from_secs(10) }
}

type Ends = Arc<Mutex<Vec<Option<&'static str>>>>;

fn server(options: Options) -> (LlamaServer, Ends) {
    let ends: Ends = Arc::new(Mutex::new(Vec::new()));
    let kept = ends.clone();
    let server = LlamaServer::new(options, Some(Box::new(move |code| kept.lock().unwrap().push(code))));
    (server, ends)
}

/// One request to the server's base URL: its status and JSON body.
fn ask(base: &str, method: &str, path: &str, key: Option<&str>, body: Option<&str>) -> (u16, Value) {
    let address = base.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(address).unwrap();
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n");
    if let Some(key) = key {
        head += &format!("Authorization: Bearer {key}\r\n");
    }
    let body = body.unwrap_or("");
    head += &format!("Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    stream.write_all(head.as_bytes()).unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).unwrap();
    let (head, body) = answer.split_once("\r\n\r\n").unwrap();
    let status = head.split(' ').nth(1).unwrap().parse().unwrap();
    (status, serde_json::from_str(body).unwrap_or(Value::Null))
}

fn wait_until(what: impl Fn() -> bool) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !what() {
        assert!(std::time::Instant::now() < deadline, "timed out");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_server_starts_on_a_port_of_its_own_and_takes_only_its_key() {
    let folder = Folder::new();
    let (server, ends) = server(options(folder.gguf("ok"), Device::Cpu));
    server.start().unwrap();
    let base = server.wait_ready(Duration::from_secs(10)).unwrap();
    assert!(base.starts_with("http://127.0.0.1:") && !base.ends_with(":0"), "{base}");
    assert_eq!(server.health().state, State::Ready);
    assert_eq!(server.health().base_url.as_deref(), Some(base.as_str()));
    // /health answers anyone; the rest only this start's key, which is not on the command line.
    assert_eq!(ask(&base, "GET", "/health", None, None).0, 200);
    assert_eq!(ask(&base, "GET", "/props", None, None).0, 401);
    assert_eq!(ask(&base, "GET", "/props", Some("another"), None).0, 401);
    let (status, props) = ask(&base, "GET", "/props", Some("key-for-this-start"), None);
    assert_eq!(status, 200);
    let arguments: Vec<&str> = props["arguments"].as_array().unwrap().iter().map(|a| a.as_str().unwrap()).collect();
    let model = folder.0.join("ok.gguf");
    let expected = ["-m", model.to_str().unwrap(), "--host", "127.0.0.1", "--port", "0", "--no-webui", "--parallel", "1", "--ctx-size", "2048", "--device", "none", "--n-gpu-layers", "0"];
    assert_eq!(arguments, expected);
    assert!(!arguments.iter().any(|a| a.contains("key-for-this-start")));
    // Stopped by its owner: told once, with no code, and the port is closed.
    assert!(server.close(Duration::from_secs(5)));
    assert_eq!(server.health().state, State::Stopped);
    assert_eq!(*ends.lock().unwrap(), [None]);
    let address = base.strip_prefix("http://").unwrap();
    assert!(TcpStream::connect(address).is_err());
}

#[test]
fn a_gpu_is_named_and_takes_every_layer() {
    let folder = Folder::new();
    let (server, _) = server(options(folder.gguf("ok"), Device::Gpu("Vulkan1".into())));
    server.start().unwrap();
    let base = server.wait_ready(Duration::from_secs(10)).unwrap();
    let props = ask(&base, "GET", "/props", Some("key-for-this-start"), None).1;
    let arguments: Vec<&str> = props["arguments"].as_array().unwrap().iter().map(|a| a.as_str().unwrap()).collect();
    assert_eq!(&arguments[arguments.len() - 4..], ["--device", "Vulkan1", "--n-gpu-layers", "999"]);
    assert_eq!(server.device(), &Device::Gpu("Vulkan1".into()));
    assert!(server.close(Duration::from_secs(5)));
}

#[test]
fn a_server_still_loading_its_model_is_waited_for() {
    let folder = Folder::new();
    let (server, _) = server(options(folder.gguf("loading"), Device::Cpu));
    server.start().unwrap();
    let base = server.wait_ready(Duration::from_secs(10)).unwrap();
    assert_eq!(ask(&base, "GET", "/health", None, None).0, 200);
    assert!(server.close(Duration::from_secs(5)));
}

#[test]
fn a_failed_start_is_one_fixed_code_told_once() {
    let folder = Folder::new();
    for (mode, code) in [("bad_model", codes::MODEL_INVALID), ("oom", codes::OUT_OF_MEMORY), ("crash", codes::EXITED)] {
        let (failed, ends) = server(options(folder.gguf(mode), Device::Cpu));
        failed.start().unwrap();
        assert_eq!(failed.wait_ready(Duration::from_secs(10)), Err(code), "{mode}");
        wait_until(|| ends.lock().unwrap().len() == 1);
        assert_eq!(failed.health().state, State::Failed);
        assert_eq!(failed.health().error_code, Some(code));
        assert_eq!(*ends.lock().unwrap(), [Some(code)], "{mode}");
        assert!(failed.close(Duration::from_secs(5)));
    }
    // A missing executable.
    let mut missing = options(folder.gguf("ok"), Device::Cpu);
    missing.binary = folder.0.join("no-llama-server");
    let (unlaunched, ends) = server(missing);
    unlaunched.start().unwrap();
    assert_eq!(unlaunched.wait_ready(Duration::from_secs(5)), Err(codes::LAUNCH_FAILED));
    wait_until(|| ends.lock().unwrap().len() == 1);
    assert_eq!(unlaunched.start(), Err(codes::SINGLE_USE));
}

#[test]
fn a_server_that_never_listens_times_out_and_is_ended() {
    let folder = Folder::new();
    let mut slow = options(folder.gguf("wait"), Device::Cpu);
    slow.start_timeout = Duration::from_millis(800);
    let (timed_out, ends) = server(slow);
    timed_out.start().unwrap();
    assert_eq!(timed_out.wait_ready(Duration::from_secs(10)), Err(codes::START_TIMEOUT));
    wait_until(|| ends.lock().unwrap().len() == 1);
    assert_eq!(*ends.lock().unwrap(), [Some(codes::START_TIMEOUT)]);
    // Stopped while still loading: no failure.
    let (stopped, ends) = server(options(folder.gguf("wait"), Device::Cpu));
    stopped.start().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert!(stopped.close(Duration::from_secs(5)));
    assert_eq!(*ends.lock().unwrap(), [None]);
    assert_eq!(stopped.wait_ready(Duration::from_millis(10)), Err(codes::EXITED));
}

#[test]
fn a_server_that_dies_after_it_was_ready_is_reported() {
    let folder = Folder::new();
    let (server, ends) = server(options(folder.gguf("die"), Device::Cpu));
    server.start().unwrap();
    let base = server.wait_ready(Duration::from_secs(10)).unwrap();
    let prompt = r#"{"prompt":"x\n\n\nhello<end_of_turn>\n<start_of_turn>model\n"}"#;
    let (status, answer) = ask(&base, "POST", "/completion", Some("key-for-this-start"), Some(prompt));
    assert_eq!((status, answer["content"].as_str()), (200, Some("HELLO")));
    wait_until(|| ends.lock().unwrap().len() == 1);
    assert_eq!(*ends.lock().unwrap(), [Some(codes::EXITED)]);
    let health = server.health();
    assert_eq!((health.state, health.base_url, health.error_code), (State::Failed, None, Some(codes::EXITED)));
}

#[test]
fn the_devices_are_those_the_server_lists() {
    let folder = Folder::new();
    let copy = folder.0.join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" });
    std::fs::copy(FAKE, &copy).unwrap();
    // A build without Vulkan lists none.
    assert_eq!(list_devices(&copy, &None), Some(Vec::new()));
    std::fs::write(folder.0.join("devices.txt"), "  Vulkan0: Intel(R) Iris(R) Xe Graphics (16296 MiB, 15527 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 3060 Ti (8238 MiB, 7460 MiB free)\n").unwrap();
    assert_eq!(
        list_devices(&copy, &None),
        Some(vec![Listed { name: "Vulkan0".into(), description: "Intel(R) Iris(R) Xe Graphics".into() }, Listed { name: "Vulkan1".into(), description: "NVIDIA GeForce RTX 3060 Ti".into() }])
    );
    assert_eq!(list_devices(&folder.0.join("missing"), &None), None);
}
