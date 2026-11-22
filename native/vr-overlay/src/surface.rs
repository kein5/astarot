//! Where the VR panel's page is captured, how its size is set and how the controllers' mouse
//! input reaches it ([`window_capture.py`], [`window_capture_linux.py`]).
//!
//! On Windows the page lives in the app's window "ASTAROT VR Panel", parked off-screen; it is
//! photographed with `PrintWindow`, and the mouse goes to its WebView2 input window
//! (`Chrome_RenderWidgetHostHWND`) with `PostMessageW`, so the system's cursor does not move. On
//! Linux the app (`src-tauri/src/vr_panel_surface.rs`) renders the page off-screen and writes each
//! repaint to `<ASTAROT_VR_PANEL_DIR>/frame`; sizes and the mouse go to
//! `<ASTAROT_VR_PANEL_DIR>/input.sock`, one line each, which the app turns into GDK events. The core
//! runs in the app's process, so all of this works from here as it did from the sidecar.
//!
//! [`window_capture.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/window_capture.py
//! [`window_capture_linux.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/window_capture_linux.py

/// The title the app gives the VR panel's window (`src-tauri/src/lib.rs`).
pub const VR_PANEL_TITLE: &str = "ASTAROT VR Panel";

/// A captured picture: BGRA, tightly packed, only the page (the window frame cut away).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub bgra: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// The mouse input the controller's laser makes on the page, in the captured picture's pixels
/// (the page's client area; (-1, -1) is outside it). The left button is the trigger; the wheel
/// is the stick, in Windows wheel units (120 a notch).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PointerInput {
    Move { x: i64, y: i64, pressed: bool },
    Down { x: i64, y: i64 },
    Up { x: i64, y: i64 },
    Wheel { x: i64, y: i64, delta: i64 },
}

/// Outside the page: moving or letting go here makes no click and ends the hover (`_OUTSIDE_XY`).
pub const OUTSIDE: (i64, i64) = (-1, -1);

/// GDK scrolls about 50 px for 1.0, down positive; Windows 120 a notch (about 100 px in
/// WebView2) (`_WHEEL_UNITS_PER_GDK_DELTA`).
pub const WHEEL_UNITS_PER_GDK_DELTA: f64 = -60.0;

/// The line the Linux page reads from `input.sock` ([`window_capture_linux.py`]).
///
/// [`window_capture_linux.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/window_capture_linux.py
pub fn input_line(input: PointerInput) -> String {
    match input {
        PointerInput::Move { x, y, pressed } => format!("move {x} {y} {}", u8::from(pressed)),
        PointerInput::Down { x, y } => format!("down {x} {y}"),
        PointerInput::Up { x, y } => format!("up {x} {y}"),
        PointerInput::Wheel { x, y, delta } => format!("wheel {x} {y} {:.4}", delta as f64 / WHEEL_UNITS_PER_GDK_DELTA),
    }
}

/// The VR page's window, found again when it is made again.
pub trait PanelSurface: Send + Sync {
    /// Whether the page can be captured here at all (`vrPanelSupported`).
    fn available(&self) -> bool;
    /// The page's current window, or `None` while the app has none.
    fn find(&self) -> Option<u64>;
    fn alive(&self, window: u64) -> bool;
    /// A picture of the page. May block while the page paints (on a capture thread).
    fn capture(&self, window: u64) -> Option<Frame>;
    /// Asks for the page to be `width` x `height` logical px. Returns the picture size that
    /// means the change is done.
    fn resize(&self, window: u64, width: u32, height: u32) -> (u32, u32);
    /// Mouse input into the page (`mouseMove`, `mouseDown`, `mouseUp`, `mouseWheel`). It does
    /// not move the system's cursor; a page that is gone ignores it.
    fn pointer(&self, _window: u64, _input: PointerInput) {}
}

/// The surface of this platform.
pub fn platform() -> std::sync::Arc<dyn PanelSurface> {
    std::sync::Arc::new(imp::Native::default())
}

