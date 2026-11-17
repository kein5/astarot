//! The consent-gated setup of the RVC worker's runtime (`runtime_setup.py`, the native kind).
//!
//! The worker (`vrct-rvc-worker`) ships with the app. What it loads does not: ONNX Runtime
//! (with its CUDA provider and NVIDIA's CUDA and cuDNN libraries on a PC with an NVIDIA
//! driver, the CPU build otherwise) and the two fixed networks. They are fetched from pinned
//! sources after the user's consent, checked against their sizes and SHA-256, and unpacked
//! into `<root>/rvc`. A failed or cancelled setup keeps each finished step and continues from
//! there. The Seed-VC runtime (a Python environment) is not offered: it ended with Python.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::Duration;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use vrct_ops::downloads::staging::RootLease;
use vrct_ops::downloads::transport::{Aborter, Transport};

use crate::archive::{unpack_members, ArchiveError};
use crate::child;

const CHUNK: usize = 1024 * 1024;
const ACTIVE: [&str; 5] = ["queued", "libraries", "assets", "verifying", "cancelling"];
const STEPS: [&str; 3] = ["libraries", "assets", "verifying"];

/// The hosts the setup may fetch from: Hugging Face (the model downloads' hosts), GitHub's
/// releases and PyPI's files.
pub const SOURCE_HOSTS: [&str; 11] = [
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.hf.co",
    "cdn-lfs-eu-1.hf.co",
    "cas-bridge.xethub.hf.co",
    "us.aws.cdn.hf.co",
    "github.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "files.pythonhosted.org",
];

const RVC_REPO: &str = "lj1995/VoiceConversionWebUI";
const RVC_REVISION: &str = "e6d0c1a17da07c33557852f9dfa2bd44cc75737d";
const ORT_VERSION: &str = "1.31.0";
const PYPI: &str = "https://files.pythonhosted.org/packages/";

/// The platforms a runtime can be set up for (`target()`): Windows and Linux on x86-64.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Windows,
    Linux,
}

