//! The overlay thread ([`overlay.py`]'s `Overlay`).
//!
//! [`Overlay::start`] starts a thread that waits for SteamVR (checking every 10 seconds),
//! connects, makes the overlays and runs a loop 16 times a second: subtitles fade out after
//! their display time, windows that follow a hand wait until the hand is tracked, and the VR
//! panel shows the app's VR page. When SteamVR quits, the thread waits for it again.
//! [`Overlay::shutdown`] stops the thread and closes the connection.
//!
//! The VR panel part shows the page's windows (log, launcher, popup), keeps the layout in step
//! with the page, follows the launcher to the wrist (shown when the wrist is looked at, with the
//! opening animation), moves the log to another anchor or back in front of the eyes, and shows
//! the tooltips. The controllers ([`input`]) point with a laser, click and scroll the page, grab,
//! move and scale windows, resize the log by a corner and show the toolbar under the log.
//!
//! [`overlay.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay.py

mod input;

use crate::layout::{self, Region, VrLayout};
use crate::math::{self, Mat34, Mat4, Tracker};
use crate::placement::{self, Placement};
use crate::pose;
use crate::runtime::{Device, HMD, Hand, Handle, INVALID_DEVICE, Session, TextureSlot, Vr, VrError};
use crate::surface::{Frame, PanelSurface};
use crate::timing::{self, LauncherTick, LauncherView};
use crate::tooltip::{self, Picture, Tooltip, TooltipMode, TooltipParent, TooltipShape};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{BuildHasher, Hasher};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const REINIT_WAIT: Duration = Duration::from_secs(5);
const SHUTDOWN_JOIN: Duration = Duration::from_secs(5);
const PANEL_FIND_INTERVAL: Duration = Duration::from_secs(2);
const PANEL_ERROR_LIMIT: u32 = 30;
const STALL_REPORT: Duration = Duration::from_secs(2);
const LAYOUT_RETRY: Duration = Duration::from_secs(1);
const LAYOUT_GIVE_UP: Duration = Duration::from_secs(3);
const RECALL_PENDING: Duration = Duration::from_secs(1);
const LAUNCHER_INTRO: f64 = 4.8;
const INTRO_FRONT: f64 = 1.3;
const INTRO_FLY: f64 = 0.8;
const INTRO_FRONT_SCALE: f64 = 5.0;
const INTRO_FRONT_FOLLOW_PER_SEC: f64 = 8.0;
const LAUNCHER_RETURN: f64 = 0.3;
const INTRO_KEY_SOFT: (i32, i32) = (4, 20);
const HAND_ANCHOR_MAX_DISTANCE_M: f64 = 0.5;
const HMD_ANCHOR_DISTANCE_RANGE_M: (f64, f64) = (0.4, 1.5);
const POPUP_ABOVE_LAUNCHER_M: f64 = 0.18;
const POPUP_DISTANCE_RANGE_M: (f64, f64) = (0.45, 0.65);
const LAUNCHER_FACE_DEG: f64 = 45.0;
const LAUNCHER_HIDE_MARGIN_DEG: f64 = 10.0;
const LAUNCHER_GAZE_SHOW_DEG: f64 = 40.0;
const LAUNCHER_GAZE_HIDE_DEG: f64 = 45.0;
/// The anchors the log can have (`PANEL_ANCHORS`).
pub const PANEL_ANCHORS: [&str; 4] = ["Playspace", "LeftHand", "RightHand", "HMD"];

/// The overlays, in the order Python made them (`ASTAROT0` to `ASTAROT4`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Surface {
    Small,
    Large,
    Panel,
    Launcher,
    Popup,
}

impl Surface {
    pub const ALL: [Surface; 5] = [Surface::Small, Surface::Large, Surface::Panel, Surface::Launcher, Surface::Popup];

    pub fn key(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Large => "large",
            Self::Panel => "panel",
            Self::Launcher => "launcher",
            Self::Popup => "popup",
        }
    }

    fn region(self) -> Option<Region> {
        match self {
            Self::Panel => Some(Region::Panel),
            Self::Launcher => Some(Region::Launcher),
            Self::Popup => Some(Region::Popup),
            _ => None,
        }
    }

    fn index(self) -> usize {
        Self::ALL.iter().position(|s| *s == self).expect("listed")
    }
}

/// A window's stored settings (`OVERLAY_*_SETTINGS`).
#[derive(Clone, Debug, PartialEq)]
pub struct WindowSettings {
    pub position: [f64; 6],
    pub tracker: String,
    pub display_duration: f64,
    pub fadeout_duration: f64,
    pub opacity: f64,
    /// The overlay's width in metres (the large log's stored value times 0.25; the launcher's
    /// stored band width).
    pub ui_scaling: f64,
    /// The log's size in logical px (the VR panel's log only).
    pub size: Option<(f64, f64)>,
}

impl WindowSettings {
    /// Reads stored settings; missing numbers are 0 and a missing tracker follows the head.
    pub fn from_json(value: &Value) -> Self {
        let number = |key: &str| value.get(key).and_then(Value::as_f64).unwrap_or(0.0);
        let size = match (value.get("width").and_then(Value::as_f64), value.get("height").and_then(Value::as_f64)) {
            (Some(w), Some(h)) => Some((w, h)),
            _ => None,
        };
        Self {
            position: [number("x_pos"), number("y_pos"), number("z_pos"), number("x_rotation"), number("y_rotation"), number("z_rotation")],
            tracker: value.get("tracker").and_then(Value::as_str).unwrap_or("HMD").to_string(),
            display_duration: number("display_duration"),
            fadeout_duration: number("fadeout_duration"),
            opacity: value.get("opacity").and_then(Value::as_f64).unwrap_or(1.0),
            ui_scaling: value.get("ui_scaling").and_then(Value::as_f64).unwrap_or(1.0),
            size,
        }
    }

    fn placement(&self) -> Placement {
        let [x_pos, y_pos, z_pos, x_rotation, y_rotation, z_rotation] = self.position;
        Placement { x_pos, y_pos, z_pos, x_rotation, y_rotation, z_rotation, ui_scaling: self.ui_scaling, tracker: Tracker::from_setting(&self.tracker) }
    }

    /// What the position callback hands on: the position, `ui_scaling`, the tracker and, for
    /// the log, its size (`notifyPosition`).
    fn position_json(&self) -> Value {
        let [x, y, z, rx, ry, rz] = self.position;
        let mut value = json!({
            "x_pos": x, "y_pos": y, "z_pos": z, "x_rotation": rx, "y_rotation": ry, "z_rotation": rz,
            "ui_scaling": self.ui_scaling, "tracker": self.tracker,
        });
        if let Some((w, h)) = self.size {
            value["width"] = json!(w);
            value["height"] = json!(h);
        }
        value
    }
}

/// What the overlay tells its owner. Sent from the overlay's thread, never under its lock.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The overlay stopped ("runtime") or the VR panel's capture failed ("capture",
    /// "capture_stalled") (`failure_callback`).
    Failure(&'static str),
    /// The VR page's layout or the tooltip generation changed (`layout_callback`).
    Layout(Value),
    /// The log went out of view or came back (`panel_out_of_view_callback`).
    PanelOutOfView(bool),
    /// The launcher's opening animation: "idle", "pending" or "playing".
    LauncherIntro(&'static str),
    /// A window's position was settled in VR (`position_changed_callback`).
    Position(Surface, Value),
    /// Where the laser points on the VR page in its logical px, `None` when off it
    /// (`pointer_callback`; the page draws its hover from it).
    Pointer(Option<(i64, i64)>),
}

pub type Events = Arc<dyn Fn(Event) + Send + Sync>;
pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

/// How the overlay is made.
pub struct Options {
    pub vr: Arc<dyn Vr>,
    /// The VR page's capture, or `None` where the VR panel cannot run.
    pub surface: Option<Arc<dyn PanelSurface>>,
    /// The settings of each surface, in [`Surface::ALL`] order.
    pub settings: [WindowSettings; 5],
    /// The launcher's default settings (`DEFAULT_OVERLAY_VR_LAUNCHER_SETTINGS`).
    pub launcher_defaults: WindowSettings,
    pub events: Events,
    /// Fixed log lines (no user text).
    pub log: Log,
    /// How often SteamVR is looked for (10 seconds; shorter in tests).
    pub steamvr_poll: Duration,
}

/// A publication's version: a later shutdown or clear makes it stale (`publicationToken`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token(u64, u64);

struct CaptureJob {
    window: u64,
    layout: VrLayout,
    started: Instant,
    generation: u64,
    result: Mutex<Option<Option<Frame>>>,
    reported: Mutex<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Intro {
    Idle,
    Pending,
    Playing,
}

impl Intro {
    fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Pending => "pending",
            Self::Playing => "playing",
        }
    }
}

struct State {
    session: Option<Box<dyn Session>>,
    handles: HashMap<Surface, Handle>,
    owned: Vec<Handle>,
    submitted: HashMap<Handle, HashMap<&'static str, String>>,
    settings: [WindowSettings; 5],
    last_update: [Instant; 5],
    fade: [f64; 5],
    initialized: bool,
    constructing: bool,
    start_cancelled: bool,
    failure: Option<&'static str>,
    publication_generation: u64,
    output_generations: [u64; 5],
    run_stop: bool,
    reconnect_requested: bool,
    connect_failed: bool,
    connect_failure_logged: bool,
    thread_running: bool,
    position_pending: HashSet<Surface>,
    // The VR panel
    vr_panel_enabled: bool,
    panel_enabled_requests: VecDeque<bool>,
    panel_locked: bool,
    launcher: timing::Launcher,
    intro: Intro,
    intro_until: f64,
    intro_started: f64,
    intro_tick: f64,
    intro_front: Option<Mat4>,
    launcher_reset: Option<bool>,
    launcher_return: Option<(Mat4, f64, f64)>,
    vr_windows_wanted: (bool, bool),
    vr_windows_hidden: HashSet<Surface>,
    requested_anchor: Option<String>,
    recall_requested: Option<Instant>,
    panel_out_of_view: bool,
    layout: VrLayout,
    layout_applied: Option<VrLayout>,
    window_fitted: Option<VrLayout>,
    window_size: Option<(u32, u32)>,
    layout_rendered: (u32, u32),
    layout_requested_at: Instant,
    layout_retried: bool,
    tooltip_epoch: u64,
    tooltip_revision: u64,
    tooltip_requests: VecDeque<Tooltip>,
    tooltip_state: Option<TooltipShape>,
    tooltip_ready: bool,
    tooltip_shown: bool,
    tooltip_handle: Option<Handle>,
    vr_resources_tried: bool,
    panel_window: Option<u64>,
    panel_last_find: Option<Instant>,
    panel_last_capture: Option<Instant>,
    panel_last_change: Instant,
    panel_last_raw: Option<u64>,
    panel_image_size: Option<(u32, u32)>,
    texture_size: Option<(u32, u32)>,
    panel_errors: u32,
    panel_stopped: bool,
    capture_job: Option<Arc<CaptureJob>>,
    capture_generation: u64,
    mask: Option<((u32, u32), VrLayout, Vec<u8>)>,
    events: Vec<Event>,
    /// The controllers: pointing, grabbing, resizing, the toolbar.
    input: input::Interaction,
}

