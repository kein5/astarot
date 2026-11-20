//! What a usage event says about the PC: its CPU, memory and GPUs, with each GPU's driver
//! version ([`hardware.py`]).
//!
//! The names come from the bundled speech.cpp (`speech devices --json`), the list the model
//! guidance already uses. Nothing here reads a serial number, a host or user name, or an audio
//! device. Memory is sent as the nearest common size, not the exact amount.
//!
//! [`hardware.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/telemetry/hardware.py

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::downloads::hardware::{parse_devices, Device};
use crate::json::Json;
use crate::process::{devices_command, Owned, Waited, OUTPUT_LIMIT};

pub const TIMEOUT: Duration = Duration::from_secs(3);
pub const MAX_GPUS: usize = 4;
pub const NAME_LIMIT: usize = 64;
/// Installed memory comes in these sizes (GiB); the nearest one is sent.
pub const MEMORY_STEPS_GB: [u64; 20] = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];
const GIB: u64 = 1 << 30;
/// The display adapters' class in the Windows registry; each adapter has a numbered key.
pub const DISPLAY_CLASS: &str = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// `{cpu, cores, ram_gb, gpus: [{name, kind, vram_gb, driver}]}`, each only when known.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Hardware {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cores: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ram_gb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpus: Option<Vec<Gpu>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Gpu {
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vram_gb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub driver: Option<String>,
}

impl Hardware {
    pub fn is_empty(&self) -> bool {
        self.cpu.is_none() && self.cores.is_none() && self.ram_gb.is_none() && self.gpus.is_none()
    }

    pub fn to_json(&self) -> Json {
        Json::from_serialize(self)
    }
}

/// Python's `str.isspace`, which also counts the separators U+001C to U+001F.
fn py_isspace(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// A name from a driver or the OS as an event may carry it, or "" when nothing is left.
/// Whatever is not printable ASCII is dropped, so text in another script never travels.
pub fn ascii_text(value: &str, limit: usize) -> String {
    let kept: String = value
        .chars()
        .filter_map(|c| {
            if (' '..='~').contains(&c) {
                Some(c)
            } else if py_isspace(c) {
                Some(' ')
            } else {
                None
            }
        })
        .collect();
    let joined = kept.split_ascii_whitespace().collect::<Vec<_>>().join(" ");
    joined.chars().take(limit).collect::<String>().trim().to_string()
}

/// The common memory size, in GiB, nearest to a number of bytes (the smaller on a tie).
pub fn memory_step(size: u64) -> u64 {
    *MEMORY_STEPS_GB.iter().min_by_key(|step| (i128::from(**step) * i128::from(GIB) - i128::from(size)).abs()).expect("steps are not empty")
}

/// `[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}`
fn plain_version(text: &str) -> bool {
    (1..=32).contains(&text.len()) && text.bytes().enumerate().all(|(i, b)| b.is_ascii_alphanumeric() || (i > 0 && b"._+-".contains(&b)))
}

/// The hardware from device rows, a driver lookup and the logical CPU count.
pub fn summarize(rows: &[Device], drivers: impl FnOnce(&[String]) -> Vec<(String, String)>, cores: Option<usize>) -> Hardware {
    let mut hardware = Hardware::default();
    let cpu = rows.iter().find(|r| r.kind == "cpu");
    if let Some(cpu) = cpu {
        let name = ascii_text(&cpu.description, NAME_LIMIT);
        if !name.is_empty() {
            hardware.cpu = Some(name);
        }
    }
    if let Some(cores) = cores.filter(|c| (1..=4096).contains(c)) {
        hardware.cores = Some(cores as u32);
    }
    if let Some(total) = cpu.and_then(|c| c.memory_total).filter(|t| *t > 0) {
        hardware.ram_gb = Some(memory_step(total));
    }
    if !rows.is_empty() {
        let adapters: Vec<&Device> = rows.iter().filter(|r| (r.kind == "gpu" || r.kind == "igpu") && !ascii_text(&r.description, NAME_LIMIT).is_empty()).take(MAX_GPUS).collect();
        let names: Vec<String> = adapters.iter().map(|r| r.description.clone()).collect();
        let drivers = if adapters.is_empty() { Vec::new() } else { drivers(&names) };
        let gpus = adapters
            .iter()
            .map(|row| {
                let mut driver = drivers.iter().find(|(name, _)| *name == row.description).map(|(_, v)| v.clone());
                if driver.is_none() {
                    // A layer over the adapter's own driver names it inside its own name, as
                    // "Microsoft Direct3D12 (NVIDIA GeForce RTX 3060 Ti)" does. The longest wins;
                    // on a tie, the first listed.
                    let mut best: Option<&(String, String)> = None;
                    for pair in drivers.iter().filter(|(name, _)| !name.is_empty() && row.description.contains(name.as_str())) {
                        if best.is_none_or(|b| pair.0.chars().count() > b.0.chars().count()) {
                            best = Some(pair);
                        }
                    }
                    driver = best.map(|(_, v)| v.clone());
                }
                Gpu {
                    name: ascii_text(&row.description, NAME_LIMIT),
                    kind: row.kind.clone(),
                    vram_gb: row.memory_total.filter(|t| *t > 0).map(|t| ((t as f64 / GIB as f64).round_ties_even() as u64).clamp(1, 1024)),
                    driver: driver.filter(|d| plain_version(d)),
                }
            })
            .collect();
        hardware.gpus = Some(gpus);
    }
    hardware
}

/// The rows of `speech devices --json` from `binary`, or an empty list when it fails.
pub fn devices(binary: &Path, timeout: Duration) -> Result<Vec<Device>, String> {
    let child = Owned::spawn(devices_command(binary)).map_err(|_| "spawn".to_string())?;
    match child.wait(timeout).map_err(|_| "wait".to_string())? {
        Waited::TimedOut => Err("timeout".into()),
        Waited::Exited(status, output) if !status.success() || output.len() > OUTPUT_LIMIT => Ok(Vec::new()),
        Waited::Exited(_, output) => {
            let value: serde_json::Value = serde_json::from_slice(&output).map_err(|_| "invalid".to_string())?;
            parse_devices(&value).map_err(str::to_string)
        }
    }
}

/// `os.cpu_count()`: the logical processors of the system.
pub fn cpu_count() -> Option<usize> {
    #[cfg(unix)]
    {
        let n = unsafe { libc::sysconf(libc::_SC_NPROCESSORS_ONLN) };
        (n > 0).then_some(n as usize)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{GetActiveProcessorCount, ALL_PROCESSOR_GROUPS};
        let n = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) };
        (n > 0).then_some(n as usize)
    }
}

