//! How much GPU memory (VRAM) each GPU and this app use now, for the flow panel (#448).
//!
//! Read only when the panel asks ([`crate::controller`]'s `/get/data/gpu_memory`), never on a
//! timer of its own. The app's share is summed over this process and the processes it
//! started, split by what they do: speech.cpp (recognition and speech), the RVC worker (voice
//! conversion) and everything else (this process with its local translation and chat reading,
//! and the WebView). Only numbers and the GPUs' names are read; no file, window or user name.
//!
//! - Windows: the adapters and their dedicated memory from DXGI, the usage from the
//!   performance counters `GPU Adapter Memory` and `GPU Process Memory` (`Dedicated Usage`).
//! - Linux: NVIDIA through `nvidia-smi`; other GPUs that report VRAM through the DRM driver
//!   (`mem_info_vram_*` in sysfs, and `drm-memory-vram` in each process's fdinfo).

use serde::Serialize;
use std::collections::HashMap;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

pub mod parse;

/// What a process of the app does, as far as its memory is told apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Part {
    /// speech.cpp: speech recognition and speech synthesis.
    Speech,
    /// The RVC worker: voice conversion.
    Conversion,
    /// This process (local translation, chat reading) and the WebView.
    Other,
}

/// The app's share of one GPU's memory, in bytes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct AppUsage {
    pub speech: u64,
    pub conversion: u64,
    pub other: u64,
}

impl AppUsage {
    pub fn add(&mut self, part: Part, bytes: u64) {
        let slot = match part {
            Part::Speech => &mut self.speech,
            Part::Conversion => &mut self.conversion,
            Part::Other => &mut self.other,
        };
        *slot = slot.saturating_add(bytes);
    }

    pub fn total(&self) -> u64 {
        self.speech.saturating_add(self.conversion).saturating_add(self.other)
    }
}

/// One GPU. `total` and `used` are the whole GPU's dedicated memory, `None` when the driver
/// does not tell; `app` is this app's part of `used`. `app_shared` is the system memory the
/// app's processes use through this GPU (Windows only, else `None`): an integrated GPU has
/// little or no memory of its own and works there instead.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Gpu {
    pub name: String,
    pub total: Option<u64>,
    pub used: Option<u64>,
    pub app: AppUsage,
    pub app_shared: Option<u64>,
}

/// Reads every GPU once. `Err` carries a fixed code: `gpu_memory_unsupported` where nothing
/// can be read on this OS, `gpu_memory_failed` when the reading failed.
pub type Reader = std::sync::Arc<dyn Fn() -> Result<Vec<Gpu>, &'static str> + Send + Sync>;

pub const UNSUPPORTED: &str = "gpu_memory_unsupported";
pub const FAILED: &str = "gpu_memory_failed";

/// The reader for this OS.
pub fn native_reader() -> Reader {
    std::sync::Arc::new(|| read_from(std::process::id()))
}

/// Reads the GPUs, counting `root` and the processes below it as the app.
#[cfg(windows)]
fn read_from(root: u32) -> Result<Vec<Gpu>, &'static str> {
    windows::read(root)
}

#[cfg(target_os = "linux")]
fn read_from(root: u32) -> Result<Vec<Gpu>, &'static str> {
    linux::read(root)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn read_from(_root: u32) -> Result<Vec<Gpu>, &'static str> {
    Err(UNSUPPORTED)
}

/// What a process does, from its executable's name (`speech.exe`, `vrct-rvc-worker`).
pub fn part_of(executable: &str) -> Part {
    let name = executable.rsplit(['/', '\\']).next().unwrap_or(executable).to_ascii_lowercase();
    let stem = name.strip_suffix(".exe").unwrap_or(&name);
    match stem {
        "speech" => Part::Speech,
        // Linux cuts a process's name to 15 bytes, which this one fits exactly.
        "vrct-rvc-worker" => Part::Conversion,
        _ => Part::Other,
    }
}

/// One running process: its id, its parent's and its executable's name.
#[derive(Clone, Debug)]
pub struct ProcessRow {
    pub pid: u32,
    pub parent: u32,
    pub executable: String,
}

