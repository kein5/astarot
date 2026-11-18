//! The ONNX Runtime and OpenVR client libraries the packages ship in `_internal` (issue #509).
//!
//! Chat reading and local translation load ONNX Runtime at run time, and the VR overlay and the
//! chat reading's headset view load the OpenVR client library. Until 0.4 both came with the
//! Python backend; since 0.5.0 the packages ship them on their own (tools/runtime_libraries.py),
//! in `_internal/onnxruntime` and `_internal/openvr`, found like the other shipped files
//! ([`crate::resources`]). Without this, Windows loaded its own older `onnxruntime.dll` from
//! System32, which cannot read the chat reading's model, and the overlay found no OpenVR at all.
//!
//! The variables that name a library (`ORT_DYLIB_PATH`, `VRCT_OPENVR_API`) still win.
//!
//! Chat reading and translation take the ONNX Runtime library and its one environment from
//! `vrct-onnx-runtime`, so they always share them (`ort` allows one environment per process).

use std::path::Path;

/// ONNX Runtime 1.31.0, the official CPU build, inside `_internal`.
pub const ONNX_RUNTIME: &str = if cfg!(windows) { "onnxruntime/onnxruntime.dll" } else { "onnxruntime/libonnxruntime.so" };
/// The OpenVR client library 2.12.14 (the function tables the core uses), inside `_internal`.
pub const OPENVR: &str = if cfg!(windows) { "openvr/libopenvr_api_64.dll" } else { "openvr/libopenvr_api_64.so" };

/// Stops ONNX Runtime's own usage reports to Microsoft for the app and the processes it starts,
/// such as the voice conversion worker (issue #518). They are not the app's opt-in telemetry and
/// never depend on its consent setting.
///
/// # Safety
///
/// Changes the process environment: call at the start of the app, before other threads run.
pub unsafe fn disable_onnx_runtime_telemetry() {
    unsafe { vrct_onnx_runtime::disable_telemetry_for_process() };
}

/// Points chat reading, translation and OpenVR at the libraries beside the app. Returns a line
/// for the log. Call once, before any of them is used.
pub fn use_shipped(app_dir: &Path) -> String {
    let onnx_runtime = crate::resources::locate(app_dir, ONNX_RUNTIME);
    let onnx_found = onnx_runtime.is_file();
    if onnx_found {
        vrct_onnx_runtime::use_library(onnx_runtime);
    }
    let openvr = crate::resources::locate(app_dir, OPENVR);
    let openvr_found = openvr.is_file();
    if openvr_found {
        vrct_openvr_client::use_library(openvr);
    }
    let state = |found: bool| if found { "shipped" } else { "not shipped" };
    format!("Shipped libraries: ONNX Runtime {}, OpenVR {}", state(onnx_found), state(openvr_found))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_libraries_are_inside_the_shipped_folder() {
        for relative in [ONNX_RUNTIME, OPENVR] {
            assert!(!Path::new(relative).is_absolute() && !relative.contains(".."), "{relative}");
        }
        assert!(ONNX_RUNTIME.ends_with(std::env::consts::DLL_SUFFIX));
        assert!(OPENVR.ends_with(std::env::consts::DLL_SUFFIX));
    }

    #[test]
    fn missing_libraries_are_reported_and_change_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(use_shipped(dir.path()), "Shipped libraries: ONNX Runtime not shipped, OpenVR not shipped");
    }
}
