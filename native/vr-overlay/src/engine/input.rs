//! The controllers on the overlays ([`overlay.py`]'s `updateGrab` and its helpers).
//!
//! Each tick, on the overlay thread:
//! - The laser leaves each controller's tip (`tipOffset`), tilted 12 degrees up. SteamVR finds
//!   what it hits (`ComputeOverlayIntersection`); the nearest window wins. Transparent parts of
//!   the subtitles and the parts of the VR page's overlays outside their region do not count.
//! - On the VR page the trigger is the left mouse button and the stick scrolls; the input goes to
//!   the page's window (`PanelSurface::pointer`). Where the laser is goes to the UI for the
//!   hover ([`Event::Pointer`]). Leaving the page with the trigger held lets go outside it, so the
//!   button pressed first is not clicked.
//! - Pressing the grip on a window grabs it; it follows the hand and turns to the eyes, the stick
//!   pushes it away or pulls it in, the trigger held with the grip scales it. Letting go saves
//!   where it is ([`Event::Position`]). A locked log cannot be grabbed; a window on a hand cannot
//!   be grabbed with that hand.
//! - The grip on a corner of the log resizes it; a frame shows the new size until the page is
//!   drawn in it.
//! - The toolbar under the log shows after the log has been pointed at for a while.
//!
//! Nothing here logs user text; the log lines name hands, windows and states.
//!
//! [`overlay.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay.py

use super::{Event, Overlay, State, Surface};
use crate::canvas;
use crate::layout::{self, Region};
use crate::math::{self, Mat34, Mat4, Vec3};
use crate::pose::{self, GrabSmoother, ScaleIcon};
use crate::runtime::{ControllerState, Device, HMD, Hand, Handle, Intersection, TextureSlot, VrError};
use crate::surface::{OUTSIDE, PointerInput};
use crate::timing::{self, ToolbarEffect};
use std::collections::{HashMap, HashSet};

const POINTER_WIDTH_M: f64 = 0.0075;
/// The pointer grows to this on a grab, to say it took.
const GRAB_POP_SCALE: f64 = 1.8;
const GRAB_POP_SEC: f64 = 0.12;
/// A subtitle is hit where it has ink within this radius (px).
const HIT_MARGIN_PX: i64 = 12;
/// The log's corners take the grip this far inside and outside (logical px).
const CORNER_INSIDE_PX: f64 = 56.0;
const CORNER_OUTSIDE_PX: f64 = 32.0;
/// The corner handles' centres from the log's edges (`VrWindow.css.ts`'s `resize_handle`).
const CORNER_HANDLE_CENTER_PX: i64 = 34;
const GHOST_COLOR: [u8; 4] = [0xB7, 0xDE, 0xD8, 255];
const GHOST_LIMIT_COLOR: [u8; 4] = [0xCB, 0x94, 0x4F, 255];
const GHOST_FILL: [u8; 4] = [0x61, 0xB4, 0xA7, 40];
/// The frame floats this far in front of the log (on the same plane it flickers).
const GHOST_FRONT_M: f64 = 0.004;
/// Big enough for a quarter of the largest log; only its top left is used.
const GHOST_TEXTURE_SIZE: (u32, u32) = (352, 256);
/// When the tip is not known, it is asked again after this.
const TIP_RETRY_SEC: f64 = 5.0;
/// The stick's tilt as wheel units per tick (WHEEL_DELTA is 120).
const PANEL_SCROLL_PER_FRAME: f64 = 60.0;
const PANEL_SCROLL_DEADZONE: f64 = 0.3;
/// Smaller moves of the pointer are not sent to the UI.
const POINTER_NOTIFY_MIN_MOVE_PX: i64 = 4;
const COLOR_NORMAL: [f32; 3] = [1.0, 1.0, 1.0];
/// VRCT's primary colours (`--primary_300_color`, `--primary_100_color`).
const COLOR_POINTER: [f32; 3] = [0x61 as f32 / 255.0, 0xB4 as f32 / 255.0, 0xA7 as f32 / 255.0];
const COLOR_GRABBING: [f32; 3] = [0xB7 as f32 / 255.0, 0xDE as f32 / 255.0, 0xD8 as f32 / 255.0];
const POINTER_ICONS: [ScaleIcon; 3] = [ScaleIcon::Dot, ScaleIcon::Plus, ScaleIcon::Minus];

/// What the laser can point at: a window, or the toolbar under the log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Target {
    Window(Surface),
    Toolbar,
}

impl Target {
    fn region(self) -> Option<Region> {
        match self {
            Self::Window(surface) => surface.region(),
            Self::Toolbar => Some(Region::Toolbar),
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Window(surface) => surface.key(),
            Self::Toolbar => "toolbar",
        }
    }
}

/// Holding the trigger with the grip: the window stays and the hand's push scales it.
pub(super) struct GrabScale {
    start: Vec3,
    forward: Vec3,
    width: f64,
    overlay: Mat4,
}

/// A held window (`grabbing` and the `grab_*` fields).
pub(super) struct Grab {
    pub(super) surface: Surface,
    hand: Device,
    hand_to_overlay: Mat4,
    started: f64,
    prev_time: f64,
    smoother: GrabSmoother,
    /// The eye distance of a window in the play space or on the head (it moves on a sphere).
    radius: Option<f64>,
    /// The eye-to-hand distance when grabbed: reaching out moves the window by the same ratio.
    hand_distance: f64,
    last_relative: Option<Mat34>,
    scale: Option<GrabScale>,
}

/// The log resized by a corner (`resizing`).
pub(super) struct Resize {
    hand: Device,
    corner: (i8, i8),
    m_per_px: f64,
    tracker: Option<Device>,
    relative: Mat4,
    pose: Mat4,
    fixed: (f64, f64),
    size: (u32, u32),
    center: (f64, f64),
}

#[derive(Default)]
pub(super) struct Interaction {
    pub(super) grabbing: Option<Grab>,
    pub(super) resizing: Option<Resize>,
    /// The grip of each hand last tick: only a fresh press grabs (not one held while the laser
    /// slides onto a window, as when holding something in VRChat).
    grip_prev: HashMap<Device, bool>,
    /// The corner each hand pointed at last tick (the laser shakes as the grip closes).
    corner_prev: HashMap<Device, Option<(i8, i8)>>,
    /// Each hand on the page: (trigger down, the last position sent).
    panel_input: HashMap<Device, (bool, Option<(i64, i64)>)>,
    /// Hands whose trigger was still held when they let go of a window: ignored until released.
    trigger_blocked: HashSet<Device>,
    pub(super) pointer_notified: Option<(i64, i64)>,
    pub(super) launcher_pointed: bool,
    pub(super) toolbar: timing::Toolbar,
    pub(super) toolbar_handle: Option<Handle>,
    /// The toolbar's pose relative to the log's tracker, and that tracker.
    pub(super) toolbar_relative: Option<Mat34>,
    pub(super) toolbar_tracker: Option<Device>,
    ghost_handle: Option<Handle>,
    ghost_key: Option<(u32, u32, bool)>,
    pointer_handles: Vec<(ScaleIcon, Handle)>,
    /// Where and how wide the log was before a resize, while the page has not taken the new size.
    pub(super) resize_undo: Option<([f64; 6], f64, String)>,
    tip_offsets: HashMap<Device, (Mat4, Option<f64>)>,
    /// The subtitles' last pictures' alpha, for what can be pointed at.
    images: [Option<(u32, u32, Vec<u8>)>; 2],
    pub(super) tooltip_manipulating: bool,
    /// (grip, what is hit) per hand, logged when it changes.
    debug: HashMap<Device, (bool, Option<Target>)>,
    error: Option<String>,
}

