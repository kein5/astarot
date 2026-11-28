//! Which bundled build a server starts, with two stand-in bundles as Linux ships them and one
//! as Windows does. Each bundle is a copy of `fake-speech` pinned by its own hash; no model,
//! GPU or Vulkan loader is used.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde_json::json;
use astarot_speech_server::builds::{survey, Builds};
use astarot_speech_server::bundle::{checked_bundle, file_sha256, Build, EXECUTABLE};
use astarot_speech_server::server::{Hooks, Launch, SpeechServer, State};
use astarot_speech_server::settings::{start_options, Profile};
use astarot_speech_server::{codes, Code};

const FAKE: &str = env!("CARGO_BIN_EXE_fake-speech");

struct Folder(PathBuf);

impl Folder {
    fn new() -> Folder {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!("vrct-speech-builds-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
        // Beside the stand-in, on its file system, so that it can be linked there.
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
        std::fs::create_dir_all(&path).unwrap();
        Folder(path.canonicalize().unwrap())
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Puts the stand-in at `to`. On Unix as a hard link, never as a copy (#1073): a copy is open for
/// writing while it is written, a process another test of this process starts at that moment
/// holds that descriptor until it runs its own program, and running the copy then fails with
/// "Text file busy" (ETXTBSY). A layout made again in the same folder links it again. Windows has
/// no such failure (a child inherits no handle of the copy), and a file a running stand-in was
/// started from cannot be removed there under any of its names, so it is a copy there, as before.
fn place(to: &Path) {
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(to);
        std::fs::hard_link(FAKE, to).unwrap();
    }
    #[cfg(not(unix))]
    std::fs::copy(FAKE, to).unwrap();
}

/// How a stand-in Vulkan build behaves on the PC of the test.
#[derive(Clone, Copy)]
enum Pc {
    /// `speech devices` lists a separate GPU.
    Gpu,
    /// It runs and lists the CPU only (no GPU driver).
    NoGpu,
    /// It does not start: no `libvulkan.so.1`.
    NoLoader,
}


/// `root/name` with a copy of the stand-in and a `bundle.json` naming `variant`; returns its pin.
fn bundle(root: &Path, name: &str, variant: &str, pc: Pc) -> (String, String) {
    let folder = root.join(name);
    std::fs::create_dir_all(&folder).unwrap();
    let binary = folder.join(EXECUTABLE);
    place(&binary);
    let meta = json!({"schema": 1, "version": astarot_speech_server::bundle::VERSION, "variant": variant});
    std::fs::write(folder.join("bundle.json"), meta.to_string()).unwrap();
    let cpu = json!({"name": "CPU", "description": "Fake CPU", "kind": "cpu", "memory_total": 1u64 << 34});
    let rows = match pc {
        Pc::Gpu => json!({"devices": [
            {"name": "Vulkan0", "description": "Fake GPU", "kind": "gpu", "memory_total": 1u64 << 33}, cpu]}),
        Pc::NoGpu => json!({"devices": [cpu]}),
        Pc::NoLoader => {
            std::fs::write(folder.join("no-loader"), b"").unwrap();
            json!({"devices": [cpu]})
        }
    };
    std::fs::write(folder.join("devices.json"), rows.to_string()).unwrap();
    (variant.to_owned(), file_sha256(&binary).unwrap())
}

/// The Linux layout: the Vulkan build in `speechcpp`, the CPU build in `speechcpp-cpu`.
fn linux(root: &Path, pc: Pc) -> Launch {
    let pins = vec![bundle(root, "speechcpp", "linux-x64-vulkan", pc), bundle(root, "speechcpp-cpu", "linux-x64-cpu", Pc::NoGpu)];
    let mut launch = Launch::bundles(vec![root.join("speechcpp"), root.join("speechcpp-cpu")]);
    launch.pins = pins.into();
    launch.start_timeout = Duration::from_secs(10);
    launch
}

/// The Windows layout: the one Vulkan build.
fn windows(root: &Path, pc: Pc) -> Launch {
    let pins = vec![bundle(root, "speechcpp", "windows-x64-vulkan", pc)];
    let mut launch = Launch::bundles(vec![root.join("speechcpp"), root.join("speechcpp-cpu")]);
    launch.pins = pins.into();
    launch.start_timeout = Duration::from_secs(10);
    launch
}

fn start(root: &Path, launch: Launch, device: &str) -> SpeechServer {
    let model = root.join("tts.gguf");
    std::fs::write(&model, b"GGUF\0\0\0\0").unwrap();
    let settings = json!({"profiles": {"multilingual": {"model": model.to_str().unwrap(), "device": device}}});
    let options = start_options(&settings, Profile::Multilingual).unwrap();
    let server = SpeechServer::new(Profile::Multilingual, options, launch, Hooks::default());
    server.start().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !matches!(server.health().state, State::Ready | State::Failed) {
        assert!(Instant::now() < deadline, "the server did not settle");
        std::thread::sleep(Duration::from_millis(10));
    }
    server
}

/// (state, build, device, notice, error) once the start settled; the server is closed.
fn outcome(root: &Path, launch: Launch, device: &str) -> (State, Option<Build>, String, Option<Code>, Option<Code>) {
    let server = start(root, launch, device);
    let health = server.health();
    let result = (health.state, server.build(), server.device(), health.notice, health.error_code);
    assert!(server.close(Duration::from_secs(3)));
    result
}

#[test]
fn linux_runs_the_cpu_build_for_the_cpu_and_the_vulkan_build_for_a_gpu() {
    let root = Folder::new();
    let ready = |build, device: &str| (State::Ready, Some(build), device.to_owned(), None, None);
    assert_eq!(outcome(&root.0, linux(&root.0, Pc::Gpu), "cpu"), ready(Build::Cpu, "cpu"));
    assert_eq!(outcome(&root.0, linux(&root.0, Pc::Gpu), "gpu"), ready(Build::Vulkan, "Vulkan0"));
    assert_eq!(outcome(&root.0, linux(&root.0, Pc::Gpu), "Vulkan0"), ready(Build::Vulkan, "Vulkan0"));
    assert_eq!(outcome(&root.0, linux(&root.0, Pc::Gpu), "auto"), ready(Build::Vulkan, "Vulkan0"));
    // A Vulkan build that runs but shows no GPU: auto is the CPU build, without a notice.
    assert_eq!(outcome(&root.0, linux(&root.0, Pc::NoGpu), "auto"), ready(Build::Cpu, "cpu"));
}

#[test]
fn linux_auto_falls_back_to_the_cpu_build_with_a_notice_when_vulkan_does_not_start() {
    let root = Folder::new();
    assert_eq!(
        outcome(&root.0, linux(&root.0, Pc::NoLoader), "auto"),
        (State::Ready, Some(Build::Cpu), "cpu".to_owned(), Some(codes::CPU_FALLBACK), None)
    );
    // A GPU the user chose is not moved to the CPU: the start fails and names the loader.
    let failed = outcome(&root.0, linux(&root.0, Pc::NoLoader), "gpu");
    assert_eq!(failed, (State::Failed, Some(Build::Vulkan), "gpu".to_owned(), None, Some(codes::VULKAN_MISSING)));
    // The CPU choice never needs the loader.
    assert_eq!(outcome(&root.0, linux(&root.0, Pc::NoLoader), "cpu").0, State::Ready);
}

#[test]
fn windows_runs_every_choice_on_its_one_vulkan_build() {
    let root = Folder::new();
    let ready = |device: &str| (State::Ready, Some(Build::Vulkan), device.to_owned(), None, None);
    assert_eq!(outcome(&root.0, windows(&root.0, Pc::Gpu), "cpu"), ready("cpu"));
    assert_eq!(outcome(&root.0, windows(&root.0, Pc::Gpu), "auto"), ready("Vulkan0"));
    // speech.cpp picks the CPU itself for "auto" when it shows no GPU.
    assert_eq!(outcome(&root.0, windows(&root.0, Pc::NoGpu), "auto"), ready("auto"));
}

#[test]
fn a_bundle_of_another_hash_is_passed_over_and_none_is_named() {
    let root = Folder::new();
    let mut launch = linux(&root.0, Pc::Gpu);
    // The CPU build's pin no longer matches: only the Vulkan build is left.
    launch.pins = launch.pins.iter().map(|(variant, hash)| {
        (variant.clone(), if variant.ends_with("-cpu") { "0".repeat(64) } else { hash.clone() })
    }).collect::<Vec<_>>().into();
    assert_eq!(launch.builds().cpu, None);
    assert_eq!(outcome(&root.0, launch.clone(), "cpu").1, Some(Build::Vulkan));
    launch.pins = Vec::new().into();
    assert_eq!(outcome(&root.0, launch, "cpu").4, Some(codes::BUNDLE));
}

#[test]
fn the_survey_names_each_build_and_lists_the_gpus_of_the_vulkan_build() {
    let root = Folder::new();
    let launch = linux(&root.0, Pc::Gpu);
    let builds = launch.builds();
    assert_eq!(checked_bundle(&root.0.join("speechcpp-cpu"), &launch.pins).unwrap().1, Build::Cpu);
    let listed = survey(&builds, &None);
    assert_eq!((listed.gpu_build, listed.cpu_build), ("ready", "separate"));
    assert_eq!(listed.gpus.iter().map(|gpu| gpu.name.as_str()).collect::<Vec<_>>(), ["Vulkan0"]);

    let root = Folder::new();
    let listed = survey(&linux(&root.0, Pc::NoLoader).builds(), &None);
    assert_eq!((listed.gpu_build, listed.cpu_build, listed.gpus.len()), ("unavailable", "separate", 0));

    let root = Folder::new();
    let listed = survey(&windows(&root.0, Pc::Gpu).builds(), &None);
    assert_eq!((listed.gpu_build, listed.cpu_build, listed.gpus.len()), ("ready", "shared", 1));

    let listed = survey(&Builds::default(), &None);
    assert_eq!((listed.gpu_build, listed.cpu_build), ("missing", "missing"));
}
