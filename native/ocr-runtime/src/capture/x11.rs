//! The VRChat window by title on X11 / XWayland (Linux; `ocr_capture_x11.py`).
//!
//! VRChat under Proton is an X11 client, so on a Wayland desktop it is an XWayland
//! window. GetImage on the window reads the window's own contents, not the screen, so
//! VRCT-VOX or another window on top does not end up in the frame (as PrintWindow on
//! Windows). Without a compositor an occluded window reads as whatever covers it, which
//! the blank-frame check or the chatbox filter then drops.
//!
//! The X protocol is spoken directly (x11rb), so a window vanishing between finding and
//! reading it, or the server going away, is an error value: there is no Xlib error
//! handler that could exit the process.
//!
//! Not covered: native Wayland windows (gamescope, Wine's Wayland driver); those are
//! read through the ScreenCast portal once the user shares them ([`super::portal`]).

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, ImageFormat, ImageOrder, MapState, Window};
use x11rb::rust_connection::RustConnection;

use super::WindowCapture;
use crate::failure::Failure;
use crate::image::BgrImage;

const VRCHAT_WINDOW_TITLE: &str = "VRChat";
const MAX_TREE_DEPTH: usize = 3;

/// 32-bit TrueColor ZPixmap rows → BGR. Other layouts → `None`.
#[allow(clippy::too_many_arguments)]
pub fn frame_from_ximage(width: usize, height: usize, bytes_per_line: usize, bits_per_pixel: u8, red_mask: u32, blue_mask: u32, lsb_first: bool, data: &[u8]) -> Option<BgrImage> {
    if bits_per_pixel != 32 || width == 0 || height == 0 || bytes_per_line < width * 4 {
        return None;
    }
    if data.len() < bytes_per_line * height {
        return None;
    }
    // Byte order in memory: LSBFirst with red in 0xff0000 is B, G, R, X.
    let order: [usize; 3] = match ((red_mask, blue_mask), lsb_first) {
        ((0xFF0000, 0xFF), true) => [0, 1, 2],
        ((0xFF0000, 0xFF), false) => [3, 2, 1],
        ((0xFF, 0xFF0000), true) => [2, 1, 0],
        ((0xFF, 0xFF0000), false) => [1, 2, 3],
        _ => return None,
    };
    let mut out = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let row = &data[y * bytes_per_line..y * bytes_per_line + width * 4];
        for px in row.as_chunks::<4>().0 {
            out.extend_from_slice(&[px[order[0]], px[order[1]], px[order[2]]]);
        }
    }
    BgrImage::new(width, height, out).ok()
}

/// 0 for the exact title, 1 for a case-insensitive substring, `None` otherwise (as the
/// Windows lookup ranks titles).
pub fn title_rank(title: &str, needle: &str) -> Option<u8> {
    if title.is_empty() {
        return None;
    }
    if title == needle {
        return Some(0);
    }
    title.to_lowercase().contains(&needle.to_lowercase()).then_some(1)
}

/// The rank of a window: by title, else 2 when its WM_CLASS or process is the
/// executable (with or without ".exe"), as Proton names it.
pub fn window_rank(title: &str, names: &[String], needle: &str) -> Option<u8> {
    if let Some(rank) = title_rank(title, needle) {
        return Some(rank);
    }
    let lower = needle.to_lowercase();
    let bare = lower.strip_suffix(".exe").unwrap_or(&lower).to_string();
    let with_exe = format!("{bare}.exe");
    names.iter().any(|name| *name == bare || *name == with_exe).then_some(2)
}

fn capture_error(message: &str) -> Failure {
    Failure::new("X11CaptureError", message)
}

/// Captures an X11/XWayland window; the facade handles failure diagnostics.
pub struct X11WindowCapture {
    pub window_title: String,
    display_name: Option<String>,
    connection: Option<(RustConnection, usize)>,
    window: Option<Window>,
}

impl X11WindowCapture {
    pub fn new(window_title: &str) -> Self {
        X11WindowCapture { window_title: if window_title.is_empty() { VRCHAT_WINDOW_TITLE.into() } else { window_title.into() }, display_name: None, connection: None, window: None }
    }

