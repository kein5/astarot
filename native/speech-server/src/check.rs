//! One run of the bundled speech.cpp command line (`speech info`, `speech tts`, `speech asr`)
//! for the GPU check of the app (#288), and what can be read from it without its text.
//!
//! speech.cpp prints its timings on stderr, one line per step:
//!
//! - `Loaded <model> on <device> in <seconds> s`
//! - `<file>: <seconds> s of audio [from <n> requests ]in <seconds> s, RTFx <x>[, time to first audio <seconds> s]`
//! - `speech: <code> (<option>): <message>` on a failure
//!
//! Only the numbers, the device name and the failure code are read. The lines also name files
//! (which may hold the user's name) and messages, so nothing here returns or logs a line.

use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::devices::{command, Environment};

const STDOUT_LIMIT: u64 = 1024 * 1024;
const STDERR_LIMIT: u64 = 256 * 1024;

/// How a run ended.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    /// The exit code, None when it was stopped (time-out or cancel) or killed by a signal.
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    /// Read only through the parsers below.
    stderr: String,
    /// The wall-clock time of the whole process, the model's loading included.
    pub seconds: f64,
    pub timed_out: bool,
    pub cancelled: bool,
}

impl Run {
    pub fn succeeded(&self) -> bool {
        self.code == Some(0)
    }

    /// What speech.cpp says it loaded the model on, and how long that took.
    pub fn loaded(&self) -> Option<Loaded> {
        self.stderr.lines().find_map(parse_loaded)
    }

    /// The timing line of the first file or text.
    pub fn timing(&self) -> Option<Timing> {
        self.stderr.lines().find_map(parse_timing)
    }

    /// The failure code speech.cpp printed (`speech: <code> ...`), when it printed one.
    pub fn failure(&self) -> Option<String> {
        self.stderr.lines().find_map(parse_failure)
    }
}

