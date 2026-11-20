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

/// The hosts the setup may fetch from: Hugging Face (the model downloads' hosts), NuGet's
/// packages (ONNX Runtime), PyPI's files (NVIDIA's libraries) and GitHub's release downloads
/// (llama.cpp): `github.com` answers a release asset with a redirect to
/// `release-assets.githubusercontent.com`, which serves the file.
pub const SOURCE_HOSTS: [&str; 10] = [
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.hf.co",
    "cdn-lfs-eu-1.hf.co",
    "cas-bridge.xethub.hf.co",
    "us.aws.cdn.hf.co",
    "api.nuget.org",
    "files.pythonhosted.org",
    "github.com",
    "release-assets.githubusercontent.com",
];

const RVC_REPO: &str = "lj1995/VoiceConversionWebUI";
const RVC_REVISION: &str = "e6d0c1a17da07c33557852f9dfa2bd44cc75737d";
const ORT_VERSION: &str = "1.31.0";
/// NuGet's package content: `<id>/<version>/<id>.<version>.nupkg`, the id in lowercase.
const NUGET: &str = "https://api.nuget.org/v3-flatcontainer/";
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
    /// The device it is for: `cuda`, `cpu` or `directml`. The setup's probe checks CUDA for
    /// `cuda` and runs on the CPU for the others.
    pub device: &'static str,
}

fn hf_url(path: &str) -> String {
    format!("https://huggingface.co/{RVC_REPO}/resolve/{RVC_REVISION}/{path}")
}

/// Where ONNX Runtime comes from. The setup takes Microsoft's NuGet packages. Until
/// 2026-11-18 it took the same release from Microsoft's GitHub release archives, as the
/// Python setup of 0.4 did. A runtime set up from those holds the same files under the same
/// names in `lib/`, so it stays installed ([`Shared::variants`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OrtSource {
    NuGet,
    GitHub,
}

/// The NuGet package of ONNX Runtime: the CUDA 13 build for one platform with a GPU, else
/// the CPU build (one package for every platform).
fn ort_package(target: Target, gpu: bool) -> &'static str {
    match (target, gpu) {
        (_, false) => "Microsoft.ML.OnnxRuntime",
        (Target::Windows, true) => "Microsoft.ML.OnnxRuntime.Gpu.Windows",
        (Target::Linux, true) => "Microsoft.ML.OnnxRuntime.Gpu.Linux",
    }
}

/// A NuGet package and the files taken from its `runtimes/<rid>/native/`.
fn nuget(package: &str, rid: &str, size: u64, sha256: &str, files: &[(&str, &str)]) -> Library {
    nuget_at(package, ORT_VERSION, &format!("runtimes/{rid}/native/"), size, sha256, files)
}

/// A NuGet package of a version and the files taken from a folder of it.
fn nuget_at(package: &str, version: &str, folder: &str, size: u64, sha256: &str, files: &[(&str, &str)]) -> Library {
    let id = package.to_lowercase();
    Library {
        url: format!("{NUGET}{id}/{version}/{id}.{version}.nupkg"),
        size,
        sha256: sha256.into(),
        members: files.iter().map(|(source, target)| (format!("{folder}{source}"), (*target).to_owned())).collect(),
    }
}

/// A GitHub release archive and the files taken from its `lib/`.
fn github(name: &str, size: u64, sha256: &str, files: &[(&str, &str)]) -> Library {
    let folder = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
    let folder = folder.strip_suffix(".tar").unwrap_or(folder);
    Library {
        url: format!("https://github.com/microsoft/onnxruntime/releases/download/v{ORT_VERSION}/{name}"),
        size,
        sha256: sha256.into(),
        members: files.iter().map(|(source, target)| (format!("{folder}/lib/{source}"), (*target).to_owned())).collect(),
    }
}

const WINDOWS_GPU_ORT: [&str; 3] = ["onnxruntime.dll", "onnxruntime_providers_cuda.dll", "onnxruntime_providers_shared.dll"];
const LINUX_GPU_ORT: [&str; 3] = ["libonnxruntime.so", "libonnxruntime_providers_cuda.so", "libonnxruntime_providers_shared.so"];