struct Shared {
    options: Options,
    state: Mutex<State>,
    wake: Condvar,
    thread: Mutex<Option<JoinHandle<()>>>,
    epoch_start: Instant,
}

/// The overlays. Cheap to clone; every clone is the same overlay.
#[derive(Clone)]
pub struct Overlay {
    shared: Arc<Shared>,
}

fn random_epoch() -> u64 {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u64(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64));
    hasher.finish() % ((1 << 47) - 1) + 1
}

/// The layout as the VR page reads it (`vrLayoutToJson`).
pub fn layout_json(layout: &VrLayout, epoch: u64) -> Value {
    let rect = |r: layout::Rect| json!([r.0, r.1, r.2, r.3]);
    json!({
        "atlas": [layout.atlas.0, layout.atlas.1],
        "regions": {
            "panel": rect(layout.panel),
            "launcher": rect(layout.launcher),
            "popup": rect(layout.popup),
            "toolbar": rect(layout.toolbar),
            "tooltip": rect(layout.tooltip),
        },
        "tooltip_epoch": epoch,
    })
}

fn panel_layout(settings: &WindowSettings) -> VrLayout {
    let (w, h) = settings.size.unwrap_or((f64::from(layout::PANEL_DEFAULT_SIZE.0), f64::from(layout::PANEL_DEFAULT_SIZE.1)));
    let (w, h) = layout::clamp_panel_size(w, h);
    VrLayout::for_panel(w, h)
}