/// {adapter name: driver version}, in the order the system lists them.
pub fn drivers(names: &[String]) -> Vec<(String, String)> {
    #[cfg(windows)]
    {
        let _ = names;
        windows_drivers().unwrap_or_default()
    }
    #[cfg(target_os = "linux")]
    {
        linux_drivers(names, Path::new("/sys/module/nvidia/version")).unwrap_or_default()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = names;
        Vec::new()
    }
}

/// Only NVIDIA's own driver names its version in one place; Mesa's is not read.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn linux_drivers(names: &[String], version_file: &Path) -> std::io::Result<Vec<(String, String)>> {
    use std::io::Read;
    let mut text = String::new();
    std::fs::File::open(version_file)?.take(64).read_to_string(&mut text)?;
    let version = text.trim().to_string();
    Ok(names.iter().filter(|n| n.to_lowercase().contains("nvidia")).map(|n| (n.clone(), version.clone())).collect())
}

/// Each display adapter's `DriverDesc` and `DriverVersion`, as Device Manager shows them. Only
/// the adapter class key and its numbered children are read.
#[cfg(windows)]
fn windows_drivers() -> Option<Vec<(String, String)>> {
    use windows_sys::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }
    fn value(key: HKEY, name: &str) -> Option<String> {
        let name = wide(name);
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
        let mut size = 0u32;
        if unsafe { RegGetValueW(key, std::ptr::null(), name.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) } != ERROR_SUCCESS {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2) + 1];
        let mut size = (buffer.len() * 2) as u32;
        if unsafe { RegGetValueW(key, std::ptr::null(), name.as_ptr(), flags, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut size) } != ERROR_SUCCESS {
            return None;
        }
        let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        String::from_utf16(&buffer[..end]).ok()
    }
    let mut root: HKEY = std::ptr::null_mut();
    if unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, wide(DISPLAY_CLASS).as_ptr(), 0, KEY_READ, &mut root) } != ERROR_SUCCESS {
        return None;
    }
    let mut found: Vec<(String, String)> = Vec::new();
    for index in 0..64u32 {
        let mut name = [0u16; 256];
        let mut length = name.len() as u32;
        let status = unsafe { RegEnumKeyExW(root, index, name.as_mut_ptr(), &mut length, std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status != ERROR_SUCCESS {
            continue;
        }
        let mut child: HKEY = std::ptr::null_mut();
        if unsafe { RegOpenKeyExW(root, name.as_ptr(), 0, KEY_READ, &mut child) } != ERROR_SUCCESS {
            // A key this user may not read.
            continue;
        }
        let pair = value(child, "DriverDesc").zip(value(child, "DriverVersion"));
        unsafe { RegCloseKey(child) };
        if let Some((desc, version)) = pair {
            if !found.iter().any(|(d, _)| *d == desc) {
                found.push((desc, version));
            }
        }
    }
    unsafe { RegCloseKey(root) };
    Some(found)
}

/// [`summarize`] of this PC, asking `binary` (the bundled speech.cpp) for the devices.
/// Without it, only what the system itself tells: the CPU count.
pub fn collect(binary: Option<&Path>, timeout: Duration) -> Hardware {
    let rows = binary.and_then(|b| devices(b, timeout).ok()).unwrap_or_default();
    summarize(&rows, drivers, cpu_count())
}

/// [`collect`], once for the process: the hardware does not change while the app runs.
pub fn cached(binary: Option<&Path>, timeout: Duration) -> Hardware {
    static CACHE: Mutex<Option<Hardware>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    cache.get_or_insert_with(|| collect(binary, timeout)).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(name: &str, description: &str, kind: &str, total: Option<u64>) -> Device {
        Device { name: name.into(), description: description.into(), kind: kind.into(), memory_total: total, memory_free: total.map(|_| 1) }
    }

    fn devices() -> Vec<Device> {
        vec![
            device("Vulkan0", "Intel(R) Iris(R) Xe Graphics", "igpu", Some(17087799296)),
            device("Vulkan1", "NVIDIA GeForce RTX 3060 Ti", "gpu", Some(8638169088)),
            device("CPU", "12th Gen Intel(R) Core(TM) i7-1255U", "cpu", Some(34175598592)),
        ]
    }

    fn drivers_of(pairs: &[(&str, &str)]) -> impl FnOnce(&[String]) -> Vec<(String, String)> + use<> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        move |_| pairs
    }

    const DRIVERS: [(&str, &str); 2] = [("Intel(R) Iris(R) Xe Graphics", "32.0.101.7085"), ("NVIDIA GeForce RTX 3060 Ti", "32.0.16.2124")];

    fn expected() -> Hardware {
        Hardware {
            cpu: Some("12th Gen Intel(R) Core(TM) i7-1255U".into()),
            cores: Some(12),
            ram_gb: Some(32),
            gpus: Some(vec![
                Gpu { name: "Intel(R) Iris(R) Xe Graphics".into(), kind: "igpu".into(), vram_gb: Some(16), driver: Some("32.0.101.7085".into()) },
                Gpu { name: "NVIDIA GeForce RTX 3060 Ti".into(), kind: "gpu".into(), vram_gb: Some(8), driver: Some("32.0.16.2124".into()) },
            ]),
        }
    }

    #[test]
    fn the_hardware_is_the_cpu_the_memory_and_the_gpus_with_their_drivers() {
        let hardware = summarize(&devices(), drivers_of(&DRIVERS), Some(12));
        assert_eq!(hardware, expected());
        assert_eq!(hardware.to_json().as_object().unwrap().keys().collect::<Vec<_>>(), ["cpu", "cores", "ram_gb", "gpus"]);
        // Seen with only the Direct3D 12 mapping layer in place of a GPU's own Vulkan driver.
        let wrapped: Vec<Device> = devices().into_iter().map(|d| if d.kind == "cpu" { d } else { Device { description: format!("Microsoft Direct3D12 ({})", d.description), ..d } }).collect();
        let similar = [DRIVERS[0], DRIVERS[1], ("NVIDIA GeForce RTX 3060", "1.0")];
        let gpus = summarize(&wrapped, drivers_of(&similar), Some(12)).gpus.unwrap();
        assert_eq!(
            gpus.iter().map(|g| (g.name.as_str(), g.driver.as_deref())).collect::<Vec<_>>(),
            [("Microsoft Direct3D12 (Intel(R) Iris(R) Xe Graphics)", Some("32.0.101.7085")), ("Microsoft Direct3D12 (NVIDIA GeForce RTX 3060 Ti)", Some("32.0.16.2124"))]
        );
    }

    #[test]
    fn hardware_that_cannot_be_read_is_left_out_not_guessed() {
        assert_eq!(summarize(&[], drivers_of(&[]), Some(12)), Hardware { cores: Some(12), ..Hardware::default() });
        assert_eq!(summarize(&[], drivers_of(&[]), None), Hardware::default());
        let unknown = vec![device("Vulkan1", "NVIDIA GeForce RTX 3060 Ti", "gpu", None), device("CPU", "12th Gen Intel(R) Core(TM) i7-1255U", "cpu", None)];
        assert_eq!(
            summarize(&unknown, drivers_of(&[]), Some(12)),
            Hardware {
                cpu: Some("12th Gen Intel(R) Core(TM) i7-1255U".into()),
                cores: Some(12),
                ram_gb: None,
                gpus: Some(vec![Gpu { name: "NVIDIA GeForce RTX 3060 Ti".into(), kind: "gpu".into(), vram_gb: None, driver: None }])
            }
        );
        assert_eq!(summarize(&devices()[2..], drivers_of(&[]), Some(12)).gpus, Some(vec![]));
    }

    #[test]
    fn names_travel_as_short_printable_ascii_and_at_most_four_gpus() {
        let many: Vec<Device> = (0..6).map(|i| device(&format!("Vulkan{i}"), &format!("GPU {i}"), "gpu", Some(1 << 31))).collect();
        let names: Vec<String> = summarize(&many, drivers_of(&[]), Some(1)).gpus.unwrap().into_iter().map(|g| g.name).collect();
        assert_eq!(names, ["GPU 0", "GPU 1", "GPU 2", "GPU 3"]);
        let long = format!("グラフィックス  Radeon\tRX 7600 {}", "x".repeat(80));
        let odd = vec![device("Vulkan0", &long, "gpu", Some(1 << 33)), device("Vulkan1", "名前だけ", "gpu", Some(1 << 33)), device("CPU", "プロセッサ", "cpu", Some(1 << 34))];
        let result = summarize(&odd, drivers_of(&[(long.as_str(), "24.5.1 beta"), ("名前だけ", "1.0")]), Some(1));
        let gpus = result.gpus.unwrap();
        assert_eq!(gpus.len(), 1);
        assert!(gpus[0].name.starts_with("Radeon RX 7600 x") && gpus[0].name.len() == 64 && gpus[0].name.bytes().all(|b| (0x20..=0x7e).contains(&b)));
        // A driver version that is not a plain version string is not sent.
        assert_eq!(gpus[0].driver, None);
        assert_eq!((result.cpu, result.ram_gb), (None, Some(16)));
    }

    #[test]
    fn memory_is_sent_as_the_nearest_common_size() {
        for (size, step) in [(34175598592u64, 32), (17087799296, 16), (8 * GIB - 5 * (1 << 20), 8), (65 * GIB, 64), (3 * (1 << 29), 1), (1 << 41, 1024)] {
            assert_eq!(memory_step(size), step, "{size}");
        }
    }

    #[test]
    fn linux_names_only_the_nvidia_driver_version() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("version");
        std::fs::write(&file, "550.120\n").unwrap();
        let names = vec!["NVIDIA GeForce RTX 4070".to_string(), "AMD Radeon RX 7600 (RADV NAVI33)".to_string()];
        assert_eq!(linux_drivers(&names, &file).unwrap(), [("NVIDIA GeForce RTX 4070".to_string(), "550.120".to_string())]);
        assert!(linux_drivers(&names, &dir.path().join("missing")).is_err());
    }

    #[test]
    fn ascii_text_drops_other_scripts_and_squeezes_spaces() {
        assert_eq!(ascii_text("  a\u{1c}b\u{3000}c  ", 64), "a b c");
        assert_eq!(ascii_text("日本", 64), "");
        assert_eq!(ascii_text(&format!("{} y", "x".repeat(63)), 64), "x".repeat(63));
    }
}