/// Runs `binary` with `args` until it ends, `timeout` passes or `cancel` is set. stdout is kept
/// (up to 1 MiB), stderr is kept for the parsers (up to 256 KiB).
pub fn run(binary: &Path, environment: &Environment, args: &[OsString], timeout: Duration, cancel: &AtomicBool) -> std::io::Result<Run> {
    let mut command = command(binary, environment);
    command.args(args).env("SPEECH_NO_UPDATE_CHECK", "1").stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().map(|stream| {
        std::thread::spawn(move || {
            let mut data = Vec::new();
            let _ = stream.take(STDOUT_LIMIT).read_to_end(&mut data);
            data
        })
    });
    let stderr = child.stderr.take().map(|stream| {
        std::thread::spawn(move || {
            let mut data = Vec::new();
            let _ = stream.take(STDERR_LIMIT).read_to_end(&mut data);
            data
        })
    });
    let deadline = started + timeout;
    let (mut timed_out, mut cancelled) = (false, false);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                timed_out = Instant::now() >= deadline;
                cancelled = cancel.load(Ordering::SeqCst);
                if timed_out || cancelled {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let seconds = started.elapsed().as_secs_f64();
    let stdout = stdout.and_then(|reader| reader.join().ok()).unwrap_or_default();
    let stderr = stderr.and_then(|reader| reader.join().ok()).unwrap_or_default();
    Ok(Run {
        code: status.and_then(|status| status.code()),
        stdout,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        seconds,
        timed_out,
        cancelled,
    })
}

/// `speech info MODEL --json`: what the model file says it is (its task, languages, voices).
pub fn info(binary: &Path, environment: &Environment, model: &Path, cancel: &AtomicBool) -> Option<Value> {
    let args = [OsString::from("info"), model.as_os_str().to_owned(), OsString::from("--json")];
    let run = run(binary, environment, &args, Duration::from_secs(60), cancel).ok()?;
    if !run.succeeded() {
        return None;
    }
    serde_json::from_slice(&run.stdout).ok().filter(Value::is_object)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Loaded {
    /// The device speech.cpp named: `CPU`, `Vulkan0`, ...
    pub device: String,
    pub seconds: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Timing {
    /// Seconds of audio spoken or heard.
    pub audio_seconds: f64,
    /// Seconds the speaking or the recognition took, the loading not included.
    pub seconds: f64,
    pub rtfx: Option<f64>,
    /// Speaking only: seconds to the first audio.
    pub first_audio_seconds: Option<f64>,
}

fn number(text: &str) -> Option<f64> {
    let value: f64 = text.trim().parse().ok()?;
    value.is_finite().then_some(value).filter(|value| *value >= 0.0)
}

/// `Loaded <model> on <device> in <seconds> s`
fn parse_loaded(line: &str) -> Option<Loaded> {
    let rest = line.trim().strip_prefix("Loaded ")?.strip_suffix(" s")?;
    let (head, seconds) = rest.rsplit_once(" in ")?;
    let (_, device) = head.rsplit_once(" on ")?;
    let device = device.trim();
    let plain = !device.is_empty() && device.len() <= 32 && device.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !plain {
        return None;
    }
    Some(Loaded { device: device.to_owned(), seconds: number(seconds)? })
}

/// `<file>: <a> s of audio [from <n> requests ]in <t> s, RTFx <x>[, time to first audio <f> s]`
fn parse_timing(line: &str) -> Option<Timing> {
    const AUDIO: &str = " s of audio ";
    let at = line.find(AUDIO)?;
    let audio_seconds = number(line[..at].rsplit(' ').next()?)?;
    let rest = &line[at + AUDIO.len()..];
    let after_in = &rest[rest.find("in ")? + 3..];
    let seconds = number(after_in.split(" s").next()?)?;
    let field = |name: &str| rest.find(name).and_then(|at| number(rest[at + name.len()..].split([',', ' ']).next()?));
    Some(Timing { audio_seconds, seconds, rtfx: field("RTFx "), first_audio_seconds: field("time to first audio ") })
}

/// `speech: <code> (<option>): <message>` or `speech: <code>: <message>`: the code alone.
fn parse_failure(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("speech: ")?;
    let code: String = rest.chars().take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_').collect();
    // A code is followed by its option in parentheses or by a colon; the dynamic loader's own
    // "speech: error while loading ..." is not a code.
    let after = &rest[code.len()..];
    let ends = after.starts_with(" (") || after.starts_with(':');
    (!code.is_empty() && code.len() <= 64 && ends && code.as_bytes()[0].is_ascii_lowercase()).then_some(code)
}

/// The characters a comparison counts: letters and digits, lower case; spaces and punctuation
/// are not counted, so "Hello, world." and "hello world" are the same.
fn comparable(text: &str) -> Vec<char> {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The character error rate of `hypothesis` against `reference`: the edits (insertions,
/// deletions, substitutions) over the reference's length, after [`comparable`]. 0 is the same
/// text. An empty reference gives 0 for an empty hypothesis and 1 otherwise.
pub fn char_error_rate(reference: &str, hypothesis: &str) -> f64 {
    let (reference, hypothesis) = (comparable(reference), comparable(hypothesis));
    if reference.is_empty() {
        return if hypothesis.is_empty() { 0.0 } else { 1.0 };
    }
    let mut previous: Vec<usize> = (0..=hypothesis.len()).collect();
    for (i, r) in reference.iter().enumerate() {
        let mut current = vec![i + 1; hypothesis.len() + 1];
        for (j, h) in hypothesis.iter().enumerate() {
            let substitution = previous[j] + usize::from(r != h);
            current[j + 1] = substitution.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        previous = current;
    }
    previous[hypothesis.len()] as f64 / reference.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(stderr: &str) -> Run {
        Run { code: Some(0), stdout: Vec::new(), stderr: stderr.into(), seconds: 1.0, timed_out: false, cancelled: false }
    }

    #[test]
    fn the_lines_speech_cpp_0_11_prints_are_read() {
        // As printed by speech.cpp 0.11.0 on Windows (the folder shortened).
        let tts = with(concat!(
            "Loaded Irodori-TTS-v4.1-Small-MF on Vulkan1 in 3.85 s\n",
            "C:\\Users\\someone\\AppData\\Local\\Temp\\x\\tts-Vulkan1.wav: 9.01 s of audio from 2 requests in 0.649 s, RTFx 13.9, time to first audio 0.247 s\n",
        ));
        assert_eq!(tts.loaded(), Some(Loaded { device: "Vulkan1".into(), seconds: 3.85 }));
        assert_eq!(tts.timing(), Some(Timing { audio_seconds: 9.01, seconds: 0.649, rtfx: Some(13.9), first_audio_seconds: Some(0.247) }));
        let asr = with("Loaded Qwen3-ASR-0.6B on CPU in 2.11 s\nC:\\Temp\\a b: c\\tts.wav: 9.01 s of audio in 9.369 s, RTFx 1.0\n");
        assert_eq!(asr.loaded(), Some(Loaded { device: "CPU".into(), seconds: 2.11 }));
        assert_eq!(asr.timing(), Some(Timing { audio_seconds: 9.01, seconds: 9.369, rtfx: Some(1.0), first_audio_seconds: None }));
        // One request: no count.
        let one = with("x.wav: 2.50 s of audio in 0.200 s, RTFx 12.5, time to first audio 0.100 s");
        assert_eq!(one.timing().map(|t| (t.audio_seconds, t.seconds, t.first_audio_seconds)), Some((2.5, 0.2, Some(0.1))));
    }

    #[test]
    fn a_failure_gives_its_code_only() {
        let failed = with("Loaded M on Vulkan0 in 1.0 s\nspeech: out_of_memory (device): vk::Device::allocateMemory: ErrorOutOfDeviceMemory\n");
        assert_eq!(failed.failure().as_deref(), Some("out_of_memory"));
        assert_eq!(with("speech: model_invalid: C:\\Users\\someone\\m.gguf is not a model").failure().as_deref(), Some("model_invalid"));
        assert_eq!(with("speech: error while loading shared libraries: libvulkan.so.1").failure(), None);
        assert_eq!(with("nothing here").failure(), None);
        assert_eq!(with("speech: Out").failure(), None);
    }

    #[test]
    fn odd_lines_are_not_read() {
        assert_eq!(parse_loaded("Loaded model on Vulkan 1; rm -rf in 3 s"), None);
        assert_eq!(parse_loaded("Loaded M on CPU in NaN s"), None);
        assert_eq!(parse_loaded("Loaded M on CPU in -1 s"), None);
        assert_eq!(parse_timing("file: lots s of audio in 1 s"), None);
        assert_eq!(parse_timing("no timing here"), None);
    }

    #[test]
    fn the_error_rate_counts_letters_and_digits() {
        assert_eq!(char_error_rate("今日はいい天気ですね。", "今日はいい天気ですね"), 0.0);
        assert_eq!(char_error_rate("Hello, world.", "hello world"), 0.0);
        assert!((char_error_rate("abcd", "abxd") - 0.25).abs() < 1e-9);
        assert!((char_error_rate("abcd", "") - 1.0).abs() < 1e-9);
        assert!((char_error_rate("ab", "abab") - 1.0).abs() < 1e-9);
        assert_eq!(char_error_rate("", ""), 0.0);
        assert_eq!(char_error_rate("...", "x"), 1.0);
    }

    #[test]
    fn a_run_is_stopped_at_its_time_out_or_when_cancelled() {
        // The test binary itself, asked for a test that does not exist, ends at once.
        let me = std::env::current_exe().unwrap();
        let cancel = AtomicBool::new(false);
        let ended = run(&me, &None, &[OsString::from("--list"), OsString::from("--format=terse")], Duration::from_secs(60), &cancel).unwrap();
        assert!(ended.succeeded() && !ended.timed_out && !ended.cancelled);
        let cancel = AtomicBool::new(true);
        let stopped = run(&me, &None, &[OsString::from("--exact"), OsString::from("check::tests::sleeps"), OsString::from("--ignored")], Duration::from_secs(60), &cancel).unwrap();
        assert!(stopped.cancelled && stopped.code.is_none(), "{stopped:?}");
        let cancel = AtomicBool::new(false);
        let late = run(&me, &None, &[OsString::from("--exact"), OsString::from("check::tests::sleeps"), OsString::from("--ignored")], Duration::from_millis(300), &cancel).unwrap();
        assert!(late.timed_out && late.code.is_none(), "{late:?}");
    }

    #[test]
    #[ignore = "run by a_run_is_stopped_at_its_time_out_or_when_cancelled"]
    fn sleeps() {
        std::thread::sleep(Duration::from_secs(30));
    }
}
