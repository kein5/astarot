//! The controllers on the VR panel, headless: a stand-in SteamVR with controller poses and
//! buttons, and a stand-in VR page that records the mouse input it gets. The overlay thread runs
//! in real time, so each step waits for its effect.

use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use astarot_vr_overlay::engine::{Event, Options, Overlay, Surface, WindowSettings};
use astarot_vr_overlay::layout::VrLayout;
use astarot_vr_overlay::math::{self, Mat4, Tracker};
use astarot_vr_overlay::pose;
use astarot_vr_overlay::runtime::fake::FakeVr;
use astarot_vr_overlay::runtime::{ControllerState, Device, GRIP_MASK, TRIGGER_MASK};
use astarot_vr_overlay::surface::{Frame, OUTSIDE, PanelSurface, PointerInput};
use astarot_vr_overlay::tooltip::{Tooltip, TooltipMode, TooltipParent, TooltipShape};

const RIGHT: Device = 2;
const PANEL_WIDTH_M: f64 = 0.4;

/// The VR page: a dark picture of the size last asked for, with a tooltip marker when set.
#[derive(Default)]
struct Page {
    size: Mutex<(u32, u32)>,
    inputs: Mutex<Vec<PointerInput>>,
    marker: Mutex<Option<u128>>,
}

impl PanelSurface for Page {
    fn available(&self) -> bool {
        true
    }
    fn find(&self) -> Option<u64> {
        Some(7)
    }
    fn alive(&self, window: u64) -> bool {
        window == 7
    }
    fn capture(&self, _window: u64) -> Option<Frame> {
        let (width, height) = *self.size.lock().unwrap();
        if width == 0 {
            return None;
        }
        let mut bgra = vec![40u8; (width * height * 4) as usize];
        if let Some(bits) = *self.marker.lock().unwrap() {
            // The tooltip region's marker row (80 cells of 4x8 px, see `tooltip::marker_matches`).
            let layout = VrLayout::for_panel(900, 700);
            let (x0, y0, _, _) = layout.tooltip;
            for index in 0..80u32 {
                let on = (bits >> (79 - index)) & 1 == 1;
                for y in y0..y0 + 8 {
                    for x in x0 + index * 4..x0 + index * 4 + 4 {
                        let at = ((y * width + x) * 4) as usize;
                        bgra[at..at + 3].fill(if on { 255 } else { 0 });
                    }
                }
            }
        }
        Some(Frame { bgra, width, height })
    }
    fn resize(&self, _window: u64, width: u32, height: u32) -> (u32, u32) {
        *self.size.lock().unwrap() = (width, height);
        (width, height)
    }
    fn pointer(&self, _window: u64, input: PointerInput) {
        self.inputs.lock().unwrap().push(input);
    }
}

struct Rig {
    vr: FakeVr,
    page: Arc<Page>,
    overlay: Overlay,
    events: Arc<Mutex<Vec<Event>>>,
}

fn window(tracker: &str, position: [f64; 6], ui_scaling: f64) -> WindowSettings {
    WindowSettings {
        position,
        tracker: tracker.into(),
        display_duration: 5.0,
        fadeout_duration: 0.0,
        opacity: 1.0,
        ui_scaling,
        size: None,
    }
}

