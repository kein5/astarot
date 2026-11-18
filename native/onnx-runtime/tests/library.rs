//! With a real library named by `ORT_DYLIB_PATH`, the environment is made from it once, and an
//! explicit load afterwards changes nothing. Without the variable this test does nothing.
//!
//!     ORT_DYLIB_PATH=<onnxruntime library> cargo test --manifest-path native/onnx-runtime/Cargo.toml

#![cfg(feature = "load-dynamic")]

use std::path::PathBuf;

use vrct_onnx_runtime::{environment, is_available, library_path, load, use_library, Error, LIBRARY_VARIABLE};

#[test]
fn the_named_library_makes_the_one_environment() {
    let Some(named) = std::env::var_os(LIBRARY_VARIABLE).filter(|value| !value.is_empty()) else {
        return;
    };
    // The variable wins over the shipped library.
    use_library(PathBuf::from("not-the-shipped-library"));
    assert_eq!(library_path(), PathBuf::from(&named));
    assert!(environment().is_ok(), "{:?}", environment().err());
    assert!(is_available());
    assert!(std::ptr::eq(environment().unwrap(), environment().unwrap()));
    assert_eq!(load(&PathBuf::from(named)), Err(Error::AlreadyLoaded));
}
