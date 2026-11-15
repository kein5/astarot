//! The process monotonic clock in nanoseconds.
//!
//! Event timestamps cross module boundaries (recognition stamps a final, speech
//! expires it), so they use the operating system's monotonic clock, the same one
//! Python's `time.monotonic_ns()` reads on Linux. `std::time::Instant` is opaque
//! and cannot be compared with a timestamp made elsewhere.

/// Nanoseconds on the system monotonic clock. Always positive.
#[cfg(unix)]
// time_t and c_long are 32-bit on some targets.
#[allow(clippy::useless_conversion)]
pub fn monotonic_ns() -> i64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `now` is a valid, writable timespec; CLOCK_MONOTONIC always exists on supported systems.
    let result = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    assert_eq!(result, 0, "CLOCK_MONOTONIC is unavailable");
    i64::from(now.tv_sec) * 1_000_000_000 + i64::from(now.tv_nsec)
}

/// Nanoseconds on the system monotonic clock. Always positive.
#[cfg(windows)]
pub fn monotonic_ns() -> i64 {
    use std::sync::OnceLock;
    use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    let frequency = *FREQUENCY.get_or_init(|| {
        let mut value = 0i64;
        // SAFETY: the pointer is valid for one i64 write. Never fails on Windows XP or later.
        unsafe { QueryPerformanceFrequency(&mut value) };
        value
    });
    let mut counter = 0i64;
    // SAFETY: as above.
    unsafe { QueryPerformanceCounter(&mut counter) };
    (counter as i128 * 1_000_000_000 / frequency as i128) as i64
}

#[cfg(test)]
mod tests {
    use super::monotonic_ns;

    #[test]
    fn never_goes_back() {
        let first = monotonic_ns();
        assert!(first > 0);
        assert!(monotonic_ns() >= first);
    }
}
