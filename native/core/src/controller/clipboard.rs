//! The clipboard of voice typing (`src-python/models/clipboard/`, issue #393).
//!
//! A recognised message is copied, then pasted (Ctrl+V) into the window of the game SteamVR
//! runs. The game is SteamVR's scene application, read through the OpenVR connection the VR
//! overlays share ([`vrct_vr_overlay::shared`]): the connection is borrowed for the read and
//! given back, and closes then unless the overlays hold it. Python only took Steam's games
//! (keys `steam.app.*`); so does this. Without SteamVR, without a game, or when the window does
//! not come to the front, the text is only copied (the behaviour of
//! [`vrct_adapters::clipboard::Clipboard`]).
//!
//! Neither the text nor the game's name is logged.

use std::sync::{Arc, OnceLock};

use vrct_adapters::clipboard::{Clipboard, Desktop, VrAppName};
use vrct_vr_overlay::runtime::Vr;

/// Makes the desktop the clipboard works on (its copy, focus and keys); called once.
pub type DesktopSource = Arc<dyn Fn() -> Box<dyn Desktop> + Send + Sync>;

/// What [`super::Services::clipboard`] is: copies a message, true when it was pasted.
pub type ClipboardFn = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// The name of the game SteamVR runs, read from SteamVR's scene application.
pub struct SceneAppName {
    vr: Arc<dyn Vr>,
}

impl SceneAppName {
    /// `vr` should be the [`SharedVr`](vrct_vr_overlay::shared::SharedVr) the overlays use.
    pub fn new(vr: Arc<dyn Vr>) -> Self {
        Self { vr }
    }
}

impl VrAppName for SceneAppName {
    fn running_app_name(&self) -> Option<String> {
        if !self.vr.runtime_running() {
            return None;
        }
        // Dropping the session at the end gives the shared connection back.
        let mut session = self.vr.connect().ok()?;
        let app = session.scene_application().ok().flatten()?;
        (app.key.starts_with("steam.app.") && !app.name.is_empty()).then_some(app.name)
    }
}

/// The clipboard that pastes into the game `vr` reports, on the desktop `desktop` makes (made
/// on the first message).
pub fn steamvr_clipboard(vr: Arc<dyn Vr>, desktop: DesktopSource) -> ClipboardFn {
    let clipboard = OnceLock::new();
    Arc::new(move |text| {
        clipboard
            .get_or_init(|| Clipboard::with_desktop(desktop(), Arc::new(SceneAppName::new(Arc::clone(&vr)))))
            .copy_and_paste(text, None, 0)
    })
}
