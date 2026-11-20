//! How busy the PC was around a measurement of `examples/pipeline_latency.rs`. #556's target is
//! judged on a quiet PC without VRChat: a load average of 1 or less on Linux (decided
//! 2026-11-20) and, on Windows, which has no load average, a CPU usage of 10% or less (decided
//! 2026-11-21, #738). The example includes this file and reads the PC when the measurement
//! starts and ends; as a test target it checks the arithmetic, on any system.
// The example uses what the tests do not, and the other way round.
#![allow(dead_code)]

use std::time::Duration;

/// The 1-minute load average a quiet PC stays at or under (Linux).
pub const QUIET_LOAD_AVERAGE: f64 = 1.0;
/// The CPU usage, in percent of every logical processor, a quiet PC stays at or under (Windows).
pub const QUIET_CPU_USAGE: f64 = 10.0;
/// How long the CPU usage is read over, at the start and at the end.
pub const CPU_USAGE_WINDOW: Duration = Duration::from_secs(5);

/// The time every logical processor has spent since Windows started, in units of 100 ns, as
/// `GetSystemTimes` counts it: the kernel's time includes the idle time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CpuTimes {
    pub idle: u64,
    pub kernel: u64,
    pub user: u64,
}

/// The share of the time between two readings that the processors were busy, in percent; `None`
/// when no time passed or the counts do not add up.
pub fn cpu_usage(before: CpuTimes, after: CpuTimes) -> Option<f64> {
    let idle = after.idle.checked_sub(before.idle)?;
    let total = after.kernel.checked_sub(before.kernel)?.checked_add(after.user.checked_sub(before.user)?)?;
    if total == 0 || idle > total {
        return None;
    }
    Some(100.0 * (total - idle) as f64 / total as f64)
}

/// The load averages over 1, 5 and 15 minutes from the text of `/proc/loadavg`.
pub fn parse_load_average(text: &str) -> Option<[f64; 3]> {
    let mut fields = text.split_whitespace().map(str::parse::<f64>);
    match (fields.next(), fields.next(), fields.next()) {
        (Some(Ok(one)), Some(Ok(five)), Some(Ok(fifteen))) => Some([one, five, fifteen]),
        _ => None,
    }
}

/// The load averages now; `None` where there is no `/proc/loadavg`.
pub fn load_average() -> Option<[f64; 3]> {
    parse_load_average(&std::fs::read_to_string("/proc/loadavg").ok()?)
}

/// The CPU usage over `window`; `None` off Windows, without waiting, or when Windows does not
/// answer.
pub fn read_cpu_usage(window: Duration) -> Option<f64> {
    #[cfg(windows)]
    {
        let before = system_times()?;
        std::thread::sleep(window);
        cpu_usage(before, system_times()?)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}

#[cfg(windows)]
fn system_times() -> Option<CpuTimes> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    let mut times = [FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 }; 3];
    let [idle, kernel, user] = &mut times;
    // SAFETY: the three pointers are to distinct FILETIMEs that live across the call.
    let ok = unsafe { GetSystemTimes(idle, kernel, user) };
    let ticks = |time: &FILETIME| (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime);
    (ok != 0).then(|| CpuTimes { idle: ticks(&times[0]), kernel: ticks(&times[1]), user: ticks(&times[2]) })
}

/// A reading above the line #556's target is judged at.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TooBusy {
    /// The highest 1-minute load average read (Linux).
    LoadAverage(f64),
    /// The highest CPU usage read, in percent (Windows).
    CpuUsage(f64),
}

impl TooBusy {
    /// The note for stderr.
    pub fn note(self) -> String {
        match self {
            TooBusy::LoadAverage(load) => {
                format!("the load average reached {load:.2}: #556's target is judged at {QUIET_LOAD_AVERAGE} or less")
            }
            TooBusy::CpuUsage(usage) => {
                format!("the CPU usage reached {usage:.1}%: #556's target is judged at {QUIET_CPU_USAGE}% or less on Windows")
            }
        }
    }
}