    /// A specific display instead of `$DISPLAY`.
    pub fn with_display(mut self, display: &str) -> Self {
        self.display_name = Some(display.into());
        self
    }

    fn open(&mut self) -> bool {
        if self.connection.is_some() {
            return true;
        }
        self.window = None;
        match x11rb::connect(self.display_name.as_deref()) {
            Ok(connection) => {
                self.connection = Some(connection);
                true
            }
            Err(_) => false,
        }
    }

    fn atom(conn: &RustConnection, name: &str) -> Option<u32> {
        let atom = conn.intern_atom(true, name.as_bytes()).ok()?.reply().ok()?.atom;
        (atom != 0).then_some(atom)
    }

    fn property(conn: &RustConnection, window: Window, name: &str, max_items: u32) -> Result<(u8, Vec<u8>), bool> {
        let Some(atom) = Self::atom(conn, name) else { return Ok((0, Vec::new())) };
        let cookie = conn.get_property(false, window, atom, AtomEnum::ANY, 0, max_items).map_err(|_| true)?;
        match cookie.reply() {
            Ok(reply) => Ok((reply.format, reply.value)),
            // The window went away: an X error, not a lost display.
            Err(x11rb::errors::ReplyError::X11Error(_)) => Err(false),
            Err(_) => Err(true),
        }
    }

    fn title(conn: &RustConnection, window: Window) -> Result<String, bool> {
        for name in ["_NET_WM_NAME", "WM_NAME"] {
            let (format, raw) = Self::property(conn, window, name, 1024)?;
            if format == 8 && !raw.is_empty() {
                return Ok(String::from_utf8_lossy(&raw).trim_end_matches('\0').to_string());
            }
        }
        Ok(String::new())
    }

    fn names(conn: &RustConnection, window: Window) -> Result<Vec<String>, bool> {
        let (format, raw) = Self::property(conn, window, "WM_CLASS", 256)?;
        let mut names: Vec<String> = if format == 8 { raw.split(|&b| b == 0).filter(|p| !p.is_empty()).map(|p| String::from_utf8_lossy(p).to_lowercase()).collect() } else { Vec::new() };
        let (format, raw) = Self::property(conn, window, "_NET_WM_PID", 1)?;
        if format == 32 && raw.len() >= 4 {
            let pid = u32::from_ne_bytes(raw[..4].try_into().unwrap());
            if pid != 0 {
                names.push(super::process::process_name_of(pid));
            }
        }
        Ok(names)
    }

    fn candidates(conn: &RustConnection, root: Window) -> Result<Vec<Window>, bool> {
        let (format, raw) = Self::property(conn, root, "_NET_CLIENT_LIST", 1 << 16)?;
        if format == 32 && !raw.is_empty() {
            return Ok(raw.as_chunks::<4>().0.iter().map(|c| u32::from_ne_bytes(*c)).collect());
        }
        // No EWMH window manager: titles live on the client window, which a
        // reparenting manager puts one or two levels below the root.
        let mut found = Vec::new();
        let mut frontier = vec![(root, 0usize)];
        while let Some((window, depth)) = frontier.pop() {
            if depth > 0 {
                found.push(window);
            }
            if depth < MAX_TREE_DEPTH {
                if let Ok(Ok(tree)) = conn.query_tree(window).map(|c| c.reply()) {
                    frontier.extend(tree.children.into_iter().map(|child| (child, depth + 1)));
                }
            }
        }
        Ok(found)
    }

    /// `(width, height)` of a mapped window larger than one pixel.
    fn viewable(conn: &RustConnection, window: Window) -> Option<(u16, u16)> {
        let attributes = conn.get_window_attributes(window).ok()?.reply().ok()?;
        if attributes.map_state != MapState::VIEWABLE {
            return None;
        }
        let geometry = conn.get_geometry(window).ok()?.reply().ok()?;
        (geometry.width > 1 && geometry.height > 1).then_some((geometry.width, geometry.height))
    }