fn image_index(surface: Surface) -> Option<usize> {
    match surface {
        Surface::Small => Some(0),
        Surface::Large => Some(1),
        _ => None,
    }
}

/// Keeps a subtitle's alpha for the laser (`self.images`).
pub(super) fn remember_image(state: &mut State, surface: Surface, rgba: &[u8], width: u32, height: u32) {
    if let Some(index) = image_index(surface) {
        let alpha = rgba.chunks_exact(4).map(|p| p[3]).collect();
        state.input.images[index] = Some((width, height, alpha));
    }
}

pub(super) fn forget_image(state: &mut State, surface: Surface) {
    if let Some(index) = image_index(surface) {
        state.input.images[index] = None;
    }
}

/// The pointer's marks: white, tinted by the overlay's colour (`createPointerImages`).
fn pointer_image(icon: ScaleIcon) -> Vec<u8> {
    let mut rgba = vec![0u8; 64 * 64 * 4];
    let (center, outer, inner) = (31.5f64, 27.5f64, 22.5f64);
    for y in 0..64i64 {
        for x in 0..64i64 {
            let distance = ((x as f64 - center).powi(2) + (y as f64 - center).powi(2)).sqrt();
            let pixel = if distance > outer {
                continue;
            } else if distance > inner {
                [0, 0, 0, 255]
            } else {
                [255, 255, 255, 255]
            };
            let horizontal = (18..=46).contains(&x) && (29..=35).contains(&y);
            let vertical = (18..=46).contains(&y) && (29..=35).contains(&x);
            let line = match icon {
                ScaleIcon::Dot => false,
                ScaleIcon::Minus => horizontal,
                ScaleIcon::Plus => horizontal || vertical,
            };
            let at = ((y * 64 + x) * 4) as usize;
            rgba[at..at + 4].copy_from_slice(if line { &[0, 0, 0, 255] } else { &pixel });
        }
    }
    rgba
}

/// The resize frame at a quarter of the new size, BGRA (`createGhostImage`).
fn ghost_image(width: u32, height: u32, at_limit: bool) -> (Vec<u8>, u32, u32) {
    let w = ((f64::from(width) / 4.0).round_ties_even() as u32).max(8);
    let h = ((f64::from(height) / 4.0).round_ties_even() as u32).max(8);
    let (wi, hi) = (i64::from(w), i64::from(h));
    let outline = if at_limit { GHOST_LIMIT_COLOR } else { GHOST_COLOR };
    let mut bgra = vec![0u8; (w * h * 4) as usize];
    for y in 0..hi {
        for x in 0..wi {
            let colour = if !canvas::inside_rounded(x, y, (1, 1, wi - 2, hi - 2), 6) {
                continue;
            } else if canvas::inside_rounded(x, y, (4, 4, wi - 5, hi - 5), 3) {
                GHOST_FILL
            } else {
                outline
            };
            let at = ((y * wi + x) * 4) as usize;
            bgra[at..at + 4].copy_from_slice(&[colour[2], colour[1], colour[0], colour[3]]);
        }
    }
    (bgra, w, h)
}

type PoseOf<'a> = &'a dyn Fn(Option<Device>) -> Option<Mat4>;

impl Overlay {
    // ---- the overlays the controllers use ---------------------------------------------

    /// The pointer's three marks, each its own overlay (changing one picture again and again
    /// with `setOverlayRaw` failed after about 190 times).
    pub(super) fn make_pointers(&self, state: &mut State) -> Result<(), VrError> {
        for icon in POINTER_ICONS {
            let handle = self.create(state, &format!("ASTAROT_pointer_{}", icon.key()))?;
            let session = state.session.as_mut().expect("connected");
            session.set_sort_order(handle, 100)?;
            session.set_raw(handle, &pointer_image(icon), 64, 64)?;
            state.input.pointer_handles.push((icon, handle));
        }
        Ok(())
    }

    /// The toolbar and the resize frame, made with the VR page's other overlays (`initVrResources`).
    pub(super) fn make_toolbar_and_ghost(&self, state: &mut State) -> Result<(), VrError> {
        let toolbar = self.create(state, "ASTAROT_toolbar")?;
        let width = layout::region_width_m(Region::Toolbar, 0.0);
        self.submit(state, toolbar, "width", format!("{width}"), |s| s.set_width(toolbar, width as f32))?;
        self.submit(state, toolbar, "visibility", "hide".into(), |s| s.hide(toolbar))?;
        state.input.toolbar_handle = Some(toolbar);
        state.input.toolbar.reset();
        let ghost = self.create(state, "ASTAROT_resize_ghost")?;
        state.session.as_mut().expect("connected").set_sort_order(ghost, 50)?;
        self.submit(state, ghost, "visibility", "hide".into(), |s| s.hide(ghost))?;
        state.input.ghost_handle = Some(ghost);
        state.input.ghost_key = None;
        Ok(())
    }

    /// Places a window and, for the log, the toolbar under it (`setTransform`).
    pub(super) fn set_window_transform(&self, state: &mut State, surface: Surface, device: Option<Device>, relative: &Mat34) -> Result<(), VrError> {
        let handle = state.handles[&surface];
        self.set_transform(state, handle, device, relative)?;
        if surface == Surface::Panel && state.input.toolbar_handle.is_some() {
            self.place_toolbar(state, device, relative)?;
        }
        Ok(())
    }

    /// Under the log; moved only while shown (`placeToolbar`).
    fn place_toolbar(&self, state: &mut State, device: Option<Device>, panel_relative: &Mat34) -> Result<(), VrError> {
        let ui_scaling = state.settings[Surface::Panel.index()].ui_scaling;
        let relative = layout::toolbar_relative(&state.layout, panel_relative, ui_scaling);
        state.input.toolbar_relative = Some(relative);
        state.input.toolbar_tracker = device;
        if let (true, Some(handle)) = (state.input.toolbar.visible, state.input.toolbar_handle) {
            self.set_transform(state, handle, device, &relative)?;
        }
        Ok(())
    }

