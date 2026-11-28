//! VRChat's window through PrintWindow (Windows; [`ocr_capture_hwnd.py`]).
//!
//! PrintWindow renders from the window's own surface, so VRChat's content is read even
//! while another window (ASTAROT itself) covers it; a screen grab would read whatever
//! is on top.
//!
//! [`ocr_capture_hwnd.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture_hwnd.py

use std::sync::Arc;

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    GetDC, GetDIBits, GetMonitorInfoW, GetWindowDC, HDC, HGDIOBJ, HMONITOR, MONITOR_DEFAULTTOPRIMARY,
    MONITORINFO, MonitorFromPoint, ReleaseDC, SelectObject, SRCCOPY, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS,
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
    let window_dc = unsafe { GetWindowDC(Some(hwnd)) };
    if window_dc.is_invalid() {
        return Err(os_error("GetWindowDC"));
    }
    let result = capture_bitmap(window_dc, width, height, |memory_dc| unsafe {
        PrintWindow(hwnd, memory_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool()
    });
    unsafe { ReleaseDC(Some(hwnd), window_dc) };
    result
}

fn capture_bitmap(source: HDC, width: i32, height: i32, draw: impl FnOnce(HDC) -> bool) -> Result<BgrImage, Failure> {
    if width <= 0 || height <= 0 || u64::from(width as u32) * u64::from(height as u32) > 34_000_000 {
        return Err(Failure::new("ValueError", "Unsupported capture dimensions"));
    }
    unsafe {
        let memory = CreateCompatibleDC(Some(source));
        if memory.is_invalid() {
            return Err(os_error("CreateCompatibleDC"));
        }
        let result = (|| {
            let bitmap = CreateCompatibleBitmap(source, width, height);
            if bitmap.is_invalid() {
                return Err(os_error("CreateCompatibleBitmap"));
            }
            let previous = SelectObject(memory, HGDIOBJ(bitmap.0));
            let drawn = !previous.is_invalid() && draw(memory);
            if !previous.is_invalid() {
                SelectObject(memory, previous);
            }
            let read = if drawn {
                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: width,
                        biHeight: -height,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut buffer = vec![0u8; width as usize * height as usize * 4];
                let got = GetDIBits(memory, bitmap, 0, height as u32, Some(buffer.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
                if got == height {
                    let data = buffer.as_chunks::<4>().0.iter().flat_map(|px| [px[0], px[1], px[2]]).collect();
                    BgrImage::new(width as usize, height as usize, data).map_err(|error| Failure::new("ValueError", error.to_string()))
                } else {
                    Err(os_error("GetDIBits"))
                }
            } else {
                Err(os_error("CaptureBitmap"))
            };
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            read
        })();
        let _ = DeleteDC(memory);
        result
    }
}

/// Captures the Windows primary monitor selected at the start of sharing.
pub struct MonitorCapture(HMONITOR);

impl MonitorCapture {
    pub fn open() -> Result<Self, &'static str> {
        let monitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        if monitor.is_invalid() { Err("talk_monitor_unavailable") } else { Ok(Self(monitor)) }
    }

    pub fn read(&self) -> Result<BgrImage, &'static str> {
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !unsafe { GetMonitorInfoW(self.0, &mut info).as_bool() } {
            return Err("talk_monitor_unavailable");
        }
        let area = info.rcMonitor;
        let screen = unsafe { GetDC(None) };
        if screen.is_invalid() {
            return Err("talk_monitor_unavailable");
        }
        let width = area.right - area.left;
        let height = area.bottom - area.top;
        let result = capture_bitmap(screen, width, height, |memory| unsafe {
            BitBlt(memory, 0, 0, width, height, Some(screen), area.left, area.top, SRCCOPY | CAPTUREBLT).is_ok()
        });
        unsafe { ReleaseDC(None, screen) };
        result.map_err(|_| "talk_monitor_unavailable")
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
