//! Linux: NVIDIA through `nvidia-smi`, other GPUs through the DRM driver (sysfs and fdinfo).

use super::parse;
use super::{AppUsage, FAILED, Gpu, Part, ProcessRow, UNSUPPORTED, app_processes};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long `nvidia-smi` may take. A hung driver must not keep the reading forever.
const NVIDIA_TIMEOUT: Duration = Duration::from_secs(3);
/// More than `nvidia-smi` ever writes for a few GPUs and processes.
const OUTPUT_LIMIT: u64 = 64 * 1024;

fn processes() -> Vec<ProcessRow> {
    let Ok(entries) = fs::read_dir("/proc") else { return Vec::new() };
    entries
        .filter_map(|entry| {
            let name = entry.ok()?.file_name();
            let pid: u32 = name.to_str()?.parse().ok()?;
            let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            let (pid, executable, parent) = parse::proc_stat(&stat)?;
            Some(ProcessRow { pid, parent, executable })
        })
        .collect()
}

/// Runs `nvidia-smi` with `args`; `None` when it is missing, fails or takes too long.
fn nvidia_smi(args: &[&str]) -> Option<String> {
    let mut command = Command::new("nvidia-smi");
    // Under the AppImage, the host's environment rather than the GUI's (#924, item 22).
    astarot_app_identity::appimage::restore_host_environment(&mut command);
    let mut child = command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let deadline = Instant::now() + NVIDIA_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    let mut text = String::new();
    child.stdout.take()?.take(OUTPUT_LIMIT).read_to_string(&mut text).ok()?;
    Some(text)
}

fn nvidia(app: &HashMap<u32, Part>) -> Vec<Gpu> {
    let Some(gpus) = nvidia_smi(&["--query-gpu=pci.bus_id,name,memory.total,memory.used", "--format=csv,noheader,nounits"]) else { return Vec::new() };
    let gpus = parse::nvidia_gpus(&gpus);
    if gpus.is_empty() {
        return Vec::new();
    }
    let mut usage: HashMap<String, AppUsage> = HashMap::new();
    let processes = nvidia_smi(&["--query-compute-apps=gpu_bus_id,pid,used_memory", "--format=csv,noheader,nounits"]).unwrap_or_default();
    for (device, pid, bytes) in parse::nvidia_processes(&processes) {
        if let Some(part) = app.get(&pid) {
            usage.entry(device).or_default().add(*part, bytes);
        }
    }
    gpus.into_iter().map(|(device, name, total, used)| Gpu { name, total, used, app: usage.remove(&device).unwrap_or_default(), app_shared: None }).collect()
}

fn read_number(path: &Path) -> Option<u64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// The PCI address of a DRM card (`PCI_SLOT_NAME` in its device's uevent).
fn card_address(device: &Path) -> Option<String> {
    let uevent = fs::read_to_string(device.join("uevent")).ok()?;
    uevent.lines().find_map(|line| line.strip_prefix("PCI_SLOT_NAME=")).and_then(parse::pci_address)
}

/// The VRAM each of the app's processes holds through DRM, by PCI address. A client open
/// under several file descriptors (or shared with a child) counts once.
fn drm_usage(app: &HashMap<u32, Part>) -> HashMap<String, AppUsage> {
    let mut seen: HashSet<(String, u64)> = HashSet::new();
    let mut usage: HashMap<String, AppUsage> = HashMap::new();
    for (pid, part) in app {
        let Ok(files) = fs::read_dir(format!("/proc/{pid}/fdinfo")) else { continue };
        for file in files.flatten() {
            let Ok(text) = fs::read_to_string(file.path()) else { continue };
            let Some(client) = parse::fdinfo(&text) else { continue };
            if seen.insert((client.device.clone(), client.client)) {
                usage.entry(client.device).or_default().add(*part, client.vram);
            }
        }
    }
    usage
}

/// GPUs whose driver reports VRAM in sysfs (amdgpu, xe). NVIDIA's are read through
/// `nvidia-smi` instead, so they are left out here.
fn drm(app: &HashMap<u32, Part>, nvidia_found: bool) -> Vec<Gpu> {
    let Ok(cards) = fs::read_dir("/sys/class/drm") else { return Vec::new() };
    let mut names: Vec<String> = cards.flatten().filter_map(|c| c.file_name().into_string().ok()).filter(|n| n.strip_prefix("card").is_some_and(|i| !i.is_empty() && i.bytes().all(|b| b.is_ascii_digit()))).collect();
    names.sort();
    let mut usage: Option<HashMap<String, AppUsage>> = None;
    let mut found = Vec::new();
    for card in names {
        let device = Path::new("/sys/class/drm").join(&card).join("device");
        let vendor = fs::read_to_string(device.join("vendor")).unwrap_or_default();
        if nvidia_found && vendor.trim() == "0x10de" {
            continue;
        }
        let Some(total) = read_number(&device.join("mem_info_vram_total")) else { continue };
        let address = card_address(&device);
        let app_usage = match &address {
            Some(address) => usage.get_or_insert_with(|| drm_usage(app)).remove(address).unwrap_or_default(),
            None => AppUsage::default(),
        };
        let name = fs::read_to_string(device.join("product_name")).ok().map(|n| n.trim().chars().filter(|c| !c.is_control()).take(128).collect::<String>()).filter(|n| !n.is_empty());
        found.push(Gpu { name: name.unwrap_or(card), total: (total > 0).then_some(total), used: read_number(&device.join("mem_info_vram_used")), app: app_usage, app_shared: None });
    }
    found
}

pub(super) fn read(root: u32) -> Result<Vec<Gpu>, &'static str> {
    let rows = processes();
    if rows.is_empty() {
        return Err(FAILED);
    }
    let app = app_processes(&rows, root);
    let mut gpus = nvidia(&app);
    let nvidia_found = !gpus.is_empty();
    gpus.extend(drm(&app, nvidia_found));
    if gpus.is_empty() { Err(UNSUPPORTED) } else { Ok(gpus) }
}