impl Target {
    /// This PC, or `None` where nothing is offered.
    pub fn current() -> Option<Self> {
        if cfg!(windows) {
            Some(Target::Windows)
        } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            Some(Target::Linux)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    pub url: String,
    /// Under the runtime's `assets/`.
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

/// A pinned archive and the files taken from it into `lib/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Library {
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub members: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    pub id: &'static str,
    pub name: &'static str,
    pub assets: Vec<Asset>,
    pub license: &'static str,
    pub licenses: Vec<String>,
    pub notice: &'static str,
    pub download_bytes: u64,
    pub disk_bytes: u64,
    pub libraries: Vec<Library>,
    /// What the setup's probe checks: `cuda` or `cpu`.
    pub device: &'static str,
}

fn hf_url(path: &str) -> String {
    format!("https://huggingface.co/{RVC_REPO}/resolve/{RVC_REVISION}/{path}")
}

fn ort(name: &str, size: u64, sha256: &str, files: &[(&str, &str)]) -> Library {
    let folder = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
    let folder = folder.strip_suffix(".tar").unwrap_or(folder);
    Library {
        url: format!("https://github.com/microsoft/onnxruntime/releases/download/v{ORT_VERSION}/{name}"),
        size,
        sha256: sha256.into(),
        members: files.iter().map(|(source, target)| (format!("{folder}/lib/{source}"), (*target).to_owned())).collect(),
    }
}

fn wheel(path: &str, size: u64, sha256: &str, folder: &str, names: &[&str]) -> Library {
    Library {
        url: format!("{PYPI}{path}"),
        size,
        sha256: sha256.into(),
        members: names.iter().map(|name| (format!("nvidia/{folder}/{name}"), name.rsplit('/').next().unwrap_or(name).to_owned())).collect(),
    }
}

fn cudnn(windows: bool) -> Vec<String> {
    ["", "_adv", "_cnn", "_engines_precompiled", "_engines_runtime_compiled", "_engines_tensor_ir", "_ext", "_graph", "_heuristic", "_ops"]
        .iter()
        .map(|part| if windows { format!("bin/cudnn{part}64_9.dll") } else { format!("lib/libcudnn{part}.so.9") })
        .collect()
}

fn gpu_libraries(target: Target) -> Vec<Library> {
    match target {
        Target::Linux => {
            let cudnn = cudnn(false);
            let cudnn: Vec<&str> = cudnn.iter().map(String::as_str).collect();
            vec![
                ort(
                    &format!("onnxruntime-linux-x64-gpu_cuda13-{ORT_VERSION}.tgz"),
                    244574938,
                    "2867dec99c6a4926e8142361b9d4d1518c16c85b854b4d41d28d65d3b2c81135",
                    &[
                        (&format!("libonnxruntime.so.{ORT_VERSION}"), "libonnxruntime.so"),
                        ("libonnxruntime_providers_cuda.so", "libonnxruntime_providers_cuda.so"),
                        ("libonnxruntime_providers_shared.so", "libonnxruntime_providers_shared.so"),
                    ],
                ),
                wheel(
                    "98/8a/3431271f6344874b8f1ac03f16b3d679c91493f8da63f716160403e6d0a0/nvidia_cuda_runtime-13.4.92-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
                    2494438,
                    "9641f797da20ce1dd8e779b6e96d08cf9ba564cec8e8225458811ee26423f3a5",
                    "cu13",
                    &["lib/libcudart.so.13"],
                ),
                wheel(
                    "7a/38/bdd540bf511d2c9b6f9efc71a81c60cb88e295be0b9312b61d19bbed2212/nvidia_cublas-13.8.0.4-py3-none-manylinux_2_27_x86_64.whl",
                    439317144,
                    "9f17797dfcc048694461f4e47de17d2e3c25adf172ef723d2db0a07cd8744b89",
                    "cu13",
                    &["lib/libcublas.so.13", "lib/libcublasLt.so.13"],
                ),
                wheel(
                    "07/73/3ee8e5b4cb891401e603ffd3a59b35c6afe785fd2de123afe7c7029603dc/nvidia_curand-10.4.4.72-py3-none-manylinux_2_27_x86_64.whl",
                    61498332,
                    "25c3457ae7a224fdd484dab90b0fc5dc0e842fab5db3012afa4a5bd2af4eb7e5",
                    "cu13",
                    &["lib/libcurand.so.10"],
                ),
                wheel(
                    "56/9c/1342ebb460ce2afd014ec5a002adc99108e3c53a6b70f399cf64dd1f267d/nvidia_cuda_nvrtc-13.4.92-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl",
                    53301733,
                    "5ce8c97b00b232c4f50c8c4b5a3b68cafee08bdb82ea86f2052ff01d03194f4a",
                    "cu13",
                    &["lib/libnvrtc.so.13", "lib/libnvrtc-builtins.so.13.4"],
                ),
                wheel(
                    "c6/7d/2e59397de3d8dc9ff80c56f6770e9e21a818dfffc8e07a1b673fa3ef7cf6/nvidia_cudnn_cu13-9.26.1.1-py3-none-manylinux_2_27_x86_64.whl",
                    519150496,
                    "c709224270fbfb5c51248422b468dc258461a723a8d5a21f50111614b36b8c53",
                    "cudnn",
                    &cudnn,
                ),
            ]
        }
        Target::Windows => {
            let cudnn = cudnn(true);
            let cudnn: Vec<&str> = cudnn.iter().map(String::as_str).collect();
            let names = ["onnxruntime.dll", "onnxruntime_providers_cuda.dll", "onnxruntime_providers_shared.dll"];
            vec![
                ort(&format!("onnxruntime-win-x64-gpu_cuda13-{ORT_VERSION}.zip"), 309484217, "d332ccf84acb769a11364cddd4e8d2992a168d16be472d5ba70b279b644552f5", &names.map(|n| (n, n))),
                wheel(
                    "86/00/d5436004268f049214193659ebc36550b5ef3925c3d13b4cc980e13be6f5/nvidia_cuda_runtime-13.4.92-py3-none-win_amd64.whl",
                    2778543,
                    "08dca5e4aba480c2fd5b55075c0fa71b84ef9dcf0521f2d58baa14a803a7311c",
                    "cu13",
                    &["bin/x86_64/cudart64_13.dll"],
                ),
                wheel(
                    "a3/df/f1246959833e2c437db8be3e5b477f66b87f8817821ed40de6c7561c9a36/nvidia_cublas-13.8.0.4-py3-none-win_amd64.whl",
                    423266897,
                    "8c5494423bb8a46822cb6b0cb95d7fa4be2d7b96a31155dff083839ec8297910",
                    "cu13",
                    &["bin/x86_64/cublas64_13.dll", "bin/x86_64/cublasLt64_13.dll"],
                ),
                wheel(
                    "e2/d4/f59ab342b82ff05ff27d674acd470ba625d788bf71338f7da6c89669d6b9/nvidia_curand-10.4.4.72-py3-none-win_amd64.whl",
                    56731059,
                    "e0bce83e083ef25976ee74f59e8f067c15149a74538f1be6c2462e286e7c9c68",
                    "cu13",
                    &["bin/x86_64/curand64_10.dll"],
                ),
                wheel(
                    "64/5b/aa91896f64444eff1dd7f189f4db05046c7f0ba08c0f531283c1c1aac581/nvidia_cuda_nvrtc-13.4.92-py3-none-win_amd64.whl",
                    46972283,
                    "6af7ac5372920f6a7a560d0699348560fe44cb52c1d722d6afd3119f8af948c4",
                    "cu13",
                    &["bin/x86_64/nvrtc64_130_0.dll", "bin/x86_64/nvrtc-builtins64_134.dll"],
                ),
                wheel(
                    "e6/08/487121df1a5a5935d7619b81fa058925321a5d7b589c100200fda73af2ae/nvidia_cudnn_cu13-9.26.1.1-py3-none-win_amd64.whl",
                    419604428,
                    "8c73be203ea71f9560b062bccfc0df7a5974b9ccf61ba941b926a3237cb76afc",
                    "cudnn",
                    &cudnn,
                ),
            ]
        }
    }
}

fn cpu_libraries(target: Target) -> Vec<Library> {
    match target {
        Target::Linux => vec![ort(
            &format!("onnxruntime-linux-x64-{ORT_VERSION}.tgz"),
            11408003,
            "cc5c72baf5ae5c8238a6841f0897227be2d02826b9cf98eaf02fdefaeeb03a57",
            &[(&format!("libonnxruntime.so.{ORT_VERSION}"), "libonnxruntime.so")],
        )],
        Target::Windows => {
            vec![ort(&format!("onnxruntime-win-x64-{ORT_VERSION}.zip"), 82887349, "3958d8a44984160692c1b4ffd0de3cb48f8c39f9d34bb31e433db06e30b82195", &[("onnxruntime.dll", "onnxruntime.dll")])]
        }
    }
}

/// Only what the worker reads: the HuBERT checkpoint and the RMVPE network.
fn rvc_assets() -> Vec<Asset> {
    vec![
        Asset { url: hf_url("hubert_base/config.json"), path: "hubert_base/config.json".into(), size: 1492, sha256: "0346950779dfb7f9316fa74ed846e2b8a22a08eedfdc5387b73f327cb1a4a7cf".into() },
        Asset {
            url: hf_url("hubert_base/pytorch_model.bin"),
            path: "hubert_base/pytorch_model.bin".into(),
            size: 189206711,
            sha256: "cc8c20f4b90a520757260197a3ff2505705a7adbd20ad9eeaa4e1a9b38442ef5".into(),
        },
        Asset { url: hf_url("rmvpe.onnx"), path: "rmvpe/rmvpe.onnx".into(), size: 361688443, sha256: "5370e71ac80af8b4b7c793d27efd51fd8bf962de3a7ede0766dac0befa3660fd".into() },
    ]
}

/// The GPU runtime on a PC with an NVIDIA driver, else the CPU one; both in the same folder.
pub fn rvc_runtime(target: Target, gpu: bool) -> Runtime {
    let libraries = if gpu { gpu_libraries(target) } else { cpu_libraries(target) };
    let assets = rvc_assets();
    let mut licenses = vec![format!("https://github.com/microsoft/onnxruntime/blob/v{ORT_VERSION}/LICENSE"), format!("https://huggingface.co/{RVC_REPO}")];
    if gpu {
        licenses.push("https://docs.nvidia.com/cuda/eula/index.html".into());
        licenses.push("https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html".into());
    }
    let disk = match (target, gpu) {
        (Target::Linux, true) => 3_300_000_000,
        (Target::Windows, true) => 2_700_000_000,
        (Target::Linux, false) => 700_000_000,
        (Target::Windows, false) => 800_000_000,
    };
    Runtime {
        id: "rvc",
        name: "RVC",
        download_bytes: libraries.iter().map(|l| l.size).sum::<u64>() + assets.iter().map(|a| a.size).sum::<u64>(),
        assets,
        license: if gpu { "MIT, NVIDIA CUDA/cuDNN EULA" } else { "MIT" },
        licenses,
        notice: if gpu { "rvc" } else { "rvc_cpu" },
        disk_bytes: disk,
        libraries,
        device: if gpu { "cuda" } else { "cpu" },
    }
}

/// `json.dumps(value, sort_keys=True)`: sorted keys, `", "` and `": "`, ASCII only.
fn python_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(text) => {
            out.push('"');
            for c in text.chars() {
                match c {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                        let mut units = [0u16; 2];
                        for unit in c.encode_utf16(&mut units) {
                            out.push_str(&format!("\\u{unit:04x}"));
                        }
                    }
                    c => out.push(c),
                }
            }
            out.push('"');
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push_str(", ");
                }
                python_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push_str(", ");
                }
                python_json(&Value::String((*key).clone()), out);
                out.push_str(": ");
                python_json(&map[*key], out);
            }
            out.push('}');
        }
    }
}

