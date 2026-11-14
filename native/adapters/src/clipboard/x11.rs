//! Linux: bring the target window (X11 / XWayland only) to the front and send Ctrl+V.
//!
//! The same steps as `models/clipboard/x11_paste.py` and the window search of
//! `models/ocr/ocr_capture_x11.py`. VRChat under Proton is an XWayland window, so the
//! X11 steps reach it. The window manager is asked to activate the window
//! (`_NET_ACTIVE_WINDOW`, as a pager acting for the user); the keys go through XTest,
//! which reaches X11 windows only, so they are sent only once the window is in front.
//! Wayland-native windows cannot be pasted into.

use std::time::{Duration, Instant};

use x11rb::connection::{Connection, RequestConnection};
use x11rb::errors::{ConnectionError, ReplyError};
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConnectionExt as _, EventMask, MapState, Window, CLIENT_MESSAGE_EVENT,
};
use x11rb::protocol::xtest::{self, ConnectionExt as _};
use x11rb::rust_connection::RustConnection;

use super::{copy, Desktop, DesktopBroken, Focus};

const SOURCE_PAGER: u32 = 2;
const XK_CONTROL_L: u32 = 0xFFE3;
const XK_V: u32 = 0x0076;
const KEY_PRESS: u8 = 2;
const KEY_RELEASE: u8 = 3;
const ACTIVATE_WAIT: Duration = Duration::from_millis(600);
const ACTIVATE_POLL: Duration = Duration::from_millis(20);
const MAX_TREE_DEPTH: u32 = 3;

/// Request: one request failed (a window that went away); the step fails and the
/// connection stays. Connection: the connection is gone.
enum Failure {
    Request,
    Connection,
}

impl From<ConnectionError> for Failure {
    fn from(_: ConnectionError) -> Self {
        Failure::Connection
    }
}

impl From<ReplyError> for Failure {
    fn from(error: ReplyError) -> Self {
        match error {
            ReplyError::ConnectionError(_) => Failure::Connection,
            ReplyError::X11Error(_) => Failure::Request,
        }
    }
}

/// 0 exact, 1 substring (ignoring case), none otherwise.
fn title_rank(title: &str, needle: &str) -> Option<u8> {
    if title.is_empty() {
        return None;
    }
    if title == needle {
        return Some(0);
    }
    title.to_lowercase().contains(&needle.to_lowercase()).then_some(1)
}

fn process_name(pid: u32) -> String {
    std::fs::read(format!("/proc/{pid}/comm"))
        .map(|raw| String::from_utf8_lossy(&raw).trim().to_lowercase())
        .unwrap_or_default()
}

/// One X11 connection, kept between pastes: KDE Plasma (Wayland) asks the user once
/// per connection before an X11 client may send keys.
pub struct X11Connection {
    conn: RustConnection,
    root: Window,
    atoms: std::collections::HashMap<&'static str, u32>,
}

impl X11Connection {
    /// Connect to `$DISPLAY`, which must offer XTest.
    pub fn open() -> Option<Self> {
        if std::env::var_os("DISPLAY").is_none_or(|d| d.is_empty()) {
            return None;
        }
        let (conn, screen) = x11rb::connect(None).ok()?;
        conn.extension_information(xtest::X11_EXTENSION_NAME).ok()??;
        let root = conn.setup().roots.get(screen)?.root;
        Some(Self { conn, root, atoms: Default::default() })
    }

    fn atom(&mut self, name: &'static str) -> Result<u32, Failure> {
        if let Some(atom) = self.atoms.get(name) {
            return Ok(*atom);
        }
        // Only atoms that exist: a missing one means nobody set that property.
        let atom = self.conn.intern_atom(true, name.as_bytes())?.reply()?.atom;
        self.atoms.insert(name, atom);
        Ok(atom)
    }

    fn property(&mut self, window: Window, name: &'static str, long_length: u32) -> Result<(u8, Vec<u8>), Failure> {
        let atom = self.atom(name)?;
        if atom == 0 {
            return Ok((0, Vec::new()));
        }
        let reply = match self.conn.get_property(false, window, atom, AtomEnum::ANY, 0, long_length)?.reply() {
            Ok(reply) => reply,
            Err(ReplyError::X11Error(_)) => return Ok((0, Vec::new())),
            Err(error) => return Err(error.into()),
        };
        Ok((reply.format, reply.value))
    }

