//! Stands in for `speech devices --json` in the hardware tests. What it does depends on its
//! own file name (the tests copy it under several names), so tests running at once never share
//! an environment variable:
//!
//! - `*-ok`: prints two devices after 100 ms;
//! - `*-sleep`: sleeps 30 s;
//! - `*-invalid`: prints text that is not JSON;
//! - `*-fail`: exits with 1;
//! - `*-stubborn`: ignores SIGTERM, writes `<exe>.ready`, then sleeps 30 s.

use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(args, ["devices", "--json"]);
    assert_eq!(std::env::var("SPEECH_NO_UPDATE_CHECK").as_deref(), Ok("1"));
    let exe = std::env::current_exe().unwrap();
    let name = exe.file_stem().unwrap().to_string_lossy().into_owned();
    match name.rsplit('-').next().unwrap() {
        "ok" => {
            std::thread::sleep(Duration::from_millis(100));
            const DEVICES: &str = r#"{"devices": [{"name": "CPU", "description": "host CPU", "kind": "cpu", "memory_total": 0, "memory_free": 0}, {"name": "Vulkan0", "description": "test GPU", "kind": "gpu", "memory_total": 8589934592, "memory_free": 3221225472}]}"#;
            println!("{DEVICES}");
        }
        "invalid" => println!("not json"),
        "fail" => std::process::exit(1),
        "stubborn" => {
            #[cfg(unix)]
            unsafe {
                libc::signal(libc::SIGTERM, libc::SIG_IGN);
            }
            std::fs::write(exe.with_extension("ready"), "ready").unwrap();
            std::thread::sleep(Duration::from_secs(30));
        }
        _ => std::thread::sleep(Duration::from_secs(30)),
    }
}