    /// The best match: exact title, then substring, then WM_CLASS or process name.
    pub fn find_window(&mut self) -> Result<Option<Window>, Failure> {
        if !self.open() {
            return Ok(None);
        }
        let needle = self.window_title.clone();
        let (conn, screen) = self.connection.as_ref().expect("opened");
        let root = conn.setup().roots[*screen].root;
        let mut ranked: Vec<(u8, Window)> = Vec::new();
        let mut errors = false;
        let candidates = match Self::candidates(conn, root) {
            Ok(windows) => windows,
            Err(_) => {
                self.connection = None;
                return Err(capture_error("X11 window lookup failed"));
            }
        };
        for window in candidates {
            let rank = match Self::title(conn, window) {
                Ok(title) => match title_rank(&title, &needle) {
                    Some(rank) => Some(rank),
                    None => match Self::names(conn, window) {
                        Ok(names) => window_rank("", &names, &needle),
                        Err(_) => {
                            errors = true;
                            None
                        }
                    },
                },
                Err(_) => {
                    errors = true;
                    None
                }
            };
            if let Some(rank) = rank {
                if Self::viewable(conn, window).is_some() {
                    ranked.push((rank, window));
                }
            }
        }
        if errors && ranked.is_empty() {
            return Err(capture_error("X11 window lookup failed"));
        }
        Ok(ranked.into_iter().min().map(|(_, window)| window))
    }

    fn grab(&mut self, window: Window) -> Result<Option<BgrImage>, Failure> {
        let (conn, _) = self.connection.as_ref().expect("opened");
        let Some((width, height)) = Self::viewable(conn, window) else { return Ok(None) };
        let cookie = conn.get_image(ImageFormat::Z_PIXMAP, window, 0, 0, width, height, !0).map_err(|_| capture_error("XGetImage failed"))?;
        let reply = match cookie.reply() {
            Ok(reply) => reply,
            // Unmapped or resized mid-read (BadMatch): look the window up again.
            Err(x11rb::errors::ReplyError::X11Error(_)) => return Err(capture_error("X11 frame capture failed")),
            Err(_) => {
                self.connection = None;
                return Err(capture_error("X11 frame capture failed"));
            }
        };
        let setup = conn.setup();
        let format = setup.pixmap_formats.iter().find(|f| f.depth == reply.depth);
        let visual = setup.roots.iter().flat_map(|s| s.allowed_depths.iter()).flat_map(|d| d.visuals.iter()).find(|v| v.visual_id == reply.visual);
        let (Some(format), Some(visual)) = (format, visual) else {
            return Err(capture_error("Unsupported or invalid X11 pixel format"));
        };
        let bits = format.bits_per_pixel as usize;
        let pad = format.scanline_pad as usize;
        let bytes_per_line = (width as usize * bits).div_ceil(pad) * pad / 8;
        let lsb_first = setup.image_byte_order == ImageOrder::LSB_FIRST;
        let frame = frame_from_ximage(width as usize, height as usize, bytes_per_line, format.bits_per_pixel, visual.red_mask, visual.blue_mask, lsb_first, &reply.data);
        match frame {
            Some(frame) if visual.green_mask == 0xFF00 => Ok(Some(frame)),
            _ => Err(capture_error("Unsupported or invalid X11 pixel format")),
        }
    }
}

impl WindowCapture for X11WindowCapture {
    fn is_available(&mut self) -> bool {
        if self.display_name.is_none() && std::env::var_os("DISPLAY").is_none_or(|d| d.is_empty()) {
            return false;
        }
        self.open()
    }

    fn capture(&mut self) -> Result<Option<BgrImage>, Failure> {
        if !self.open() {
            return Err(capture_error("X11 display unavailable"));
        }
        let window = match self.window {
            Some(window) => window,
            None => match self.find_window()? {
                Some(window) => window,
                None => return Ok(None),
            },
        };
        match self.grab(window) {
            Ok(Some(frame)) => {
                self.window = Some(window);
                Ok(Some(frame))
            }
            Ok(None) => {
                // Gone or unmapped: look the window up again next tick.
                self.window = None;
                Ok(None)
            }
            Err(failure) => {
                self.window = None;
                Err(failure)
            }
        }
    }

    fn find(&mut self) -> Result<bool, Failure> {
        Ok(self.find_window()?.is_some())
    }

    fn close(&mut self) {
        self.connection = None;
        self.window = None;
    }
}
