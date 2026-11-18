//! The text the platforms answer with, read without touching the platform, so that every OS
//! can test it.

/// An adapter's LUID as the performance counters write it: `(high, low)`.
pub type Luid = (u32, u32);

fn hex(text: &str) -> Option<u32> {
    u32::from_str_radix(text.strip_prefix("0x").or_else(|| text.strip_prefix("0X"))?, 16).ok()
}

/// `luid_0x00000000_0x0000D1A3_phys_0` (a `GPU Adapter Memory` instance).
pub fn pdh_adapter(instance: &str) -> Option<Luid> {
    let mut parts = instance.split('_');
    if parts.next()? != "luid" {
        return None;
    }
    Some((hex(parts.next()?)?, hex(parts.next()?)?))
}

/// `pid_1234_luid_0x00000000_0x0000D1A3_phys_0` (a `GPU Process Memory` instance).
pub fn pdh_process(instance: &str) -> Option<(u32, Luid)> {
    let rest = instance.strip_prefix("pid_")?;
    let (pid, rest) = rest.split_once('_')?;
    Some((pid.parse().ok()?, pdh_adapter(rest)?))
}

/// `/proc/<pid>/stat`: `(pid, name, parent)`. The name sits in parentheses and may hold
/// spaces and parentheses itself, so the fields after it are found from the last `)`.
pub fn proc_stat(text: &str) -> Option<(u32, String, u32)> {
    let open = text.find('(')?;
    let close = text.rfind(')')?;
    let pid = text[..open].trim().parse().ok()?;
    let name = text.get(open + 1..close)?.to_owned();
    let mut rest = text[close + 1..].split_whitespace();
    let _state = rest.next()?;
    let parent = rest.next()?.parse().ok()?;
    Some((pid, name, parent))
}

/// A PCI address as `0000:01:00.0`, whatever the width of its domain (`nvidia-smi` writes
/// eight digits).
pub fn pci_address(text: &str) -> Option<String> {
    let text = text.trim().to_ascii_lowercase();
    let (domain, rest) = text.rsplit_once(':').and_then(|(head, function)| {
        let (domain, bus) = head.split_once(':')?;
        Some((domain, format!("{bus}:{function}")))
    })?;
    let domain = u32::from_str_radix(domain, 16).ok()?;
    let valid = rest.len() == 7 && rest.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.');
    valid.then(|| format!("{domain:04x}:{rest}"))
}

/// One DRM client of a process (`/proc/<pid>/fdinfo/<fd>`): which GPU, which client (one
/// client may be open under several file descriptors) and the VRAM it holds, in bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DrmClient {
    pub device: String,
    pub client: u64,
    pub vram: u64,
}

fn size(text: &str) -> Option<u64> {
    let mut words = text.split_whitespace();
    let value: u64 = words.next()?.parse().ok()?;
    let scale = match words.next() {
        None => 1,
        Some("KiB") => 1 << 10,
        Some("MiB") => 1 << 20,
        Some("GiB") => 1 << 30,
        Some(_) => return None,
    };
    value.checked_mul(scale)
}

/// An fdinfo file of a DRM client; `None` for any other file descriptor.
pub fn fdinfo(text: &str) -> Option<DrmClient> {
    let (mut device, mut client, mut vram) = (None, None, None);
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        match key.trim() {
            "drm-pdev" => device = pci_address(value),
            "drm-client-id" => client = value.trim().parse().ok(),
            // amdgpu writes drm-memory-vram; xe and i915 write drm-total-vram0 / drm-resident-vram0.
            "drm-memory-vram" | "drm-resident-vram0" => vram = size(value),
            _ => {}
        }
    }
    Some(DrmClient { device: device?, client: client?, vram: vram? })
}

/// A GPU from `nvidia-smi --query-gpu=pci.bus_id,name,memory.total,memory.used
/// --format=csv,noheader,nounits`: `(address, name, total, used)`, memory in bytes.
pub fn nvidia_gpus(csv: &str) -> Vec<(String, String, Option<u64>, Option<u64>)> {
    csv.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            let [bus, name, total, used] = fields.as_slice() else { return None };
            let name = name.chars().filter(|c| !c.is_control()).take(128).collect::<String>();
            (!name.is_empty()).then_some(())?;
            Some((pci_address(bus)?, name, mib(total), mib(used)))
        })
        .collect()
}