/// Changes with anything the user consented to or that changes the install. The same text as
/// the Python setup wrote into `receipt.json`, so a runtime it set up stays installed.
pub fn version_of(runtime: &Runtime) -> String {
    let document = json!({
        "id": runtime.id, "name": runtime.name, "python": "", "locks": [], "source_url": "", "source_digest": "", "patch": "",
        "assets": runtime.assets.iter().map(|a| json!({"url": a.url, "path": a.path, "size": a.size, "sha256": a.sha256, "blob": ""})).collect::<Vec<_>>(),
        "license": runtime.license, "licenses": runtime.licenses, "notice": runtime.notice,
        "download_bytes": runtime.download_bytes, "disk_bytes": runtime.disk_bytes, "kind": "native",
        "libraries": runtime.libraries.iter().map(|l| json!({"url": l.url, "size": l.size, "sha256": l.sha256, "members": l.members.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "device": runtime.device, "requires_gpu": false,
    });
    let mut text = String::new();
    python_json(&document, &mut text);
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// The SHA-256 of `data` as lowercase hex, as the pins are written.
pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether an NVIDIA driver is there (only a file is looked for; the runtime answers for itself
/// once installed).
pub fn nvidia_driver() -> bool {
    if cfg!(windows) {
        let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        root.join("System32").join("nvcuda.dll").is_file()
    } else {
        Path::new("/proc/driver/nvidia/version").is_file()
    }
}

/// How the setup reaches outside.
#[derive(Clone)]
pub struct SetupOptions {
    /// `<state>/vc_runtimes`: a runtime is set up in `<root>/<id>`.
    pub root: PathBuf,
    pub target: Option<Target>,
    pub transport: Arc<dyn Transport>,
    pub gpu_check: Arc<dyn Fn() -> bool + Send + Sync>,
    /// The bundled worker that probes a runtime after its files are in place.
    pub worker: PathBuf,
    pub free_space: Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>,
    /// What is offered in place of the pinned runtime (tests).
    pub entries: Option<Vec<Runtime>>,
}

#[derive(Debug)]
enum StepError {
    Cancelled,
    Code(&'static str),
    Io(std::io::Error),
    Failed,
}

impl From<std::io::Error> for StepError {
    fn from(error: std::io::Error) -> Self {
        StepError::Io(error)
    }
}

impl From<ArchiveError> for StepError {
    fn from(error: ArchiveError) -> Self {
        match error {
            ArchiveError::Refused(code) => StepError::Code(code),
            ArchiveError::Io(error) => StepError::Io(error),
        }
    }
}

struct Inner {
    closed: bool,
    jobs: Vec<(String, Map<String, Value>)>,
    thread: Option<thread::JoinHandle<()>>,
    cancel: Option<Arc<AtomicBool>>,
    aborter: Option<Aborter>,
    child: Option<Arc<Mutex<Child>>>,
}

struct Shared {
    options: SetupOptions,
    inner: Mutex<Inner>,
    closing: AtomicBool,
    entries: OnceLock<Vec<Runtime>>,
}

/// The runtime setups of this app and their state.
pub struct RuntimeSetup {
    shared: Arc<Shared>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ns() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())
}

impl RuntimeSetup {
    pub fn new(options: SetupOptions) -> Self {
        Self {
            shared: Arc::new(Shared {
                options,
                inner: Mutex::new(Inner { closed: false, jobs: Vec::new(), thread: None, cancel: None, aborter: None, child: None }),
                closing: AtomicBool::new(false),
                entries: OnceLock::new(),
            }),
        }
    }

    pub fn catalog(&self) -> Value {
        let shared = &self.shared;
        let entries = shared.entries();
        let gpu = !entries.is_empty() && (shared.options.gpu_check)();
        let rows: Vec<Value> = entries
            .iter()
            .map(|runtime| {
                json!({
                    "id": runtime.id, "name": runtime.name, "version": version_of(runtime), "license": runtime.license,
                    "licenses": runtime.licenses, "notice": runtime.notice, "download_bytes": runtime.download_bytes,
                    "disk_bytes": runtime.disk_bytes, "destination": shared.folder(runtime).to_string_lossy(),
                    "gpu_ready": gpu, "requires_gpu": false, "device": runtime.device,
                })
            })
            .collect();
        json!({ "runtimes": rows })
    }

    pub fn state(&self) -> Value {
        self.shared.state()
    }

    /// `{"id", "consent": true, "version"}`: start (or continue) a setup.
    pub fn start(&self, request: &Value) -> Result<Value, &'static str> {
        let shared = &self.shared;
        let object = request.as_object().filter(|o| o.len() == 3 && ["id", "consent", "version"].iter().all(|k| o.contains_key(*k))).ok_or("vc_runtime_request_invalid")?;
        if object["consent"] != Value::Bool(true) {
            return Err("consent_required");
        }
        let runtime = object["id"].as_str().and_then(|id| shared.entries().iter().find(|r| r.id == id)).cloned().ok_or("vc_runtime_changed")?;
        if object["version"].as_str() != Some(version_of(&runtime).as_str()) {
            return Err("vc_runtime_changed");
        }
        let mut inner = locked(&shared.inner);
        if inner.closed || shared.closing.load(Ordering::SeqCst) {
            return Err("vc_runtime_closed");
        }
        if inner.jobs.iter().any(|(_, job)| ACTIVE.contains(&job["phase"].as_str().unwrap_or(""))) {
            return Err("vc_runtime_busy");
        }
        let job = json!({
            "job_id": uuid::Uuid::new_v4().simple().to_string(), "phase": "queued", "step": 0, "steps": STEPS.len(),
            "warning_code": null, "received_bytes": 0, "total_bytes": 0, "error_code": null, "path": null,
        });
        let Value::Object(job) = job else { unreachable!() };
        inner.jobs.retain(|(id, _)| id != runtime.id);
        inner.jobs.push((runtime.id.to_owned(), job));
        let cancel = Arc::new(AtomicBool::new(false));
        inner.cancel = Some(cancel.clone());
        let previous = inner.thread.take();
        let worker = shared.clone();
        inner.thread = Some(
            thread::Builder::new()
                .name("vc-runtime-setup".into())
                .spawn(move || {
                    if let Some(previous) = previous {
                        let _ = previous.join();
                    }
                    worker.install(&runtime, &cancel);
                })
                .map_err(|_| "vc_runtime_failed")?,
        );
        drop(inner);
        Ok(shared.state())
    }

    pub fn cancel(&self, id: &str, job_id: &str) -> Result<Value, &'static str> {
        let shared = &self.shared;
        {
            let mut inner = locked(&shared.inner);
            let job = inner.jobs.iter_mut().find(|(key, _)| key == id).map(|(_, job)| job).filter(|job| job["job_id"] == job_id).ok_or("stale_job")?;
            if ACTIVE.contains(&job["phase"].as_str().unwrap_or("")) {
                job.insert("phase".into(), json!("cancelling"));
                if let Some(cancel) = &inner.cancel {
                    cancel.store(true, Ordering::SeqCst);
                }
                Shared::interrupt(&inner);
            }
        }
        Ok(shared.state())
    }

    /// Signal cancellation without waiting.
    pub fn request_close(&self) {
        self.shared.closing.store(true, Ordering::SeqCst);
        let inner = locked(&self.shared.inner);
        if let Some(cancel) = &inner.cancel {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Stop a running setup and wait up to `timeout` for it.
    pub fn close(&self, timeout: Duration) -> bool {
        self.request_close();
        let thread = {
            let mut inner = locked(&self.shared.inner);
            inner.closed = true;
            Shared::interrupt(&inner);
            inner.thread.take()
        };
        let Some(thread) = thread else { return true };
        let deadline = std::time::Instant::now() + timeout;
        while !thread.is_finished() {
            if std::time::Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = thread.join();
        true
    }
}

impl Shared {
    fn entries(&self) -> &Vec<Runtime> {
        // Asking for the driver waits until a setup page needs it, not app start.
        self.entries.get_or_init(|| match &self.options.entries {
            Some(entries) => entries.clone(),
            None => self.options.target.map(|target| vec![rvc_runtime(target, (self.options.gpu_check)())]).unwrap_or_default(),
        })
    }

    fn folder(&self, runtime: &Runtime) -> PathBuf {
        self.options.root.join(runtime.id)
    }

    /// What counts as installed: the entry, and for the CPU runtime also the GPU one (it runs
    /// on the CPU too, so a driver missing for a moment does not make it look gone).
    fn variants(&self, runtime: &Runtime) -> Vec<Runtime> {
        let mut variants = vec![runtime.clone()];
        if runtime.device == "cpu"
            && self.options.entries.is_none()
            && let Some(target) = self.options.target
        {
            variants.push(rvc_runtime(target, true));
        }
        variants
    }

    fn installed(&self, runtime: &Runtime) -> bool {
        let folder = self.folder(runtime);
        let Ok(text) = fs::read_to_string(folder.join("receipt.json")) else { return false };
        let Ok(receipt) = serde_json::from_str::<Value>(&text) else { return false };
        let Some(version) = receipt.get("version").and_then(Value::as_str) else { return false };
        let Some(installed) = self.variants(runtime).into_iter().find(|item| version_of(item) == version) else { return false };
        installed.libraries.iter().all(|l| l.members.iter().all(|(_, name)| folder.join("lib").join(name).is_file())) && installed.assets.iter().all(|a| folder.join("assets").join(&a.path).is_file())
    }

    fn state(&self) -> Value {
        let inner = locked(&self.inner);
        let jobs: Map<String, Value> = inner.jobs.iter().map(|(id, job)| (id.clone(), Value::Object(job.clone()))).collect();
        drop(inner);
        let installed: Map<String, Value> = self.entries().iter().filter(|r| self.installed(r)).map(|r| (r.id.to_owned(), json!(self.folder(r).to_string_lossy()))).collect();
        json!({ "observation_id": now_ns().to_string(), "jobs": jobs, "installed": installed })
    }

    fn interrupt(inner: &Inner) {
        if let Some(aborter) = &inner.aborter {
            aborter.abort();
        }
        if let Some(child) = &inner.child {
            let _ = locked(child).kill();
        }
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Map<String, Value>)) {
        let mut inner = locked(&self.inner);
        if let Some((_, job)) = inner.jobs.iter_mut().find(|(key, _)| key == id) {
            change(job);
        }
    }

    fn add_received(&self, id: &str, count: u64) {
        self.update(id, |job| {
            let received = job["received_bytes"].as_u64().unwrap_or(0) + count;
            job.insert("received_bytes".into(), json!(received));
        });
    }

    fn checkpoint(&self, cancel: &AtomicBool) -> Result<(), StepError> {
        if cancel.load(Ordering::SeqCst) || self.closing.load(Ordering::SeqCst) {
            Err(StepError::Cancelled)
        } else {
            Ok(())
        }
    }

    /// Fetch `url` into `target` through `<target>.part`, checking its size and SHA-256.
    #[allow(clippy::too_many_arguments)]
    fn fetch(&self, id: &str, url: &str, target: &Path, size: u64, sha256: &str, cancel: &AtomicBool, progress: bool) -> Result<(), StepError> {
        let part = target.with_file_name(format!("{}.part", target.file_name().and_then(|n| n.to_str()).unwrap_or("download")));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut body = self.options.transport.open(url).map_err(|_| StepError::Failed)?;
        {
            let mut inner = locked(&self.inner);
            inner.aborter = body.aborter();
            drop(inner);
            self.checkpoint(cancel)?;
        }
        let result = (|| -> Result<(), StepError> {
            let mut output = File::create(&part)?;
            let mut digest = Sha256::new();
            let mut received = 0u64;
            let mut buffer = vec![0u8; CHUNK];
            loop {
                let count = body.read(&mut buffer).map_err(|error| if cancel.load(Ordering::SeqCst) || self.closing.load(Ordering::SeqCst) { StepError::Cancelled } else { StepError::Io(error) })?;
                if count == 0 {
                    break;
                }
                self.checkpoint(cancel)?;
                received += count as u64;
                if received > size {
                    return Err(StepError::Code("size_mismatch"));
                }
                output.write_all(&buffer[..count])?;
                digest.update(&buffer[..count]);
                if progress {
                    self.add_received(id, count as u64);
                }
            }
            output.flush()?;
            drop(output);
            let hex: String = digest.finalize().iter().map(|b| format!("{b:02x}")).collect();
            if received != size || hex != sha256 {
                let _ = fs::remove_file(&part);
                return Err(StepError::Code("hash_mismatch"));
            }
            fs::rename(&part, target)?;
            Ok(())
        })();
        locked(&self.inner).aborter = None;
        result
    }

    fn file_digest(&self, path: &Path, cancel: &AtomicBool) -> Result<String, StepError> {
        let mut file = File::open(path)?;
        let mut digest = Sha256::new();
        let mut buffer = vec![0u8; CHUNK];
        loop {
            self.checkpoint(cancel)?;
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        Ok(digest.finalize().iter().map(|b| format!("{b:02x}")).collect())
    }

    /// Each archive in turn: fetched, checked, its files taken, then deleted, so only one
    /// archive is on disk at a time. A resumed setup skips the archives it finished.
    fn libraries(&self, runtime: &Runtime, cancel: &AtomicBool) -> Result<(), StepError> {
        let folder = self.folder(runtime);
        let (staging, target, downloads) = (folder.join("lib.part"), folder.join("lib"), folder.join("downloads"));
        let record = staging.join(".archives.json");
        let total: u64 = runtime.libraries.iter().map(|l| l.size).sum();
        self.update(runtime.id, |job| {
            job.insert("total_bytes".into(), json!(total));
        });
        fs::create_dir_all(&staging)?;
        let mut done: Vec<String> = fs::read_to_string(&record).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        for library in &runtime.libraries {
            self.checkpoint(cancel)?;
            if done.contains(&library.sha256) {
                self.add_received(runtime.id, library.size);
                continue;
            }
            let name = library.url.rsplit('/').next().unwrap_or("archive");
            let archive = downloads.join(name);
            let kept = archive.is_file() && fs::metadata(&archive).map(|m| m.len()).ok() == Some(library.size) && self.file_digest(&archive, cancel)? == library.sha256;
            if kept {
                self.add_received(runtime.id, library.size);
            } else {
                self.fetch(runtime.id, &library.url, &archive, library.size, &library.sha256, cancel, true)?;
            }
            unpack_members(&archive, &library.members, &staging)?;
            fs::remove_file(&archive)?;
            done.push(library.sha256.clone());
            fs::write(&record, serde_json::to_string(&done).expect("strings serialize"))?;
        }
        fs::remove_file(&record)?;
        let _ = fs::remove_dir_all(&target);
        fs::rename(&staging, &target)?;
        let _ = fs::remove_dir_all(&downloads);
        Ok(())
    }

    fn assets(&self, runtime: &Runtime, cancel: &AtomicBool) -> Result<(), StepError> {
        let total: u64 = runtime.assets.iter().map(|a| a.size).sum();
        self.update(runtime.id, |job| {
            job.insert("total_bytes".into(), json!(total));
        });
        for asset in &runtime.assets {
            let target = self.folder(runtime).join("assets").join(&asset.path);
            if target.is_file() && fs::metadata(&target).map(|m| m.len()).ok() == Some(asset.size) && self.file_digest(&target, cancel)? == asset.sha256 {
                self.add_received(runtime.id, asset.size);
                continue;
            }
            self.fetch(runtime.id, &asset.url, &target, asset.size, &asset.sha256, cancel, true)?;
        }
        Ok(())
    }

    /// The worker loads the libraries and runs one operation on the device. The GPU runtime is
    /// still usable on the CPU when the GPU cannot run it: exit 3 then, and a warning.
    fn verifying(&self, runtime: &Runtime, cancel: &AtomicBool) -> Result<(), StepError> {
        let device = if runtime.device == "cpu" { "cpu" } else { "auto" };
        let mut command = Command::new(&self.options.worker);
        command.arg("--runtime").arg(self.folder(runtime)).arg("--probe").arg("--device").arg(device).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let owned = child::spawn(command).map_err(|_| StepError::Failed)?;
        let child = Arc::new(Mutex::new(owned.child));
        locked(&self.inner).child = Some(child.clone());
        // The job (Windows) is held by `owned`'s remains until the probe ends.
        let code = loop {
            if self.checkpoint(cancel).is_err() {
                let _ = locked(&child).kill();
                let _ = locked(&child).wait();
                locked(&self.inner).child = None;
                return Err(StepError::Cancelled);
            }
            match locked(&child).try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {}
                Err(_) => break None,
            }
            thread::sleep(Duration::from_millis(50));
        };
        locked(&self.inner).child = None;
        self.checkpoint(cancel)?;
        match (code, device) {
            (Some(0), _) => Ok(()),
            (Some(3), "auto") => {
                self.update(runtime.id, |job| {
                    job.insert("warning_code".into(), json!("vc_runtime_gpu_unusable_cpu"));
                });
                Ok(())
            }
            _ => Err(StepError::Failed),
        }
    }

    fn install(self: &Arc<Self>, runtime: &Runtime, cancel: &Arc<AtomicBool>) {
        let folder = self.folder(runtime);
        let marker = folder.join(".steps.json");
        let version = version_of(runtime);
        let mut lease = RootLease::new(&self.options.root);
        let mut step = STEPS[0];
        let result = (|| -> Result<(), StepError> {
            fs::create_dir_all(&self.options.root)?;
            lease.acquire().map_err(|error| if error.code() == Some("download_busy") { StepError::Code("download_busy") } else { StepError::Failed })?;
            fs::create_dir_all(&folder)?;
            let mut finished: Value = fs::read_to_string(&marker).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null);
            if finished.get("version").and_then(Value::as_str) != Some(version.as_str()) || !finished["steps"].is_array() {
                finished = json!({ "version": version, "steps": [] });
            }
            let fresh = finished["steps"].as_array().is_some_and(Vec::is_empty);
            if fresh && (self.options.free_space)(&self.options.root).is_some_and(|free| free < runtime.disk_bytes) {
                return Err(StepError::Code("space"));
            }
            for (number, name) in STEPS.iter().enumerate() {
                self.checkpoint(cancel)?;
                step = name;
                self.update(runtime.id, |job| {
                    if job["phase"] != "cancelling" {
                        job.insert("phase".into(), json!(name));
                        job.insert("step".into(), json!(number + 1));
                        job.insert("received_bytes".into(), json!(0));
                        job.insert("total_bytes".into(), json!(0));
                    }
                });
                if finished["steps"].as_array().is_some_and(|steps| steps.iter().any(|s| s == name)) {
                    continue;
                }
                match *name {
                    "libraries" => self.libraries(runtime, cancel)?,
                    "assets" => self.assets(runtime, cancel)?,
                    _ => self.verifying(runtime, cancel)?,
                }
                finished["steps"].as_array_mut().expect("an array").push(json!(name));
                fs::write(&marker, finished.to_string())?;
            }
            self.checkpoint(cancel)?;
            fs::write(folder.join("receipt.json"), json!({ "version": version, "id": runtime.id }).to_string())?;
            // Steps resume a setup, not a finished runtime: a repair must run them again.
            let _ = fs::remove_file(&marker);
            let _ = fs::remove_dir_all(folder.join(".cache"));
            remove_earlier_rvc(&folder);
            Ok(())
        })();
        lease.close();
        let cancelled = cancel.load(Ordering::SeqCst) || self.closing.load(Ordering::SeqCst);
        let terminal = match result {
            Ok(()) => json!({ "phase": "ready", "path": folder.to_string_lossy(), "error_code": null }),
            Err(StepError::Cancelled) => json!({ "phase": "cancelled" }),
            Err(_) if cancelled => json!({ "phase": "cancelled" }),
            Err(error) => {
                let code = match &error {
                    StepError::Code("download_busy") => "vc_runtime_busy",
                    StepError::Code("space") => "vc_runtime_space",
                    StepError::Io(error) if is_disk_full(error) => "vc_runtime_space",
                    _ if step == "libraries" => "vc_runtime_libraries_failed",
                    _ if step == "assets" => "vc_runtime_assets_failed",
                    _ => "vc_runtime_check_failed",
                };
                json!({ "phase": "failed", "error_code": code })
            }
        };
        let mut inner = locked(&self.inner);
        inner.aborter = None;
        inner.child = None;
        if let Some((_, job)) = inner.jobs.iter_mut().find(|(key, _)| key == runtime.id) {
            for (key, value) in terminal.as_object().expect("an object") {
                job.insert(key.clone(), value.clone());
            }
        }
    }
}

fn is_disk_full(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(libc::ENOSPC)
    }
    #[cfg(windows)]
    {
        // ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL
        matches!(error.raw_os_error(), Some(112) | Some(39))
    }
}

/// What the earlier, PyTorch-based RVC runtime setup put in this same folder. Only these
/// names are touched; a file goes only if it is the pinned file that setup placed.
const EARLIER_RVC_FILES: [(&str, Option<u64>, Option<&str>); 3] = [
    ("assets/rmvpe/rmvpe.pt", Some(181184272), Some("6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193")),
    ("assets/hubert_base/preprocessor_config.json", Some(225), Some("7c1976a680fb7acc757cd36fb08eef878fa36c70b4c9d2d595df9c608bbbbf0e")),
    ("engine.zip", None, None),
];

/// Files a user may have put in the engine folder (models, indexes, recordings); kept.
const USER_SUFFIXES: [&str; 15] = [".pth", ".index", ".onnx", ".pt", ".ckpt", ".safetensors", ".bin", ".npy", ".wav", ".flac", ".mp3", ".ogg", ".m4a", ".zip", ".7z"];

/// Remove a folder without following links, keeping what `keep` names (and the folders on the
/// way). Returns whether anything was kept.
fn remove_tree(path: &Path, keep: &dyn Fn(&Path) -> bool) -> std::io::Result<bool> {
    let mut kept = false;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if remove_tree(&child, keep)? {
                kept = true;
                continue;
            }
            fs::remove_dir(&child)?;
        } else if keep(&child) {
            kept = true;
        } else {
            fs::remove_file(&child)?;
        }
    }
    Ok(kept)
}

/// Delete what the earlier PyTorch RVC runtime installed in the app's own runtime folder: the
/// virtual environment, uv's Python, the engine source (keeping user files) and the weights
/// the new runtime does not use. Failures are ignored.
pub fn remove_earlier_rvc(folder: &Path) -> Vec<String> {
    let mut removed = Vec::new();
    let mut remove = |name: &str, keep: &dyn Fn(&Path) -> bool| {
        let path = folder.join(name);
        let Ok(meta) = fs::symlink_metadata(&path) else { return };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return;
        }
        if let Ok(kept) = remove_tree(&path, keep)
            && (kept || fs::remove_dir(&path).is_ok())
        {
            removed.push(name.to_owned());
        }
    };
    if folder.join("venv").join("pyvenv.cfg").is_file() {
        remove("venv", &|_| false);
    }
    let python = folder.join("python");
    if fs::symlink_metadata(&python).is_ok_and(|m| m.is_dir()) {
        let only_uv = fs::read_dir(&python)
            .map(|entries| entries.flatten().all(|e| e.file_name().to_string_lossy().starts_with("cpython-") || e.file_name().to_string_lossy().starts_with('.')))
            .unwrap_or(false);
        if only_uv {
            remove("python", &|_| false);
        }
    }
    let user_file = |file: &Path| file.extension().and_then(|e| e.to_str()).is_some_and(|e| USER_SUFFIXES.contains(&format!(".{}", e.to_lowercase()).as_str()));
    for name in ["engine", "engine.part"] {
        remove(name, &user_file);
    }
    let names: HashSet<&str> = EARLIER_RVC_FILES.iter().map(|(name, _, _)| *name).collect();
    for (name, size, sha256) in EARLIER_RVC_FILES {
        debug_assert!(names.contains(name));
        let path = folder.join(name);
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.file_type().is_symlink() || !meta.is_file() || size.is_some_and(|size| meta.len() != size) {
            continue;
        }
        if let Some(expected) = sha256 {
            let Ok(data) = fs::read(&path) else { continue };
            let hex: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
            if hex != expected {
                continue;
            }
        }
        if fs::remove_file(&path).is_ok() {
            removed.push(name.to_owned());
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_the_ones_the_python_setup_wrote() {
        // Computed with `runtime_setup.version_of(rvc_runtime(gpu))` for each platform.
        assert_eq!(version_of(&rvc_runtime(Target::Windows, true)), "0670490dc81d981c");
        assert_eq!(version_of(&rvc_runtime(Target::Windows, false)), "eb13d6b8d11ff57b");
        assert_eq!(version_of(&rvc_runtime(Target::Linux, true)), "6dc6eeaed06a95db");
        assert_eq!(version_of(&rvc_runtime(Target::Linux, false)), "0b7aa8b46f79b83f");
        assert_eq!(rvc_runtime(Target::Windows, true).download_bytes, 1809734073);
        assert_eq!(rvc_runtime(Target::Linux, false).download_bytes, 562304649);
    }

    #[test]
    fn the_earlier_runtime_goes_and_user_files_stay() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path();
        fs::create_dir_all(folder.join("venv")).unwrap();
        fs::write(folder.join("venv/pyvenv.cfg"), "x").unwrap();
        fs::create_dir_all(folder.join("engine/weights")).unwrap();
        fs::write(folder.join("engine/weights/voice.pth"), "model").unwrap();
        fs::write(folder.join("engine/code.py"), "x").unwrap();
        fs::write(folder.join("engine.zip"), "x").unwrap();
        fs::create_dir_all(folder.join("lib")).unwrap();
        let removed = remove_earlier_rvc(folder);
        assert!(removed.contains(&"venv".to_owned()) && removed.contains(&"engine.zip".to_owned()));
        assert!(!folder.join("venv").exists());
        assert!(folder.join("engine/weights/voice.pth").is_file(), "a user's model stays");
        assert!(!folder.join("engine/code.py").exists());
        assert!(folder.join("lib").is_dir());
    }
}
