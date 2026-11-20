// The voice stand-in of the core's tests (native/core/tests/common/fake_voice.rs) names the RVC
// worker stand-in those tests build (`CARGO_BIN_EXE_fake-rvc-worker`). The integration tests
// never start the voice conversion, so here it names nothing.
fn main() {
    println!("cargo:rustc-env=CARGO_BIN_EXE_fake-rvc-worker=");
}
