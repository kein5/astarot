//! Which bundled speech.cpp build a server runs, and on which device.
//!
//! Windows ships one build, the Vulkan one, which also computes on the CPU (`--device cpu`).
//! Linux ships two side by side: the Vulkan build (`build/speechcpp`) and the CPU build
//! (`build/speechcpp-cpu`). The CPU build needs no Vulkan loader, so it runs where the Vulkan
//! build cannot start. Each bundle's `bundle.json` names its variant; the folder names do not
//! decide which build is which.
//!
//! The saved choice (`auto`, `cpu`, `gpu`, `VulkanN`) maps to a build:
//!
//! - `cpu`: the CPU build, or the one build with `--device cpu`.
//! - `gpu` and `VulkanN`: the Vulkan build. Without a Vulkan build, the CPU build is started
//!   with the choice and fails with the device notice, as a CPU-only package always did.
//! - `auto` with both builds: the Vulkan build when `speech devices --json` of the Vulkan build
//!   runs and lists a GPU to compute on ([`preferred_gpu`]); otherwise the CPU build on the CPU.
//!   When the listing does not run at all (no `libvulkan.so.1`, a broken driver), the start
//!   carries [`codes::CPU_FALLBACK`] so that the fallback is shown, not silent.
//! - `auto` with one build: that build, as before ([`resolve_device`]).

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::bundle::{checked_bundle, Build};
use crate::devices::{list_gpus_checked, preferred_gpu, resolve_device, Environment, Gpu};
use crate::{codes, Code};

/// The checked executables of the bundles that passed their check, at most one of each build.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Builds {
    pub vulkan: Option<PathBuf>,
    pub cpu: Option<PathBuf>,
}

impl Builds {
    /// The first bundle of each build among `folders` that matches `pins`. A folder that is
    /// missing or fails its check is passed over.
    pub fn find(folders: &[PathBuf], pins: &[(String, String)]) -> Builds {
        let mut builds = Builds::default();
        for folder in folders {
            let Ok((binary, build)) = checked_bundle(folder, pins) else { continue };
            let slot = match build {
                Build::Vulkan => &mut builds.vulkan,
                Build::Cpu => &mut builds.cpu,
            };
            slot.get_or_insert(binary);
        }
        builds
    }

    pub fn is_empty(&self) -> bool {
        self.vulkan.is_none() && self.cpu.is_none()
    }

    /// The executable to list this PC's devices with: the Vulkan build when it runs, else the
    /// CPU build. `runs` is asked only when there are both.
    pub fn for_listing(&self, runs: impl FnOnce(&Path) -> bool) -> Option<PathBuf> {
        match (&self.vulkan, &self.cpu) {
            (Some(vulkan), Some(cpu)) => Some(if runs(vulkan) { vulkan.clone() } else { cpu.clone() }),
            (vulkan, cpu) => vulkan.clone().or_else(|| cpu.clone()),
        }
    }
}

/// What a start runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub binary: PathBuf,
    pub build: Build,
    /// What is passed to `--device`.
    pub device: String,
    /// Set when the server runs other than asked for a reason the user should see
    /// ([`codes::CPU_FALLBACK`]).
    pub notice: Option<Code>,
}

/// The build and device for the saved choice `asked`. `rows` lists the devices of an executable
/// (`speech devices --json`), None when it does not run; it is asked at most once.
pub fn choose(
    builds: &Builds,
    asked: &str,
    rows: impl FnOnce(&Path) -> Option<Vec<Value>>,
) -> Result<Choice, Code> {
    let choice = |binary: &PathBuf, build, device: String, notice| Choice { binary: binary.clone(), build, device, notice };
    match (&builds.vulkan, &builds.cpu) {
        (None, None) => Err(codes::BUNDLE),
        // One build: as before the CPU build was shipped beside the Vulkan one.
        (Some(binary), None) | (None, Some(binary)) => {
            let build = if builds.vulkan.is_some() { Build::Vulkan } else { Build::Cpu };
            let device = if matches!(asked, "auto" | "gpu") {
                resolve_device(asked, rows(binary).as_deref())
            } else {
                asked.to_owned()
            };
            Ok(choice(binary, build, device, None))
        }
        (Some(vulkan), Some(cpu)) => Ok(match asked {
            "cpu" => choice(cpu, Build::Cpu, "cpu".into(), None),
            "gpu" => choice(vulkan, Build::Vulkan, resolve_device("gpu", rows(vulkan).as_deref()), None),
            "auto" => match rows(vulkan) {
                None => choice(cpu, Build::Cpu, "cpu".into(), Some(codes::CPU_FALLBACK)),
                Some(rows) => match preferred_gpu(&rows) {
                    Some(gpu) => choice(vulkan, Build::Vulkan, gpu, None),
                    // No GPU to compute on: the CPU build needs nothing of Vulkan.
                    None => choice(cpu, Build::Cpu, "cpu".into(), None),
                },
            },
            // A named GPU.
            named => choice(vulkan, Build::Vulkan, named.to_owned(), None),
        }),
    }
}

