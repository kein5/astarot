//! A stand-in for the `vrct-asr-capture` helper, for `tests/helper_capture.rs` (decision 82 of
//! `docs/voice-stack/core-integration.md`; Python's `test_capture_diagnostics.py`). It takes the
//! helper's arguments and does what the endpoint's name (the fifth) asks: no PipeWire, no device.
//!
//! - `noisy:<code>` or `noisy:none`: a long line of noise that ends like a code, then the code
//!   written in two parts, then the end. `noisy-wait:<code>` stays a second after the code.
//! - `silent`: nothing, for 30 s.
//! - `idle` / `partial`: one packet, then nothing (or 31 bytes of a header, slowly).
//! - `stream`: a silent packet every 20 ms.
//! - `aged:<ms>`: a packet every 20 ms stamped `<ms>` before it is written.
//! - `closed`: one packet, then the end.
//! - `fails:<code>`: one packet, then the code.

#[cfg(target_os = "linux")]
fn main() {
    use std::io::Write;
    use std::time::Duration;

    fn monotonic_ns() -> u64 {
        let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
        now.tv_sec as u64 * 1_000_000_000 + now.tv_nsec as u64
    }

    let behaviour = std::env::args().nth(5).unwrap_or_default();
    let mut sequence = 0u32;
    let mut packet = |age_ns: u64| {
        let cycle = monotonic_ns();
        let mut out = b"VCA1".to_vec();
        out.extend(sequence.to_le_bytes());
        out.extend(cycle.to_le_bytes());
        out.extend((cycle - age_ns).to_le_bytes());
        out.extend(48000u32.to_le_bytes());
        out.extend(960u32.to_le_bytes());
        out.extend(vec![0u8; 1920]);
        sequence += 1;
        out
    };
    let (mut stdout, mut stderr) = (std::io::stdout(), std::io::stderr());
    let sleep = |ms: u64| std::thread::sleep(Duration::from_millis(ms));
    let (kind, value) = behaviour.split_once(':').unwrap_or((behaviour.as_str(), ""));
    match kind {
        "noisy" | "noisy-wait" => {
            // The long line ends like a code; only whole short lines count.
            let _ = stderr.write_all(&[b"private".repeat(12000), b"asr_capture_stalled\n".to_vec()].concat());
            if value != "none" {
                let _ = stderr.write_all(b"asr_capture_");
                let _ = stderr.flush();
                sleep(10);
                let _ = stderr.write_all(format!("{value}\n").as_bytes());
            }
            if kind == "noisy-wait" {
                sleep(1000);
            }
        }
        "silent" => sleep(30_000),
        "idle" | "partial" => {
            let _ = stdout.write_all(&packet(20_000_000));
            let _ = stdout.flush();
            if kind == "partial" {
                for byte in &packet(20_000_000)[..31] {
                    sleep(100);
                    let _ = stdout.write_all(&[*byte]);
                    let _ = stdout.flush();
                }
            }
            sleep(30_000);
        }
        "stream" | "aged" => {
            let age_ns = value.parse::<u64>().unwrap_or(20) * 1_000_000;
            for _ in 0..1500 {
                if stdout.write_all(&packet(age_ns)).and_then(|_| stdout.flush()).is_err() {
                    return;
                }
                sleep(20);
            }
        }
        "closed" | "fails" => {
            let _ = stdout.write_all(&packet(20_000_000));
            let _ = stdout.flush();
            sleep(200);
            if kind == "fails" {
                let _ = stderr.write_all(format!("{value}\n").as_bytes());
                let _ = stderr.flush();
                sleep(30_000);
            }
        }
        _ => {}
    }
}

#[cfg(not(target_os = "linux"))]
fn main() {}