/// The highest reading above its line, from the readings at the start and at the end; `None` when
/// the PC was quiet or nothing could be read. A load average, where there is one, comes first.
pub fn too_busy(loads: &[Option<[f64; 3]>], usages: &[Option<f64>]) -> Option<TooBusy> {
    let highest = |values: &mut dyn Iterator<Item = f64>| values.reduce(f64::max);
    if let Some(load) = highest(&mut loads.iter().flatten().map(|load| load[0])).filter(|&load| load > QUIET_LOAD_AVERAGE) {
        return Some(TooBusy::LoadAverage(load));
    }
    highest(&mut usages.iter().flatten().copied()).filter(|&usage| usage > QUIET_CPU_USAGE).map(TooBusy::CpuUsage)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn times(idle: u64, kernel: u64, user: u64) -> CpuTimes {
        CpuTimes { idle, kernel, user }
    }

    #[test]
    fn the_cpu_usage_is_the_busy_share_of_the_kernel_and_user_time() {
        // 12 processors for 5 s: 600,000,000 units of 100 ns, 540,000,000 of them idle.
        let before = times(1_000, 2_000, 3_000);
        let after = times(1_000 + 540_000_000, 2_000 + 570_000_000, 3_000 + 30_000_000);
        assert_eq!(cpu_usage(before, after), Some(10.0));
        assert_eq!(cpu_usage(before, times(1_000 + 10, 2_000 + 10, 3_000)), Some(0.0));
        assert_eq!(cpu_usage(before, times(1_000, 2_000 + 4, 3_000 + 4)), Some(100.0));
    }

    #[test]
    fn readings_that_do_not_add_up_give_no_cpu_usage() {
        let before = times(1_000, 2_000, 3_000);
        assert_eq!(cpu_usage(before, before), None, "no time passed");
        assert_eq!(cpu_usage(before, times(999, 3_000, 4_000)), None, "a count went back");
        assert_eq!(cpu_usage(before, times(1_100, 2_050, 3_000)), None, "more idle time than time");
        assert_eq!(cpu_usage(times(0, u64::MAX - 1, 0), times(0, u64::MAX, u64::MAX)), None, "an overflow");
    }

    #[test]
    fn the_load_average_is_read_from_its_first_three_fields() {
        assert_eq!(parse_load_average("0.52 1.25 3.00 2/1287 3012153\n"), Some([0.52, 1.25, 3.0]));
        assert_eq!(parse_load_average("0.52 1.25"), None);
        assert_eq!(parse_load_average("0.52 high 3.00 2/1287 3012153"), None);
        assert_eq!(parse_load_average(""), None);
    }

    #[test]
    fn a_reading_above_its_line_makes_the_pc_too_busy() {
        // Linux: a load average and no CPU usage.
        assert_eq!(too_busy(&[Some([0.4, 2.0, 3.0]), Some([1.0, 2.0, 3.0])], &[None, None]), None, "the line is quiet");
        assert_eq!(too_busy(&[Some([0.4, 0.1, 0.1]), Some([4.07, 0.1, 0.1])], &[None, None]), Some(TooBusy::LoadAverage(4.07)));
        // Windows: no load average.
        assert_eq!(too_busy(&[None, None], &[Some(3.2), Some(10.0)]), None, "the line is quiet");
        assert_eq!(too_busy(&[None, None], &[Some(12.5), Some(31.0)]), Some(TooBusy::CpuUsage(31.0)));
        assert_eq!(too_busy(&[None, None], &[None, Some(10.4)]), Some(TooBusy::CpuUsage(10.4)));
        // Nothing read.
        assert_eq!(too_busy(&[None, None], &[None, None]), None);
        // Both read: the load average first.
        assert_eq!(too_busy(&[Some([2.0, 0.0, 0.0])], &[Some(50.0)]), Some(TooBusy::LoadAverage(2.0)));
        assert_eq!(too_busy(&[Some([0.5, 0.0, 0.0])], &[Some(50.0)]), Some(TooBusy::CpuUsage(50.0)));
    }

    #[test]
    fn the_notes_name_the_reading_and_its_line() {
        assert_eq!(TooBusy::LoadAverage(4.07).note(), "the load average reached 4.07: #556's target is judged at 1 or less");
        assert_eq!(TooBusy::CpuUsage(31.04).note(), "the CPU usage reached 31.0%: #556's target is judged at 10% or less on Windows");
    }

    #[test]
    fn the_cpu_usage_is_read_on_windows_only() {
        if cfg!(windows) {
            let usage = read_cpu_usage(Duration::from_millis(200));
            assert!(usage.is_some_and(|usage| (0.0..=100.0).contains(&usage)), "{usage:?}");
        } else {
            let started = std::time::Instant::now();
            assert_eq!(read_cpu_usage(Duration::from_secs(60)), None);
            assert!(started.elapsed() < Duration::from_secs(1), "nothing waits for a reading");
        }
    }
}
