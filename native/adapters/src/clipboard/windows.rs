//! Windows: find the target window, bring it forward and send Ctrl+V.
//!
//! The same steps as [`models/clipboard/clipboard.py`]: a window whose title contains the
//! name (ignoring case), else a window of a process with that name; `ShowWindow`
//! (restore), then `BringWindowToTop` and `SetForegroundWindow` while this thread's
//! input is attached to the foreground thread's (the documented way past the focus
//! stealing guard); then `keybd_event` for Ctrl and V, releasing Ctrl even when V fails.
//!
//! [`models/clipboard/clipboard.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/clipboard/clipboard.py

use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, GlobalFree, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM};
use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows_sys::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};

use super::{copy, Desktop, DesktopBroken, Focus};
use crate::log;

const VK_CONTROL: u8 = 0x11;
const VK_V: u8 = 0x56;
const CF_UNICODETEXT: u32 = 13;

fn wide_to_string(wide: &[u16]) -> String {
    let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..end])
}

fn all_windows() -> Vec<HWND> {
    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> windows_sys::core::BOOL {
        let found = unsafe { &mut *(data as *mut Vec<HWND>) };
        found.push(hwnd);
        1
    }
    let mut found: Vec<HWND> = Vec::new();
    unsafe { EnumWindows(Some(collect), &mut found as *mut Vec<HWND> as LPARAM) };
    found
}

fn window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    wide_to_string(&buffer[..copied.max(0) as usize])
}

/// The executable's file name (what psutil's `name()` gives on Windows).
fn process_name(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size) };
    unsafe { CloseHandle(handle) };
    if ok == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..size as usize]);
    path.rsplit(['\\', '/']).next().map(str::to_string)
}

pub fn find_windows_by_title_substring(substring: &str) -> Vec<HWND> {
    let needle = substring.to_lowercase();
    all_windows()
        .into_iter()
        .filter(|&hwnd| {
            let title = window_title(hwnd);
            !title.is_empty() && title.to_lowercase().contains(&needle)
        })
        .collect()
}

pub fn find_windows_by_process_name(name: &str) -> Vec<HWND> {
    let wanted = name.to_lowercase();
    all_windows()
        .into_iter()
        .filter(|&hwnd| {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
            process_name(pid).is_some_and(|n| n.to_lowercase() == wanted)
        })
        .collect()
}

pub fn focus_window(hwnd: HWND) -> bool {
    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        // Windows ignores a plain SetForegroundWindow from a process that was not in
        // front. Attaching this thread's input to the foreground thread's makes the two
        // share input state, which lifts that restriction the documented way.
        let current = GetCurrentThreadId();
        let foreground = GetForegroundWindow();
        let foreground_thread =
            if foreground.is_null() { 0 } else { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) };
        let attached = foreground_thread != 0
            && foreground_thread != current
            && AttachThreadInput(current, foreground_thread, 1) != 0;
        BringWindowToTop(hwnd);
        let result = SetForegroundWindow(hwnd);
        if attached {
            AttachThreadInput(current, foreground_thread, 0);
        }
        result != 0
    }
}

/// Send Ctrl+V to the focused window after `countdown` seconds. Keys are released in
/// reverse order, Ctrl always.
pub fn paste_via_ctrl_v(countdown: u32) -> bool {
    for _ in (1..=countdown).rev() {
        log::line("paste: countdown");
        std::thread::sleep(Duration::from_secs(1));
    }
    unsafe {
        keybd_event(VK_CONTROL, 0, 0, 0);
        keybd_event(VK_V, 0, 0, 0);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
    }
    true
}

/// The Win32 clipboard as text (`CF_UNICODETEXT`), when `clip.exe` could not run.
pub fn copy_with_api(text: &str) -> bool {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        let mut ok = EmptyClipboard() != 0;
        if ok {
            let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
            ok = !memory.is_null();
            if ok {
                let target = GlobalLock(memory) as *mut u16;
                if target.is_null() {
                    GlobalFree(memory);
                    ok = false;
                } else {
                    std::ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
                    GlobalUnlock(memory);
                    // The clipboard owns the memory once this succeeds.
                    ok = !SetClipboardData(CF_UNICODETEXT, memory as HANDLE).is_null();
                    if !ok {
                        GlobalFree(memory);
                    }
                }
            }
        }
        CloseClipboard();
        ok
    }
}

/// Whether a process with this executable name runs (a Toolhelp snapshot).
pub fn is_process_running(name: &str) -> bool {
    let wanted = name.to_lowercase();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            if wide_to_string(&entry.szExeFile).to_lowercase() == wanted {
                found = true;
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

#[derive(Default)]
pub struct WindowsDesktop;

impl Desktop for WindowsDesktop {
    fn focuses_before_copy(&self) -> bool {
        true
    }

    fn copy(&mut self, text: &str) -> bool {
        copy::copy_to_clipboard(text)
    }

    fn focus(&mut self, window_name: &str) -> Result<Focus, DesktopBroken> {
        // The title first, then the name as a process name.
        let by_title = find_windows_by_title_substring(window_name);
        if by_title.into_iter().any(focus_window) {
            return Ok(Focus::Focused);
        }
        let by_process = find_windows_by_process_name(window_name);
        Ok(if by_process.into_iter().any(focus_window) { Focus::Focused } else { Focus::NotFocused })
    }

    fn paste(&mut self, countdown: u32) -> Result<bool, DesktopBroken> {
        Ok(paste_via_ctrl_v(countdown))
    }
}
