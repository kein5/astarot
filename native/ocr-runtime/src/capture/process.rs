//! Is a process running (SteamVR's `vrmonitor`)? ([`process_check.py`])
//!
//! Python's psutil walk took about two seconds on a PC with ~460 processes; Windows uses
//! a Toolhelp snapshot instead (~15 ms) and Linux reads `/proc/<pid>/comm`.
//!
//! [`process_check.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/process_check.py

/// Whether a process named `name` runs. `false` when it cannot be told.
pub fn is_process_running(name: &str) -> bool {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return false };
        let wanted = name.to_lowercase();
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                if String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase() == wanted {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        found
    }
    #[cfg(not(windows))]
    {
        let Ok(entries) = std::fs::read_dir("/proc") else { return false };
        entries.flatten().any(|entry| {
            let file_name = entry.file_name();
            file_name.to_str().is_some_and(|pid| pid.bytes().all(|b| b.is_ascii_digit())) && process_name(entry.path().join("comm")).as_deref() == Some(name)
        })
    }
}

#[cfg(not(windows))]
fn process_name(comm: std::path::PathBuf) -> Option<String> {
    std::fs::read_to_string(comm).ok().map(|s| s.trim_end_matches('\n').to_string())
}

/// The executable name of a process id, lower-cased ("" when unknown). On Windows the
/// file name of its image; elsewhere `/proc/<pid>/comm` (VRChat under Proton is
/// "VRChat.exe" there too).
pub fn process_name_of(pid: u32) -> String {
    #[cfg(windows)]
    unsafe {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size).is_ok();
        let _ = CloseHandle(handle);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        process_name(std::path::PathBuf::from(format!("/proc/{pid}/comm"))).unwrap_or_default().to_lowercase()
    }
}