    fn windows(&mut self, window: Window, name: &'static str) -> Result<Vec<Window>, Failure> {
        let (format, raw) = self.property(window, name, 1 << 16)?;
        if format != 32 {
            return Ok(Vec::new());
        }
        Ok(raw.as_chunks::<4>().0.iter().map(|c| u32::from_ne_bytes(*c)).collect())
    }

    fn title(&mut self, window: Window) -> Result<String, Failure> {
        for name in ["_NET_WM_NAME", "WM_NAME"] {
            let (format, raw) = self.property(window, name, 1024)?;
            if format == 8 && !raw.is_empty() {
                return Ok(String::from_utf8_lossy(&raw).trim_end_matches('\0').to_string());
            }
        }
        Ok(String::new())
    }

    fn classes(&mut self, window: Window) -> Result<Vec<String>, Failure> {
        let (format, raw) = self.property(window, "WM_CLASS", 256)?;
        if format != 8 {
            return Ok(Vec::new());
        }
        Ok(raw
            .split(|&b| b == 0)
            .filter(|p| !p.is_empty())
            .map(|p| String::from_utf8_lossy(p).to_lowercase())
            .collect())
    }

    fn pid(&mut self, window: Window) -> Result<u32, Failure> {
        let (format, raw) = self.property(window, "_NET_WM_PID", 1)?;
        if format != 32 || raw.len() < 4 {
            return Ok(0);
        }
        Ok(u32::from_ne_bytes([raw[0], raw[1], raw[2], raw[3]]))
    }

