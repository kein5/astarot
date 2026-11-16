//! Whether SteamVR runs: its `vrmonitor` process (`checkSteamvrRunning`).

/// Whether a process of this executable name runs (`vrmonitor.exe` on Windows, `vrmonitor`
/// elsewhere; case-insensitive on Windows).
pub fn running(name: &str) -> bool {
    imp::running(name)
}

pub fn steamvr_running() -> bool {
    running(if cfg!(windows) { "vrmonitor.exe" } else { "vrmonitor" })
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };

    pub fn running(name: &str) -> bool {
        let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return false;
        };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
        while more {
            let length = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..length]).eq_ignore_ascii_case(name) {
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
    pub fn running(name: &str) -> bool {
        let Ok(entries) = std::fs::read_dir("/proc") else { return false };
        entries.flatten().any(|entry| {
            let is_pid = entry.file_name().to_str().is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()));
            is_pid && std::fs::read_to_string(entry.path().join("comm")).is_ok_and(|comm| comm.trim_end() == name)
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_made_up_process_does_not_run() {
        assert!(!super::running("vrct-no-such-process-name"));
    }
}
