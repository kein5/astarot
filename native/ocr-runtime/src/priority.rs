//! Running OCR below VRChat and the VR panels (Windows only; [`background_priority.py`]).
//!
//! ONNX Runtime creates native threads at normal priority. On hardware, OCR at normal
//! priority made the VR panel's work several times slower; below normal, it only runs
//! when the others leave the CPU free. Elsewhere these are no-ops, as in Python.
//!
//! [`background_priority.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/background_priority.py

/// The calling thread at below-normal priority.
pub fn lower_current_thread() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

/// The ids of this process's threads (empty outside Windows).
pub fn thread_ids() -> Vec<u64> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32};
        use windows::Win32::System::Threading::GetCurrentProcessId;
        let mut ids = Vec::new();
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) else { return ids };
        let pid = GetCurrentProcessId();
        let mut entry = THREADENTRY32 { dwSize: std::mem::size_of::<THREADENTRY32>() as u32, ..Default::default() };
        if Thread32First(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32OwnerProcessID == pid {
                    ids.push(entry.th32ThreadID as u64);
                }
                if Thread32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        ids
    }
    #[cfg(not(windows))]
    Vec::new()
}

/// Lower every thread that did not exist in `baseline` (taken just before the models
/// were loaded). Returns how many were lowered.
pub fn lower_new_threads(baseline: &[u64]) -> usize {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL, THREAD_SET_INFORMATION};
        let mut lowered = 0;
        for id in thread_ids() {
            if baseline.contains(&id) {
                continue;
            }
            if let Ok(handle) = OpenThread(THREAD_SET_INFORMATION, false, id as u32) {
                if SetThreadPriority(handle, THREAD_PRIORITY_BELOW_NORMAL).is_ok() {
                    lowered += 1;
                }
                let _ = CloseHandle(handle);
            }
        }
        lowered
    }
    #[cfg(not(windows))]
    {
        let _ = baseline;
        0
    }
}