/// ONNX Runtime 1.31.0 for a runtime. The NuGet packages' SHA-512 are the ones NuGet
/// publishes. Their CPU libraries are byte for byte those of the GitHub archives; the GPU
/// packages' CUDA provider links against CUDA 13 (cuBLAS 13, cudart 13) as the GitHub
/// `gpu_cuda13` archives' did.
fn ort(target: Target, gpu: bool, source: OrtSource) -> Library {
    let package = ort_package(target, gpu);
    let so = format!("libonnxruntime.so.{ORT_VERSION}");
    match (source, target, gpu) {
        (OrtSource::NuGet, Target::Windows, false) => {
            nuget(package, "win-x64", 159626085, "7e35fdb4f5adb62f01e60798e2e5ed05108f5fbbe1cca03fbcc37903cf7c5e3b", &[("onnxruntime.dll", "onnxruntime.dll")])
        }
        (OrtSource::NuGet, Target::Linux, false) => {
            nuget(package, "linux-x64", 159626085, "7e35fdb4f5adb62f01e60798e2e5ed05108f5fbbe1cca03fbcc37903cf7c5e3b", &[("libonnxruntime.so", "libonnxruntime.so")])
        }
        (OrtSource::NuGet, Target::Windows, true) => {
            nuget(package, "win-x64", 160447640, "6ef71832859a6fa1cdbd51d36be301641b6de609c72a2ab206b32f6cc209959d", &WINDOWS_GPU_ORT.map(|n| (n, n)))
        }
        (OrtSource::NuGet, Target::Linux, true) => {
            nuget(package, "linux-x64", 244928869, "7cd256a2b6a0713a55bbb7f60b175ff004d462d56a07572a15a2ed07456514d7", &LINUX_GPU_ORT.map(|n| (n, n)))
        }
        (OrtSource::GitHub, Target::Windows, false) => github(
            &format!("onnxruntime-win-x64-{ORT_VERSION}.zip"),
            82887349,
            "3958d8a44984160692c1b4ffd0de3cb48f8c39f9d34bb31e433db06e30b82195",
            &[("onnxruntime.dll", "onnxruntime.dll")],
        ),
        (OrtSource::GitHub, Target::Linux, false) => {
            github(&format!("onnxruntime-linux-x64-{ORT_VERSION}.tgz"), 11408003, "cc5c72baf5ae5c8238a6841f0897227be2d02826b9cf98eaf02fdefaeeb03a57", &[(&so, "libonnxruntime.so")])
        }
        (OrtSource::GitHub, Target::Windows, true) => github(
            &format!("onnxruntime-win-x64-gpu_cuda13-{ORT_VERSION}.zip"),
            309484217,
            "d332ccf84acb769a11364cddd4e8d2992a168d16be472d5ba70b279b644552f5",
            &WINDOWS_GPU_ORT.map(|n| (n, n)),
        ),
        (OrtSource::GitHub, Target::Linux, true) => github(
            &format!("onnxruntime-linux-x64-gpu_cuda13-{ORT_VERSION}.tgz"),
            244574938,
            "2867dec99c6a4926e8142361b9d4d1518c16c85b854b4d41d28d65d3b2c81135",
            &[(&so, "libonnxruntime.so"), ("libonnxruntime_providers_cuda.so", "libonnxruntime_providers_cuda.so"), ("libonnxruntime_providers_shared.so", "libonnxruntime_providers_shared.so")],
        ),
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

/// NVIDIA's CUDA 13.4 Update 1 and cuDNN 9.26 libraries the CUDA provider loads.
fn nvidia_libraries(target: Target) -> Vec<Library> {
    match target {
        Target::Linux => {
            let cudnn = cudnn(false);
            let cudnn: Vec<&str> = cudnn.iter().map(String::as_str).collect();
            vec![
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
            vec![
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
    runtime_with(target, gpu, OrtSource::NuGet)
}

/// The same runtime as set up with ONNX Runtime from GitHub ([`OrtSource`]).
fn earlier_rvc_runtime(target: Target, gpu: bool) -> Runtime {
    runtime_with(target, gpu, OrtSource::GitHub)
}

fn runtime_with(target: Target, gpu: bool, source: OrtSource) -> Runtime {
    let mut libraries = vec![ort(target, gpu, source)];
    if gpu {
        libraries.extend(nvidia_libraries(target));
    }
    let assets = rvc_assets();
    let ort_license = match source {
        OrtSource::NuGet => format!("https://www.nuget.org/packages/{}/{ORT_VERSION}/License", ort_package(target, gpu)),
        OrtSource::GitHub => format!("https://github.com/microsoft/onnxruntime/blob/v{ORT_VERSION}/LICENSE"),
    };
    let mut licenses = vec![ort_license, format!("https://huggingface.co/{RVC_REPO}")];
    if gpu {
        licenses.push("https://docs.nvidia.com/cuda/eula/index.html".into());
        licenses.push("https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html".into());
    }
    // The unpacked libraries and networks, plus the largest archive while it is unpacked,
    // rounded up. The CPU build's NuGet package holds every platform's libraries (160 MB; the
    // GitHub archive for Linux was 11 MB).
    let disk = match (target, gpu, source) {
        (Target::Linux, true, _) => 3_300_000_000,
        (Target::Windows, true, _) => 2_700_000_000,
        (Target::Linux, false, OrtSource::NuGet) => 800_000_000,
        (Target::Linux, false, OrtSource::GitHub) => 700_000_000,
        (Target::Windows, false, _) => 800_000_000,
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

/// The runtime that holds ONNX Runtime with its CUDA provider for the app's own ONNX Runtime
/// (local translation and chat reading; decision 2 (c) of docs/voice-stack/core-integration.md).
pub const ONNX_CUDA: &str = "onnxruntime-cuda";
/// The runtime that holds the DirectML build of ONNX Runtime and DirectML (Windows, optional).
pub const ONNX_DIRECTML: &str = "onnxruntime-directml";
/// The last ONNX Runtime with a DirectML package (DirectML is in sustained engineering), and the
/// DirectML that package names as its dependency.
const DML_ORT_VERSION: &str = "1.24.4";
const DIRECTML_VERSION: &str = "1.15.4";

/// ONNX Runtime 1.31.0 with its CUDA provider and NVIDIA's CUDA 13 and cuDNN 9 libraries, for
/// the app process: the same pinned files as the RVC GPU runtime's `lib/`, without its networks.
pub fn onnx_cuda_runtime(target: Target) -> Runtime {
    let mut libraries = vec![ort(target, true, OrtSource::NuGet)];
    libraries.extend(nvidia_libraries(target));
    Runtime {
        id: ONNX_CUDA,
        name: "ONNX Runtime · CUDA",
        download_bytes: libraries.iter().map(|l| l.size).sum(),
        assets: Vec::new(),
        license: "MIT, NVIDIA CUDA/cuDNN EULA",
        licenses: vec![
            format!("https://www.nuget.org/packages/{}/{ORT_VERSION}/License", ort_package(target, true)),
            "https://docs.nvidia.com/cuda/eula/index.html".into(),
            "https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html".into(),
        ],
        notice: "onnx_cuda",
        // The RVC GPU runtime's room without its networks (about 0.55 GB), rounded up.
        disk_bytes: if target == Target::Windows { 2_200_000_000 } else { 2_800_000_000 },
        libraries,
        device: "cuda",
    }
}

/// The DirectML build of ONNX Runtime and DirectML itself (Windows on x86-64 only). Not
/// bundled: fetched from NuGet when the user asks for it.
pub fn onnx_directml_runtime() -> Runtime {
    let libraries = vec![
        nuget_at(
            "Microsoft.ML.OnnxRuntime.DirectML",
            DML_ORT_VERSION,
            "runtimes/win-x64/native/",
            12458649,
            "57e9f11b73437bef7a309496135d4c1f96b1a8e9ddba60013fa27bfc1d788681",
            &[("onnxruntime.dll", "onnxruntime.dll"), ("onnxruntime_providers_shared.dll", "onnxruntime_providers_shared.dll")],
        ),
        nuget_at("Microsoft.AI.DirectML", DIRECTML_VERSION, "bin/x64-win/", 202292617, "4e7cb7ddce8cf837a7a75dc029209b520ca0101470fcdf275c1f49736a3615b9", &[("DirectML.dll", "DirectML.dll")]),
    ];
    Runtime {
        id: ONNX_DIRECTML,
        name: "ONNX Runtime · DirectML",
        download_bytes: libraries.iter().map(|l| l.size).sum(),
        assets: Vec::new(),
        license: "MIT, Microsoft DirectML License",
        licenses: vec![
            format!("https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime.DirectML/{DML_ORT_VERSION}/License"),
            format!("https://www.nuget.org/packages/Microsoft.AI.DirectML/{DIRECTML_VERSION}/License"),
        ],
        notice: "onnx_directml",
        // The unpacked libraries (36 MB) and DirectML's package while it is unpacked (202 MB).
        disk_bytes: 300_000_000,
        libraries,
        device: "directml",
    }
}

/// The setup of llama.cpp's `llama-server` with the Vulkan backend (ADR-015): it runs a
/// decoder-only translation LLM such as TranslateGemma, on the GPU or the CPU. Only this build
/// is offered (decision 5 of the LLM runtime plan, 2026-11-19): it carries the CPU backends too,
/// and a separate CPU build would save only about 13 MB of download.
pub const LLAMACPP_VULKAN: &str = "llamacpp-vulkan";
/// The release of `ggml-org/llama.cpp` whose archives are pinned below (published 2026-11-04).
pub const LLAMACPP_TAG: &str = "b12125";
/// ggml's CPU backends, one per instruction set; the server loads the one the CPU runs best.
const LLAMACPP_CPU_BACKENDS: [&str; 14] =
    ["alderlake", "cannonlake", "cascadelake", "cooperlake", "haswell", "icelake", "ivybridge", "piledriver", "sandybridge", "sapphirerapids", "skylakex", "sse42", "x64", "zen4"];

/// Whether a runtime is llama.cpp's server.
pub fn is_llamacpp(runtime: &Runtime) -> bool {
    runtime.id == LLAMACPP_VULKAN
}

/// The server's file name in a llama.cpp runtime's `lib/`.
pub fn llama_server_name(target: Target) -> &'static str {
    if target == Target::Windows { "llama-server.exe" } else { "llama-server" }
}

/// The files of the release archive the server needs, flat in `lib/`, under the names it loads
/// them by. The archives hold more tools (the CLI, the quantizer, an RPC server); those stay out.
/// The Linux archive keeps versioned files behind links (`libllama.so.0` → `libllama.so.0.9.0`),
/// which [`unpack_members`] refuses: the file is taken under the link's name, the one the
/// libraries ask for (their RUNPATH is `$ORIGIN`).
fn llamacpp_members(target: Target) -> Vec<(String, String)> {
    let same = |name: String| (name.clone(), name);
    let members: Vec<(String, String)> = match target {
        Target::Windows => {
            let mut members: Vec<(String, String)> = ["llama-server.exe", "llama-server-impl.dll", "llama-common.dll", "llama.dll", "mtmd.dll", "ggml.dll", "ggml-base.dll", "libomp.dll", "LICENSE-LLVM-OpenMP"]
                .into_iter()
                .map(|name| same(name.to_owned()))
                .collect();
            members.extend(LLAMACPP_CPU_BACKENDS.iter().map(|cpu| same(format!("ggml-cpu-{cpu}.dll"))));
            members.push(same("ggml-vulkan.dll".into()));
            members
        }
        Target::Linux => {
            let mut members: Vec<(String, String)> = vec![
                same("llama-server".into()),
                same("libllama-server-impl.so".into()),
                ("libllama-common.so.0.9.0".into(), "libllama-common.so.0".into()),
                ("libmtmd.so.0.9.0".into(), "libmtmd.so.0".into()),
                ("libllama.so.0.9.0".into(), "libllama.so.0".into()),
                ("libggml.so.0.29.0".into(), "libggml.so.0".into()),
                ("libggml-base.so.0.29.0".into(), "libggml-base.so.0".into()),
                same("LICENSE".into()),
            ];
            members.extend(LLAMACPP_CPU_BACKENDS.iter().map(|cpu| same(format!("libggml-cpu-{cpu}.so"))));
            members.push(same("libggml-vulkan.so".into()));
            // Every file sits in the archive's top folder.
            members.into_iter().map(|(source, name)| (format!("llama-{LLAMACPP_TAG}/{source}"), name)).collect()
        }
    };
    members
}

/// llama.cpp's Vulkan server from its GitHub release, pinned by size and SHA-256 (decisions 2
/// and 5 of docs/voice-stack/translation-llm-runtime-plan.md). Not bundled: fetched when the
/// user asks. It also runs on the CPU (`--device none`).
pub fn llamacpp_runtime(target: Target) -> Runtime {
    let (archive, size, sha256) = match target {
        Target::Windows => ("win-vulkan-x64.zip", 37683656, "29db801266e784d17fbc9dd7ff9b6a350d2b665bdc5658216f37d91c09918f07"),
        Target::Linux => ("ubuntu-vulkan-x64.tar.gz", 35883040, "455ec2f079e0d175b29beef93975aeacd119d8c74bd3e40298afa9a98e5a75f1"),
    };
    let library = Library {
        url: format!("https://github.com/ggml-org/llama.cpp/releases/download/{LLAMACPP_TAG}/llama-{LLAMACPP_TAG}-bin-{archive}"),
        size,
        sha256: sha256.into(),
        members: llamacpp_members(target),
    };
    let mut licenses = vec![format!("https://github.com/ggml-org/llama.cpp/blob/{LLAMACPP_TAG}/LICENSE")];
    if target == Target::Windows {
        // libomp.dll, LLVM's OpenMP runtime (the release is built with Clang 20.1.8); the archive
        // carries its license as LICENSE-LLVM-OpenMP.
        licenses.push("https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/openmp/LICENSE.TXT".into());
    }
    Runtime {
        id: LLAMACPP_VULKAN,
        name: "llama.cpp · Vulkan",
        download_bytes: size,
        assets: Vec::new(),
        license: if target == Target::Windows { "MIT, Apache-2.0 WITH LLVM-exception" } else { "MIT" },
        licenses,
        notice: "llamacpp_vulkan",
        // The files taken (89 MB) and the archive while it is unpacked, rounded up.
        disk_bytes: 140_000_000,
        libraries: vec![library],
        device: "vulkan",
    }
}

/// The llama.cpp server's executable when its setup under `root` (`<state>/vc_runtimes`) is
/// complete.
pub fn llama_server(root: &Path, target: Target) -> Option<PathBuf> {
    let runtime = llamacpp_runtime(target);
    let folder = root.join(runtime.id);
    set_up(&folder, std::slice::from_ref(&runtime)).then(|| folder.join("lib").join(llama_server_name(target)))
}

/// The ONNX Runtime GPU runtimes offered on a platform: CUDA where an NVIDIA driver is, and
/// DirectML on Windows.
pub fn onnx_runtimes(target: Target, nvidia: bool) -> Vec<Runtime> {
    let mut runtimes = Vec::new();
    if nvidia {
        runtimes.push(onnx_cuda_runtime(target));
    }
    if target == Target::Windows {
        runtimes.push(onnx_directml_runtime());
    }
    runtimes
}

/// The file name of ONNX Runtime's library in a runtime's `lib/`.
pub fn onnx_runtime_library(target: Target) -> &'static str {
    if target == Target::Windows {
        "onnxruntime.dll"
    } else {
        "libonnxruntime.so"
    }
}

/// The files of a runtime's `lib/` to load before ONNX Runtime itself: NVIDIA's libraries for
/// the CUDA provider, DirectML for the DirectML build. The loader does not look beside the
/// library for them.
pub fn dependencies(runtime: &Runtime) -> Vec<String> {
    runtime.libraries[1..].iter().flat_map(|l| l.members.iter().map(|(_, name)| name.clone())).collect()
}

/// Whether `folder` holds a finished setup of one of `runtimes`: its receipt names the version
/// and every library and network is in place.
fn set_up(folder: &Path, runtimes: &[Runtime]) -> bool {
    let Ok(text) = fs::read_to_string(folder.join("receipt.json")) else { return false };
    let Ok(receipt) = serde_json::from_str::<Value>(&text) else { return false };
    let Some(version) = receipt.get("version").and_then(Value::as_str) else { return false };
    let Some(installed) = runtimes.iter().find(|item| version_of(item) == version) else { return false };
    installed.libraries.iter().all(|l| l.members.iter().all(|(_, name)| folder.join("lib").join(name).is_file())) && installed.assets.iter().all(|a| folder.join("assets").join(&a.path).is_file())
}

/// A set-up runtime's `lib/` and the runtime whose files it holds.
#[derive(Debug, Clone)]
pub struct InstalledLibraries {
    pub lib: PathBuf,
    pub runtime: Runtime,
}

/// The `lib/` folders under `root` (`<state>/vc_runtimes`) that hold ONNX Runtime 1.31.0 with
/// its CUDA provider and NVIDIA's CUDA 13 and cuDNN 9 libraries, set up and checked: the
/// app's own CUDA runtime first, then the RVC GPU runtime's (the same files). Anything else in
/// the app that needs these NVIDIA libraries can find them here.
pub fn cuda_libraries(root: &Path, target: Target) -> Vec<InstalledLibraries> {
    let mut found = Vec::new();
    let own = onnx_cuda_runtime(target);
    if set_up(&root.join(ONNX_CUDA), std::slice::from_ref(&own)) {
        found.push(InstalledLibraries { lib: root.join(ONNX_CUDA).join("lib"), runtime: own });
    }
    let rvc = [rvc_runtime(target, true), earlier_rvc_runtime(target, true)];
    if set_up(&root.join("rvc"), &rvc) {
        found.push(InstalledLibraries { lib: root.join("rvc").join("lib"), runtime: rvc[0].clone() });
    }
    found
}

/// The DirectML runtime's `lib/` under `root`, when it is set up (Windows).
pub fn directml_libraries(root: &Path) -> Option<InstalledLibraries> {
    let runtime = onnx_directml_runtime();
    set_up(&root.join(ONNX_DIRECTML), std::slice::from_ref(&runtime)).then(|| InstalledLibraries { lib: root.join(ONNX_DIRECTML).join("lib"), runtime })
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
            None => self
                .options
                .target
                .map(|target| {
                    let gpu = (self.options.gpu_check)();
                    let mut entries = vec![rvc_runtime(target, gpu)];
                    entries.extend(onnx_runtimes(target, gpu));
                    entries.push(llamacpp_runtime(target));
                    entries
                })
                .unwrap_or_default(),
        })
    }

    fn folder(&self, runtime: &Runtime) -> PathBuf {
        self.options.root.join(runtime.id)
    }

    /// What counts as installed: the entry, and for the CPU runtime also the GPU one (it runs
    /// on the CPU too, so a driver missing for a moment does not make it look gone); each
    /// also as set up with ONNX Runtime from GitHub ([`OrtSource`]).
    fn variants(&self, runtime: &Runtime) -> Vec<Runtime> {
        let mut variants = vec![runtime.clone()];
        if self.options.entries.is_none()
            && runtime.id == "rvc"
            && let Some(target) = self.options.target
        {
            let gpu = runtime.device != "cpu";
            variants.push(earlier_rvc_runtime(target, gpu));
            if !gpu {
                variants.push(rvc_runtime(target, true));
                variants.push(earlier_rvc_runtime(target, true));
            }
        }
        variants
    }

    fn installed(&self, runtime: &Runtime) -> bool {
        set_up(&self.folder(runtime), &self.variants(runtime))
    }

    /// Where a runtime is set up: its own folder, or for ONNX Runtime with CUDA also the RVC GPU
    /// runtime, which holds the same libraries (the app uses those then; nothing to fetch).
    fn installed_at(&self, runtime: &Runtime) -> Option<PathBuf> {
        if self.installed(runtime) {
            return Some(self.folder(runtime));
        }
        let target = self.options.target?;
        (runtime.id == ONNX_CUDA && self.options.entries.is_none())
            .then(|| cuda_libraries(&self.options.root, target).into_iter().next().and_then(|found| found.lib.parent().map(Path::to_path_buf)))
            .flatten()
    }

    fn state(&self) -> Value {
        let inner = locked(&self.inner);
        let jobs: Map<String, Value> = inner.jobs.iter().map(|(id, job)| (id.clone(), Value::Object(job.clone()))).collect();
        drop(inner);
        let installed: Map<String, Value> = self.entries().iter().filter_map(|r| self.installed_at(r).map(|folder| (r.id.to_owned(), json!(folder.to_string_lossy())))).collect();
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

    /// The worker loads the libraries and runs one operation on the device. A GPU runtime is
    /// still usable on the CPU when the GPU cannot run it: exit 3 then, and a warning. The
    /// DirectML build is probed on DirectML (the worker loads `DirectML.dll` first).
    fn verifying(&self, runtime: &Runtime, cancel: &AtomicBool) -> Result<(), StepError> {
        if is_llamacpp(runtime) {
            return self.verifying_llamacpp(runtime, cancel);
        }
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
                // ONNX Runtime with CUDA or DirectML for the app: the translation (and with
                // DirectML, RVC on it) then runs on the CPU.
                let warning = match runtime.id {
                    ONNX_CUDA => "onnx_runtime_gpu_unusable",
                    ONNX_DIRECTML => "onnx_runtime_directml_unusable",
                    _ => "vc_runtime_gpu_unusable_cpu",
                };
                self.update(runtime.id, |job| {
                    job.insert("warning_code".into(), json!(warning));
                });
                Ok(())
            }
            _ => Err(StepError::Failed),
        }
    }

    /// llama.cpp's server lists its devices and ends (`--list-devices`): its libraries load and
    /// it runs. Nothing else is started and no model is read. The Vulkan build that lists no
    /// Vulkan device still runs on the CPU: a warning, as for the RVC runtime without its GPU.
    fn verifying_llamacpp(&self, runtime: &Runtime, cancel: &AtomicBool) -> Result<(), StepError> {
        let target = self.options.target.ok_or(StepError::Failed)?;
        let binary = self.folder(runtime).join("lib").join(llama_server_name(target));
        #[cfg(unix)]
        {
            // The archive's modes are not kept: the server must be executable.
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))?;
        }
        let mut command = Command::new(&binary);
        command.arg("--list-devices").env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut owned = child::spawn(command).map_err(|_| StepError::Failed)?;
        // Both streams on threads of their own, bounded: a pipe nobody reads would block it.
        let readers: Vec<thread::JoinHandle<Vec<u8>>> = [owned.child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), owned.child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
            .map(|stream| {
                thread::spawn(move || {
                    let mut data = Vec::new();
                    let _ = stream.take(256 * 1024).read_to_end(&mut data);
                    data
                })
            })
            .collect();
        let child = Arc::new(Mutex::new(owned.child));
        locked(&self.inner).child = Some(child.clone());
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        let status = loop {
            let cancelled = self.checkpoint(cancel).is_err();
            if cancelled || std::time::Instant::now() >= deadline {
                let _ = locked(&child).kill();
                let _ = locked(&child).wait();
                locked(&self.inner).child = None;
                return Err(if cancelled { StepError::Cancelled } else { StepError::Failed });
            }
            match locked(&child).try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {}
                Err(_) => break None,
            }
            thread::sleep(Duration::from_millis(50));
        };
        locked(&self.inner).child = None;
        // The device names only: what the server printed goes nowhere else.
        let output: Vec<u8> = readers.into_iter().flat_map(|reader| reader.join().unwrap_or_default()).collect();
        self.checkpoint(cancel)?;
        if !status.is_some_and(|status| status.success()) {
            return Err(StepError::Failed);
        }
        if runtime.device == "vulkan" && !String::from_utf8_lossy(&output).lines().any(|line| line.trim_start().starts_with("Vulkan")) {
            self.update(runtime.id, |job| {
                job.insert("warning_code".into(), json!("llamacpp_no_gpu"));
            });
        }
        Ok(())
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
            if runtime.id == "rvc" {
                remove_earlier_rvc(&folder);
            }
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
    fn a_runtime_set_up_from_github_keeps_the_version_its_receipt_names() {
        // Computed with `runtime_setup.version_of(rvc_runtime(gpu))` for each platform: the
        // Python setup of 0.4 and this one until 2026-11-18 wrote these into `receipt.json`.
        assert_eq!(version_of(&earlier_rvc_runtime(Target::Windows, true)), "0670490dc81d981c");
        assert_eq!(version_of(&earlier_rvc_runtime(Target::Windows, false)), "eb13d6b8d11ff57b");
        assert_eq!(version_of(&earlier_rvc_runtime(Target::Linux, true)), "6dc6eeaed06a95db");
        assert_eq!(version_of(&earlier_rvc_runtime(Target::Linux, false)), "0b7aa8b46f79b83f");
        assert_eq!(earlier_rvc_runtime(Target::Windows, true).download_bytes, 1809734073);
        assert_eq!(earlier_rvc_runtime(Target::Linux, false).download_bytes, 562304649);
    }

    #[test]
    fn onnx_runtime_comes_from_nuget_into_the_same_files() {
        let names = |runtime: &Runtime| runtime.libraries.iter().flat_map(|l| l.members.iter().map(|(_, name)| name.clone())).collect::<Vec<_>>();
        for target in [Target::Windows, Target::Linux] {
            let rid = if target == Target::Windows { "win-x64" } else { "linux-x64" };
            for gpu in [false, true] {
                let (runtime, earlier) = (rvc_runtime(target, gpu), earlier_rvc_runtime(target, gpu));
                let package = ort_package(target, gpu).to_lowercase();
                assert_eq!(runtime.libraries[0].url, format!("https://api.nuget.org/v3-flatcontainer/{package}/1.31.0/{package}.1.31.0.nupkg"));
                assert!(runtime.libraries[0].members.iter().all(|(member, _)| member.starts_with(&format!("runtimes/{rid}/native/"))));
                // The worker finds the same files in lib/; NVIDIA's libraries and the networks are unchanged.
                assert_eq!(names(&runtime), names(&earlier));
                assert_eq!(runtime.libraries[1..], earlier.libraries[1..]);
                assert_eq!(runtime.assets, earlier.assets);
                assert!(runtime.licenses[0].starts_with("https://www.nuget.org/packages/Microsoft.ML.OnnxRuntime"));
                for url in runtime.libraries.iter().map(|l| &l.url).chain(runtime.assets.iter().map(|a| &a.url)) {
                    assert!(vrct_ops::downloads::transport::validate_url(url, &SOURCE_HOSTS).is_ok(), "{url}");
                }
                // GitHub is no longer ONNX Runtime's source (its host is allowed for llama.cpp).
                assert!(earlier.libraries[0].url.starts_with("https://github.com/microsoft/") && !runtime.libraries[0].url.starts_with("https://github.com/"));
            }
        }
        assert_eq!(version_of(&rvc_runtime(Target::Windows, true)), "bb4f92c2eb0a3041");
        assert_eq!(version_of(&rvc_runtime(Target::Windows, false)), "04ac8d519383480b");
        assert_eq!(version_of(&rvc_runtime(Target::Linux, true)), "0693837c0b632f34");
        assert_eq!(version_of(&rvc_runtime(Target::Linux, false)), "e432cf274236db5c");
        assert_eq!(rvc_runtime(Target::Windows, true).download_bytes, 1660697496);
        assert_eq!(rvc_runtime(Target::Linux, false).download_bytes, 710522731);
    }

    /// The pinned libraries from their real sources through the setup's own step: fetched with
    /// the app's transport and hosts, checked against their pins and unpacked into `lib/`.
    /// With `VRCT_TEST_RVC_WORKER` (a built `vrct-rvc-worker`) the worker then probes them on
    /// the CPU, or with `VRCT_TEST_RVC_GPU=1` on the GPU (`--device cuda`, no fallback). The CPU
    /// runtime fetches 160 MB, the GPU one about 1.1 GB. `VRCT_TEST_RVC_TARGET=linux` or
    /// `windows` fetches another platform's files (no probe then). Archives already in the
    /// folder `VRCT_TEST_RVC_DOWNLOADS` are taken as a resumed setup takes them: only when
    /// their size and SHA-256 match. The networks are not fetched: they are models, offered
    /// only with the user's consent.
    ///
    ///     cargo test --manifest-path native/voice-conversion/Cargo.toml --lib -- --ignored pinned_libraries
    #[test]
    #[ignore = "fetches the pinned archives from their sources"]
    fn pinned_libraries_come_from_their_sources() {
        let current = Target::current();
        let target = match std::env::var("VRCT_TEST_RVC_TARGET").as_deref() {
            Ok("linux") => Target::Linux,
            Ok("windows") => Target::Windows,
            _ => current.expect("Windows or Linux on x86-64"),
        };
        let gpu = std::env::var_os("VRCT_TEST_RVC_GPU").is_some();
        let mut runtime = rvc_runtime(target, gpu);
        runtime.assets.clear();
        let dir = tempfile::tempdir().unwrap();
        let transport = vrct_ops::downloads::transport::Public { timeout: vrct_ops::downloads::transport::TIMEOUT, hosts: SOURCE_HOSTS.iter().map(|h| h.to_string()).collect() };
        let setup = RuntimeSetup::new(SetupOptions {
            root: dir.path().to_owned(),
            target: Some(target),
            transport: Arc::new(transport),
            gpu_check: Arc::new(move || gpu),
            worker: PathBuf::new(),
            free_space: Arc::new(|_| None),
            entries: Some(vec![runtime.clone()]),
        });
        let folder = dir.path().join("rvc");
        if let Some(kept) = std::env::var_os("VRCT_TEST_RVC_DOWNLOADS") {
            fs::create_dir_all(folder.join("downloads")).unwrap();
            for name in runtime.libraries.iter().filter_map(|l| l.url.rsplit('/').next()) {
                if Path::new(&kept).join(name).is_file() {
                    fs::copy(Path::new(&kept).join(name), folder.join("downloads").join(name)).unwrap();
                }
            }
        }
        setup.shared.libraries(&runtime, &AtomicBool::new(false)).expect("fetched, checked and unpacked");
        let mut found: Vec<String> = fs::read_dir(folder.join("lib")).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
        let mut expected: Vec<String> = runtime.libraries.iter().flat_map(|l| l.members.iter().map(|(_, name)| name.clone())).collect();
        found.sort();
        expected.sort();
        assert_eq!(found, expected);
        if let Some(worker) = std::env::var_os("VRCT_TEST_RVC_WORKER")
            && Some(target) == current
        {
            let device = if gpu { "cuda" } else { "cpu" };
            let status = Command::new(worker).arg("--runtime").arg(&folder).arg("--probe").arg("--device").arg(device).status().unwrap();
            assert!(status.success(), "the worker's probe on {device}: {status}");
        }
    }

    /// An ONNX Runtime GPU runtime through a whole setup from its sources: fetched, checked
    /// against its pins, unpacked, and probed by a built `vrct-rvc-worker`
    /// (`VRCT_TEST_RVC_WORKER`) as the setup probes it, then receipted. `VRCT_TEST_ONNX_RUNTIME`
    /// is `directml` (the default; Windows; about 215 MB; probed with `auto`, and then with
    /// `--device directml`, which must take a GPU through DirectML) or `cuda` (about 1.1 GB;
    /// probed with `auto`, and then with `--device cuda`, which must take the GPU). With
    /// `VRCT_TEST_KEEP_RUNTIME_ROOT` the setup is made there (as `<root>/onnxruntime-directml`
    /// or `<root>/onnxruntime-cuda`) and kept.
    ///
    ///     cargo test --manifest-path native/voice-conversion/Cargo.toml --lib -- --ignored onnx_runtime_sets_up
    #[test]
    #[ignore = "fetches the pinned archives from their sources"]
    fn onnx_runtime_sets_up_from_its_sources() {
        let Some(target) = Target::current() else { return };
        let cuda = std::env::var("VRCT_TEST_ONNX_RUNTIME").as_deref() == Ok("cuda");
        if !cuda && target != Target::Windows {
            return;
        }
        let kept = std::env::var_os("VRCT_TEST_KEEP_RUNTIME_ROOT").map(PathBuf::from);
        let dir = tempfile::tempdir().unwrap();
        let root = kept.clone().unwrap_or_else(|| dir.path().to_owned());
        let worker = std::env::var_os("VRCT_TEST_RVC_WORKER").map(PathBuf::from);
        let transport = vrct_ops::downloads::transport::Public { timeout: vrct_ops::downloads::transport::TIMEOUT, hosts: SOURCE_HOSTS.iter().map(|h| h.to_string()).collect() };
        let runtime = if cuda { onnx_cuda_runtime(target) } else { onnx_directml_runtime() };
        let setup = RuntimeSetup::new(SetupOptions {
            root: root.clone(),
            target: Some(target),
            transport: Arc::new(transport),
            gpu_check: Arc::new(move || cuda),
            worker: worker.clone().unwrap_or_default(),
            free_space: Arc::new(|_| None),
            entries: Some(vec![runtime.clone()]),
        });
        let cancel = AtomicBool::new(false);
        setup.shared.libraries(&runtime, &cancel).expect("fetched, checked and unpacked");
        let folder = root.join(runtime.id);
        let mut found: Vec<String> = fs::read_dir(folder.join("lib")).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
        let mut expected: Vec<String> = runtime.libraries.iter().flat_map(|l| l.members.iter().map(|(_, name)| name.clone())).collect();
        found.sort();
        expected.sort();
        assert_eq!(found, expected);
        if let Some(worker) = worker {
            setup.shared.verifying(&runtime, &cancel).expect("the worker loads the runtime as the setup probes it");
            let device = if cuda { "cuda" } else { "directml" };
            let status = Command::new(&worker).arg("--runtime").arg(&folder).arg("--probe").arg("--device").arg(device).status().unwrap();
            assert!(status.success(), "the worker's probe on {device}: {status}");
            fs::write(folder.join("receipt.json"), json!({ "version": version_of(&runtime), "id": runtime.id }).to_string()).unwrap();
            if cuda {
                assert_eq!(cuda_libraries(&root, target).first().map(|found| found.lib.clone()), Some(folder.join("lib")));
            } else {
                assert!(directml_libraries(&root).is_some());
            }
        }
    }

    /// llama.cpp's servers for this PC set up from the pinned archives through the setup itself:
    /// fetched (or, with `VRCT_TEST_LLAMACPP_DOWNLOADS`, read from that folder by file name),
    /// checked against their pins, unpacked and run with `--list-devices`. No model is read.
    /// About 63 MB on Windows, 59 MB on Linux.
    ///
    ///     cargo test --manifest-path native/voice-conversion/Cargo.toml --lib -- --ignored llamacpp_sets_up
    #[test]
    #[ignore = "fetches the pinned llama.cpp archives and runs the server"]
    fn llamacpp_sets_up_from_its_release() {
        let target = Target::current().expect("Windows or Linux on x86-64");
        let dir = tempfile::tempdir().unwrap();
        let transport: Arc<dyn Transport> = match std::env::var_os("VRCT_TEST_LLAMACPP_DOWNLOADS") {
            Some(folder) => {
                let folder = PathBuf::from(folder);
                Arc::new(move |url: &str| -> Result<Box<dyn vrct_ops::downloads::transport::Body>, vrct_ops::downloads::Error> {
                    let name = url.rsplit('/').next().unwrap_or_default();
                    let data = fs::read(folder.join(name)).map_err(vrct_ops::downloads::Error::Io)?;
                    Ok(Box::new(std::io::Cursor::new(data)))
                })
            }
            None => Arc::new(vrct_ops::downloads::transport::Public { timeout: vrct_ops::downloads::transport::TIMEOUT, hosts: SOURCE_HOSTS.iter().map(|h| h.to_string()).collect() }),
        };
        let setup = RuntimeSetup::new(SetupOptions {
            root: dir.path().to_owned(),
            target: Some(target),
            transport,
            gpu_check: Arc::new(|| false),
            worker: dir.path().join("no-worker"),
            free_space: Arc::new(|_| None),
            entries: Some(vec![llamacpp_runtime(target)]),
        });
        for runtime in [llamacpp_runtime(target)] {
            let version = version_of(&runtime);
            setup.start(&json!({ "id": runtime.id, "consent": true, "version": version })).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(600);
            let job = loop {
                let job = setup.state()["jobs"][runtime.id].clone();
                if !ACTIVE.contains(&job["phase"].as_str().unwrap_or("")) || std::time::Instant::now() > deadline {
                    break job;
                }
                thread::sleep(Duration::from_millis(100));
            };
            assert_eq!(job["phase"], "ready", "{}: {job}", runtime.id);
            eprintln!("{}: warning {}", runtime.id, job["warning_code"]);
        }
        assert!(llama_server(dir.path(), target).is_some_and(|binary| binary.is_file()));
        assert!(setup.close(Duration::from_secs(5)));
    }

    fn setup_in(root: &Path, target: Target, gpu: bool) -> RuntimeSetup {
        let offline = |_: &str| -> Result<Box<dyn vrct_ops::downloads::transport::Body>, vrct_ops::downloads::Error> { Err(vrct_ops::downloads::Error::Other("offline".into())) };
        RuntimeSetup::new(SetupOptions {
            root: root.to_owned(),
            target: Some(target),
            transport: Arc::new(offline),
            gpu_check: Arc::new(move || gpu),
            worker: root.join("no-worker"),
            free_space: Arc::new(|_| None),
            entries: None,
        })
    }

    /// What a finished setup of `runtime` leaves in `<root>/<id>`.
    fn place(root: &Path, runtime: &Runtime) {
        let folder = root.join(runtime.id);
        for (_, name) in runtime.libraries.iter().flat_map(|l| &l.members) {
            fs::create_dir_all(folder.join("lib")).unwrap();
            fs::write(folder.join("lib").join(name), "library").unwrap();
        }
        for asset in &runtime.assets {
            let path = folder.join("assets").join(&asset.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "asset").unwrap();
        }
        fs::write(folder.join("receipt.json"), json!({ "version": version_of(runtime), "id": runtime.id }).to_string()).unwrap();
    }

    fn names(runtime: &Runtime) -> Vec<String> {
        runtime.libraries.iter().flat_map(|l| l.members.iter().map(|(_, name)| name.clone())).collect()
    }

    #[test]
    fn the_onnx_runtimes_are_offered_where_they_run() {
        let ids = |target, nvidia| onnx_runtimes(target, nvidia).iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(ids(Target::Windows, true), [ONNX_CUDA, ONNX_DIRECTML]);
        assert_eq!(ids(Target::Windows, false), [ONNX_DIRECTML]);
        assert_eq!(ids(Target::Linux, true), [ONNX_CUDA]);
        assert!(ids(Target::Linux, false).is_empty());
        // The setup offers them after the RVC runtime, and llama.cpp's servers last.
        let dir = tempfile::tempdir().unwrap();
        let catalog = setup_in(dir.path(), Target::Windows, true).catalog();
        let offered: Vec<&str> = catalog["runtimes"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap()).collect();
        assert_eq!(offered, ["rvc", ONNX_CUDA, ONNX_DIRECTML, LLAMACPP_VULKAN]);
        assert_eq!(catalog["runtimes"][2]["device"], "directml");
        let catalog = setup_in(dir.path(), Target::Linux, false).catalog();
        let offered: Vec<&str> = catalog["runtimes"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap()).collect();
        assert_eq!(offered, ["rvc", LLAMACPP_VULKAN]);
    }

    #[test]
    fn llamacpp_comes_pinned_from_its_github_release() {
        for target in [Target::Windows, Target::Linux] {
            // Only the Vulkan build (decision 5 of the LLM runtime plan); it runs on the CPU too.
            let runtime = llamacpp_runtime(target);
            assert!(is_llamacpp(&runtime) && runtime.assets.is_empty());
            assert_eq!((runtime.id, runtime.device), (LLAMACPP_VULKAN, "vulkan"));
            assert_eq!(runtime.libraries.len(), 1);
            let library = &runtime.libraries[0];
            assert!(library.url.starts_with("https://github.com/ggml-org/llama.cpp/releases/download/b12125/llama-b12125-bin-"), "{}", library.url);
            assert!(library.url.contains("vulkan-x64."), "{}", library.url);
            assert!(vrct_ops::downloads::transport::validate_url(&library.url, &SOURCE_HOSTS).is_ok(), "{}", library.url);
            // GitHub answers with a redirect to its asset host, which must be allowed too.
            assert!(vrct_ops::downloads::transport::validate_url("https://release-assets.githubusercontent.com/github-production-release-asset/1/x", &SOURCE_HOSTS).is_ok());
            assert_eq!((library.sha256.len(), runtime.download_bytes), (64, library.size));
            let files = names(&runtime);
            assert!(files.contains(&llama_server_name(target).to_string()));
            assert!(files.iter().any(|f| f.contains("ggml-vulkan")));
            assert_eq!(files.iter().filter(|f| f.contains("ggml-cpu-")).count(), 14);
            // Plain names only (the archive reader refuses others), each once.
            let unique: HashSet<&String> = files.iter().collect();
            assert_eq!(unique.len(), files.len());
            assert!(runtime.licenses[0].starts_with("https://github.com/ggml-org/llama.cpp/blob/b12125/"));
        }
        // The Linux archive's files sit in its top folder; the links' names are the ones kept.
        let linux = llamacpp_runtime(Target::Linux);
        assert!(linux.libraries[0].members.iter().all(|(member, _)| member.starts_with("llama-b12125/")));
        assert!(linux.libraries[0].members.contains(&("llama-b12125/libllama.so.0.9.0".into(), "libllama.so.0".into())));
        assert_ne!(version_of(&llamacpp_runtime(Target::Windows)), version_of(&linux));
    }

    #[test]
    fn a_set_up_llama_server_is_found() {
        for target in [Target::Windows, Target::Linux] {
            let dir = tempfile::tempdir().unwrap();
            assert_eq!(llama_server(dir.path(), target), None);
            place(dir.path(), &llamacpp_runtime(target));
            let binary = dir.path().join(LLAMACPP_VULKAN).join("lib").join(llama_server_name(target));
            assert_eq!(llama_server(dir.path(), target), Some(binary.clone()));
            // A file missing: not set up.
            fs::remove_file(&binary).unwrap();
            assert_eq!(llama_server(dir.path(), target), None);
        }
    }

    #[test]
    fn the_cuda_runtime_holds_the_rvc_gpu_runtimes_libraries_without_its_networks() {
        for target in [Target::Windows, Target::Linux] {
            let (own, rvc) = (onnx_cuda_runtime(target), rvc_runtime(target, true));
            assert_eq!(own.libraries, rvc.libraries);
            assert!(own.assets.is_empty() && own.device == "cuda");
            assert_ne!(version_of(&own), version_of(&rvc));
            assert_eq!(own.download_bytes, rvc.libraries.iter().map(|l| l.size).sum::<u64>());
            // What is loaded before ONNX Runtime: NVIDIA's libraries, not ONNX Runtime's own.
            let first = dependencies(&own);
            assert!(!first.is_empty() && first.iter().all(|name| !name.contains("onnxruntime")), "{first:?}");
            assert!(names(&own).contains(&onnx_runtime_library(target).to_string()));
        }
    }

    #[test]
    fn the_directml_runtime_is_pinned_on_nuget() {
        let runtime = onnx_directml_runtime();
        assert_eq!(runtime.libraries.len(), 2);
        for library in &runtime.libraries {
            assert!(vrct_ops::downloads::transport::validate_url(&library.url, &SOURCE_HOSTS).is_ok(), "{}", library.url);
            assert_eq!(library.sha256.len(), 64);
        }
        assert_eq!(runtime.libraries[0].url, "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/1.24.4/microsoft.ml.onnxruntime.directml.1.24.4.nupkg");
        assert_eq!(runtime.libraries[1].url, "https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg");
        assert_eq!(names(&runtime), ["onnxruntime.dll", "onnxruntime_providers_shared.dll", "DirectML.dll"]);
        assert_eq!(runtime.libraries[1].members, [("bin/x64-win/DirectML.dll".to_string(), "DirectML.dll".to_string())]);
        assert_eq!(dependencies(&runtime), ["DirectML.dll"]);
        assert_eq!(runtime.download_bytes, 12458649 + 202292617);
        assert!(runtime.licenses.iter().all(|url| url.starts_with("https://www.nuget.org/packages/")));
    }

    #[test]
    fn set_up_onnx_runtimes_are_found_for_the_app_process() {
        for target in [Target::Windows, Target::Linux] {
            let dir = tempfile::tempdir().unwrap();
            assert!(cuda_libraries(dir.path(), target).is_empty());
            // The RVC GPU runtime holds the same libraries; the CPU one does not count.
            place(dir.path(), &rvc_runtime(target, false));
            assert!(cuda_libraries(dir.path(), target).is_empty());
            place(dir.path(), &earlier_rvc_runtime(target, true));
            let found = cuda_libraries(dir.path(), target);
            assert_eq!(found.iter().map(|f| f.lib.clone()).collect::<Vec<_>>(), [dir.path().join("rvc/lib")]);
            // The app's own CUDA runtime comes first.
            place(dir.path(), &onnx_cuda_runtime(target));
            let found = cuda_libraries(dir.path(), target);
            assert_eq!(found.iter().map(|f| f.lib.clone()).collect::<Vec<_>>(), [dir.path().join(ONNX_CUDA).join("lib"), dir.path().join("rvc/lib")]);
            assert_eq!(found[0].runtime.id, ONNX_CUDA);
            // A file missing: not set up.
            fs::remove_file(dir.path().join(ONNX_CUDA).join("lib").join(onnx_runtime_library(target))).unwrap();
            assert_eq!(cuda_libraries(dir.path(), target).len(), 1);
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(directml_libraries(dir.path()).is_none());
        place(dir.path(), &onnx_directml_runtime());
        assert_eq!(directml_libraries(dir.path()).map(|f| f.lib), Some(dir.path().join(ONNX_DIRECTML).join("lib")));
        fs::write(dir.path().join(ONNX_DIRECTML).join("receipt.json"), json!({ "version": "0000000000000000", "id": ONNX_DIRECTML }).to_string()).unwrap();
        assert!(directml_libraries(dir.path()).is_none());
    }

    #[test]
    fn the_state_names_the_rvc_gpu_runtime_for_cuda_when_only_it_is_set_up() {
        let dir = tempfile::tempdir().unwrap();
        place(dir.path(), &rvc_runtime(Target::Windows, true));
        let state = setup_in(dir.path(), Target::Windows, true).state();
        assert_eq!(state["installed"]["rvc"], json!(dir.path().join("rvc").to_string_lossy()));
        assert_eq!(state["installed"][ONNX_CUDA], json!(dir.path().join("rvc").to_string_lossy()));
        assert!(state["installed"].get(ONNX_DIRECTML).is_none());
        // Its own setup, once there, is the one named.
        place(dir.path(), &onnx_cuda_runtime(Target::Windows));
        let state = setup_in(dir.path(), Target::Windows, true).state();
        assert_eq!(state["installed"][ONNX_CUDA], json!(dir.path().join(ONNX_CUDA).to_string_lossy()));
    }

    #[test]
    fn a_runtime_set_up_from_github_stays_installed() {
        for target in [Target::Windows, Target::Linux] {
            // (set up with a GPU, offered with a GPU, installed): the CPU entry also takes the
            // GPU runtime, as before; the GPU entry does not take the CPU one.
            for (set_up, offered, installed) in [(false, false, true), (true, true, true), (true, false, true), (false, true, false)] {
                let dir = tempfile::tempdir().unwrap();
                place(dir.path(), &earlier_rvc_runtime(target, set_up));
                let state = setup_in(dir.path(), target, offered).state();
                assert_eq!(state["installed"].get("rvc").is_some(), installed, "{target:?}, set up {set_up}, offered {offered}");
            }
            // A runtime set up from NuGet, and one with a file missing.
            let dir = tempfile::tempdir().unwrap();
            place(dir.path(), &rvc_runtime(target, false));
            assert!(setup_in(dir.path(), target, false).state()["installed"].get("rvc").is_some());
            let earlier = earlier_rvc_runtime(target, false);
            place(dir.path(), &earlier);
            fs::remove_file(dir.path().join("rvc/lib").join(&earlier.libraries[0].members[0].1)).unwrap();
            assert!(setup_in(dir.path(), target, false).state()["installed"].get("rvc").is_none());
        }
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