impl Overlay {
    pub fn new(options: Options) -> Self {
        let now = Instant::now();
        let layout = panel_layout(&options.settings[Surface::Panel.index()]);
        let state = State {
            session: None,
            handles: HashMap::new(),
            owned: Vec::new(),
            submitted: HashMap::new(),
            settings: options.settings.clone(),
            last_update: [now; 5],
            fade: [1.0; 5],
            initialized: false,
            constructing: false,
            start_cancelled: false,
            failure: None,
            publication_generation: 0,
            output_generations: [0; 5],
            run_stop: false,
            reconnect_requested: false,
            connect_failed: false,
            connect_failure_logged: false,
            thread_running: false,
            position_pending: HashSet::new(),
            vr_panel_enabled: true,
            panel_enabled_requests: VecDeque::new(),
            panel_locked: false,
            launcher: timing::Launcher::new(true),
            intro: Intro::Idle,
            intro_until: 0.0,
            intro_started: 0.0,
            intro_tick: 0.0,
            intro_front: None,
            launcher_reset: None,
            launcher_return: None,
            vr_windows_wanted: (false, false),
            vr_windows_hidden: HashSet::new(),
            requested_anchor: None,
            recall_requested: None,
            panel_out_of_view: false,
            layout,
            layout_applied: None,
            window_fitted: None,
            window_size: None,
            layout_rendered: layout::PANEL_DEFAULT_SIZE,
            layout_requested_at: now,
            layout_retried: false,
            tooltip_epoch: random_epoch(),
            tooltip_revision: 0,
            tooltip_requests: VecDeque::new(),
            tooltip_state: None,
            tooltip_ready: false,
            tooltip_shown: false,
            tooltip_handle: None,
            vr_resources_tried: false,
            panel_window: None,
            panel_last_find: None,
            panel_last_capture: None,
            panel_last_change: now,
            panel_last_raw: None,
            panel_image_size: None,
            texture_size: None,
            panel_errors: 0,
            panel_stopped: false,
            capture_job: None,
            capture_generation: 0,
            mask: None,
            events: Vec::new(),
            input: input::Interaction::default(),
        };
        Self { shared: Arc::new(Shared { options, state: Mutex::new(state), wake: Condvar::new(), thread: Mutex::new(None), epoch_start: now }) }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.shared.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn log(&self, text: &str) {
        (self.shared.options.log)(text);
    }

    /// Sends the events gathered under the lock, after letting it go.
    fn flush(&self, mut state: MutexGuard<'_, State>) {
        let events = std::mem::take(&mut state.events);
        drop(state);
        for event in events {
            (self.shared.options.events)(event);
        }
    }

    fn seconds(&self, at: Instant) -> f64 {
        at.duration_since(self.shared.epoch_start).as_secs_f64()
    }

    // ---- lifecycle -------------------------------------------------------------------

    /// Starts the overlay thread, or keeps the running one (`startOverlay`). False when the
    /// running thread has failed.
    pub fn start(&self) -> bool {
        let mut thread = self.shared.thread.lock().unwrap();
        let mut state = self.lock();
        if state.thread_running {
            return state.failure.is_none() && !state.start_cancelled;
        }
        state.start_cancelled = false;
        state.failure = None;
        state.publication_generation += 1;
        state.run_stop = false;
        state.thread_running = true;
        drop(state);
        let me = self.clone();
        *thread = std::thread::Builder::new().name("vr_overlay".into()).spawn(move || me.main()).ok();
        if thread.is_none() {
            self.lock().thread_running = false;
            return false;
        }
        true
    }

    /// Stops the thread and waits for it, at most 5 seconds (`shutdownOverlay`).
    pub fn shutdown(&self) {
        let worker = {
            let mut thread = self.shared.thread.lock().unwrap();
            let mut state = self.lock();
            state.start_cancelled = true;
            state.publication_generation += 1;
            state.initialized = false;
            state.run_stop = true;
            state.requested_anchor = None;
            self.shared.wake.notify_all();
            match thread.as_ref() {
                Some(handle) if handle.thread().id() == std::thread::current().id() => return,
                Some(_) => thread.take(),
                None => None,
            }
        };
        let Some(worker) = worker else { return };
        let deadline = Instant::now() + SHUTDOWN_JOIN;
        while !worker.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if worker.is_finished() {
            let _ = worker.join();
        } else {
            self.log("overlay: shutdown timed out; the thread stops on its own");
            *self.shared.thread.lock().unwrap() = Some(worker);
        }
    }

    /// Whether the overlays are made and connected (`initialized`).
    pub fn initialized(&self) -> bool {
        self.lock().initialized
    }

    /// Whether the thread runs (waiting for SteamVR or connected).
    pub fn running(&self) -> bool {
        self.lock().thread_running
    }

    fn wait_unless_cancelled(&self, seconds: Duration) -> bool {
        let deadline = Instant::now() + seconds;
        let mut state = self.lock();
        loop {
            if state.start_cancelled {
                return true;
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = self.shared.wake.wait_timeout(state, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    fn main(&self) {
        self.log("overlay: checking whether SteamVR runs");
        let poll = self.shared.options.steamvr_poll;
        loop {
            while !self.shared.options.vr.runtime_running() {
                if self.wait_unless_cancelled(poll) {
                    return self.ended();
                }
            }
            if self.wait_unless_cancelled(Duration::ZERO) {
                return self.ended();
            }
            {
                let mut state = self.lock();
                state.run_stop = false;
                state.reconnect_requested = false;
            }
            match self.shared.options.vr.connect() {
                Err(error) => {
                    let missing = error.0 == "openvr_api_not_found";
                    let mut state = self.lock();
                    state.connect_failed = true;
                    if !state.connect_failure_logged {
                        state.connect_failure_logged = true;
                        drop(state);
                        self.log(if missing {
                            "overlay: the OpenVR library was not found"
                        } else {
                            "overlay: cannot connect to SteamVR; trying again until it connects"
                        });
                    } else {
                        drop(state);
                    }
                    if missing {
                        let mut state = self.lock();
                        self.report_failure(&mut state, "runtime");
                        self.flush(state);
                        return self.ended();
                    }
                }
                Ok(session) => {
                    {
                        let mut state = self.lock();
                        state.connect_failed = false;
                        state.connect_failure_logged = false;
                        state.session = Some(session);
                    }
                    let ok = self.init();
                    if ok && !self.lock().start_cancelled {
                        self.mainloop();
                    }
                    self.teardown();
                    if !ok {
                        let mut state = self.lock();
                        self.report_failure(&mut state, "runtime");
                        self.flush(state);
                        return self.ended();
                    }
                }
            }
            if self.lock().start_cancelled {
                return self.ended();
            }
            let reconnect = self.lock().reconnect_requested;
            if !reconnect && self.wait_unless_cancelled(poll) {
                return self.ended();
            }
        }
    }

    fn ended(&self) {
        let mut state = self.lock();
        state.initialized = false;
        state.thread_running = false;
        state.run_stop = true;
        self.shared.wake.notify_all();
        let out_of_view = state.panel_out_of_view;
        state.panel_out_of_view = false;
        if out_of_view {
            state.events.push(Event::PanelOutOfView(false));
        }
        self.flush(state);
    }

    fn report_failure(&self, state: &mut State, reason: &'static str) {
        if reason == "runtime" {
            state.failure = Some(reason);
            state.start_cancelled = true;
            state.initialized = false;
            state.run_stop = true;
            self.shared.wake.notify_all();
        }
        state.events.push(Event::Failure(reason));
    }

    /// Makes the overlays (`init`). False when SteamVR refused.
    fn init(&self) -> bool {
        let mut state = self.lock();
        let result = self.build(&mut state);
        state.constructing = false;
        match result {
            Ok(()) => {
                state.initialized = !state.start_cancelled;
                let panel = state.tooltip_handle.is_some();
                drop(state);
                self.log(if panel { "overlay: started (with the VR panel)" } else { "overlay: started" });
                true
            }
            Err(error) => {
                drop(state);
                self.log(&format!("overlay: making the overlays failed: {error}"));
                false
            }
        }
    }

    fn build(&self, state: &mut State) -> Result<(), VrError> {
        state.submitted.clear();
        state.handles.clear();
        state.vr_windows_hidden.clear();
        state.panel_image_size = None;
        state.texture_size = None;
        state.tooltip_handle = None;
        state.tooltip_shown = false;
        self.reset_tooltip_epoch(state, true);
        if let Some(keep_hand) = state.launcher_reset.take() {
            // Asked while not connected: the defaults apply here.
            self.apply_launcher_defaults(state, keep_hand);
        }
        state.constructing = true;
        state.input = input::Interaction::default();
        // The overlay keys: ASTAROT0 to ASTAROT4 for the windows, ASTAROT_<part> for the rest
        // (VRCT up to 0.5.x; SteamVR keeps nothing under them, ADR-014 2.2).
        for (i, surface) in Surface::ALL.into_iter().enumerate() {
            let handle = self.create(state, &format!("ASTAROT{i}"))?;
            state.handles.insert(surface, handle);
            if surface.region().is_some() {
                // Shown once the page was captured (no blank board on the wrist).
                state.vr_windows_hidden.insert(surface);
            } else {
                self.submit(state, handle, "visibility", "show".into(), |s| s.show(handle))?;
            }
        }
        self.make_pointers(state)?;
        state.vr_resources_tried = false;
        self.apply_vr_panel_enabled(state)?;
        self.set_intro(state, if state.vr_panel_enabled { Intro::Pending } else { Intro::Idle });
        let intro_idle = state.intro == Intro::Idle;
        state.launcher.start(intro_idle);
        for surface in Surface::ALL {
            let handle = state.handles[&surface];
            let session = state.session.as_mut().expect("connected");
            session.set_raw(handle, &[0, 0, 0, 0], 1, 1)?;
            session.set_color(handle, [1.0, 1.0, 1.0])?;
            input::remember_image(state, surface, &[0, 0, 0, 0], 1, 1);
            let opacity = state.settings[surface.index()].opacity;
            self.set_alpha(state, surface, opacity)?;
            self.apply_width(state, surface)?;
            self.update_position(state, surface)?;
        }
        Ok(())
    }

    fn create(&self, state: &mut State, key: &str) -> Result<Handle, VrError> {
        let handle = state.session.as_mut().expect("connected").create_overlay(key, key)?;
        state.owned.push(handle);
        state.submitted.remove(&handle);
        Ok(handle)
    }

    /// A call whose value is remembered; the same value is not sent again (`submitOverlay`).
    fn submit(
        &self,
        state: &mut State,
        handle: Handle,
        key: &'static str,
        value: String,
        call: impl FnOnce(&mut dyn Session) -> Result<(), VrError>,
    ) -> Result<(), VrError> {
        if state.submitted.get(&handle).and_then(|m| m.get(key)) == Some(&value) {
            return Ok(());
        }
        let Some(session) = state.session.as_mut() else { return Ok(()) };
        match call(session.as_mut()) {
            Ok(()) => {
                state.submitted.entry(handle).or_default().insert(key, value);
                Ok(())
            }
            Err(error) => {
                state.submitted.remove(&handle);
                Err(error)
            }
        }
    }

    fn connected(state: &State) -> bool {
        state.session.is_some() && (state.initialized || state.constructing)
    }

    fn set_alpha(&self, state: &mut State, surface: Surface, alpha: f64) -> Result<(), VrError> {
        if !Self::connected(state) {
            return Ok(());
        }
        let handle = state.handles[&surface];
        self.submit(state, handle, "alpha", format!("{alpha}"), |s| s.set_alpha(handle, alpha as f32))
    }

    fn width_m(state: &State, surface: Surface) -> f64 {
        let ui_scaling = state.settings[surface.index()].ui_scaling;
        match surface {
            Surface::Launcher => layout::region_width_m(Region::Launcher, ui_scaling),
            _ => ui_scaling,
        }
    }

    fn apply_width(&self, state: &mut State, surface: Surface) -> Result<(), VrError> {
        if !Self::connected(state) {
            return Ok(());
        }
        let handle = state.handles[&surface];
        let width = Self::width_m(state, surface);
        self.submit(state, handle, "width", format!("{width}"), |s| s.set_width(handle, width as f32))
    }

    fn tracker(state: &mut State, name: &str) -> (Tracker, Option<Device>) {
        let tracker = Tracker::from_setting(name);
        let device = match tracker {
            Tracker::Playspace => None,
            Tracker::Hmd => Some(HMD),
            Tracker::LeftHand => Some(state.session.as_mut().map_or(INVALID_DEVICE, |s| s.hand(Hand::Left))),
            Tracker::RightHand => Some(state.session.as_mut().map_or(INVALID_DEVICE, |s| s.hand(Hand::Right))),
        };
        (tracker, device)
    }

    fn relative(state: &State, surface: Surface) -> Mat34 {
        let settings = &state.settings[surface.index()];
        math::relative_pose(Tracker::from_setting(&settings.tracker), settings.position)
    }

    fn set_transform(&self, state: &mut State, handle: Handle, device: Option<Device>, pose: &Mat34) -> Result<(), VrError> {
        let value = format!("{device:?} {pose:?}");
        let pose = *pose;
        match device {
            None => self.submit(state, handle, "transform", value, |s| s.set_transform_absolute(handle, &pose)),
            Some(device) => self.submit(state, handle, "transform", value, |s| s.set_transform_relative(handle, device, &pose)),
        }
    }

    /// Places a window at its stored position (`updatePosition`); a window on a hand that is
    /// not tracked yet waits.
    fn update_position(&self, state: &mut State, surface: Surface) -> Result<(), VrError> {
        if !Self::connected(state) {
            return Ok(());
        }
        let name = state.settings[surface.index()].tracker.clone();
        let (_, device) = Self::tracker(state, &name);
        let available = match device {
            None => true,
            Some(device) => state.session.as_mut().is_some_and(|s| s.connected(device)),
        };
        if available {
            let relative = Self::relative(state, surface);
            self.set_window_transform(state, surface, device, &relative)?;
            state.position_pending.remove(&surface);
        } else {
            state.position_pending.insert(surface);
        }
        Ok(())
    }

    fn mainloop(&self) {
        loop {
            let started = Instant::now();
            let mut state = self.lock();
            if state.run_stop || state.start_cancelled || !state.initialized {
                break;
            }
            if state.session.as_mut().is_none_or(|s| s.quit_requested()) {
                drop(state);
                self.log("overlay: SteamVR quit");
                break;
            }
            if let Err(error) = self.tick(&mut state) {
                self.log(&format!("overlay: {error}"));
            }
            // Quicker while a window is held or the laser is on the VR page.
            let holding = state.input.grabbing.is_some() || state.input.resizing.is_some();
            let interval = Duration::from_secs_f64(timing::loop_interval(holding, state.input.pointer_notified.is_some()));
            self.flush(state);
            let mut state = self.lock();
            let deadline = started + interval;
            while !state.run_stop && !state.start_cancelled {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                state = self.shared.wake.wait_timeout(state, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
            }
        }
        // Let go of anything still pressed on the page.
        let mut state = self.lock();
        self.cancel_panel_inputs(&mut state);
        self.flush(state);
    }

    fn tick(&self, state: &mut State) -> Result<(), VrError> {
        self.apply_vr_panel_enabled(state)?;
        let now = Instant::now();
        for surface in Surface::ALL {
            self.update_alpha(state, surface, now)?;
        }
        for surface in state.position_pending.clone() {
            self.update_position(state, surface)?;
        }
        let poses = state.session.as_mut().map(|s| s.poses()).unwrap_or_default();
        let pose_of = |device: Option<Device>| -> Option<Mat4> {
            match device {
                None => Some(math::IDENTITY),
                Some(device) => poses.get(device as usize).copied().flatten(),
            }
        };
        let seconds = self.seconds(now);
        self.update_launcher_return(state, &pose_of, seconds);
        self.update_intro_flight(state, &pose_of, seconds);
        self.update_launcher_visibility(state, &pose_of, seconds);
        self.apply_vr_windows(state, &pose_of)?;
        // The laser before the capture, so it does not wait for the capture.
        if let Err(error) = self.update_input(state, &pose_of, seconds) {
            self.on_input_error(state, &error);
        }
        if let Err(error) = self.update_panel(state, now) {
            state.panel_errors += 1;
            if state.panel_errors >= PANEL_ERROR_LIMIT && !state.panel_stopped {
                self.log("overlay: the VR page's capture kept failing; it stops");
                self.reset_tooltip_epoch(state, true);
                state.panel_stopped = true;
                self.report_failure(state, "capture");
            }
            return Err(error);
        }
        Ok(())
    }

    /// The fade-out after the display time, the launcher's own fade, or the stored opacity
    /// (`update`).
    fn update_alpha(&self, state: &mut State, surface: Surface, now: Instant) -> Result<(), VrError> {
        let settings = &state.settings[surface.index()];
        let (opacity, fadeout, display) = (settings.opacity, settings.fadeout_duration, settings.display_duration);
        let alpha = if fadeout != 0.0 {
            let elapsed = (now.duration_since(state.last_update[surface.index()]).as_secs_f64() - display).max(0.0);
            let ratio = (1.0 - elapsed / fadeout).max(0.0);
            state.fade[surface.index()] = ratio;
            ratio * opacity
        } else if surface == Surface::Launcher {
            state.launcher.overlay_alpha(opacity)
        } else {
            opacity
        };
        self.set_alpha(state, surface, alpha)
    }

    fn teardown(&self) {
        let mut state = self.lock();
        state.capture_generation += 1;
        state.initialized = false;
        let handles = std::mem::take(&mut state.owned);
        if let Some(session) = state.session.as_mut() {
            for handle in handles {
                let _ = session.destroy_overlay(handle);
            }
        }
        state.handles.clear();
        state.submitted.clear();
        state.tooltip_handle = None;
        state.tooltip_state = None;
        state.tooltip_ready = false;
        state.tooltip_shown = false;
        state.position_pending.clear();
        state.input = input::Interaction::default();
        state.session = None;
        let pointed = std::mem::take(&mut state.events);
        drop(state);
        for event in pointed {
            (self.shared.options.events)(event);
        }
        self.log("overlay: stopped");
    }

    // ---- publication -----------------------------------------------------------------

    pub fn publication_token(&self, surface: Surface) -> Token {
        let state = self.lock();
        Token(state.publication_generation, state.output_generations[surface.index()])
    }

    /// Whether a publication begun with `token` may still show (`publicationCurrent`).
    pub fn publication_current(&self, surface: Surface, token: Token) -> bool {
        let state = self.lock();
        !state.start_cancelled && token == Token(state.publication_generation, state.output_generations[surface.index()])
    }

    /// Shows an RGBA picture on a subtitle overlay (`updateImage`). `Ok(false)` when it was
    /// cancelled (turned off, cleared, not connected); a failed upload reconnects once and tries
    /// again, then gives the error.
    pub fn update_image(&self, surface: Surface, rgba: &[u8], width: u32, height: u32, token: Token, current: &dyn Fn() -> bool)
    -> Result<bool, VrError> {
        let valid = |state: &State| {
            !state.start_cancelled
                && Token(state.publication_generation, state.output_generations[surface.index()]) == token
                && current()
        };
        for attempt in 0..2 {
            {
                let diag = Instant::now();
                let mut state = self.lock();
                let lock_ms = diag.elapsed().as_millis();
                if !valid(&state) || !state.initialized {
                    return Ok(false);
                }
                let handle = state.handles[&surface];
                let result = state.session.as_mut().expect("initialized").set_raw(handle, rgba, width, height);
                eprintln!("[861] update_image: lock {lock_ms} ms, set_raw {} ms ({width}x{height})", diag.elapsed().as_millis() - lock_ms);
                match result {
                    Ok(()) => {
                        input::remember_image(&mut state, surface, rgba, width, height);
                        let index = surface.index();
                        state.last_update[index] = Instant::now();
                        state.fade[index] = 1.0;
                        let (opacity, fadeout) = (state.settings[index].opacity, state.settings[index].fadeout_duration);
                        let _ = if fadeout != 0.0 { self.update_alpha(&mut state, surface, Instant::now()) } else { self.set_alpha(&mut state, surface, opacity) };
                        return Ok(valid(&state));
                    }
                    Err(error) => {
                        if !valid(&state) {
                            return Ok(false);
                        }
                        if attempt == 1 {
                            return Err(error);
                        }
                        // The owner tears down and reconnects (`reStartOverlay`).
                        state.initialized = false;
                        state.reconnect_requested = true;
                        state.run_stop = true;
                        self.shared.wake.notify_all();
                    }
                }
            }
            let deadline = Instant::now() + REINIT_WAIT;
            let mut state = self.lock();
            while !state.initialized && valid(&state) && Instant::now() < deadline {
                state = self.shared.wake.wait_timeout(state, Duration::from_millis(100)).unwrap_or_else(|e| e.into_inner()).0;
            }
            if !valid(&state) {
                return Ok(false);
            }
            if !state.initialized {
                return Err(VrError("overlay reinitialization timed out".into()));
            }
        }
        Ok(false)
    }

    /// Clears a subtitle overlay and makes pictures on their way stale (`clearImage`).
    pub fn clear_image(&self, surface: Surface) {
        let mut state = self.lock();
        state.output_generations[surface.index()] += 1;
        input::forget_image(&mut state, surface);
        if state.initialized {
            let handle = state.handles[&surface];
            let cleared = state.session.as_mut().expect("initialized").set_raw(handle, &[0, 0, 0, 0], 1, 1);
            if cleared.is_err() {
                self.log("overlay: clearing a subtitle failed");
                self.report_failure(&mut state, "runtime");
            }
        }
        self.flush(state);
    }

    // ---- settings --------------------------------------------------------------------

    /// New settings for a window: position, times, opacity and width
    /// (`updateOverlaySmallLogSettings`, `updateVrLauncherPosition`).
    pub fn set_window(&self, surface: Surface, settings: WindowSettings) {
        let mut state = self.lock();
        let index = surface.index();
        let keep_size = state.settings[index].size;
        state.settings[index] = WindowSettings { size: settings.size.or(keep_size), ..settings };
        let result = (|| -> Result<(), VrError> {
            self.update_position(&mut state, surface)?;
            self.apply_width(&mut state, surface)?;
            let now = Instant::now();
            self.update_alpha(&mut state, surface, now)
        })();
        if result.is_err() {
            self.log("overlay: applying a setting failed");
        }
        self.flush(state);
    }

    /// The log window's opacity (`updateOverlayVrPanelOpacity`).
    pub fn set_panel_opacity(&self, opacity: f64) {
        self.lock().settings[Surface::Panel.index()].opacity = opacity;
    }

    /// Turns the VR panel on or off; applied in order by the overlay thread (`setVrPanelEnabled`).
    pub fn set_vr_panel_enabled(&self, enabled: bool) {
        self.lock().panel_enabled_requests.push_back(enabled);
    }

    pub fn set_panel_locked(&self, locked: bool) {
        self.lock().panel_locked = locked;
    }

    pub fn set_launcher_auto_hide(&self, enabled: bool) {
        self.lock().launcher.auto_hide = enabled;
    }

    /// Which VR windows the page has open (`setVrWindows`).
    pub fn set_vr_windows(&self, log: bool, popup: bool) {
        self.lock().vr_windows_wanted = (log, popup);
    }

    /// Moves the log to another anchor, keeping where it is seen (`requestAnchor`).
    pub fn request_anchor(&self, anchor: &str) {
        if PANEL_ANCHORS.contains(&anchor) {
            self.lock().requested_anchor = Some(anchor.to_string());
        }
    }

    /// Brings the log in front of the eyes (`requestRecallPanel`).
    pub fn request_recall(&self) {
        self.lock().recall_requested = Some(Instant::now());
    }

    /// Puts the launcher back at its default place, flying it to the wrist when connected
    /// (`requestLauncherReset`). `keep_hand` keeps the hand and only pulls it into reach.
    pub fn request_launcher_reset(&self, keep_hand: bool) {
        let mut state = self.lock();
        let keep = keep_hand && state.launcher_reset.is_none_or(|k| k);
        state.launcher_reset = Some(keep);
    }

    /// A tooltip request of the VR page (`setTooltip`).
    pub fn set_tooltip(&self, tooltip: Tooltip) {
        self.lock().tooltip_requests.push_back(tooltip);
    }

    /// The log size the VR page has drawn its layout for (`setLayoutRendered`).
    pub fn set_layout_rendered(&self, size: (u32, u32)) {
        self.lock().layout_rendered = size;
    }

    /// The layout and the tooltip generation (`getVrLayout`).
    pub fn vr_layout(&self) -> Value {
        let state = self.lock();
        layout_json(&state.layout, state.tooltip_epoch)
    }

    // ---- the VR panel (overlay thread) -------------------------------------------------

    fn reset_tooltip_epoch(&self, state: &mut State, notify: bool) {
        self.hide_tooltip(state);
        state.tooltip_epoch += 1;
        state.tooltip_revision = 0;
        if notify {
            state.events.push(Event::Layout(layout_json(&state.layout, state.tooltip_epoch)));
        }
    }

    fn hide_tooltip(&self, state: &mut State) {
        state.tooltip_state = None;
        state.tooltip_ready = false;
        state.panel_last_raw = None;
        self.hide_tooltip_overlay(state);
    }

    fn hide_tooltip_overlay(&self, state: &mut State) {
        if !state.tooltip_shown {
            return;
        }
        state.tooltip_shown = false;
        if let Some(handle) = state.tooltip_handle {
            let _ = self.submit(state, handle, "visibility", "hide".into(), |s| s.hide(handle));
        }
    }

    fn set_intro(&self, state: &mut State, intro: Intro) {
        if intro == state.intro {
            return;
        }
        state.intro = intro;
        if intro != Intro::Playing {
            self.end_intro_flight(state);
        }
        state.events.push(Event::LauncherIntro(intro.name()));
    }

    fn apply_vr_panel_enabled(&self, state: &mut State) -> Result<(), VrError> {
        let mut restart = false;
        while let Some(enabled) = state.panel_enabled_requests.pop_front() {
            if enabled && !state.vr_panel_enabled {
                restart = true;
            }
            if enabled != state.vr_panel_enabled {
                state.capture_generation += 1;
                self.reset_tooltip_epoch(state, true);
                self.set_intro(state, if enabled { Intro::Pending } else { Intro::Idle });
            }
            state.vr_panel_enabled = enabled;
        }
        if state.vr_panel_enabled && !state.vr_resources_tried && state.session.is_some() {
            state.vr_resources_tried = true;
            self.make_toolbar_and_ghost(state)?;
            let handle = self.create(state, "ASTAROT_tooltip")?;
            state.session.as_mut().expect("connected").set_sort_order(handle, 70)?;
            self.submit(state, handle, "visibility", "hide".into(), |s| s.hide(handle))?;
            state.tooltip_handle = Some(handle);
            state.panel_last_raw = None;
            state.panel_stopped = false;
            state.layout_applied = None;
            state.window_fitted = None;
            state.layout_requested_at = Instant::now();
            state.layout_retried = false;
            state.capture_generation += 1;
        }
        if restart && state.vr_panel_enabled {
            state.panel_window = None;
            state.panel_last_find = None;
            state.panel_last_capture = None;
            state.window_fitted = None;
            state.window_size = None;
            state.panel_stopped = false;
            state.panel_errors = 0;
            state.panel_last_raw = None;
            let now = Instant::now();
            state.panel_last_change = now;
            if state.layout_applied != Some(state.layout) {
                state.layout_requested_at = state.layout_requested_at.max(now);
                state.layout_retried = false;
            }
        }
        Ok(())
    }

    fn world_pose(state: &mut State, surface: Surface, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>) -> Option<Mat4> {
        let name = state.settings[surface.index()].tracker.clone();
        let (_, device) = Self::tracker(state, &name);
        let tracker_pose = pose_of(device)?;
        Some(math::mul(&tracker_pose, &math::to_homogeneous(&Self::relative(state, surface))))
    }

    /// Stores where a window now is, from its pose relative to its tracker (`commitPosition`).
    fn commit_position(&self, state: &mut State, surface: Surface, relative: &Mat34) {
        let index = surface.index();
        let base = Tracker::from_setting(&state.settings[index].tracker).base();
        if let Some(position) = math::matrix_to_position(&base, relative) {
            state.settings[index].position = position.map(layout::round4);
        }
        if surface == Surface::Launcher && placement::launcher_out_of_reach(&state.settings[index].placement()) {
            // Put too far, too small or too big: it flies back to the wrist of its hand.
            let keep = state.launcher_reset.is_none_or(|k| k);
            state.launcher_reset = Some(keep);
        }
        if surface == Surface::Panel {
            // Moved after a resize: going back to the old size must not undo the move.
            state.input.resize_undo = None;
        }
        self.notify_position(state, surface);
    }

    fn notify_position(&self, state: &mut State, surface: Surface) {
        if surface == Surface::Popup {
            return;
        }
        state.events.push(Event::Position(surface, state.settings[surface.index()].position_json()));
    }

    fn set_anchor(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>, anchor: &str) -> Result<(), VrError> {
        let (_, new_device) = Self::tracker(state, anchor);
        let new_pose = pose_of(new_device);
        let world = Self::world_pose(state, Surface::Panel, pose_of);
        let (Some(new_pose), Some(world)) = (new_pose, world) else {
            // The new anchor is not tracked: the page shows the old one again.
            self.notify_position(state, Surface::Panel);
            return Ok(());
        };
        let Some(inverse) = math::inverse(&new_pose) else { return Ok(()) };
        let mut relative = math::mul(&inverse, &world);
        let offset = math::translation(&relative);
        let distance = math::norm(offset);
        let (low, high) = match anchor {
            "LeftHand" | "RightHand" => (0.0, HAND_ANCHOR_MAX_DISTANCE_M),
            "HMD" => HMD_ANCHOR_DISTANCE_RANGE_M,
            _ => (0.0, f64::INFINITY),
        };
        if distance > 1e-6 && !(low..=high).contains(&distance) {
            math::set_axis(&mut relative, 3, math::scale(offset, distance.clamp(low, high) / distance));
        }
        state.settings[Surface::Panel.index()].tracker = anchor.to_string();
        self.commit_position(state, Surface::Panel, &math::to_mat34(&relative));
        self.update_position(state, Surface::Panel)
    }

    fn is_panel_out_of_view(state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>) -> bool {
        let tracker = state.settings[Surface::Panel.index()].tracker.clone();
        if state.vr_windows_hidden.contains(&Surface::Panel) || !matches!(tracker.as_str(), "Playspace" | "HMD") {
            return false;
        }
        let (Some(head), Some(world)) = (pose_of(Some(HMD)), Self::world_pose(state, Surface::Panel, pose_of)) else {
            return false;
        };
        pose::is_out_of_view(&head, math::translation(&world), state.panel_out_of_view)
    }

    fn recall_panel(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>) -> Result<(), VrError> {
        let Some(head) = pose_of(Some(HMD)) else { return Ok(()) };
        state.settings[Surface::Panel.index()].tracker = "Playspace".into();
        self.commit_position(state, Surface::Panel, &math::to_mat34(&pose::recall_pose(&head)));
        self.update_position(state, Surface::Panel)
    }

    fn place_popup(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>) -> Result<(), VrError> {
        let Some(head) = pose_of(Some(HMD)) else { return Ok(()) };
        let head_pos = math::translation(&head);
        let mut position = match Self::world_pose(state, Surface::Launcher, pose_of) {
            Some(launcher) => math::add(math::translation(&launcher), [0.0, POPUP_ABOVE_LAUNCHER_M, 0.0]),
            None => math::add(head_pos, math::scale(math::neg(math::axis(&head, 2)), POPUP_DISTANCE_RANGE_M.0)),
        };
        let mut horizontal = math::sub(position, head_pos);
        horizontal[1] = 0.0;
        let distance = math::norm(horizontal);
        if distance > 1e-6 {
            let clamped = distance.clamp(POPUP_DISTANCE_RANGE_M.0, POPUP_DISTANCE_RANGE_M.1);
            position = math::add(math::add(head_pos, math::scale(horizontal, clamped / distance)), [0.0, position[1] - head_pos[1], 0.0]);
        }
        state.settings[Surface::Popup.index()].tracker = "Playspace".into();
        self.commit_position(state, Surface::Popup, &math::to_mat34(&pose::face_head(position, &head)));
        self.update_position(state, Surface::Popup)
    }

    /// Shows and hides the page's windows as it asks, then moves the log when asked
    /// (`applyVrWindows`).
    fn apply_vr_windows(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>) -> Result<(), VrError> {
        let (log, popup) = state.vr_windows_wanted;
        for (surface, wanted) in [(Surface::Panel, log), (Surface::Popup, popup), (Surface::Launcher, true)] {
            let Some(&handle) = state.handles.get(&surface) else { continue };
            let wanted = wanted && state.vr_panel_enabled;
            if wanted && state.panel_image_size.is_none() {
                continue;
            }
            let hidden = state.vr_windows_hidden.contains(&surface);
            if wanted && hidden {
                if surface == Surface::Popup {
                    self.place_popup(state, pose_of)?;
                }
                state.vr_windows_hidden.remove(&surface);
                self.submit(state, handle, "visibility", "show".into(), |s| s.show(handle))?;
                state.panel_last_raw = None;
                if surface == Surface::Panel {
                    self.update_position(state, Surface::Panel)?;
                    if Self::is_panel_out_of_view(state, pose_of) {
                        self.recall_panel(state, pose_of)?;
                    }
                }
            } else if !wanted && !hidden {
                if matches!(surface, Surface::Panel | Surface::Launcher) {
                    self.reset_tooltip_epoch(state, true);
                }
                state.vr_windows_hidden.insert(surface);
                self.submit(state, handle, "visibility", "hide".into(), |s| s.hide(handle))?;
                self.window_hidden(state, surface);
            }
        }
        // Not while a window is held: the hold places it this tick. A recall waits until it is let go.
        if state.input.grabbing.is_some() || state.input.resizing.is_some() {
            return Ok(());
        }
        if let Some(anchor) = state.requested_anchor.take() {
            self.set_anchor(state, pose_of, &anchor)?;
        }
        if let Some(asked) = state.recall_requested {
            if !state.vr_windows_hidden.contains(&Surface::Panel) {
                state.recall_requested = None;
                self.recall_panel(state, pose_of)?;
            } else if asked.elapsed() > RECALL_PENDING {
                state.recall_requested = None;
            }
        }
        let out = Self::is_panel_out_of_view(state, pose_of);
        if out != state.panel_out_of_view {
            state.panel_out_of_view = out;
            state.events.push(Event::PanelOutOfView(out));
        }
        Ok(())
    }

    fn apply_launcher_defaults(&self, state: &mut State, keep_hand: bool) {
        let index = Surface::Launcher.index();
        if keep_hand {
            let near = placement::launcher_nearest_in_reach(&state.settings[index].placement());
            state.settings[index].position = near.position();
            state.settings[index].ui_scaling = near.ui_scaling;
            return;
        }
        let defaults = self.shared.options.launcher_defaults.clone();
        let current = &mut state.settings[index];
        current.position = defaults.position;
        current.ui_scaling = defaults.ui_scaling;
        current.tracker = defaults.tracker;
    }

    fn update_launcher_return(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>, now: f64) {
        // Not while a window is held, resized, or the launcher flies in (the hand might change).
        let can_start = state.intro_front.is_none() && state.input.grabbing.is_none() && state.input.resizing.is_none();
        if can_start
            && let Some(keep_hand) = state.launcher_reset.take()
        {
            if state.launcher_return.is_some() {
                if !keep_hand {
                    self.apply_launcher_defaults(state, false);
                }
            } else {
                let start = if state.vr_panel_enabled { Self::world_pose(state, Surface::Launcher, pose_of) } else { None };
                let width = Self::width_m(state, Surface::Launcher);
                self.apply_launcher_defaults(state, keep_hand);
                match start {
                    None => return self.finish_launcher_return(state),
                    Some(start) => state.launcher_return = Some((start, width, now)),
                }
            }
        }
        let Some((start, width, started)) = state.launcher_return else { return };
        let elapsed = now - started;
        let target = Self::world_pose(state, Surface::Launcher, pose_of);
        let Some(target) = target.filter(|_| elapsed < LAUNCHER_RETURN) else {
            return self.finish_launcher_return(state);
        };
        let progress = (elapsed / LAUNCHER_RETURN).powi(2);
        let pose = math::to_mat34(&pose::intro_flight_pose(&start, &target, progress));
        let handle = state.handles[&Surface::Launcher];
        let end = Self::width_m(state, Surface::Launcher);
        let flying = width * (end / width).powf(progress);
        if self.set_transform(state, handle, None, &pose).is_err()
            || self.submit(state, handle, "width", format!("{flying}"), |s| s.set_width(handle, flying as f32)).is_err()
        {
            self.finish_launcher_return(state);
        }
    }

    fn finish_launcher_return(&self, state: &mut State) {
        state.launcher_return = None;
        if !state.handles.contains_key(&Surface::Launcher) {
            return;
        }
        let _ = self.update_position(state, Surface::Launcher);
        let _ = self.apply_width(state, Surface::Launcher);
        if state.position_pending.contains(&Surface::Launcher) {
            state.launcher.shown = false;
            state.launcher.alpha = 0.0;
        }
        self.notify_position(state, Surface::Launcher);
    }

    fn end_intro_flight(&self, state: &mut State) {
        if state.intro_front.take().is_none() || !state.handles.contains_key(&Surface::Launcher) {
            return;
        }
        let _ = self.update_position(state, Surface::Launcher);
        let _ = self.apply_width(state, Surface::Launcher);
        if state.position_pending.contains(&Surface::Launcher) {
            state.launcher.shown = false;
            state.launcher.alpha = 0.0;
            if state.intro == Intro::Playing {
                self.set_intro(state, Intro::Idle);
            }
        }
    }

    fn update_intro_flight(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>, now: f64) {
        let Some(mut front) = state.intro_front else { return };
        if !state.handles.contains_key(&Surface::Launcher) {
            return;
        }
        let elapsed = now - state.intro_started;
        if elapsed >= INTRO_FRONT + INTRO_FLY {
            return self.end_intro_flight(state);
        }
        if elapsed < INTRO_FRONT {
            if let Some(head) = pose_of(Some(HMD)) {
                let follow = 1.0 - (-INTRO_FRONT_FOLLOW_PER_SEC * (now - state.intro_tick).max(0.0)).exp();
                front = pose::intro_flight_pose(&front, &pose::intro_front_pose(&head), follow);
                state.intro_front = Some(front);
            }
            state.intro_tick = now;
        }
        let Some(target) = Self::world_pose(state, Surface::Launcher, pose_of) else { return };
        let progress = ((elapsed - INTRO_FRONT) / INTRO_FLY).clamp(0.0, 1.0).powi(2);
        let pose = math::to_mat34(&pose::intro_flight_pose(&front, &target, progress));
        let handle = state.handles[&Surface::Launcher];
        let width = Self::width_m(state, Surface::Launcher) * INTRO_FRONT_SCALE.powf(1.0 - progress);
        if self.set_transform(state, handle, None, &pose).is_err()
            || self.submit(state, handle, "width", format!("{width}"), |s| s.set_width(handle, width as f32)).is_err()
        {
            self.end_intro_flight(state);
        }
    }

    /// Shows the launcher while the wrist is looked at, and starts the opening animation once
    /// the page was captured (`updateLauncherVisibility`).
    fn update_launcher_visibility(&self, state: &mut State, pose_of: &dyn Fn(Option<Device>) -> Option<Mat4>, now: f64) {
        if !state.handles.contains_key(&Surface::Launcher) {
            return;
        }
        if state.intro == Intro::Playing && now >= state.intro_until {
            self.set_intro(state, Intro::Idle);
        }
        let head = pose_of(Some(HMD));
        let launcher = Self::world_pose(state, Surface::Launcher, pose_of);
        let view = match (head, launcher) {
            (Some(head), Some(launcher)) => LauncherView {
                within_show: Some(pose::launcher_looks_visible(&launcher, &head, LAUNCHER_FACE_DEG, LAUNCHER_GAZE_SHOW_DEG)),
                within_hide: Some(pose::launcher_looks_visible(&launcher, &head, LAUNCHER_FACE_DEG + LAUNCHER_HIDE_MARGIN_DEG, LAUNCHER_GAZE_HIDE_DEG)),
            },
            _ => LauncherView::default(),
        };
        if state.intro == Intro::Pending && state.panel_last_raw.is_some() {
            let worn = state.session.as_mut().is_some_and(|s| s.headset_worn());
            if let (Some(head), true) = (head, worn) {
                state.intro_front = Some(pose::intro_front_pose(&head));
            }
            if state.intro_front.is_some() || state.launcher.shown {
                state.intro_started = now;
                state.intro_tick = now;
                state.intro_until = now + LAUNCHER_INTRO;
                self.set_intro(state, Intro::Playing);
            }
        }
        let forced = state.intro == Intro::Playing || state.launcher_return.is_some();
        let idle = state.intro == Intro::Idle && state.launcher_return.is_none();
        // The laser on the launcher, or the launcher held: it stays as it is.
        let held = state.input.launcher_pointed || state.input.grabbing.as_ref().is_some_and(|g| g.surface == Surface::Launcher);
        let stopped = state.launcher.update(LauncherTick { now, view, held, forced, idle });
        if stopped {
            self.reset_tooltip_epoch(state, true);
        }
    }

    // ---- the VR page's capture ---------------------------------------------------------

    fn update_panel(&self, state: &mut State, now: Instant) -> Result<(), VrError> {
        let manipulating = state.input.grabbing.is_some() || state.input.resizing.is_some();
        if manipulating && !state.input.tooltip_manipulating {
            self.reset_tooltip_epoch(state, true);
        }
        state.input.tooltip_manipulating = manipulating;
        self.apply_tooltip_requests(state);
        self.update_tooltip(state);
        let Some(surface) = self.shared.options.surface.clone() else {
            self.hide_tooltip(state);
            return Ok(());
        };
        if !state.vr_panel_enabled || state.panel_stopped || state.tooltip_handle.is_none() {
            self.hide_tooltip(state);
            return Ok(());
        }
        let Some(frame) = self.collect_capture(state, &surface, now) else { return Ok(()) };
        self.transfer(state, frame, now)?;
        state.panel_errors = 0;
        Ok(())
    }

    fn apply_tooltip_requests(&self, state: &mut State) {
        while let Some(request) = state.tooltip_requests.pop_front() {
            if request.epoch != state.tooltip_epoch || request.revision <= state.tooltip_revision {
                continue;
            }
            state.tooltip_revision = request.revision;
            self.hide_tooltip(state);
            state.tooltip_state = request.shown;
        }
    }

    /// Whether the tooltip's button is where the laser points (`tooltipTargetMatches`); a focus
    /// tooltip (keyboard) always is.
    fn tooltip_target_matches(state: &State, xy: Option<(i64, i64)>) -> bool {
        let Some(shape) = state.tooltip_state else { return false };
        if shape.mode == TooltipMode::Focus {
            return true;
        }
        let Some((px, py)) = xy else { return false };
        let (rx, ry, _, _) = match shape.region {
            TooltipParent::Launcher => state.layout.launcher,
            TooltipParent::Toolbar => state.layout.toolbar,
        };
        let [x, y, w, h] = shape.button;
        let (px, py) = (px as f64, py as f64);
        let (left, top) = (f64::from(rx) + x, f64::from(ry) + y);
        left <= px && px < left + w && top <= py && py < top + h
    }

    /// Places the tooltip over its button once the captured page carries it (`updateTooltip`).
    fn update_tooltip(&self, state: &mut State) {
        let Some(shape) = state.tooltip_state else { return };
        let launcher = shape.region == TooltipParent::Launcher;
        let parent_visible = if launcher { state.launcher.interactive } else { state.input.toolbar.visible };
        let parent_hidden = if launcher {
            state.vr_windows_hidden.contains(&Surface::Launcher)
        } else {
            state.vr_windows_hidden.contains(&Surface::Panel)
        };
        if !parent_visible
            || !state.vr_panel_enabled
            || state.panel_stopped
            || parent_hidden
            || state.input.grabbing.is_some()
            || state.input.resizing.is_some()
            || state.layout_applied != Some(state.layout)
            || !Self::tooltip_target_matches(state, state.input.pointer_notified)
        {
            self.hide_tooltip(state);
            return;
        }
        let (Some(handle), true, Some(image), Some(texture)) = (state.tooltip_handle, state.tooltip_ready, state.panel_image_size, state.texture_size) else {
            return;
        };
        let (relative, device, owner) = if launcher {
            let name = state.settings[Surface::Launcher.index()].tracker.clone();
            let (_, device) = Self::tracker(state, &name);
            (Some(Self::relative(state, Surface::Launcher)), device, Surface::Launcher)
        } else {
            (state.input.toolbar_relative, state.input.toolbar_tracker, Surface::Panel)
        };
        let Some(relative) = relative else {
            self.hide_tooltip(state);
            return;
        };
        if device == Some(INVALID_DEVICE) || state.position_pending.contains(&owner) {
            self.hide_tooltip(state);
            return;
        }
        let (_, _, pw, ph) = if launcher { state.layout.launcher } else { state.layout.toolbar };
        let (pw, ph) = (f64::from(pw), f64::from(ph));
        let width_m = if launcher { Self::width_m(state, Surface::Launcher) } else { layout::region_width_m(Region::Toolbar, 0.0) };
        let mpp = width_m / pw;
        let [x, y, w, _] = shape.button;
        let [bw, bh] = shape.size;
        let center_x = (x + w / 2.0).max(bw / 2.0 + 12.0).min(pw - bw / 2.0 - 12.0);
        let mut offset = math::IDENTITY;
        offset[0][3] = (center_x - pw / 2.0) * mpp;
        offset[1][3] = (ph / 2.0 - y + 12.0 + (bh + 6.0) / 2.0) * mpp;
        offset[2][3] = 0.004;
        let pose = math::to_mat34(&math::mul(&math::to_homogeneous(&relative), &offset));
        let (tx, ty, _, _) = state.layout.tooltip;
        let scale = f64::from(image.0) / f64::from(state.layout.atlas.0);
        let (tw, th) = (f64::from(texture.0), f64::from(texture.1));
        let bounds = [
            (f64::from(tx) * scale / tw) as f32,
            (1.0 - (f64::from(ty) + 8.0) * scale / th) as f32,
            ((f64::from(tx) + bw) * scale / tw) as f32,
            (1.0 - (f64::from(ty) + 8.0 + bh + 6.0) * scale / th) as f32,
        ];
        let width = bw * mpp;
        let result = (|| -> Result<(), VrError> {
            self.set_transform(state, handle, device, &pose)?;
            self.submit(state, handle, "width", format!("{width}"), |s| s.set_width(handle, width as f32))?;
            self.submit(state, handle, "bounds", format!("{bounds:?}"), |s| s.set_texture_bounds(handle, bounds))?;
            self.submit(state, handle, "visibility", "show".into(), |s| s.show(handle))
        })();
        if result.is_ok() {
            state.tooltip_shown = true;
        } else {
            state.tooltip_state = None;
            state.tooltip_ready = false;
        }
    }

    fn collect_capture(&self, state: &mut State, surface: &Arc<dyn PanelSurface>, now: Instant) -> Option<Frame> {
        if let Some(job) = state.capture_job.clone() {
            let result = job.result.lock().unwrap().take();
            let Some(result) = result else {
                let mut reported = job.reported.lock().unwrap();
                if !*reported && now.duration_since(job.started) >= STALL_REPORT {
                    *reported = true;
                    self.report_failure(state, "capture_stalled");
                    drop(reported);
                    self.log("overlay: capturing the VR page takes long (the app's window may not answer)");
                }
                return None;
            };
            state.capture_job = None;
            if *job.reported.lock().unwrap() {
                self.log("overlay: the VR page's capture came back");
                state.layout_requested_at = state.layout_requested_at.max(Instant::now());
            }
            if job.generation != state.capture_generation || job.layout != state.layout {
                return None;
            }
            self.start_capture(state, surface, now);
            return result;
        }
        self.start_capture(state, surface, now);
        None
    }

    fn start_capture(&self, state: &mut State, surface: &Arc<dyn PanelSurface>, now: Instant) {
        if state.capture_job.is_some() {
            return;
        }
        let active = state.input.pointer_notified.is_some()
            || state.input.grabbing.is_some()
            || state.input.resizing.is_some()
            || now.duration_since(state.panel_last_change).as_secs_f64() < timing::PANEL_ACTIVE_HOLD_SEC;
        let interval = Duration::from_secs_f64(if active { timing::PANEL_CAPTURE_INTERVAL_SEC } else { timing::PANEL_IDLE_CAPTURE_INTERVAL_SEC });
        if state.panel_last_capture.is_some_and(|last| now.duration_since(last) < interval) {
            return;
        }
        state.panel_last_capture = Some(now);
        if state.panel_window.is_none_or(|window| !surface.alive(window)) {
            if state.panel_window.take().is_some() {
                self.reset_tooltip_epoch(state, true);
            }
            if state.panel_last_find.is_some_and(|last| now.duration_since(last) < PANEL_FIND_INTERVAL) {
                return;
            }
            state.panel_last_find = Some(now);
            state.panel_window = surface.find();
            let Some(_) = state.panel_window else { return };
            self.reset_tooltip_epoch(state, true);
            state.window_fitted = None;
        }
        let window = state.panel_window.expect("found above");
        if state.window_fitted != Some(state.layout) {
            state.window_size = Some(surface.resize(window, state.layout.atlas.0, state.layout.atlas.1));
            state.window_fitted = Some(state.layout);
        }
        let job = Arc::new(CaptureJob {
            window,
            layout: state.layout,
            started: now,
            generation: state.capture_generation,
            result: Mutex::new(None),
            reported: Mutex::new(false),
        });
        state.capture_job = Some(Arc::clone(&job));
        let surface = Arc::clone(surface);
        let wake = Arc::clone(&self.shared);
        let spawned = std::thread::Builder::new().name("vr_panel_capture".into()).spawn(move || {
            let frame = surface.capture(job.window);
            *job.result.lock().unwrap() = Some(frame);
            wake.wake.notify_all();
        });
        if spawned.is_err() {
            state.capture_job = None;
        }
    }

    fn retry_or_revert_layout(&self, state: &mut State, now: Instant) {
        if state.layout_applied == Some(state.layout) {
            return;
        }
        let waited = now.saturating_duration_since(state.layout_requested_at);
        if waited >= LAYOUT_GIVE_UP {
            let fallback = state.layout_applied.map_or(layout::PANEL_DEFAULT_SIZE, |applied| (applied.panel.2, applied.panel.3));
            self.log("overlay: the VR page does not take the new size; going back");
            let index = Surface::Panel.index();
            if let Some((position, ui_scaling, tracker)) = state.input.resize_undo.take() {
                // Back to where and how wide it was before the drag (else it would jump).
                let window = &mut state.settings[index];
                window.position = position;
                window.ui_scaling = ui_scaling;
                window.tracker = tracker;
            } else {
                // The length of one px stays.
                let ratio = f64::from(fallback.0) / f64::from(state.layout.panel.2);
                state.settings[index].ui_scaling *= ratio;
            }
            self.set_panel_size(state, f64::from(fallback.0), f64::from(fallback.1));
            state.layout_requested_at = now + Duration::from_secs(3600);
            self.notify_position(state, Surface::Panel);
        } else if waited >= LAYOUT_RETRY && !state.layout_retried {
            state.layout_retried = true;
            state.window_fitted = None;
        }
    }

    fn atlas_mask(state: &mut State, size: (u32, u32)) -> &[u8] {
        let fresh = matches!(&state.mask, Some((s, l, _)) if *s == size && *l == state.layout);
        if !fresh {
            let layout = state.layout;
            let mut mask = vec![0u8; size.0 as usize * size.1 as usize];
            let scale = f64::from(size.0) / f64::from(layout.atlas.0);
            let radius = layout::round_half_even(f64::from(layout::PANEL_CORNER_RADIUS_PX) * scale);
            for region in [Region::Panel, Region::Launcher, Region::Popup, Region::Toolbar] {
                let (x0, y0, x1, y1) = layout.region_rect(region, size.0);
                for y in y0.max(0)..y1.min(i64::from(size.1)) {
                    for x in x0.max(0)..x1.min(i64::from(size.0)) {
                        if crate::canvas::inside_rounded(x, y, (x0, y0, x1 - 1, y1 - 1), radius) {
                            mask[y as usize * size.0 as usize + x as usize] = 255;
                        }
                    }
                }
            }
            state.mask = Some((size, layout, mask));
        }
        &state.mask.as_ref().expect("made above").2
    }

    /// Checks a captured picture and shows it when it changed (`transferCapture`).
    fn transfer(&self, state: &mut State, frame: Frame, now: Instant) -> Result<(), VrError> {
        let size = (frame.width, frame.height);
        let fits = Some(size) == state.window_size;
        let rendered = state.layout_rendered == (state.layout.panel.2, state.layout.panel.3);
        if !fits || !rendered {
            if !fits && state.layout_applied == Some(state.layout) {
                state.window_fitted = None;
            } else if !fits {
                self.retry_or_revert_layout(state, now);
            }
            return Ok(());
        }
        let hash = {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            hasher.write(&frame.bgra);
            hasher.write_u32(frame.width);
            hasher.finish()
        };
        if state.panel_last_raw == Some(hash) {
            return Ok(());
        }
        state.panel_last_raw = None;
        state.panel_last_change = now;
        let mut pixels = frame.bgra;
        let mask = Self::atlas_mask(state, size).to_vec();
        let tooltip = state.tooltip_state.map(|shown| Tooltip { epoch: state.tooltip_epoch, revision: state.tooltip_revision, shown: Some(shown) });
        let matches = tooltip.is_some_and(|t| {
            tooltip::marker_matches(&Picture { pixels: &pixels, width: size.0, height: size.1, channels: 4 }, &state.layout, &t)
        });
        let mut mask = mask;
        if matches && let Some(shape) = state.tooltip_state {
            let shape_mask = tooltip::tooltip_mask(&state.layout, &shape, size.0);
            apply_tooltip_mask(&mut mask, size, &shape_mask);
        } else {
            state.tooltip_ready = false;
            self.hide_tooltip_overlay(state);
        }
        for (pixel, alpha) in pixels.chunks_exact_mut(4).zip(&mask) {
            pixel[3] = *alpha;
        }
        if state.intro != Intro::Idle {
            let rect = state.layout.region_rect(Region::Launcher, size.0);
            if state.intro == Intro::Pending {
                clear_rect(&mut pixels, size, rect);
            } else {
                intro_key_alpha(&mut pixels, size, rect);
            }
        }
        let mut targets: Vec<Handle> = [Surface::Panel, Surface::Launcher, Surface::Popup].iter().filter_map(|s| state.handles.get(s).copied()).collect();
        targets.extend(state.input.toolbar_handle);
        targets.extend(state.tooltip_handle);
        let max = VrLayout::max_layout().atlas;
        let scale = f64::from(size.0) / f64::from(state.layout.atlas.0);
        let wanted = (((f64::from(max.0) * scale).round() as u32).max(size.0), ((f64::from(max.1) * scale).round() as u32).max(size.1));
        let texture = state.texture_size.unwrap_or(wanted);
        let session = state.session.as_mut().expect("connected");
        let texture = session.set_shared_texture(TextureSlot::Page, &targets, &pixels, size.0, size.1, texture)?;
        let changed = state.panel_image_size != Some(size) || state.texture_size != Some(texture);
        state.panel_image_size = Some(size);
        state.texture_size = Some(texture);
        if state.layout_applied != Some(state.layout) || changed {
            self.apply_layout(state)?;
        }
        state.tooltip_ready = matches;
        self.update_tooltip(state);
        state.panel_last_raw = Some(hash);
        Ok(())
    }

    /// Each region's part of the texture, and the log's width and place (`applyLayout`).
    fn apply_layout(&self, state: &mut State) -> Result<(), VrError> {
        let (Some(image), Some(texture)) = (state.panel_image_size, state.texture_size) else { return Ok(()) };
        let fu = f64::from(image.0) / f64::from(texture.0);
        let fv = f64::from(image.1) / f64::from(texture.1);
        let mut regions: Vec<(Handle, Region)> = [Surface::Panel, Surface::Launcher, Surface::Popup]
            .iter()
            .filter_map(|s| state.handles.get(s).map(|h| (*h, s.region().expect("a region"))))
            .collect();
        regions.extend(state.input.toolbar_handle.map(|h| (h, Region::Toolbar)));
        for (handle, region) in regions {
            let (u_min, u_max, v_min, v_max) = state.layout.region_bounds(region);
            let bounds = [(u_min * fu) as f32, (1.0 - (1.0 - v_min) * fv) as f32, (u_max * fu) as f32, (1.0 - (1.0 - v_max) * fv) as f32];
            self.submit(state, handle, "bounds", format!("{bounds:?}"), |s| s.set_texture_bounds(handle, bounds))?;
        }
        if state.initialized {
            self.apply_width(state, Surface::Panel)?;
            self.update_position(state, Surface::Panel)?;
        }
        state.layout_applied = Some(state.layout);
        state.input.resize_undo = None;
        if state.input.resizing.is_none() {
            self.hide_ghost(state);
        }
        Ok(())
    }

    /// A new log size: the page is asked for the new layout, and the overlays switch once it
    /// was captured in it (`setPanelSize`).
    fn set_panel_size(&self, state: &mut State, width: f64, height: f64) {
        let (width, height) = layout::clamp_panel_size(width, height);
        state.settings[Surface::Panel.index()].size = Some((f64::from(width), f64::from(height)));
        let layout = VrLayout::for_panel(width, height);
        if layout == state.layout {
            return;
        }
        state.layout = layout;
        state.submitted.clear();
        self.reset_tooltip_epoch(state, false);
        state.panel_last_raw = None;
        state.layout_requested_at = Instant::now();
        state.layout_retried = false;
        state.events.push(Event::Layout(layout_json(&state.layout, state.tooltip_epoch)));
    }

    /// The overlays' state for tests: (initialized, hidden VR windows, panel picture size).
    pub fn debug_state(&self) -> (bool, Vec<&'static str>, Option<(u32, u32)>) {
        let state = self.lock();
        let mut hidden: Vec<_> = state.vr_windows_hidden.iter().map(|s| s.key()).collect();
        hidden.sort();
        (state.initialized, hidden, state.panel_image_size)
    }

    /// The settings the overlay holds for a window (tests).
    pub fn window(&self, surface: Surface) -> WindowSettings {
        self.lock().settings[surface.index()].clone()
    }

    pub fn panel_locked(&self) -> bool {
        self.lock().panel_locked
    }

    pub fn launcher_auto_hide(&self) -> bool {
        self.lock().launcher.auto_hide
    }
}

fn clear_rect(pixels: &mut [u8], size: (u32, u32), rect: (i64, i64, i64, i64)) {
    let (x0, y0, x1, y1) = rect;
    for y in y0.max(0)..y1.min(i64::from(size.1)) {
        for x in x0.max(0)..x1.min(i64::from(size.0)) {
            let i = (y as usize * size.0 as usize + x as usize) * 4;
            pixels[i..i + 4].fill(0);
        }
    }
}

/// During the opening animation, the launcher region's background colour becomes transparent
/// (`introKeyAlpha`); the key is the region's top left pixel.
fn intro_key_alpha(pixels: &mut [u8], size: (u32, u32), rect: (i64, i64, i64, i64)) {
    let (x0, y0, x1, y1) = rect;
    if x0 < 0 || y0 < 0 || x1 > i64::from(size.0) || y1 > i64::from(size.1) || x0 >= x1 || y0 >= y1 {
        return;
    }
    let at = |x: i64, y: i64| (y as usize * size.0 as usize + x as usize) * 4;
    let key_at = at(x0, y0);
    let key = [i32::from(pixels[key_at]), i32::from(pixels[key_at + 1]), i32::from(pixels[key_at + 2])];
    let (low, high) = INTRO_KEY_SOFT;
    for y in y0..y1 {
        for x in x0..x1 {
            let i = at(x, y);
            let diff = (0..3).map(|c| (i32::from(pixels[i + c]) - key[c]).abs()).max().unwrap_or(0);
            let keyed = ((diff - low) * 255 / (high - low)).clamp(0, 255) as u8;
            pixels[i + 3] = pixels[i + 3].min(keyed);
            if pixels[i + 3] == 0 {
                pixels[i..i + 3].fill(0);
            }
        }
    }
}

fn apply_tooltip_mask(mask: &mut [u8], size: (u32, u32), shape: &tooltip::TooltipMask) {
    let (x0, y0, x1, y1) = shape.body;
    for y in y0.max(0)..=y1.min(i64::from(size.1) - 1) {
        for x in x0.max(0)..=x1.min(i64::from(size.0) - 1) {
            if crate::canvas::inside_rounded(x, y, shape.body, shape.radius) {
                mask[y as usize * size.0 as usize + x as usize] = 255;
            }
        }
    }
    // The arrow: a small triangle under the body.
    let [(ax0, ay0), (ax1, _), (ax2, ay2)] = shape.arrow;
    for y in ay0.max(0)..=ay2.min(i64::from(size.1) - 1) {
        let t = if ay2 == ay0 { 1.0 } else { (y - ay0) as f64 / (ay2 - ay0) as f64 };
        let left = ax0 as f64 + (ax2 - ax0) as f64 * t;
        let right = ax1 as f64 + (ax2 - ax1) as f64 * t;
        for x in (left.ceil() as i64).max(0)..=(right.floor() as i64).min(i64::from(size.0) - 1) {
            mask[y as usize * size.0 as usize + x as usize] = 255;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::fake::FakeVr;

    fn settings() -> [WindowSettings; 5] {
        let base = |tracker: &str, fade: f64, scaling: f64| WindowSettings {
            position: [0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            tracker: tracker.into(),
            display_duration: 5.0,
            fadeout_duration: fade,
            opacity: 1.0,
            ui_scaling: scaling,
            size: None,
        };
        [base("HMD", 2.0, 1.0), base("HMD", 2.0, 0.25), base("Playspace", 0.0, 0.4), base("LeftHand", 0.0, 0.303), base("Playspace", 0.0, 0.36)]
    }

    fn overlay(vr: &FakeVr, events: Arc<Mutex<Vec<Event>>>) -> Overlay {
        let sink = Arc::clone(&events);
        Overlay::new(Options {
            vr: Arc::new(vr.clone()),
            surface: None,
            settings: settings(),
            launcher_defaults: settings()[3].clone(),
            events: Arc::new(move |e| sink.lock().unwrap().push(e)),
            log: Arc::new(|_| {}),
            steamvr_poll: Duration::from_millis(20),
        })
    }

    fn wait(what: &str, f: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !f() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn waits_for_steamvr_then_makes_the_overlays() {
        let vr = FakeVr::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        let overlay = overlay(&vr, events);
        assert!(overlay.start());
        std::thread::sleep(Duration::from_millis(60));
        assert!(!overlay.initialized());
        assert_eq!(vr.with(|s| s.connects), 0);
        vr.with(|s| {
            s.running = true;
            s.hands_connected = true;
        });
        wait("connected", || overlay.initialized());
        let keys: Vec<String> = vr.with(|s| s.created.iter().map(|(k, _)| k.clone()).collect());
        assert_eq!(&keys[..5], ["ASTAROT0", "ASTAROT1", "ASTAROT2", "ASTAROT3", "ASTAROT4"]);
        let small = vr.handle("ASTAROT0").unwrap();
        assert!(vr.with(|s| s.visible.contains(&small)));
        let panel = vr.handle("ASTAROT2").unwrap();
        assert!(!vr.with(|s| s.visible.contains(&panel)), "the VR windows wait for the page");
        overlay.shutdown();
        assert!(!overlay.running());
        assert_eq!(vr.with(|s| s.sessions_open), 0);
    }

    #[test]
    fn a_picture_shows_then_fades_and_a_clear_cancels_older_ones() {
        let vr = FakeVr::running();
        let overlay = overlay(&vr, Arc::new(Mutex::new(Vec::new())));
        let token = overlay.publication_token(Surface::Small);
        assert_eq!(overlay.update_image(Surface::Small, &[0; 16], 2, 2, token, &|| true), Ok(false), "not connected yet");
        overlay.start();
        wait("connected", || overlay.initialized());
        let token = overlay.publication_token(Surface::Small);
        assert_eq!(overlay.update_image(Surface::Small, &[0; 16], 2, 2, token, &|| true), Ok(true));
        let small = vr.handle("ASTAROT0").unwrap();
        assert_eq!(vr.with(|s| s.raw[&small]), (2, 2));
        overlay.clear_image(Surface::Small);
        assert_eq!(overlay.update_image(Surface::Small, &[0; 16], 2, 2, token, &|| true), Ok(false), "stale after a clear");
        assert_eq!(vr.with(|s| s.raw[&small]), (1, 1));
        overlay.shutdown();
    }

    #[test]
    fn steamvr_quitting_closes_and_reconnects() {
        let vr = FakeVr::running();
        let overlay = overlay(&vr, Arc::new(Mutex::new(Vec::new())));
        overlay.start();
        wait("connected", || overlay.initialized());
        vr.with(|s| s.quit = true);
        wait("reconnected", || vr.with(|s| s.connects) >= 2 && overlay.initialized());
        overlay.shutdown();
        assert_eq!(vr.with(|s| s.sessions_open), 0);
    }

    #[test]
    fn a_failing_upload_reconnects_once_then_reports() {
        let vr = FakeVr::running();
        let overlay = overlay(&vr, Arc::new(Mutex::new(Vec::new())));
        overlay.start();
        wait("connected", || overlay.initialized());
        vr.with(|s| s.fail_raw = true);
        let token = overlay.publication_token(Surface::Large);
        // The reconnect itself fails to make the overlays (setOverlayRaw fails during init).
        let result = overlay.update_image(Surface::Large, &[0; 4], 1, 1, token, &|| true);
        assert!(result.is_err() || result == Ok(false));
        overlay.shutdown();
    }

    #[test]
    fn the_anchor_moves_keep_the_window_where_it_is_seen() {
        let vr = FakeVr::running();
        let events = Arc::new(Mutex::new(Vec::new()));
        let overlay = overlay(&vr, Arc::clone(&events));
        overlay.start();
        wait("connected", || overlay.initialized());
        overlay.request_anchor("HMD");
        wait("anchored", || events.lock().unwrap().iter().any(|e| matches!(e, Event::Position(Surface::Panel, _))));
        let panel = overlay.window(Surface::Panel);
        assert_eq!(panel.tracker, "HMD");
        let found = events.lock().unwrap().iter().find_map(|e| match e {
            Event::Position(Surface::Panel, value) => Some(value.clone()),
            _ => None,
        });
        assert_eq!(found.unwrap()["tracker"], "HMD");
        overlay.shutdown();
    }

    #[test]
    fn layout_json_has_the_shape_the_page_reads() {
        let value = layout_json(&VrLayout::default_layout(), 7);
        assert_eq!(value["atlas"], json!([1628, 880]));
        assert_eq!(value["regions"]["panel"], json!([0, 0, 900, 700]));
        assert_eq!(value["tooltip_epoch"], 7);
    }

    #[test]
    fn the_intro_key_clears_the_background_only() {
        let size = (4u32, 1u32);
        let mut pixels = vec![10, 10, 10, 255, 10, 10, 10, 255, 200, 200, 200, 255, 12, 10, 10, 255];
        intro_key_alpha(&mut pixels, size, (0, 0, 4, 1));
        assert_eq!(pixels[3], 0);
        assert_eq!(pixels[11], 255);
        assert_eq!(pixels[15], 0, "within the soft edge");
    }
}