    fn apply_toolbar(&self, state: &mut State, effects: Vec<ToolbarEffect>) -> Result<(), VrError> {
        let Some(handle) = state.input.toolbar_handle else { return Ok(()) };
        for effect in effects {
            match effect {
                ToolbarEffect::Show(alpha) => {
                    let name = state.settings[Surface::Panel.index()].tracker.clone();
                    let (_, device) = Self::tracker(state, &name);
                    let relative = Self::relative(state, Surface::Panel);
                    self.place_toolbar(state, device, &relative)?;
                    self.submit(state, handle, "alpha", format!("{alpha}"), |s| s.set_alpha(handle, alpha as f32))?;
                    self.submit(state, handle, "visibility", "show".into(), |s| s.show(handle))?;
                }
                ToolbarEffect::Alpha(alpha) => {
                    self.submit(state, handle, "alpha", format!("{alpha}"), |s| s.set_alpha(handle, alpha as f32))?;
                }
                ToolbarEffect::Hide => self.submit(state, handle, "visibility", "hide".into(), |s| s.hide(handle))?,
                ToolbarEffect::ResetTooltip => self.reset_tooltip_epoch(state, true),
            }
        }
        Ok(())
    }

    fn update_toolbar(&self, state: &mut State, now: f64, pointing_log: bool) -> Result<(), VrError> {
        let log_shown = !state.vr_windows_hidden.contains(&Surface::Panel) && state.vr_panel_enabled;
        let can_show = !state.position_pending.contains(&Surface::Panel);
        let effects = state.input.toolbar.update(now, pointing_log, log_shown, can_show);
        self.apply_toolbar(state, effects)
    }

    /// A window was hidden by the page: what was going on with it ends (`applyVrWindows`).
    pub(super) fn window_hidden(&self, state: &mut State, surface: Surface) {
        if surface == Surface::Panel {
            let now = self.seconds(std::time::Instant::now());
            let effects = state.input.toolbar.update(now, false, false, true);
            let _ = self.apply_toolbar(state, effects);
            self.hide_ghost(state);
            if state.input.resizing.take().is_some() {
                self.set_highlight(state, None);
                self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
            }
        }
        if state.input.grabbing.as_ref().is_some_and(|g| g.surface == surface) {
            state.input.grabbing = None;
            self.set_highlight(state, None);
            self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
        }
    }

    pub(super) fn hide_ghost(&self, state: &mut State) {
        if let Some(ghost) = state.input.ghost_handle {
            let _ = self.submit(state, ghost, "visibility", "hide".into(), |s| s.hide(ghost));
        }
    }

    /// The pointer where the laser hits, or hidden (`showPointer`).
    fn show_pointer(&self, state: &mut State, hit: Option<(Vec3, Vec3)>, color: [f32; 3], scale: f64, icon: ScaleIcon) {
        let handles = state.input.pointer_handles.clone();
        for (other, handle) in &handles {
            if *other != icon || hit.is_none() {
                let handle = *handle;
                let _ = self.submit(state, handle, "visibility", "hide".into(), |s| s.hide(handle));
            }
        }
        let (Some((point, normal)), Some(&(_, handle))) = (hit, handles.iter().find(|(i, _)| *i == icon)) else { return };
        let point = math::add(point, math::scale(normal, 0.002));
        let up = if normal[1].abs() < 0.99 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
        let x_axis = math::cross(up, normal);
        let x_axis = math::scale(x_axis, 1.0 / math::norm(x_axis));
        let y_axis = math::cross(normal, x_axis);
        let mut pose = math::IDENTITY;
        math::set_axis(&mut pose, 0, x_axis);
        math::set_axis(&mut pose, 1, y_axis);
        math::set_axis(&mut pose, 2, normal);
        math::set_axis(&mut pose, 3, point);
        let width = POINTER_WIDTH_M * if icon == ScaleIcon::Dot { 1.0 } else { 2.0 } * scale;
        let _ = (|| -> Result<(), VrError> {
            self.set_transform(state, handle, None, &math::to_mat34(&pose))?;
            self.submit(state, handle, "color", format!("{color:?}"), |s| s.set_color(handle, color))?;
            self.submit(state, handle, "width", format!("{width}"), |s| s.set_width(handle, width as f32))?;
            self.submit(state, handle, "visibility", "show".into(), |s| s.show(handle))
        })();
    }

    /// Tints the held window; `None` gives every window its colour back (`setHighlight`).
    fn set_highlight(&self, state: &mut State, surface: Option<Surface>) {
        for each in Surface::ALL {
            let Some(&handle) = state.handles.get(&each) else { continue };
            let color = if Some(each) == surface { COLOR_GRABBING } else { COLOR_NORMAL };
            let _ = self.submit(state, handle, "color", format!("{color:?}"), |s| s.set_color(handle, color));
        }
    }

    // ---- what the laser hits ---------------------------------------------------------

    /// The controller's tip as seen from its body (`tipOffset`): the laser leaves the tip, which
    /// on some controllers points well below the body's forward.
    fn tip_offset(&self, state: &mut State, hand: Device, now: f64) -> Mat4 {
        if let Some((offset, retry)) = state.input.tip_offsets.get(&hand)
            && retry.is_none_or(|at| now < at)
        {
            return *offset;
        }
        let first = !state.input.tip_offsets.contains_key(&hand);
        let found = state.session.as_mut().and_then(|s| s.tip_offset(hand));
        let entry = match found {
            Some(offset) => (offset, None),
            None => (math::IDENTITY, Some(now + TIP_RETRY_SEC)),
        };
        if first && entry.1.is_some() {
            self.log(&format!("overlay: the tip of controller {hand} is not known; its laser leaves the body"));
        }
        state.input.tip_offsets.insert(hand, entry);
        entry.0
    }

    /// Where the laser leaves (`rayOf`); a held window follows this pose too.
    fn ray_of(&self, state: &mut State, pose_of: PoseOf, hand: Device, now: f64) -> Option<Mat4> {
        let body = pose_of(Some(hand))?;
        let tip = self.tip_offset(state, hand, now);
        Some(math::mul(&math::mul(&body, &tip), &pose::laser_tilt(pose::LASER_PITCH_UP_DEG)))
    }

    fn intersect_handle(state: &mut State, handle: Handle, ray: &Mat4) -> Option<Intersection> {
        let direction = math::neg(math::axis(ray, 2));
        state.session.as_mut()?.intersect(handle, math::translation(ray), direction)
    }

    fn target_world_pose(state: &mut State, target: Target, pose_of: PoseOf) -> Option<Mat4> {
        match target {
            Target::Window(surface) => Self::world_pose(state, surface, pose_of),
            Target::Toolbar => {
                let relative = state.input.toolbar_relative?;
                let tracker = pose_of(state.input.toolbar_tracker)?;
                Some(math::mul(&tracker, &math::to_homogeneous(&relative)))
            }
        }
    }