/// The app's processes: `root` and every process below it, each with its [`Part`]. The root
/// is always [`Part::Other`] (it is this process).
pub fn app_processes(rows: &[ProcessRow], root: u32) -> HashMap<u32, Part> {
    let mut children: HashMap<u32, Vec<&ProcessRow>> = HashMap::new();
    for row in rows {
        // A process whose parent id is its own (the idle process) would loop.
        if row.pid != row.parent {
            children.entry(row.parent).or_default().push(row);
        }
    }
    let mut found = HashMap::from([(root, Part::Other)]);
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        for child in children.get(&pid).map(Vec::as_slice).unwrap_or_default() {
            if found.contains_key(&child.pid) {
                continue;
            }
            found.insert(child.pid, part_of(&child.executable));
            stack.push(child.pid);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pid: u32, parent: u32, executable: &str) -> ProcessRow {
        ProcessRow { pid, parent, executable: executable.into() }
    }

    #[test]
    fn processes_are_told_apart_by_their_executable() {
        assert_eq!(part_of("speech.exe"), Part::Speech);
        assert_eq!(part_of("SPEECH.EXE"), Part::Speech);
        assert_eq!(part_of("/opt/astarot/build/speechcpp/speech"), Part::Speech);
        assert_eq!(part_of(r"C:\app\build\vrct-rvc-worker.exe"), Part::Conversion);
        assert_eq!(part_of("vrct-rvc-worker"), Part::Conversion);
        assert_eq!(part_of("msedgewebview2.exe"), Part::Other);
        assert_eq!(part_of("speech-helper"), Part::Other);
    }

    #[test]
    fn the_app_is_its_process_and_everything_it_started() {
        let rows = [
            row(0, 0, "System Idle Process"),
            row(10, 1, "explorer.exe"),
            row(100, 10, "astarot.exe"),
            row(101, 100, "speech.exe"),
            row(102, 100, "vrct-rvc-worker.exe"),
            row(103, 100, "msedgewebview2.exe"),
            row(104, 103, "msedgewebview2.exe"),
            row(200, 10, "speech.exe"),
        ];
        let app = app_processes(&rows, 100);
        assert_eq!(app.len(), 5);
        assert_eq!(app[&100], Part::Other);
        assert_eq!(app[&101], Part::Speech);
        assert_eq!(app[&102], Part::Conversion);
        assert_eq!(app[&104], Part::Other);
        assert!(!app.contains_key(&200), "another app's speech.cpp is not ours");
        assert!(!app.contains_key(&10));
    }

    #[test]
    fn a_parent_loop_ends() {
        let rows = [row(100, 102, "astarot.exe"), row(101, 100, "speech.exe"), row(102, 101, "x")];
        let app = app_processes(&rows, 100);
        assert_eq!(app.len(), 3);
    }

    /// Reads the GPUs of the computer the test runs on and prints them, with the time it
    /// took: `cargo test --lib gpu_memory -- --ignored --nocapture`. `GPU_MEMORY_ROOT=<pid>`
    /// counts another process tree as the app, to see the per-process numbers.
    #[test]
    #[ignore = "reads the real GPUs"]
    fn reads_this_computer() {
        let root = std::env::var("GPU_MEMORY_ROOT").ok().and_then(|pid| pid.parse().ok()).unwrap_or_else(std::process::id);
        for _ in 0..3 {
            let started = std::time::Instant::now();
            let reading = read_from(root);
            println!("{:?} in {:?}", reading, started.elapsed());
        }
    }

    #[test]
    fn usage_adds_up_by_part() {
        let mut usage = AppUsage::default();
        usage.add(Part::Speech, 3);
        usage.add(Part::Speech, 4);
        usage.add(Part::Other, u64::MAX);
        usage.add(Part::Other, 1);
        assert_eq!((usage.speech, usage.conversion, usage.other), (7, 0, u64::MAX));
        assert_eq!(usage.total(), u64::MAX);
    }
}