impl Rig {
    /// SteamVR with the headset at the origin looking down -Z, the log fixed 1 m in front of it
    /// and shown, and the right controller tracked with nothing pressed.
    fn start() -> Self {
        let vr = FakeVr::running();
        let page = Arc::new(Page::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let far = [0.0, 10.0, 1.0, 0.0, 0.0, 0.0];
        let settings = [
            window("HMD", far, 1.0),
            window("HMD", far, 0.25),
            window("Playspace", [0.0, 0.0, 1.0, 0.0, 0.0, 0.0], PANEL_WIDTH_M),
            window("LeftHand", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 0.303),
            window("Playspace", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 0.36),
        ];
        let overlay = Overlay::new(Options {
            vr: Arc::new(vr.clone()),
            surface: Some(Arc::clone(&page) as Arc<dyn PanelSurface>),
            settings: settings.clone(),
            launcher_defaults: settings[3].clone(),
            events: Arc::new(move |e| sink.lock().unwrap().push(e)),
            log: Arc::new(|_| {}),
            steamvr_poll: Duration::from_millis(20),
        });
        vr.set_pose(RIGHT, None);
        vr.set_controller(RIGHT, Some(ControllerState::default()));
        let rig = Self { vr, page, overlay, events };
        rig.overlay.start();
        rig.overlay.set_vr_windows(true, false);
        rig.wait("the log shown", || rig.handle("ASTAROT2").is_some_and(|h| rig.vr.with(|s| s.visible.contains(&h) && s.bounds.contains_key(&h))));
        rig
    }

    fn handle(&self, key: &str) -> Option<u64> {
        self.vr.handle(key)
    }

    fn wait(&self, what: &str, ok: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ok() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn panel_pose(&self) -> Mat4 {
        let panel = self.overlay.window(Surface::Panel);
        math::to_homogeneous(&math::relative_pose(Tracker::from_setting(&panel.tracker), panel.position))
    }

    /// Holds the right controller `distance` in front of the log's point (x, y) (m from its
    /// centre), its laser (12 degrees up from the tip) on that point.
    fn aim(&self, x: f64, y: f64, distance: f64) {
        let mut offset = math::IDENTITY;
        offset[0][3] = x;
        offset[1][3] = y;
        offset[2][3] = distance;
        let ray = math::mul(&self.panel_pose(), &offset);
        let untilt = math::inverse(&pose::laser_tilt(pose::LASER_PITCH_UP_DEG)).unwrap();
        self.vr.set_pose(RIGHT, Some(math::mul(&ray, &untilt)));
    }

    /// Sets the right controller's buttons and waits until the overlay's loop has read them a
    /// few times, so the next step does not race the loop on a loaded machine.
    fn press(&self, buttons: u64, stick: f64) {
        self.vr.set_controller(RIGHT, Some(ControllerState { pressed: buttons, axis: (0.0, stick) }));
        let start = self.vr.with(|s| s.controller_reads);
        self.wait("the loop read the buttons", || self.vr.with(|s| s.controller_reads) >= start + 4);
    }

    fn inputs(&self) -> Vec<PointerInput> {
        self.page.inputs.lock().unwrap().clone()
    }

    fn events(&self) -> Vec<Event> {
        self.events.lock().unwrap().clone()
    }

    fn pointers(&self) -> Vec<Option<(i64, i64)>> {
        self.events().into_iter().filter_map(|e| if let Event::Pointer(p) = e { Some(p) } else { None }).collect()
    }

    fn positions(&self, surface: Surface) -> Vec<Value> {
        self.events().into_iter().filter_map(|e| match e {
            Event::Position(s, value) if s == surface => Some(value),
            _ => None,
        }).collect()
    }

    fn color(&self, key: &str) -> Option<[f32; 3]> {
        let handle = self.handle(key)?;
        self.vr.with(|s| s.colors.get(&handle).copied())
    }

    fn visible(&self, key: &str) -> bool {
        self.handle(key).is_some_and(|h| self.vr.with(|s| s.visible.contains(&h)))
    }

    /// The log's picture pixel for its point (x, y) (m from its centre), as the page sees it.
    fn pixel(&self, x: f64, y: f64) -> (i64, i64) {
        let (w, h) = (900.0, 700.0);
        let height_m = PANEL_WIDTH_M * h / w;
        (((x / PANEL_WIDTH_M + 0.5) * w) as i64, ((0.5 - y / height_m) * h) as i64)
    }

    fn stop(self) {
        self.overlay.shutdown();
        assert_eq!(self.vr.with(|s| s.sessions_open), 0);
    }
}

#[test]
fn the_laser_hovers_clicks_and_scrolls_the_page() {
    let rig = Rig::start();
    rig.aim(0.1, 0.05, 0.6);
    let xy = rig.pixel(0.1, 0.05);
    rig.wait("the hover position", || rig.pointers().contains(&Some(xy)));
    assert!(rig.inputs().contains(&PointerInput::Move { x: xy.0, y: xy.1, pressed: false }));
    assert!(rig.visible("ASTAROT_pointer_dot"), "the pointer shows where the laser hits");

    rig.press(TRIGGER_MASK, 0.0);
    rig.wait("pressed", || rig.inputs().contains(&PointerInput::Down { x: xy.0, y: xy.1 }));
    rig.press(0, 0.0);
    rig.wait("released", || rig.inputs().contains(&PointerInput::Up { x: xy.0, y: xy.1 }));

    rig.press(0, 0.8);
    rig.wait("scrolled", || rig.inputs().contains(&PointerInput::Wheel { x: xy.0, y: xy.1, delta: 48 }));
    rig.press(0, 0.1);

    // Pressed, then off the page: it lets go outside, so the press is no click.
    rig.press(TRIGGER_MASK, 0.0);
    rig.wait("pressed again", || rig.inputs().iter().filter(|i| matches!(i, PointerInput::Down { .. })).count() == 2);
    rig.aim(2.0, 0.0, 0.6);
    let (x, y) = OUTSIDE;
    rig.wait("let go outside", || rig.inputs().ends_with(&[PointerInput::Move { x, y, pressed: true }, PointerInput::Up { x, y }]));
    rig.wait("the hover ends", || rig.pointers().last() == Some(&None));
    // Back on the page with the trigger still held: no new press until it is released.
    let downs = rig.inputs().iter().filter(|i| matches!(i, PointerInput::Down { .. })).count();
    rig.aim(0.1, 0.05, 0.6);
    rig.wait("hovering again", || rig.pointers().last() == Some(&Some(xy)));
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(rig.inputs().iter().filter(|i| matches!(i, PointerInput::Down { .. })).count(), downs);
    rig.stop();
}

#[test]
fn a_grabbed_log_follows_the_hand_and_its_place_is_saved() {
    let rig = Rig::start();
    rig.aim(0.0, 0.0, 0.6);
    rig.wait("pointing", || rig.pointers().iter().any(Option::is_some));
    rig.press(GRIP_MASK, 0.0);
    rig.wait("held (tinted)", || rig.color("ASTAROT2").is_some_and(|c| c != [1.0, 1.0, 1.0]));
    // The hover ends on the tick after the grab.
    rig.wait("no hover while held", || rig.pointers().last() == Some(&None));
    // The hand moves up 20 cm.
    let mut moved = rig.vr.with(|s| s.poses[RIGHT as usize]).unwrap();
    moved[1][3] += 0.2;
    rig.vr.set_pose(RIGHT, Some(moved));
    std::thread::sleep(Duration::from_millis(200));
    assert!(rig.positions(Surface::Panel).is_empty(), "saved only when let go");
    rig.press(0, 0.0);
    rig.wait("let go", || !rig.positions(Surface::Panel).is_empty());
    let saved = rig.positions(Surface::Panel)[0].clone();
    assert_eq!(saved["tracker"], "Playspace");
    assert!(saved["y_pos"].as_f64().unwrap() > 0.1, "moved up: {saved}");
    assert_eq!(rig.color("ASTAROT2"), Some([1.0, 1.0, 1.0]), "the tint is gone");
    assert_eq!(rig.overlay.window(Surface::Panel).position[1], saved["y_pos"].as_f64().unwrap());
    rig.stop();
}

#[test]
fn a_locked_log_cannot_be_grabbed() {
    let rig = Rig::start();
    rig.overlay.set_panel_locked(true);
    rig.aim(0.0, 0.0, 0.6);
    rig.wait("pointing", || rig.pointers().iter().any(Option::is_some));
    rig.press(GRIP_MASK, 0.0);
    std::thread::sleep(Duration::from_millis(200));
    let mut moved = rig.vr.with(|s| s.poses[RIGHT as usize]).unwrap();
    moved[1][3] += 0.2;
    rig.vr.set_pose(RIGHT, Some(moved));
    std::thread::sleep(Duration::from_millis(200));
    rig.press(0, 0.0);
    std::thread::sleep(Duration::from_millis(200));
    assert!(rig.positions(Surface::Panel).is_empty());
    assert_ne!(rig.color("ASTAROT2"), Some([0xB7 as f32 / 255.0, 0xDE as f32 / 255.0, 0xD8 as f32 / 255.0]));
    rig.stop();
}

#[test]
fn the_trigger_with_the_grip_scales_within_its_limits() {
    let rig = Rig::start();
    rig.aim(0.0, 0.0, 0.6);
    rig.wait("pointing", || rig.pointers().iter().any(Option::is_some));
    rig.press(GRIP_MASK, 0.0);
    rig.wait("held", || rig.color("ASTAROT2").is_some_and(|c| c != [1.0, 1.0, 1.0]));
    // A few ticks held with the grip alone first (scaling starts from where it was last shown).
    std::thread::sleep(Duration::from_millis(300));
    rig.press(GRIP_MASK | TRIGGER_MASK, 0.0);
    std::thread::sleep(Duration::from_millis(100));
    // Pushed 15 cm forward: twice as wide; the plus mark shows.
    let start = rig.vr.with(|s| s.poses[RIGHT as usize]).unwrap();
    let forward = math::neg(math::axis(&math::mul(&start, &pose::laser_tilt(pose::LASER_PITCH_UP_DEG)), 2));
    let mut pushed = start;
    math::set_axis(&mut pushed, 3, math::add(math::translation(&start), math::scale(forward, 0.15)));
    rig.vr.set_pose(RIGHT, Some(pushed));
    rig.wait("twice as wide", || (rig.overlay.window(Surface::Panel).ui_scaling - 2.0 * PANEL_WIDTH_M).abs() < 1e-6);
    // Far beyond: no wider than 3 m.
    math::set_axis(&mut pushed, 3, math::add(math::translation(&start), math::scale(forward, 2.0)));
    rig.vr.set_pose(RIGHT, Some(pushed));
    rig.wait("at the limit", || (rig.overlay.window(Surface::Panel).ui_scaling - 3.0).abs() < 1e-9);
    // Letting go of both buttons saves it; the trigger is ignored until released.
    rig.press(TRIGGER_MASK, 0.0);
    rig.wait("saved", || !rig.positions(Surface::Panel).is_empty());
    assert_eq!(rig.positions(Surface::Panel)[0]["ui_scaling"], 3.0);
    assert!(!rig.inputs().iter().any(|i| matches!(i, PointerInput::Down { .. })), "no click from the held trigger");
    rig.stop();
}

#[test]
fn a_corner_resizes_the_log_with_a_frame_until_the_page_takes_the_size() {
    let rig = Rig::start();
    let height_m = PANEL_WIDTH_M * 700.0 / 900.0;
    // The bottom left corner, just inside.
    rig.aim(-PANEL_WIDTH_M / 2.0 + 0.005, -height_m / 2.0 + 0.005, 0.6);
    rig.wait("the corner handle lights up", || rig.pointers().last() == Some(&Some((34, 700 - 34))));
    rig.press(GRIP_MASK, 0.0);
    rig.wait("the frame shows", || rig.visible("ASTAROT_resize_ghost"));
    // Dragged 10 cm left: 1125 px wide, the top right corner stays.
    rig.aim(-PANEL_WIDTH_M / 2.0 - 0.1, -height_m / 2.0, 0.6);
    std::thread::sleep(Duration::from_millis(400));
    rig.press(0, 0.0);
    rig.wait("the new layout", || rig.events().iter().any(|e| matches!(e, Event::Layout(l) if l["regions"]["panel"][2] == 1125)));
    let saved = rig.positions(Surface::Panel).last().cloned().unwrap();
    assert_eq!((saved["width"].as_f64(), saved["height"].as_f64()), (Some(1125.0), Some(700.0)));
    assert!((saved["ui_scaling"].as_f64().unwrap() - PANEL_WIDTH_M * 1125.0 / 900.0).abs() < 1e-9, "one px keeps its length");
    assert!(saved["x_pos"].as_f64().unwrap() < 0.0, "the centre moved left");
    assert!(rig.visible("ASTAROT_resize_ghost"), "until the page is drawn in the new size");
    rig.overlay.set_layout_rendered((1125, 700));
    rig.wait("the frame goes", || !rig.visible("ASTAROT_resize_ghost"));

    // Far beyond the largest size: 1400 x 1000 at most.
    let height_m = saved["ui_scaling"].as_f64().unwrap() * 700.0 / 1125.0;
    let width_m = saved["ui_scaling"].as_f64().unwrap();
    rig.aim(-width_m / 2.0 + 0.005, -height_m / 2.0 + 0.005, 0.6);
    rig.wait("on the corner", || rig.pointers().last() == Some(&Some((34, 700 - 34))));
    rig.press(GRIP_MASK, 0.0);
    rig.wait("the frame shows", || rig.visible("ASTAROT_resize_ghost"));
    rig.aim(-width_m / 2.0 - 3.0, -height_m / 2.0 - 3.0, 0.6);
    std::thread::sleep(Duration::from_millis(400));
    rig.press(0, 0.0);
    rig.wait("the largest layout", || rig.events().iter().any(|e| matches!(e, Event::Layout(l) if l["regions"]["panel"] == serde_json::json!([0, 0, 1400, 1000]))));
    rig.stop();
}

#[test]
fn the_toolbar_shows_under_a_pointed_log_and_its_buttons_are_page_clicks_with_a_hover_tooltip() {
    let rig = Rig::start();
    rig.aim(0.0, 0.0, 0.6);
    rig.wait("the toolbar shows after a while", || rig.visible("ASTAROT_toolbar"));
    // The toolbar's centre: under the log, 12 mm apart.
    let layout = VrLayout::for_panel(900, 700);
    let bar_height_m = 720.0 * 0.4 / 900.0 * 96.0 / 720.0;
    let below = -(PANEL_WIDTH_M * 700.0 / 900.0 / 2.0 + 0.012 + bar_height_m / 2.0);
    rig.aim(0.0, below, 0.6);
    let (bx, by, bw, bh) = layout.toolbar;
    let centre = (i64::from(bx + bw / 2), i64::from(by + bh / 2));
    rig.wait("hovering the toolbar", || rig.pointers().last().copied().flatten().is_some_and(|(x, y)| (x - centre.0).abs() <= 2 && (y - centre.1).abs() <= 2));
    rig.press(TRIGGER_MASK, 0.0);
    rig.wait("a click on the toolbar", || rig.inputs().iter().any(|i| matches!(i, PointerInput::Down { x, y }
        if (i64::from(bx)..i64::from(bx + bw)).contains(x) && (i64::from(by)..i64::from(by + bh)).contains(y))));
    rig.press(0, 0.0);

    // The page asks for a hover tooltip over the button under the laser and draws its marker.
    let epoch = rig.overlay.vr_layout()["tooltip_epoch"].as_u64().unwrap();
    let tooltip = Tooltip {
        epoch,
        revision: 1,
        shown: Some(TooltipShape {
            region: TooltipParent::Toolbar,
            mode: TooltipMode::Hover,
            button: [300.0, 10.0, 120.0, 76.0],
            size: [360.0, 40.0],
            arrow_x: 180.0,
        }),
    };
    *rig.page.marker.lock().unwrap() = Some(tooltip.marker_bits());
    rig.overlay.set_tooltip(tooltip);
    rig.wait("the tooltip shows", || rig.visible("ASTAROT_tooltip"));
    // Off the button: it goes.
    rig.aim(0.15, 0.0, 0.6);
    rig.wait("the tooltip goes", || !rig.visible("ASTAROT_tooltip"));
    rig.stop();
}

#[test]
fn a_lost_controller_lets_go_where_the_window_was_last_shown() {
    let rig = Rig::start();
    rig.aim(0.0, 0.0, 0.6);
    rig.wait("pointing", || rig.pointers().iter().any(Option::is_some));
    rig.press(GRIP_MASK, 0.0);
    rig.wait("held", || rig.color("ASTAROT2").is_some_and(|c| c != [1.0, 1.0, 1.0]));
    let mut moved = rig.vr.with(|s| s.poses[RIGHT as usize]).unwrap();
    moved[0][3] += 0.1;
    rig.vr.set_pose(RIGHT, Some(moved));
    std::thread::sleep(Duration::from_millis(400));
    rig.vr.set_pose(RIGHT, None);
    rig.wait("let go", || !rig.positions(Surface::Panel).is_empty());
    assert!(rig.positions(Surface::Panel)[0]["x_pos"].as_f64().unwrap() > 0.05);
    assert_eq!(rig.color("ASTAROT2"), Some([1.0, 1.0, 1.0]));

    // Pressed on the page, then lost: let go outside.
    rig.aim(0.0, 0.0, 0.6);
    rig.press(TRIGGER_MASK, 0.0);
    rig.wait("pressed", || rig.inputs().iter().any(|i| matches!(i, PointerInput::Down { .. })));
    rig.vr.set_pose(RIGHT, None);
    let (x, y) = OUTSIDE;
    rig.wait("let go outside", || rig.inputs().ends_with(&[PointerInput::Move { x, y, pressed: true }, PointerInput::Up { x, y }]));
    rig.stop();
}