    fn region_width(state: &State, target: Target) -> f64 {
        match target {
            Target::Toolbar => layout::region_width_m(Region::Toolbar, 0.0),
            Target::Window(surface) => Self::width_m(state, surface),
        }
    }

    /// Whether a subtitle has ink near the hit (`hasContentAt`); the VR page's regions are opaque.
    fn has_content_at(state: &State, surface: Surface, hit: &Intersection) -> bool {
        let Some(index) = image_index(surface) else { return true };
        let Some((width, height, alpha)) = &state.input.images[index] else { return true };
        let (x, y) = layout::uv_to_pixel(hit.uv.0, hit.uv.1, *width, *height);
        let (w, h) = (i64::from(*width), i64::from(*height));
        for py in (y - HIT_MARGIN_PX).max(0)..=(y + HIT_MARGIN_PX).min(h - 1) {
            for px in (x - HIT_MARGIN_PX).max(0)..=(x + HIT_MARGIN_PX).min(w - 1) {
                if alpha[(py * w + px) as usize] > 0 {
                    return true;
                }
            }
        }
        false
    }

    /// Whether a hit on a VR page region lies within what it shows (`hitInsideRegion`); SteamVR's
    /// own test spills over the edge of a cut-out texture.
    fn hit_inside_region(state: &mut State, target: Target, hit: &Intersection, pose_of: PoseOf) -> bool {
        let Some(region) = target.region() else { return true };
        let Some(pose) = Self::target_world_pose(state, target, pose_of) else { return true };
        let Some(inverse) = math::inverse(&pose) else { return true };
        let local = math::transform_point(&inverse, hit.point);
        let (_, _, w, h) = state.layout.region(region);
        let width_m = Self::region_width(state, target);
        let height_m = width_m * f64::from(h) / f64::from(w);
        let margin = 0.001;
        local[0].abs() <= width_m / 2.0 + margin && local[1].abs() <= height_m / 2.0 + margin
    }

    fn is_visible(state: &State, surface: Surface) -> bool {
        let settings = &state.settings[surface.index()];
        settings.opacity > 0.0 && timing::subtitle_visible(settings.fadeout_duration, state.fade[surface.index()])
    }

    /// The nearest window the laser hits (`pointingOverlay`). Faded-out subtitles count (the grip
    /// wakes them); hidden windows, a launcher not taking presses and transparent parts do not.
    fn pointing_overlay(&self, state: &mut State, ray: &Mat4, pose_of: PoseOf) -> Option<(Target, Intersection)> {
        let mut best: Option<(Target, Intersection)> = None;
        for surface in Surface::ALL {
            if state.settings[surface.index()].opacity <= 0.0 || state.vr_windows_hidden.contains(&surface) {
                continue;
            }
            if surface == Surface::Launcher && !state.launcher.interactive {
                continue;
            }
            let Some(&handle) = state.handles.get(&surface) else { continue };
            let Some(hit) = Self::intersect_handle(state, handle, ray) else { continue };
            if !Self::has_content_at(state, surface, &hit) || !Self::hit_inside_region(state, Target::Window(surface), &hit, pose_of) {
                continue;
            }
            if best.as_ref().is_none_or(|(_, b)| hit.distance < b.distance) {
                best = Some((Target::Window(surface), hit));
            }
        }
        best
    }

    fn intersect_toolbar(&self, state: &mut State, ray: &Mat4) -> Option<Intersection> {
        let handle = state.input.toolbar_handle?;
        if !state.input.toolbar.visible {
            return None;
        }
        Self::intersect_handle(state, handle, ray)
    }

    /// Lifts a faded subtitle back (`wakeOverlay`).
    fn wake(&self, state: &mut State, surface: Surface) {
        let index = surface.index();
        state.last_update[index] = std::time::Instant::now();
        state.fade[index] = 1.0;
        let opacity = state.settings[index].opacity;
        let _ = self.set_alpha(state, surface, opacity);
    }

    // ---- the page's mouse --------------------------------------------------------------

    fn send_pointer(&self, state: &State, input: PointerInput) {
        if let (Some(surface), Some(window)) = (self.shared.options.surface.as_ref(), state.panel_window) {
            surface.pointer(window, input);
        }
    }

    /// Lets go outside the page, so a trigger held back onto it is not a new press
    /// (`cancelPanelInput`).
    fn cancel_panel_input(&self, state: &mut State, hand: Device) {
        let (pressed, xy) = state.input.panel_input.remove(&hand).unwrap_or((false, None));
        if pressed {
            state.input.trigger_blocked.insert(hand);
        }
        if xy.is_some() && state.panel_window.is_some() {
            let (x, y) = OUTSIDE;
            self.send_pointer(state, PointerInput::Move { x, y, pressed });
            if pressed {
                self.send_pointer(state, PointerInput::Up { x, y });
            }
        }
    }

    pub(super) fn cancel_panel_inputs(&self, state: &mut State) {
        let hands: Vec<Device> = state.input.panel_input.keys().copied().collect();
        for hand in hands {
            self.cancel_panel_input(state, hand);
        }
        self.notify_pointer(state, None);
    }

    /// The trigger clicks and the stick scrolls where the laser is on the page (`handlePanelInput`);
    /// `xy` is the captured picture's pixel, `None` off the page.
    fn handle_panel_input(&self, state: &mut State, hand: Device, xy: Option<(i64, i64)>, controller: Option<ControllerState>) {
        let (last_pressed, last_xy) = state.input.panel_input.get(&hand).copied().unwrap_or((false, None));
        let Some(controller) = controller.filter(|_| state.panel_window.is_some() && state.panel_image_size.is_some()) else {
            self.cancel_panel_input(state, hand);
            return;
        };
        let mut pressed = controller.trigger();
        if state.input.trigger_blocked.contains(&hand) {
            if pressed {
                pressed = false;
            } else {
                state.input.trigger_blocked.remove(&hand);
            }
        }
        let Some((x, y)) = xy else {
            // Off the page, also while pressed: let go outside, so the press is no click
            // (no microphone turned on by mistake), and the hover ends.
            self.cancel_panel_input(state, hand);
            return;
        };
        if xy != last_xy {
            self.send_pointer(state, PointerInput::Move { x, y, pressed });
        }
        if pressed && !last_pressed {
            self.send_pointer(state, PointerInput::Down { x, y });
        } else if last_pressed && !pressed {
            self.send_pointer(state, PointerInput::Up { x, y });
        }
        let stick = controller.axis.1;
        if stick.abs() > PANEL_SCROLL_DEADZONE {
            self.send_pointer(state, PointerInput::Wheel { x, y, delta: (PANEL_SCROLL_PER_FRAME * stick) as i64 });
        }
        state.input.panel_input.insert(hand, (pressed, xy));
    }

