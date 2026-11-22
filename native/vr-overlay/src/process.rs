//! Whether SteamVR runs: one of its processes, `vrserver` or `vrmonitor`
//! ([`vrct_openvr_client::STEAMVR_PROCESSES`], #944). Python's `checkSteamvrRunning` looked for
//! `vrmonitor` alone, which SteamVR on a Steam Frame does not open.

/// Whether a process of this executable name runs (case-insensitive on Windows).
pub fn running(name: &str) -> bool {
    running_any(&[name])
}

/// Whether a process of any of these executable names runs; one look at the process list.
pub fn running_any(names: &[&str]) -> bool {
    imp::running_any(names)
}

pub fn steamvr_running() -> bool {
    running_any(&vrct_openvr_client::STEAMVR_PROCESSES)
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };

    pub fn running_any(names: &[&str]) -> bool {
        let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return false;
        };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
        while more {
            let length = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let exe = String::from_utf16_lossy(&entry.szExeFile[..length]);
            if names.iter().any(|name| exe.eq_ignore_ascii_case(name)) {
                found = true;
                break;
            }
            more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
        }
        unsafe {
            let _ = CloseHandle(snapshot);
        }
        found
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn running_any(names: &[&str]) -> bool {
        let Ok(entries) = std::fs::read_dir("/proc") else { return false };
        entries.flatten().any(|entry| {
            let is_pid = entry.file_name().to_str().is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()));
            is_pid && std::fs::read_to_string(entry.path().join("comm")).is_ok_and(|comm| names.contains(&comm.trim_end()))
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_made_up_process_does_not_run() {
        assert!(!super::running("vrct-no-such-process-name"));
        assert!(!super::running_any(&["vrct-no-such-process-name", "vrct-nor-this-one"]));
    }

    /// This test's own process name, as the process list shows it.
    fn own_name() -> String {
        if cfg!(windows) {
            std::env::current_exe().unwrap().file_name().unwrap().to_string_lossy().into_owned()
        } else {
            std::fs::read_to_string("/proc/self/comm").unwrap().trim_end().to_string()
        }
    }

    #[test]
    fn any_one_of_the_names_running_is_enough() {
        // As SteamVR on a Steam Frame: its server runs, its status window does not (#944).
        let me = own_name();
        assert!(super::running(&me));
        assert!(super::running_any(&["vrct-no-such-process-name", &me]));
    }
}
