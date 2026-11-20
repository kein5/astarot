//! VRChat's window through PrintWindow (Windows; [`ocr_capture_hwnd.py`]).
//!
//! PrintWindow renders from the window's own surface, so VRChat's content is read even
//! while another window (VRCT-VOX itself) covers it; a screen grab would read whatever
//! is on top.
//!
//! [`ocr_capture_hwnd.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture_hwnd.py

use std::sync::Arc;

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible};

use super::WindowCapture;
use crate::failure::{Clock, Failure, FailureLog, Log};
use crate::image::BgrImage;

const VRCHAT_WINDOW_TITLE: &str = "VRChat";
const PW_RENDERFULLCONTENT: u32 = 0x0000_0002;

/// The executable name without ".exe", lower-cased, of the process owning `hwnd`.
fn process_name(hwnd: HWND) -> String {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return String::new();
    }
    let name = super::process::process_name_of(pid);
    name.strip_suffix(".exe").map(str::to_string).unwrap_or(name)
}

struct Search {
    title: String,
    needle: String,
    needle_no_exe: String,
    exact: Vec<HWND>,
    partial: Vec<HWND>,
    by_process: Vec<HWND>,
}

unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe {
        let search = &mut *(lparam.0 as *mut Search);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let length = GetWindowTextLengthW(hwnd);
        if length > 0 {
            let mut buffer = vec![0u16; length as usize + 1];
            let copied = GetWindowTextW(hwnd, &mut buffer);
            let title = String::from_utf16_lossy(&buffer[..copied.max(0) as usize]);
            if title == search.title {
                search.exact.push(hwnd);
                return BOOL(1);
            }
            if title.to_lowercase().contains(&search.needle) {
                search.partial.push(hwnd);
                return BOOL(1);
            }
        }
        if process_name(hwnd) == search.needle_no_exe {
            search.by_process.push(hwnd);
        }
        BOOL(1)
    }
}

/// The first visible window by exact title, then substring, then executable name.
pub fn find_vrchat_hwnd(title: &str) -> Option<HWND> {
    let needle = title.to_lowercase();
    let needle_no_exe = needle.strip_suffix(".exe").unwrap_or(&needle).to_string();
    let mut search = Search { title: title.to_string(), needle, needle_no_exe, exact: Vec::new(), partial: Vec::new(), by_process: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    search.exact.first().or(search.partial.first()).or(search.by_process.first()).copied()
}

fn window_rect(hwnd: HWND) -> Option<(i32, i32, i32, i32)> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).ok()? };
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    (w > 0 && h > 0).then_some((rect.left, rect.top, w, h))
}

fn os_error(operation: &str) -> Failure {
    Failure::new("OSError", format!("{operation} failed"))
}

/// The window's own content into an offscreen bitmap; every handle is released.
fn print_window(hwnd: HWND, width: i32, height: i32) -> Result<BgrImage, Failure> {
    unsafe {
        let window_dc = GetWindowDC(Some(hwnd));
        if window_dc.is_invalid() {
            return Err(os_error("GetWindowDC"));
        }
        let memory_dc = CreateCompatibleDC(Some(window_dc));
        let result = (|| {
            if memory_dc.is_invalid() {
                return Err(os_error("CreateCompatibleDC"));
            }
            let bitmap = CreateCompatibleBitmap(window_dc, width, height);
            if bitmap.is_invalid() {
                return Err(os_error("CreateCompatibleBitmap"));
            }
            let previous = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
            let read = (|| {
                if !PrintWindow(hwnd, memory_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool() {
                    return Err(os_error("PrintWindow"));
                }
                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: width,
                        biHeight: -height, // top-down
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut buffer = vec![0u8; width as usize * height as usize * 4];
                let got = GetDIBits(memory_dc, bitmap, 0, height as u32, Some(buffer.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
                if got != height {
                    return Err(os_error("GetDIBits"));
                }
                let data: Vec<u8> = buffer.as_chunks::<4>().0.iter().flat_map(|px| [px[0], px[1], px[2]]).collect();
                BgrImage::new(width as usize, height as usize, data).map_err(|e| Failure::new("ValueError", e.to_string()))
            })();
            SelectObject(memory_dc, previous);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            read
        })();
        if !memory_dc.is_invalid() {
            let _ = DeleteDC(memory_dc);
        }
        ReleaseDC(Some(hwnd), window_dc);
        result
    }
}

/// VRChat's window through PrintWindow, with its own bounded failure log.
pub struct HwndCapture {
    pub window_title: String,
    hwnd: Option<HWND>,
    failures: FailureLog,
    clock: Arc<dyn Clock>,
}

// HWND is a plain handle value; the capture is used on the worker thread only.
unsafe impl Send for HwndCapture {}

impl HwndCapture {
    pub fn new(window_title: &str, log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> Self {
        HwndCapture {
            window_title: if window_title.is_empty() { VRCHAT_WINDOW_TITLE.into() } else { window_title.into() },
            hwnd: None,
            failures: FailureLog::new("OCR HWND capture", log, clock.clone()),
            clock,
        }
    }
}

impl WindowCapture for HwndCapture {
    fn is_available(&mut self) -> bool {
        true
    }

    /// `None` when the window is missing or minimized, or the read failed (logged here).
    fn capture(&mut self) -> Result<Option<BgrImage>, Failure> {
        self.failures.report(self.clock.now());
        let mut hwnd = self.hwnd;
        if hwnd.is_none_or(|h| window_rect(h).is_none()) {
            hwnd = find_vrchat_hwnd(&self.window_title);
            self.hwnd = hwnd;
        }
        let Some(hwnd) = hwnd else { return Ok(None) };
        if unsafe { IsIconic(hwnd).as_bool() } {
            return Ok(None);
        }
        let Some((_, _, width, height)) = window_rect(hwnd) else {
            self.hwnd = None;
            return Ok(None);
        };
        match print_window(hwnd, width, height) {
            Ok(frame) => {
                self.failures.success();
                Ok(Some(frame))
            }
            Err(failure) => {
                self.failures.failure(&failure);
                self.hwnd = None;
                Ok(None)
            }
        }
    }

    fn find(&mut self) -> Result<bool, Failure> {
        Ok(find_vrchat_hwnd(&self.window_title).is_some())
    }

    fn failure_active(&self) -> bool {
        self.failures.active()
    }

    fn close(&mut self) {
        self.hwnd = None;
        self.failures.reset();
    }
}