    /// Tells the UI where the pointer is when it moved enough (`notifyPointer`).
    fn notify_pointer(&self, state: &mut State, xy: Option<(i64, i64)>) {
        let last = state.input.pointer_notified;
        let small = match (xy, last) {
            (Some(a), Some(b)) => (a.0 - b.0).abs() < POINTER_NOTIFY_MIN_MOVE_PX && (a.1 - b.1).abs() < POINTER_NOTIFY_MIN_MOVE_PX,
            _ => false,
        };
        if xy == last || small {
            return;
        }
        state.input.pointer_notified = xy;
        // The tooltip is matched against the position told, as `updateTooltip` does.
        if state.tooltip_state.is_some() && !Self::tooltip_target_matches(state, xy) {
            self.reset_tooltip_epoch(state, true);
        }
        state.events.push(Event::Pointer(xy));
    }

    // ---- corners -------------------------------------------------------------------------

    /// The log's corner the laser points at, with the hit on the log's plane (`panelCornerAt`).
    /// Not while locked, hidden, faded, being resized into, or on the pointing hand.
    fn panel_corner_at(state: &mut State, hand: Device, ray: &Mat4, pose_of: PoseOf) -> Option<((i8, i8), (Vec3, Vec3))> {
        if !state.handles.contains_key(&Surface::Panel) || state.vr_windows_hidden.contains(&Surface::Panel) || !state.vr_panel_enabled {
            return None;
        }
        if state.panel_locked || state.layout_applied != Some(state.layout) || !Self::is_visible(state, Surface::Panel) {
            return None;
        }
        let name = state.settings[Surface::Panel.index()].tracker.clone();
        if Self::tracker(state, &name).1 == Some(hand) {
            return None;
        }
        let pose = Self::world_pose(state, Surface::Panel, pose_of)?;
        let hit = pose::ray_plane_hit(ray, &pose)?;
        let (_, _, width_px, height_px) = state.layout.panel;
        let m_per_px = state.settings[Surface::Panel.index()].ui_scaling / f64::from(width_px);
        let (half_w, half_h) = (f64::from(width_px) * m_per_px / 2.0, f64::from(height_px) * m_per_px / 2.0);
        let (inside, outside) = (CORNER_INSIDE_PX * m_per_px, CORNER_OUTSIDE_PX * m_per_px);
        for sx in [1i8, -1] {
            for sy in [1i8, -1] {
                let dx = f64::from(sx) * hit.x - half_w;
                let dy = f64::from(sy) * hit.y - half_h;
                if !((-inside..=outside).contains(&dx) && (-inside..=outside).contains(&dy)) {
                    continue;
                }
                if (sx, sy) == (1, 1) && dx <= 0.0 && dy <= 0.0 {
                    continue; // The top right inside is the close button.
                }
                return Some(((sx, sy), (hit.point, math::axis(&pose, 2))));
            }
        }
        None
    }

    /// The corner handle's centre on the page (logical px); the top right has none (`cornerHandleXY`).
    fn corner_handle_xy(state: &State, corner: (i8, i8)) -> Option<(i64, i64)> {
        if corner == (1, 1) {
            return None;
        }
        let (_, _, width, height) = state.layout.panel;
        let (width, height) = (i64::from(width), i64::from(height));
        Some((
            if corner.0 < 0 { CORNER_HANDLE_CENTER_PX } else { width - CORNER_HANDLE_CENTER_PX },
            if corner.1 > 0 { CORNER_HANDLE_CENTER_PX } else { height - CORNER_HANDLE_CENTER_PX },
        ))
    }

    /// The opposite corner stays; only the grabbed one moves (`startResize`).
    fn start_resize(&self, state: &mut State, hand: Device, corner: (i8, i8), pose_of: PoseOf, now: f64) -> Result<(), VrError> {
        let name = state.settings[Surface::Panel.index()].tracker.clone();
        let (_, tracker) = Self::tracker(state, &name);
        let (Some(tracker_pose), Some(pose)) = (pose_of(tracker), Self::world_pose(state, Surface::Panel, pose_of)) else {
            return Ok(());
        };
        let Some(inverse) = math::inverse(&tracker_pose) else { return Ok(()) };
        let (_, _, width_px, height_px) = state.layout.panel;
        let m_per_px = state.settings[Surface::Panel.index()].ui_scaling / f64::from(width_px);
        let (sx, sy) = (f64::from(corner.0), f64::from(corner.1));
        state.input.resizing = Some(Resize {
            hand,
            corner,
            m_per_px,
            tracker,
            relative: math::mul(&inverse, &pose),
            pose,
            fixed: (-sx * f64::from(width_px) * m_per_px / 2.0, -sy * f64::from(height_px) * m_per_px / 2.0),
            size: (width_px, height_px),
            center: (0.0, 0.0),
        });
        self.log(&format!("overlay: resizing the log with controller {hand}"));
        let effects = state.input.toolbar.update(now, false, false, true);
        self.apply_toolbar(state, effects)?;
        self.notify_pointer(state, None);
        self.set_highlight(state, Some(Surface::Panel));
        Ok(())
    }

    /// The grabbed corner follows the laser; only the frame moves (`updateResize`).
    fn update_resize(&self, state: &mut State, pose_of: PoseOf, now: f64, controllers: &mut HashMap<Device, Option<ControllerState>>) -> Result<(), VrError> {
        let hand = state.input.resizing.as_ref().expect("resizing").hand;
        let ray = self.ray_of(state, pose_of, hand, now);
        let controller = Self::controller(state, controllers, hand);
        let (Some(ray), true) = (ray, controller.is_some_and(|c| c.grip())) else {
            return self.finish_resize(state);
        };
        let r = state.input.resizing.as_mut().expect("resizing");
        if let Some(tracker_pose) = pose_of(r.tracker) {
            r.pose = math::mul(&tracker_pose, &r.relative);
        }
        let Some(hit) = pose::ray_plane_hit(&ray, &r.pose) else { return Ok(()) };
        let (sx, sy) = (f64::from(r.corner.0), f64::from(r.corner.1));
        let (fixed_x, fixed_y) = r.fixed;
        let wanted = (sx * (hit.x - fixed_x) / r.m_per_px, sy * (hit.y - fixed_y) / r.m_per_px);
        let (width, height) = layout::clamp_panel_size(wanted.0, wanted.1);
        let at_limit = (f64::from(width) - wanted.0).abs() > 1.0 || (f64::from(height) - wanted.1).abs() > 1.0;
        r.size = (width, height);
        r.center = (fixed_x + sx * f64::from(width) * r.m_per_px / 2.0, fixed_y + sy * f64::from(height) * r.m_per_px / 2.0);
        let normal = math::axis(&r.pose, 2);
        self.show_pointer(state, Some((hit.point, normal)), COLOR_POINTER, 1.0, ScaleIcon::Dot);
        self.show_ghost(state, at_limit)
    }