/// A process from `nvidia-smi --query-compute-apps=gpu_bus_id,pid,used_memory
/// --format=csv,noheader,nounits`: `(address, pid, bytes)`.
pub fn nvidia_processes(csv: &str) -> Vec<(String, u32, u64)> {
    csv.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            let [bus, pid, used] = fields.as_slice() else { return None };
            Some((pci_address(bus)?, pid.parse().ok()?, mib(used)?))
        })
        .collect()
}

/// `nvidia-smi` writes MiB, or `[N/A]` / `[Not Supported]` when it cannot tell.
fn mib(text: &str) -> Option<u64> {
    text.parse::<u64>().ok()?.checked_mul(1 << 20)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn performance_counter_instances() {
        assert_eq!(pdh_adapter("luid_0x00000000_0x0000D1A3_phys_0"), Some((0, 0xD1A3)));
        assert_eq!(pdh_adapter("luid_0x00000001_0x0000d1a3_phys_1"), Some((1, 0xD1A3)));
        assert_eq!(pdh_adapter("pid_4_luid_0x00000000_0x0000D1A3_phys_0"), None);
        assert_eq!(pdh_adapter("luid_00000000_0x0000D1A3_phys_0"), None);
        assert_eq!(pdh_process("pid_1234_luid_0x00000000_0x0000D1A3_phys_0"), Some((1234, (0, 0xD1A3))));
        assert_eq!(pdh_process("pid_x_luid_0x00000000_0x0000D1A3_phys_0"), None);
        assert_eq!(pdh_process("_Total"), None);
    }

    #[test]
    fn proc_stat_names_may_hold_spaces_and_parentheses() {
        assert_eq!(proc_stat("1234 (speech) S 1000 1234 1000 0 -1"), Some((1234, "speech".into(), 1000)));
        assert_eq!(proc_stat("77 (a (b) c) R 5 77 5"), Some((77, "a (b) c".into(), 5)));
        assert_eq!(proc_stat("77 (cut"), None);
        assert_eq!(proc_stat(""), None);
    }

    #[test]
    fn pci_addresses_compare_whatever_the_domain_width() {
        assert_eq!(pci_address("00000000:01:00.0").as_deref(), Some("0000:01:00.0"));
        assert_eq!(pci_address("0000:0A:00.0\n").as_deref(), Some("0000:0a:00.0"));
        assert_eq!(pci_address("01:00.0"), None);
        assert_eq!(pci_address("zz:01:00.0"), None);
    }

    #[test]
    fn drm_clients_from_fdinfo() {
        let amd = "pos:\t0\nflags:\t02100002\ndrm-driver:\tamdgpu\ndrm-pdev:\t0000:03:00.0\ndrm-client-id:\t42\ndrm-memory-vram:\t524288 KiB\ndrm-memory-gtt:\t2048 KiB\n";
        assert_eq!(fdinfo(amd), Some(DrmClient { device: "0000:03:00.0".into(), client: 42, vram: 512 << 20 }));
        let xe = "drm-driver:\txe\ndrm-pdev:\t0000:00:02.0\ndrm-client-id:\t7\ndrm-total-vram0:\t64 MiB\ndrm-resident-vram0:\t32 MiB\n";
        assert_eq!(fdinfo(xe).map(|c| c.vram), Some(32 << 20));
        // A file descriptor that is not a DRM client, or a client that holds no VRAM.
        assert_eq!(fdinfo("pos:\t0\nflags:\t02\n"), None);
        assert_eq!(fdinfo("drm-pdev:\t0000:03:00.0\ndrm-client-id:\t1\ndrm-memory-gtt:\t1 KiB\n"), None);
        assert_eq!(fdinfo("drm-pdev:\t0000:03:00.0\ndrm-client-id:\t1\ndrm-memory-vram:\t1 TiB\n"), None);
    }

    #[test]
    fn nvidia_smi_rows() {
        let gpus = nvidia_gpus("00000000:01:00.0, NVIDIA GeForce RTX 3060 Ti, 8192, 1536\n00000000:02:00.0, Tesla, [N/A], [N/A]\nbad line\n");
        assert_eq!(gpus.len(), 2);
        assert_eq!(gpus[0], ("0000:01:00.0".into(), "NVIDIA GeForce RTX 3060 Ti".into(), Some(8192 << 20), Some(1536 << 20)));
        assert_eq!((gpus[1].2, gpus[1].3), (None, None));
        let apps = nvidia_processes("00000000:01:00.0, 4242, 900\n00000000:01:00.0, 4243, [N/A]\n");
        assert_eq!(apps, vec![("0000:01:00.0".into(), 4242, 900 << 20)]);
    }
}