#[cfg(windows)]
mod imp {
    use super::{Frame, PanelSurface, PointerInput, VR_PANEL_TITLE};
    use std::sync::Mutex;
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::core::BOOL;
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS,
        DeleteDC, DeleteObject, GetDIBits, GetWindowDC, ReleaseDC, SelectObject,
    };
    use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, FindWindowW, GetClassNameW, GetClientRect, GetWindowRect, IsIconic, IsWindow, PostMessageW,
        SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER, SetWindowPos, WM_LBUTTONDOWN, WM_LBUTTONUP,
        WM_MOUSEMOVE, WM_MOUSEWHEEL,
    };
    use windows::core::HSTRING;

    const PW_RENDERFULLCONTENT: u32 = 2;
    const MK_LBUTTON: usize = 1;
    /// The WebView2 child window that takes the input.
    const RENDER_WIDGET_CLASS: &str = "Chrome_RenderWidgetHostHWND";

    #[derive(Default)]
    pub struct Native {
        /// (page window, its input window), found once.
        target: Mutex<Option<(u64, u64)>>,
    }

    fn hwnd(window: u64) -> HWND {
        HWND(window as usize as *mut core::ffi::c_void)
    }

    unsafe extern "system" fn find_render_widget(child: HWND, found: LPARAM) -> BOOL {
        let mut name = [0u16; 64];
        let length = unsafe { GetClassNameW(child, &mut name) }.max(0) as usize;
        if String::from_utf16_lossy(&name[..length]) == RENDER_WIDGET_CLASS {
            unsafe { *(found.0 as *mut usize) = child.0 as usize };
            return BOOL(0);
        }
        BOOL(1)
    }

    impl Native {
        /// In WebView2 the descendant `Chrome_RenderWidgetHostHWND` takes the input (`_target`);
        /// without one, the window itself.
        fn target(&self, window: u64) -> HWND {
            let mut cached = self.target.lock().unwrap();
            if let Some((page, input)) = *cached
                && page == window
                && unsafe { IsWindow(Some(hwnd(input))) }.as_bool()
            {
                return hwnd(input);
            }
            let mut found: usize = 0;
            unsafe {
                let _ = EnumChildWindows(Some(hwnd(window)), Some(find_render_widget), LPARAM(&mut found as *mut usize as isize));
            }
            if found == 0 {
                return hwnd(window);
            }
            *cached = Some((window, found as u64));
            hwnd(found as u64)
        }
    }

    impl PanelSurface for Native {
        fn available(&self) -> bool {
            true
        }

        fn find(&self) -> Option<u64> {
            let found = unsafe { FindWindowW(None, &HSTRING::from(VR_PANEL_TITLE)) }.ok()?;
            (!found.0.is_null()).then_some(found.0 as usize as u64)
        }

        fn alive(&self, window: u64) -> bool {
            unsafe { IsWindow(Some(hwnd(window))) }.as_bool()
        }

        fn capture(&self, window: u64) -> Option<Frame> {
            let hwnd = hwnd(window);
            unsafe {
                if IsIconic(hwnd).as_bool() {
                    return None;
                }
                let mut rect = RECT::default();
                GetWindowRect(hwnd, &mut rect).ok()?;
                let (width, height) = (rect.right - rect.left, rect.bottom - rect.top);
                if width <= 0 || height <= 0 {
                    return None;
                }
                let hdc = GetWindowDC(Some(hwnd));
                let mdc = CreateCompatibleDC(Some(hdc));
                let bitmap = CreateCompatibleBitmap(hdc, width, height);
                let previous = SelectObject(mdc, bitmap.into());
                let mut pixels = vec![0u8; (width * height * 4) as usize];
                let printed = PrintWindow(hwnd, mdc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
                if printed {
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
                    GetDIBits(mdc, bitmap, 0, height as u32, Some(pixels.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
                }
                SelectObject(mdc, previous);
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(mdc);
                ReleaseDC(Some(hwnd), hdc);
                if !printed {
                    return None;
                }
                // Only the client area, which the input coordinates use.
                let mut client = RECT::default();
                GetClientRect(hwnd, &mut client).ok()?;
                let mut origin = POINT::default();
                let _ = ClientToScreen(hwnd, &mut origin);
                let (left, top) = (origin.x - rect.left, origin.y - rect.top);
                let (cw, ch) = (client.right.min(width - left), client.bottom.min(height - top));
                if left < 0 || top < 0 || cw <= 0 || ch <= 0 {
                    return None;
                }
                let mut bgra = Vec::with_capacity((cw * ch * 4) as usize);
                for row in top..top + ch {
                    let start = ((row * width + left) * 4) as usize;
                    bgra.extend_from_slice(&pixels[start..start + (cw * 4) as usize]);
                }
                Some(Frame { bgra, width: cw as u32, height: ch as u32 })
            }
        }

        fn pointer(&self, window: u64, input: PointerInput) {
            let target = self.target(window);
            let lparam = |x: i64, y: i64| LPARAM((((y as i32 & 0xFFFF) << 16) | (x as i32 & 0xFFFF)) as isize);
            unsafe {
                let _ = match input {
                    PointerInput::Move { x, y, pressed } => {
                        PostMessageW(Some(target), WM_MOUSEMOVE, WPARAM(if pressed { MK_LBUTTON } else { 0 }), lparam(x, y))
                    }
                    PointerInput::Down { x, y } => PostMessageW(Some(target), WM_LBUTTONDOWN, WPARAM(MK_LBUTTON), lparam(x, y)),
                    PointerInput::Up { x, y } => PostMessageW(Some(target), WM_LBUTTONUP, WPARAM(0), lparam(x, y)),
                    PointerInput::Wheel { x, y, delta } => {
                        // WM_MOUSEWHEEL carries screen coordinates.
                        let mut point = POINT { x: x as i32, y: y as i32 };
                        let _ = ClientToScreen(target, &mut point);
                        let wparam = WPARAM((((delta as i32) & 0xFFFF) as usize) << 16);
                        PostMessageW(Some(target), WM_MOUSEWHEEL, wparam, lparam(i64::from(point.x), i64::from(point.y)))
                    }
                };
            }
        }

        fn resize(&self, window: u64, width: u32, height: u32) -> (u32, u32) {
            let hwnd = hwnd(window);
            unsafe {
                let dpi = GetDpiForWindow(hwnd);
                let scale = if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 };
                let target = ((f64::from(width) * scale).round_ties_even() as i32, (f64::from(height) * scale).round_ties_even() as i32);
                let (mut rect, mut client) = (RECT::default(), RECT::default());
                let _ = GetWindowRect(hwnd, &mut rect);
                let _ = GetClientRect(hwnd, &mut client);
                if (client.right, client.bottom) != target {
                    let frame_w = (rect.right - rect.left) - client.right;
                    let frame_h = (rect.bottom - rect.top) - client.bottom;
                    let _ = SetWindowPos(hwnd, None, 0, 0, target.0 + frame_w, target.1 + frame_h,
                        SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
                }
                (target.0.max(0) as u32, target.1.max(0) as u32)
            }
        }
    }
}

#[cfg(unix)]
mod imp {
    use super::{Frame, PanelSurface, PointerInput};
    use std::os::unix::fs::FileExt;
    use std::os::unix::net::UnixDatagram;
    use std::path::PathBuf;
    use std::sync::Mutex;

    const DIRECTORY_ENV: &str = astarot_app_identity::env::VR_PANEL_DIR;
    const MAGIC: &[u8; 8] = astarot_app_identity::handoff::VR_PANEL_FRAME;
    const HEADER_SIZE: usize = 64;
    const MAX_SIDE: u32 = 8192;

    #[derive(Default)]
    pub struct Native {
        cache: Mutex<Option<(u64, u64, Frame)>>,
        sender: Mutex<Option<UnixDatagram>>,
    }

    fn directory() -> Option<PathBuf> {
        std::env::var_os(DIRECTORY_ENV).filter(|v| !v.is_empty()).map(PathBuf::from)
    }

    /// (sequence, instance, width, height, stride).
    pub fn parse(head: &[u8]) -> Option<(u64, u64, u32, u32, u32)> {
        if head.len() < 32 || &head[..8] != MAGIC {
            return None;
        }
        let u64_at = |i: usize| u64::from_le_bytes(head[i..i + 8].try_into().unwrap());
        let u32_at = |i: usize| u32::from_le_bytes(head[i..i + 4].try_into().unwrap());
        let (sequence, instance, width, height, stride) = (u64_at(8), u64_at(16), u32_at(24), u32_at(28), u32_at(32));
        if width > MAX_SIDE || height > MAX_SIDE || (width > 0 && stride < width * 4) || stride > MAX_SIDE * 4 {
            return None;
        }
        Some((sequence, instance, width, height, stride))
    }

    fn header() -> Option<(u64, u64, u32, u32, u32)> {
        let file = std::fs::File::open(directory()?.join("frame")).ok()?;
        let mut head = [0u8; HEADER_SIZE];
        file.read_exact_at(&mut head, 0).ok()?;
        parse(&head)
    }

    impl Native {
        fn send(&self, text: &str) {
            let Some(dir) = directory() else { return };
            let mut sender = self.sender.lock().unwrap();
            if sender.is_none() {
                *sender = UnixDatagram::unbound().ok();
                if let Some(socket) = sender.as_ref() {
                    let _ = socket.set_nonblocking(true);
                }
            }
            if let Some(socket) = sender.as_ref() {
                let _ = socket.send_to(text.as_bytes(), dir.join("input.sock"));
            }
        }
    }

    impl PanelSurface for Native {
        fn available(&self) -> bool {
            directory().is_some_and(|d| d.is_dir())
        }

        fn find(&self) -> Option<u64> {
            header().map(|h| h.1).filter(|instance| *instance != 0)
        }

        fn alive(&self, window: u64) -> bool {
            window != 0 && header().is_some_and(|h| h.1 == window)
        }

        fn capture(&self, window: u64) -> Option<Frame> {
            let file = std::fs::File::open(directory()?.join("frame")).ok()?;
            let mut cache = self.cache.lock().unwrap();
            for _ in 0..4 {
                let mut head = [0u8; HEADER_SIZE];
                file.read_exact_at(&mut head, 0).ok()?;
                let (sequence, instance, width, height, stride) = parse(&head)?;
                if instance != window {
                    return None;
                }
                if sequence % 2 == 1 {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                    continue;
                }
                if width == 0 || height == 0 {
                    return None;
                }
                if let Some((i, s, frame)) = cache.as_ref()
                    && (*i, *s) == (instance, sequence)
                {
                    return Some(frame.clone());
                }
                let mut raw = vec![0u8; stride as usize * height as usize];
                if file.read_exact_at(&mut raw, HEADER_SIZE as u64).is_err() {
                    continue;
                }
                let mut again = [0u8; 16];
                if file.read_exact_at(&mut again, 0).is_err() || again != head[..16] {
                    continue;
                }
                let bgra = if stride == width * 4 {
                    raw
                } else {
                    raw.chunks_exact(stride as usize).flat_map(|row| row[..(width * 4) as usize].iter().copied()).collect()
                };
                let frame = Frame { bgra, width, height };
                *cache = Some((instance, sequence, frame.clone()));
                return Some(frame);
            }
            cache.as_ref().filter(|(i, _, _)| *i == window).map(|(_, _, frame)| frame.clone())
        }

        fn resize(&self, _window: u64, width: u32, height: u32) -> (u32, u32) {
            self.send(&format!("resize {width} {height}"));
            (width, height)
        }

        fn pointer(&self, _window: u64, input: PointerInput) {
            self.send(&super::input_line(input));
        }
    }
}