/// What the Settings page shows of the bundled builds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Survey {
    /// The GPUs the Vulkan build lists (or the one build).
    pub gpus: Vec<Gpu>,
    /// `ready` (the Vulkan build lists its devices), `unavailable` (it is bundled and does not
    /// start here, e.g. without `libvulkan.so.1`), or `missing`.
    pub gpu_build: &'static str,
    /// `separate` (a CPU build of its own, Linux), `shared` (the CPU runs on the Vulkan build,
    /// Windows), or `missing`.
    pub cpu_build: &'static str,
}

/// The devices and builds, listed with each build's own `speech devices`. Starts no model.
pub fn survey(builds: &Builds, environment: &Environment) -> Survey {
    let listed = builds.vulkan.as_ref().map(|binary| list_gpus_checked(binary, environment));
    let gpu_build = match &listed {
        None => "missing",
        Some(None) => "unavailable",
        Some(Some(_)) => "ready",
    };
    let cpu_build = match (&builds.cpu, &builds.vulkan) {
        (Some(_), _) => "separate",
        (None, Some(_)) => "shared",
        (None, None) => "missing",
    };
    Survey { gpus: listed.flatten().unwrap_or_default(), gpu_build, cpu_build }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    fn gpu() -> Vec<Value> {
        vec![
            json!({"name": "Vulkan0", "description": "AMD Radeon RX 7800 XT", "kind": "gpu", "memory_total": 1u64 << 34}),
            json!({"name": "CPU", "description": "CPU", "kind": "cpu"}),
        ]
    }

    fn both() -> Builds {
        Builds { vulkan: Some("/v/speech".into()), cpu: Some("/c/speech".into()) }
    }

    fn picked(builds: &Builds, asked: &str, rows: Option<Vec<Value>>) -> (Build, String, Option<Code>, u32) {
        let asked_rows = Cell::new(0);
        let choice = choose(builds, asked, |_| {
            asked_rows.set(asked_rows.get() + 1);
            rows
        })
        .unwrap();
        (choice.build, choice.device, choice.notice, asked_rows.get())
    }

    #[test]
    fn linux_maps_each_choice_to_a_build() {
        let b = both();
        assert_eq!(picked(&b, "cpu", Some(gpu())), (Build::Cpu, "cpu".into(), None, 0));
        assert_eq!(picked(&b, "Vulkan1", Some(gpu())), (Build::Vulkan, "Vulkan1".into(), None, 0));
        assert_eq!(picked(&b, "gpu", Some(gpu())), (Build::Vulkan, "Vulkan0".into(), None, 1));
        assert_eq!(picked(&b, "auto", Some(gpu())), (Build::Vulkan, "Vulkan0".into(), None, 1));
        // A Vulkan build that runs but shows no GPU to compute on: the CPU build, quietly.
        let software = vec![json!({"name": "Vulkan0", "description": "llvmpipe (LLVM 19)", "kind": "igpu"})];
        assert_eq!(picked(&b, "auto", Some(software)), (Build::Cpu, "cpu".into(), None, 1));
        assert_eq!(picked(&b, "auto", Some(vec![])), (Build::Cpu, "cpu".into(), None, 1));
        // A Vulkan build that does not start: the CPU build, with the notice.
        assert_eq!(picked(&b, "auto", None), (Build::Cpu, "cpu".into(), Some(codes::CPU_FALLBACK), 1));
        // An explicit GPU choice is not moved to the CPU: it fails with its own notice.
        assert_eq!(picked(&b, "gpu", None), (Build::Vulkan, "gpu".into(), None, 1));
    }

    #[test]
    fn windows_runs_every_choice_on_its_one_build() {
        let one = Builds { vulkan: Some("/v/speech.exe".into()), cpu: None };
        assert_eq!(picked(&one, "cpu", Some(gpu())), (Build::Vulkan, "cpu".into(), None, 0));
        assert_eq!(picked(&one, "auto", Some(gpu())), (Build::Vulkan, "Vulkan0".into(), None, 1));
        assert_eq!(picked(&one, "auto", None), (Build::Vulkan, "auto".into(), None, 1));
        assert_eq!(picked(&one, "Vulkan3", None), (Build::Vulkan, "Vulkan3".into(), None, 0));
    }

    #[test]
    fn a_cpu_build_alone_runs_as_a_cpu_package_did() {
        let one = Builds { vulkan: None, cpu: Some("/c/speech".into()) };
        assert_eq!(picked(&one, "auto", Some(vec![])), (Build::Cpu, "auto".into(), None, 1));
        assert_eq!(picked(&one, "gpu", Some(vec![])), (Build::Cpu, "gpu".into(), None, 1));
        assert_eq!(picked(&one, "cpu", None), (Build::Cpu, "cpu".into(), None, 0));
        assert_eq!(choose(&Builds::default(), "auto", |_| None).err(), Some(codes::BUNDLE));
    }

    #[test]
    fn listing_prefers_a_vulkan_build_that_runs() {
        let b = both();
        assert_eq!(b.for_listing(|_| true), b.vulkan);
        assert_eq!(b.for_listing(|_| false), b.cpu);
        let one = Builds { vulkan: None, cpu: Some("/c/speech".into()) };
        assert_eq!(one.for_listing(|_| panic!("one build is not asked")), one.cpu);
        assert_eq!(Builds::default().for_listing(|_| true), None);
    }
}
