//! A library that cannot be loaded is an error value, kept for the process: nothing panics, and
//! a later call neither retries nor loads another library. Its own test binary, because the
//! environment is made once per process.

#![cfg(feature = "load-dynamic")]

use vrct_onnx_runtime::{environment, is_available, library_name, load, Error};

#[test]
fn a_missing_library_is_an_error_and_the_process_keeps_it() {
    let missing = std::env::temp_dir().join("vrct-onnx-runtime-missing").join(library_name());
    assert!(!missing.exists());
    assert!(matches!(load(&missing), Err(Error::Unavailable(_))));
    // The failure is kept: neither the default lookup nor another explicit file is tried.
    assert!(matches!(environment(), Err(Error::Unavailable(_))));
    assert!(!is_available());
    assert_eq!(load(&missing), Err(Error::AlreadyLoaded));
}