    fn children(&self, window: Window) -> Result<Vec<Window>, Failure> {
        match self.conn.query_tree(window)?.reply() {
            Ok(reply) => Ok(reply.children),
            Err(ReplyError::X11Error(_)) => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn candidates(&mut self) -> Result<Vec<Window>, Failure> {
        let managed = self.windows(self.root, "_NET_CLIENT_LIST")?;
        if !managed.is_empty() {
            return Ok(managed);
        }
        // No EWMH window manager: walk the tree (titles live on the client window,
        // which a reparenting window manager puts one or two levels below the root).
        let mut found = Vec::new();
        let mut frontier = vec![(self.root, 0)];
        while let Some((window, depth)) = frontier.pop() {
            if depth > 0 {
                found.push(window);
            }
            if depth < MAX_TREE_DEPTH {
                frontier.extend(self.children(window)?.into_iter().map(|child| (child, depth + 1)));
            }
        }
        Ok(found)
    }

    fn viewable(&self, window: Window) -> Result<bool, Failure> {
        let attributes = match self.conn.get_window_attributes(window)?.reply() {
            Ok(attributes) => attributes,
            Err(ReplyError::X11Error(_)) => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        if attributes.map_state != MapState::VIEWABLE {
            return Ok(false);
        }
        match self.conn.get_geometry(window)?.reply() {
            Ok(geometry) => Ok(geometry.width > 1 && geometry.height > 1),
            Err(ReplyError::X11Error(_)) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    /// Best match: exact title, then substring, then class or process name (with or
    /// without `.exe`), among windows that are shown.
    fn find(&mut self, needle: &str) -> Result<Option<Window>, Failure> {
        let lower = needle.to_lowercase();
        let bare = lower.strip_suffix(".exe").unwrap_or(&lower).to_string();
        let with_exe = format!("{bare}.exe");
        let mut ranked = Vec::new();
        for window in self.candidates()? {
            let mut rank = title_rank(&self.title(window)?, needle);
            if rank.is_none() {
                let mut names = self.classes(window)?;
                let pid = self.pid(window)?;
                if pid != 0 {
                    names.push(process_name(pid));
                }
                if names.iter().any(|n| *n == bare || *n == with_exe) {
                    rank = Some(2);
                }
            }
            if let Some(rank) = rank {
                if self.viewable(window)? {
                    ranked.push((rank, window));
                }
            }
        }
        Ok(ranked.into_iter().min().map(|(_, window)| window))
    }

    fn active(&mut self) -> Result<Window, Failure> {
        let root = self.root;
        Ok(self.windows(root, "_NET_ACTIVE_WINDOW")?.first().copied().unwrap_or(0))
    }

    /// Ask the window manager to bring `window` forward; true once it is in front.
    fn focus(&mut self, window: Window) -> Result<bool, Failure> {
        if self.active()? == window {
            return Ok(true);
        }
        let atom = self.atom("_NET_ACTIVE_WINDOW")?;
        let event = ClientMessageEvent {
            response_type: CLIENT_MESSAGE_EVENT,
            format: 32,
            sequence: 0,
            window,
            type_: atom,
            data: [SOURCE_PAGER, 0, 0, 0, 0].into(),
        };
        let mask = EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT;
        if self.conn.send_event(false, self.root, mask, event)?.check().is_err() {
            return Ok(false);
        }
        let deadline = Instant::now() + ACTIVATE_WAIT;
        loop {
            if self.active()? == window {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            std::thread::sleep(ACTIVATE_POLL);
        }
    }

    fn keycode(&self, keysym: u32) -> Result<u8, Failure> {
        let setup = self.conn.setup();
        let (min, max) = (setup.min_keycode, setup.max_keycode);
        let mapping = self.conn.get_keyboard_mapping(min, max - min + 1)?.reply()?;
        let per = mapping.keysyms_per_keycode as usize;
        if per == 0 {
            return Ok(0);
        }
        Ok(mapping
            .keysyms
            .chunks(per)
            .position(|syms| syms.contains(&keysym))
            .map(|index| min + index as u8)
            .unwrap_or(0))
    }

    /// Send Ctrl+V to the X11 window in front.
    fn paste(&mut self) -> Result<bool, Failure> {
        let control = self.keycode(XK_CONTROL_L)?;
        let letter = self.keycode(XK_V)?;
        if control == 0 || letter == 0 {
            return Ok(false);
        }
        let mut cookies = Vec::new();
        for (keycode, kind) in
            [(control, KEY_PRESS), (letter, KEY_PRESS), (letter, KEY_RELEASE), (control, KEY_RELEASE)]
        {
            cookies.push(self.conn.xtest_fake_input(kind, keycode, 0, x11rb::NONE, 0, 0, 0)?);
        }
        let mut ok = true;
        for cookie in cookies {
            ok &= cookie.check().is_ok();
        }
        self.conn.flush()?;
        Ok(ok)
    }
}

/// Linux: copy with the clipboard tool, paste over X11.
#[derive(Default)]
pub struct X11Desktop {
    connection: Option<X11Connection>,
}

impl X11Desktop {
    fn connection(&mut self) -> Option<&mut X11Connection> {
        if self.connection.is_none() {
            self.connection = X11Connection::open();
        }
        self.connection.as_mut()
    }

    fn broken(&mut self) -> DesktopBroken {
        // Closed now and opened again next time.
        self.connection = None;
        DesktopBroken
    }
}

impl Desktop for X11Desktop {
    fn focuses_before_copy(&self) -> bool {
        false
    }

    fn copy(&mut self, text: &str) -> bool {
        copy::copy_to_clipboard(text)
    }

    fn focus(&mut self, window_name: &str) -> Result<Focus, DesktopBroken> {
        let Some(connection) = self.connection() else { return Ok(Focus::Unavailable) };
        let outcome = match connection.find(window_name) {
            Ok(Some(window)) => connection.focus(window),
            Ok(None) => Ok(false),
            Err(error) => Err(error),
        };
        match outcome {
            Ok(true) => Ok(Focus::Focused),
            Ok(false) | Err(Failure::Request) => Ok(Focus::NotFocused),
            Err(Failure::Connection) => Err(self.broken()),
        }
    }

    fn paste(&mut self, _countdown: u32) -> Result<bool, DesktopBroken> {
        let Some(connection) = self.connection() else { return Ok(false) };
        match connection.paste() {
            Ok(pasted) => Ok(pasted),
            Err(Failure::Request) => Ok(false),
            Err(Failure::Connection) => Err(self.broken()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::title_rank;

    #[test]
    fn titles_rank_exact_then_substring_ignoring_case() {
        assert_eq!(title_rank("VRChat", "VRChat"), Some(0));
        assert_eq!(title_rank("VRChat - Beta", "vrchat"), Some(1));
        assert_eq!(title_rank("vrchat", "VRChat"), Some(1));
        assert_eq!(title_rank("Other", "VRChat"), None);
        assert_eq!(title_rank("", "VRChat"), None);
    }

    /// Looks windows up on the real display without focusing them or sending keys.
    /// `[VRCT_X11_WINDOW=<title of a shown window>] cargo test -- --ignored finds_a_window`
    #[test]
    #[ignore]
    fn finds_a_window_on_the_real_display() {
        let mut connection = super::X11Connection::open().expect("an X11 display with XTest");
        if let Ok(name) = std::env::var("VRCT_X11_WINDOW") {
            assert!(matches!(connection.find(&name), Ok(Some(_))));
        }
        assert!(matches!(connection.find("no window has this title 7c1f"), Ok(None)));
        assert!(connection.keycode(super::XK_CONTROL_L).is_ok_and(|k| k != 0));
    }
}