    /// Letting go keeps the size and place and saves them; the overlays switch once the page
    /// was drawn in the new size (`finishResize`).
    fn finish_resize(&self, state: &mut State) -> Result<(), VrError> {
        let Some(r) = state.input.resizing.take() else { return Ok(()) };
        self.set_highlight(state, None);
        self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
        let index = Surface::Panel.index();
        let undo = (state.settings[index].position, state.settings[index].ui_scaling, state.settings[index].tracker.clone());
        // One px keeps its length: a wider log holds more per line at the same text size.
        state.settings[index].ui_scaling = r.m_per_px * f64::from(r.size.0);
        self.set_panel_size(state, f64::from(r.size.0), f64::from(r.size.1));
        let mut center = math::IDENTITY;
        center[0][3] = r.center.0;
        center[1][3] = r.center.1;
        self.commit_position(state, Surface::Panel, &math::to_mat34(&math::mul(&r.relative, &center)));
        let applied = state.layout_applied == Some(state.layout);
        state.input.resize_undo = (!applied).then_some(undo);
        self.log(&format!("overlay: resized the log to {}x{}", r.size.0, r.size.1));
        if applied {
            self.hide_ghost(state);
        }
        Ok(())
    }

    fn show_ghost(&self, state: &mut State, at_limit: bool) -> Result<(), VrError> {
        let Some(ghost) = state.input.ghost_handle else { return Ok(()) };
        let r = state.input.resizing.as_ref().expect("resizing");
        let (size, center, pose, m_per_px) = (r.size, r.center, r.pose, r.m_per_px);
        let key = (size.0 / 4, size.1 / 4, at_limit);
        if state.input.ghost_key != Some(key) {
            state.input.ghost_key = Some(key);
            let (pixels, w, h) = ghost_image(size.0, size.1, at_limit);
            let session = state.session.as_mut().expect("connected");
            let texture = session.set_shared_texture(TextureSlot::Ghost, &[ghost], &pixels, w, h, GHOST_TEXTURE_SIZE)?;
            let bounds = [0.0, 1.0, w as f32 / texture.0 as f32, 1.0 - h as f32 / texture.1 as f32];
            self.submit(state, ghost, "bounds", format!("{bounds:?}"), |s| s.set_texture_bounds(ghost, bounds))?;
        }
        let mut offset = math::IDENTITY;
        offset[0][3] = center.0;
        offset[1][3] = center.1;
        offset[2][3] = GHOST_FRONT_M;
        let placed = math::to_mat34(&math::mul(&pose, &offset));
        self.set_transform(state, ghost, None, &placed)?;
        let width = f64::from(size.0) * m_per_px;
        self.submit(state, ghost, "width", format!("{width}"), |s| s.set_width(ghost, width as f32))?;
        self.submit(state, ghost, "visibility", "show".into(), |s| s.show(ghost))
    }

    // ---- the tick ---------------------------------------------------------------------------

    fn controller(state: &mut State, cache: &mut HashMap<Device, Option<ControllerState>>, device: Device) -> Option<ControllerState> {
        *cache.entry(device).or_insert_with(|| state.session.as_mut().and_then(|s| s.controller_state(device)))
    }

    /// An error in the controller handling ends what it was doing, once logged (`onGrabError`).
    pub(super) fn on_input_error(&self, state: &mut State, error: &VrError) {
        self.cancel_panel_inputs(state);
        state.input.grabbing = None;
        if state.input.resizing.take().is_some() {
            self.hide_ghost(state);
        }
        self.set_highlight(state, None);
        self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
        let text = error.to_string();
        if state.input.error.as_ref() != Some(&text) {
            self.log(&format!("overlay: the controllers' handling failed: {text}"));
            state.input.error = Some(text);
        }
    }

    /// The controllers' part of a tick (`updateGrab` after the windows and the launcher).
    pub(super) fn update_input(&self, state: &mut State, pose_of: PoseOf, now: f64) -> Result<(), VrError> {
        let effects = state.input.toolbar.fade(now);
        self.apply_toolbar(state, effects)?;
        let mut controllers: HashMap<Device, Option<ControllerState>> = HashMap::new();
        // While holding or resizing no hand uses the page. A hand that lost tracking lets go
        // outside the page first (a tick without input is not a released trigger).
        let hands: Vec<Device> = state.input.panel_input.keys().copied().collect();
        for hand in hands {
            let manipulating = state.input.resizing.is_some() || state.input.grabbing.is_some();
            if manipulating || pose_of(Some(hand)).is_none() {
                self.cancel_panel_input(state, hand);
            } else if Self::controller(state, &mut controllers, hand).is_none_or(|c| c.grip()) {
                self.cancel_panel_input(state, hand);
            }
        }
        if state.input.resizing.is_some() {
            return self.update_resize(state, pose_of, now, &mut controllers);
        }
        if state.input.grabbing.is_some() {
            return self.update_grab(state, pose_of, now, &mut controllers);
        }
        self.update_pointing(state, pose_of, now, &mut controllers)
    }

