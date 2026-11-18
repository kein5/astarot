//! A chosen library with libraries to load first: those that load are loaded, one that does not
//! is counted and leaves ONNX Runtime usable. Its own test binary, because the environment is
//! made once per process. Without the variable this test does nothing.
//!
//!     VRCT_TEST_ONNX_RUNTIME_LIBRARY=<onnxruntime library> cargo test --manifest-path native/onnx-runtime/Cargo.toml --test dependencies

#![cfg(feature = "load-dynamic")]

use std::path::PathBuf;

use vrct_onnx_runtime::{dependencies_missing, environment, library_path, use_library_with, LIBRARY_VARIABLE};

#[test]
fn a_dependency_that_does_not_load_leaves_onnx_runtime_usable() {
    let Some(library) = std::env::var_os("VRCT_TEST_ONNX_RUNTIME_LIBRARY").map(PathBuf::from) else {
        return;
    };
    assert!(std::env::var_os(LIBRARY_VARIABLE).is_none_or(|value| value.is_empty()), "unset ORT_DYLIB_PATH for this test");
    // The library itself loads as a dependency (a second load is harmless); the other is missing.
    let missing = std::env::temp_dir().join("vrct-onnx-runtime-missing").join("not_there.dll");
    use_library_with(library.clone(), vec![library.clone(), missing]);
    assert_eq!(library_path(), library);
    assert_eq!(dependencies_missing(), None);
    assert!(environment().is_ok(), "{:?}", environment().err());
    assert_eq!(dependencies_missing(), Some(1));
}