    fn update_grab(&self, state: &mut State, pose_of: PoseOf, now: f64, controllers: &mut HashMap<Device, Option<ControllerState>>) -> Result<(), VrError> {
        let (surface, hand) = {
            let grab = state.input.grabbing.as_ref().expect("grabbing");
            (grab.surface, grab.hand)
        };
        let ray = self.ray_of(state, pose_of, hand, now);
        let name = state.settings[surface.index()].tracker.clone();
        let (_, tracker) = Self::tracker(state, &name);
        let tracker_pose = pose_of(tracker);
        let (Some(hand_pose), Some(tracker_pose)) = (ray, tracker_pose) else {
            // Tracking lost (asleep, switched off): letting go cannot be seen either, so the
            // window stays where it was last shown.
            let grab = state.input.grabbing.take().expect("grabbing");
            self.set_highlight(state, None);
            self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
            self.log(&format!("overlay: controller {hand} lost; the {} stays where it was", surface.key()));
            if let Some(relative) = grab.last_relative {
                self.commit_position(state, surface, &relative);
            }
            return Ok(());
        };
        let Some(tracker_inverse) = math::inverse(&tracker_pose) else { return Ok(()) };
        self.notify_pointer(state, None);
        let controller = Self::controller(state, controllers, hand);
        let grip = controller.is_some_and(|c| c.grip());
        let trigger = controller.is_some_and(|c| c.trigger());
        state.input.grip_prev.insert(hand, grip);
        let stick = controller.map(|c| c.axis);
        let head = pose_of(Some(HMD));
        if grip && trigger {
            return self.update_grab_scale(state, surface, &hand_pose, &tracker_pose, tracker, now);
        }
        let grab = state.input.grabbing.as_mut().expect("grabbing");
        if let Some(scale) = grab.scale.take() {
            // Scaling ended: hold the window from where the hand is now.
            if let Some(inverse) = math::inverse(&hand_pose) {
                grab.hand_to_overlay = math::mul(&inverse, &scale.overlay);
            }
            if grab.radius.is_some()
                && let Some(head) = head
            {
                grab.radius = Some(math::norm(math::sub(math::translation(&scale.overlay), math::translation(&head))));
                grab.hand_distance = math::norm(math::sub(math::translation(&hand_pose), math::translation(&head)));
            }
            self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
        }
        let grab = state.input.grabbing.as_mut().expect("grabbing");
        // A pause in the loop must not make it jump.
        let dt = (now - grab.prev_time).clamp(0.0, 0.1);
        grab.prev_time = now;
        let on_sphere = grab.radius.is_some() && head.is_some();
        // The head lost for a moment: it cannot be placed on the sphere, so it stays.
        let lost_head = grab.radius.is_some() && head.is_none() && grab.last_relative.is_some();
        if grip && on_sphere {
            grab.radius = grab.radius.map(|r| pose::push_pull_distance(r, stick, dt));
        } else if grip && !lost_head {
            grab.hand_to_overlay = pose::push_pull(&grab.hand_to_overlay, stick, dt);
        }
        let relative = if lost_head {
            grab.last_relative.expect("checked")
        } else {
            let mut world = math::mul(&hand_pose, &grab.hand_to_overlay);
            if let (true, Some(head)) = (on_sphere, head) {
                let hand_distance = math::norm(math::sub(math::translation(&hand_pose), math::translation(&head)));
                let radius = pose::sphere_radius(grab.radius.expect("on the sphere"), grab.hand_distance, hand_distance);
                world = pose::pose_on_sphere(math::translation(&world), &head, radius);
            }
            let mut relative = grab.smoother.step(&math::to_mat34(&math::mul(&tracker_inverse, &world)), dt);
            if let (true, Some(head)) = (on_sphere, head) {
                // Smoothed and a little behind, it still faces the head.
                let smoothed = math::translation(&math::mul(&tracker_pose, &math::to_homogeneous(&relative)));
                relative = math::to_mat34(&math::mul(&tracker_inverse, &pose::face_head(smoothed, &head)));
            }
            relative
        };
        grab.last_relative = Some(relative);
        let started = grab.started;
        if grip {
            self.set_window_transform(state, surface, tracker, &relative)?;
            self.wake(state, surface); // No fade while held.
            let pop = ((now - started) / GRAB_POP_SEC).min(1.0);
            let handle = state.handles[&surface];
            let hit = Self::intersect_handle(state, handle, &hand_pose).map(|h| (h.point, h.normal));
            self.show_pointer(state, hit, COLOR_POINTER, 1.0 + (GRAB_POP_SCALE - 1.0) * pop, ScaleIcon::Dot);
        } else {
            state.input.grabbing = None;
            self.set_highlight(state, None);
            self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot);
            if trigger {
                state.input.trigger_blocked.insert(hand);
            }
            // Where it was smoothed to, so it does not jump on release.
            self.set_window_transform(state, surface, tracker, &relative)?;
            self.log(&format!("overlay: let go of the {}", surface.key()));
            self.commit_position(state, surface, &relative);
        }
        Ok(())
    }

    /// Held with the trigger: the window stays and the hand's push scales it (`updateGrabScale`).
    fn update_grab_scale(&self, state: &mut State, surface: Surface, hand_pose: &Mat4, tracker_pose: &Mat4, tracker: Option<Device>, now: f64) -> Result<(), VrError> {
        let index = surface.index();
        let ui_scaling = state.settings[index].ui_scaling;
        let grab = state.input.grabbing.as_mut().expect("grabbing");
        grab.prev_time = now;
        grab.smoother.reset();
        if grab.scale.is_none() {
            let Some(last) = grab.last_relative else { return Ok(()) };
            grab.scale = Some(GrabScale {
                start: math::translation(hand_pose),
                forward: math::neg(math::axis(hand_pose, 2)),
                width: ui_scaling,
                overlay: math::mul(tracker_pose, &math::to_homogeneous(&last)),
            });
        }
        let scale = grab.scale.as_ref().expect("made above");
        let pushed = math::dot(math::sub(math::translation(hand_pose), scale.start), scale.forward);
        let (width, icon) = pose::grab_scale(scale.width, pushed);
        let Some(inverse) = math::inverse(tracker_pose) else { return Ok(()) };
        let relative = math::to_mat34(&math::mul(&inverse, &scale.overlay));
        grab.last_relative = Some(relative);
        state.settings[index].ui_scaling = width;
        self.apply_width(state, surface)?;
        self.set_window_transform(state, surface, tracker, &relative)?;
        self.wake(state, surface);
        let handle = state.handles[&surface];
        let hit = Self::intersect_handle(state, handle, hand_pose).map(|h| (h.point, h.normal));
        self.show_pointer(state, hit, COLOR_POINTER, 1.0, icon);
        Ok(())
    }

    /// Nothing held: each hand points, presses on the page, or grabs (`updateGrab`'s last part).
    fn update_pointing(&self, state: &mut State, pose_of: PoseOf, now: f64, controllers: &mut HashMap<Device, Option<ControllerState>>) -> Result<(), VrError> {
        let mut pointer: Option<((Vec3, Vec3), [f32; 3])> = None;
        let mut hover: Option<(i64, i64)> = None;
        let mut pointing_log = false;
        let mut pointing_launcher = false;
        for side in [Hand::Left, Hand::Right] {
            let hand = state.session.as_mut().map_or(crate::runtime::INVALID_DEVICE, |s| s.hand(side));
            let ray = if hand == crate::runtime::INVALID_DEVICE { None } else { self.ray_of(state, pose_of, hand, now) };
            let controller = if ray.is_some() { Self::controller(state, controllers, hand) } else { None };
            let grip = ray.is_some() && controller.is_some_and(|c| c.grip());
            let mut found = match ray.as_ref() {
                Some(ray) => self.pointing_overlay(state, ray, pose_of),
                None => None,
            };
            if let Some(ray) = ray.as_ref()
                && let Some(toolbar) = self.intersect_toolbar(state, ray)
                && Self::hit_inside_region(state, Target::Toolbar, &toolbar, pose_of)
                && found.as_ref().is_none_or(|(_, hit)| toolbar.distance < hit.distance)
            {
                found = Some((Target::Toolbar, toolbar));
            }
            // A window on this hand moves with it; this hand cannot move it (the toolbar is the log's).
            if let Some((target, _)) = found {
                let owner = match target {
                    Target::Toolbar => Surface::Panel,
                    Target::Window(surface) => surface,
                };
                let name = state.settings[owner.index()].tracker.clone();
                if Self::tracker(state, &name).1 == Some(hand) {
                    found = None;
                }
            }
            let target = found.map(|(t, _)| t);
            pointing_log |= matches!(target, Some(Target::Window(Surface::Panel) | Target::Toolbar));
            let corner = match ray.as_ref() {
                // Another window in front of the log (the toolbar on its plane) wins over a corner.
                Some(ray) if matches!(target, None | Some(Target::Window(Surface::Panel))) => Self::panel_corner_at(state, hand, ray, pose_of),
                _ => None,
            };
            let corner_before = state.input.corner_prev.get(&hand).copied().flatten();
            state.input.corner_prev.insert(hand, corner.map(|(c, _)| c));
            if corner.is_some() {
                pointing_log = true;
            }
            // The corner pointed at last tick first: the laser shakes as the grip closes.
            let grip_corner = corner_before.or(corner.map(|(c, _)| c));
            let grip_prev = state.input.grip_prev.get(&hand).copied().unwrap_or(false);
            if grip && !grip_prev && let Some(grip_corner) = grip_corner {
                state.input.grip_prev.insert(hand, true);
                self.cancel_panel_inputs(state);
                return self.start_resize(state, hand, grip_corner, pose_of, now);
            }
            pointing_launcher |= target == Some(Target::Window(Surface::Launcher));
            let debug = (grip, target);
            if state.input.debug.get(&hand) != Some(&debug) {
                state.input.debug.insert(hand, debug);
                self.log(&format!("overlay grab: hand {hand} grip {grip} hit {}", target.map_or("none", Target::key)));
            }
            if ray.is_some() && !grip {
                let mut xy = None;
                // While the size changes the overlays (old layout) and the page (new) differ: a
                // press could land on another button, so nothing is sent.
                if let (Some((target, hit)), Some(image)) = (found.as_ref(), state.panel_image_size)
                    && let Some(region) = target.region()
                    && state.layout_applied == Some(state.layout)
                    && let Some(pose) = Self::target_world_pose(state, *target, pose_of)
                {
                    let ui_scaling = match target {
                        Target::Window(surface) => state.settings[surface.index()].ui_scaling,
                        Target::Toolbar => 0.0,
                    };
                    xy = layout::region_pixel(&state.layout, region, ui_scaling, image.0, &pose, hit.point);
                }
                // The corner handle gets the hover only (it lights up), no clicks or scrolls.
                self.handle_panel_input(state, hand, if corner.is_some() { None } else { xy }, controller);
                let handle_xy = corner.and_then(|(c, _)| Self::corner_handle_xy(state, c));
                if hover.is_none() {
                    if handle_xy.is_some() {
                        hover = handle_xy;
                    } else if let (Some((x, y)), Some(image)) = (xy, state.panel_image_size) {
                        let scale = f64::from(image.0) / f64::from(state.layout.atlas.0);
                        hover = Some(((x as f64 / scale).round_ties_even() as i64, (y as f64 / scale).round_ties_even() as i64));
                    }
                }
            }
            // On a corner (also outside the log): the pointer shows; the grip resizes (above).
            if let Some((_, hit)) = corner
                && target != Some(Target::Toolbar)
            {
                state.input.grip_prev.insert(hand, grip);
                pointer.get_or_insert((hit, COLOR_POINTER));
                continue;
            }
            // The toolbar cannot be held (it moves with the log); its buttons are page clicks.
            if let Some((Target::Toolbar, hit)) = found.as_ref() {
                state.input.grip_prev.insert(hand, grip);
                pointer.get_or_insert(((hit.point, hit.normal), COLOR_POINTER));
                continue;
            }
            let grip_pressed_now = grip && !grip_prev;
            state.input.grip_prev.insert(hand, grip);
            let Some((Target::Window(surface), hit)) = found else { continue };
            if !grip_pressed_now {
                if !grip && Self::is_visible(state, surface) {
                    pointer.get_or_insert(((hit.point, hit.normal), COLOR_POINTER));
                }
                continue;
            }
            if surface == Surface::Panel && state.panel_locked {
                continue;
            }
            let Some(overlay_pose) = Self::world_pose(state, surface, pose_of) else { continue };
            let (Some(hand_pose), Some(inverse)) = (ray, ray.as_ref().and_then(math::inverse)) else { continue };
            self.wake(state, surface); // A faded subtitle wakes up on the grip.
            self.cancel_panel_inputs(state);
            let head = pose_of(Some(HMD));
            let name = state.settings[surface.index()].tracker.clone();
            let on_sphere = matches!(name.as_str(), "Playspace" | "HMD") && head.is_some();
            let eyes = |p: &Mat4| head.map_or(0.0, |head| math::norm(math::sub(math::translation(p), math::translation(&head))));
            state.input.grabbing = Some(Grab {
                surface,
                hand,
                hand_to_overlay: math::mul(&inverse, &overlay_pose),
                started: now,
                prev_time: now,
                smoother: GrabSmoother::default(),
                radius: on_sphere.then(|| eyes(&overlay_pose)),
                hand_distance: if on_sphere { eyes(&hand_pose) } else { 1.0 },
                last_relative: None,
                scale: None,
            });
            self.log(&format!("overlay: controller {hand} grabbed the {}", surface.key()));
            self.show_pointer(state, Some((hit.point, hit.normal)), COLOR_POINTER, 1.0, ScaleIcon::Dot);
            self.set_highlight(state, Some(surface));
            return Ok(());
        }
        match pointer {
            Some((hit, color)) => self.show_pointer(state, Some(hit), color, 1.0, ScaleIcon::Dot),
            None => self.show_pointer(state, None, COLOR_NORMAL, 1.0, ScaleIcon::Dot),
        }
        self.notify_pointer(state, hover);
        self.update_toolbar(state, now, pointing_log)?;
        state.input.launcher_pointed = pointing_launcher;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pointer_marks_differ_only_by_their_lines() {
        let (dot, plus, minus) = (pointer_image(ScaleIcon::Dot), pointer_image(ScaleIcon::Plus), pointer_image(ScaleIcon::Minus));
        let at = |image: &[u8], x: usize, y: usize| image[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4].to_vec();
        assert_eq!(at(&dot, 32, 32), [255, 255, 255, 255]);
        assert_eq!(at(&minus, 32, 32), [0, 0, 0, 255]);
        assert_eq!(at(&minus, 32, 22), [255, 255, 255, 255], "no vertical line");
        assert_eq!(at(&plus, 32, 22), [0, 0, 0, 255]);
        assert_eq!(at(&dot, 0, 0), [0, 0, 0, 0], "transparent outside the circle");
    }

    #[test]
    fn the_resize_frame_is_a_quarter_size_with_its_limit_colour() {
        let (pixels, w, h) = ghost_image(1400, 1000, true);
        assert_eq!((w, h), (350, 250));
        let at = |x: u32, y: u32| pixels[((y * w + x) * 4) as usize..((y * w + x) * 4 + 4) as usize].to_vec();
        assert_eq!(at(175, 2), [GHOST_LIMIT_COLOR[2], GHOST_LIMIT_COLOR[1], GHOST_LIMIT_COLOR[0], 255], "the outline");
        assert_eq!(at(175, 125)[3], GHOST_FILL[3], "the faint fill");
        assert_eq!(ghost_image(16, 16, false).1, 8, "never under 8 px");
    }
}
