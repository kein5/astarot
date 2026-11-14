//! How long things stay and how they fade: the subtitle overlays, the launcher on the wrist,
//! the toolbar under the log, and how often the loop and the capture run.
//!
//! Times are seconds on a monotonic clock. Each state machine takes `now` from its caller,
//! so tests can step through time.

/// The launcher shows when its face turns to the head within this angle and sits within the
/// show gaze angle; it hides past the face angle plus the margin or the hide gaze angle.
pub const LAUNCHER_FACE_DEG: f64 = 45.0;
pub const LAUNCHER_GAZE_SHOW_DEG: f64 = 40.0;
pub const LAUNCHER_GAZE_HIDE_DEG: f64 = 45.0;
pub const LAUNCHER_HIDE_MARGIN_DEG: f64 = 10.0;
pub const LAUNCHER_SHOW_AFTER_SEC: f64 = 0.05;
pub const LAUNCHER_HIDE_AFTER_SEC: f64 = 0.3;
pub const LAUNCHER_FADE_SEC: f64 = 0.1;
/// Fresh on screen the launcher ignores presses, so turning the wrist does not press it.
pub const LAUNCHER_INPUT_DELAY_SEC: f64 = 0.2;
/// The longest step the launcher fade takes in one tick.
const LAUNCHER_MAX_DT_SEC: f64 = 0.1;
pub const TOOLBAR_SHOW_AFTER_SEC: f64 = 0.3;
pub const TOOLBAR_HIDE_AFTER_SEC: f64 = 2.0;
pub const TOOLBAR_FADE_SEC: f64 = 0.25;
pub const PANEL_CAPTURE_INTERVAL_SEC: f64 = 1.0 / 20.0;
pub const PANEL_IDLE_CAPTURE_INTERVAL_SEC: f64 = 1.0 / 4.0;
pub const PANEL_ACTIVE_HOLD_SEC: f64 = 1.0;

/// How much of a subtitle overlay's opacity is left (`evaluateOpacityFade`): all of it for
/// `display_duration` seconds after the last update, then falling in a straight line to none
/// over `fadeout_duration`. A zero fade-out keeps it.
pub fn fade_ratio(now: f64, last_update: f64, display_duration: f64, fadeout_duration: f64) -> f64 {
    let elapsed = (now - last_update - display_duration).max(0.0);
    if fadeout_duration != 0.0 {
        (1.0 - elapsed / fadeout_duration).max(0.0)
    } else {
        1.0
    }
}

/// Whether a subtitle overlay can be seen: it never fades, or it has not faded out (`isVisible`).
pub fn subtitle_visible(fadeout_duration: f64, ratio: f64) -> bool {
    fadeout_duration == 0.0 || ratio > 0.0
}

/// One step of `alpha` towards `target` at `1 / fade_sec` per second.
fn approach(alpha: f64, target: f64, dt: f64, fade_sec: f64) -> f64 {
    let step = dt / fade_sec;
    if target > alpha {
        (alpha + step).min(target)
    } else {
        (alpha - step).max(target)
    }
}

/// What the toolbar asks of its overlay.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ToolbarEffect {
    /// Show it at this alpha (it fades in from there).
    Show(f64),
    Alpha(f64),
    /// Faded out, or hidden at once with the log.
    Hide,
    /// It became hidden: the tooltip's generation starts over.
    ResetTooltip,
}

/// The toolbar under the log: shown after the log or the bar has been pointed at for a while,
/// hidden a while after the laser leaves, fading both ways (`updateToolbarVisibility`,
/// `setToolbarVisible`, `updateToolbarFade`, `hideToolbarNow`).
#[derive(Clone, Debug, PartialEq)]
pub struct Toolbar {
    pub visible: bool,
    pub alpha: f64,
    faded_at: Option<f64>,
    pointed_since: Option<f64>,
    last_pointed: f64,
}

impl Default for Toolbar {
    fn default() -> Self {
        Self { visible: false, alpha: 0.0, faded_at: None, pointed_since: None, last_pointed: 0.0 }
    }
}

impl Toolbar {
    /// One tick. `log_shown` is false while the log is closed or the VR page is off;
    /// `can_show` is false while the log's position waits for its tracker.
    pub fn update(&mut self, now: f64, pointing_log: bool, log_shown: bool, can_show: bool) -> Vec<ToolbarEffect> {
        let mut effects = Vec::new();
        if !log_shown {
            self.pointed_since = None;
            self.set_visible(false, can_show, &mut effects);
            if self.alpha > 0.0 {
                self.alpha = 0.0;
                effects.push(ToolbarEffect::Hide);
            }
            return effects;
        }
        if pointing_log {
            let since = *self.pointed_since.get_or_insert(now);
            self.last_pointed = now;
            if now - since >= TOOLBAR_SHOW_AFTER_SEC {
                self.set_visible(true, can_show, &mut effects);
            }
        } else {
            self.pointed_since = None;
            if now - self.last_pointed >= TOOLBAR_HIDE_AFTER_SEC {
                self.set_visible(false, can_show, &mut effects);
            }
        }
        effects
    }

    fn set_visible(&mut self, visible: bool, can_show: bool, effects: &mut Vec<ToolbarEffect>) {
        if visible == self.visible || (visible && !can_show) {
            return;
        }
        self.visible = visible;
        effects.push(if visible { ToolbarEffect::Show(self.alpha) } else { ToolbarEffect::ResetTooltip });
    }

    /// The fade towards shown or hidden; hides the overlay once it has faded out.
    pub fn fade(&mut self, now: f64) -> Vec<ToolbarEffect> {
        let dt = self.faded_at.map_or(0.0, |at| now - at);
        self.faded_at = Some(now);
        let target = if self.visible { 1.0 } else { 0.0 };
        if self.alpha == target {
            return Vec::new();
        }
        self.alpha = approach(self.alpha, target, dt, TOOLBAR_FADE_SEC);
        let mut effects = vec![ToolbarEffect::Alpha(self.alpha)];
        if self.alpha == 0.0 && target == 0.0 {
            effects.push(ToolbarEffect::Hide);
        }
        effects
    }

    /// The overlays were made again (SteamVR restarted): hidden, with no fade in progress.
    pub fn reset(&mut self) {
        self.visible = false;
        self.alpha = 0.0;
        self.faded_at = None;
    }
}

/// What the launcher's pose says this tick. `None` in either field when the head or the
/// launcher cannot be tracked.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LauncherView {
    /// Within the show angles (face 45 degrees, gaze 40 degrees).
    pub within_show: Option<bool>,
    /// Within the hide angles (face 55 degrees, gaze 45 degrees).
    pub within_hide: Option<bool>,
}

/// One tick's inputs to the launcher.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LauncherTick {
    pub now: f64,
    pub view: LauncherView,
    /// The laser is on the launcher or the launcher is held: it stays as it is.
    pub held: bool,
    /// The opening animation plays or the launcher flies back to the wrist: it stays shown.
    pub forced: bool,
    /// No opening animation in progress and not flying back; presses are allowed only then.
    pub idle: bool,
}

/// The launcher on the wrist: shown when the user looks at the wrist and hidden when they look
/// away, after a short wait each way, fading in and out (`updateLauncherVisibility`). With
/// auto-hide off it is always shown.
#[derive(Clone, Debug, PartialEq)]
pub struct Launcher {
    pub auto_hide: bool,
    pub shown: bool,
    pub alpha: f64,
    pub interactive: bool,
    shown_at: f64,
    change_since: Option<f64>,
    previous: Option<f64>,
}

impl Default for Launcher {
    fn default() -> Self {
        Self {
            auto_hide: true,
            shown: true,
            alpha: 1.0,
            interactive: true,
            shown_at: 0.0,
            change_since: None,
            previous: None,
        }
    }
}

impl Launcher {
    /// The overlays were made (`init`): hidden until looked at, unless auto-hide is off.
    pub fn start(&mut self, intro_idle: bool) {
        self.shown = !self.auto_hide;
        self.alpha = if self.shown { 1.0 } else { 0.0 };
        self.interactive = self.shown && intro_idle;
    }

    /// One tick. Returns true when the launcher stopped taking presses this tick (the tooltip's
    /// generation then starts over).
    pub fn update(&mut self, tick: LauncherTick) -> bool {
        let now = tick.now;
        let dt = self.previous.map_or(0.0, |previous| (now - previous).min(LAUNCHER_MAX_DT_SEC));
        self.previous = Some(now);
        let mut want = if !self.auto_hide {
            true
        } else if tick.held {
            self.shown
        } else if self.shown {
            tick.view.within_hide.unwrap_or(self.shown)
        } else {
            tick.view.within_show.unwrap_or(self.shown)
        };
        if tick.forced {
            want = true;
        }
        if want == self.shown {
            self.change_since = None;
        } else if !self.auto_hide {
            self.shown = true;
            self.shown_at = now;
            self.change_since = None;
        } else {
            let since = *self.change_since.get_or_insert(now);
            let wait = if want { LAUNCHER_SHOW_AFTER_SEC } else { LAUNCHER_HIDE_AFTER_SEC };
            if now - since >= wait {
                self.shown = want;
                self.change_since = None;
                if want {
                    self.shown_at = now;
                }
            }
        }
        self.alpha = approach(self.alpha, if self.shown { 1.0 } else { 0.0 }, dt, LAUNCHER_FADE_SEC);
        let was_interactive = self.interactive;
        self.interactive = self.alpha >= 1.0
            && tick.idle
            && (!self.auto_hide || now - self.shown_at >= LAUNCHER_INPUT_DELAY_SEC);
        was_interactive && !self.interactive
    }

    /// The overlay's alpha for a launcher of stored `opacity` with no fade-out set (`update`).
    pub fn overlay_alpha(&self, opacity: f64) -> f64 {
        if self.alpha < 1.0 {
            opacity * self.alpha
        } else {
            opacity
        }
    }
}

/// How long until the next capture of the VR page (`panelCaptureInterval`): short while it is
/// used or just changed, long while idle.
pub fn panel_capture_interval(active: bool, now: f64, last_change: f64) -> f64 {
    if active || now - last_change < PANEL_ACTIVE_HOLD_SEC {
        PANEL_CAPTURE_INTERVAL_SEC
    } else {
        PANEL_IDLE_CAPTURE_INTERVAL_SEC
    }
}

/// The overlay loop's period (`mainloop`): fast while a window is held or resized, quicker
/// while the laser is on the VR page.
pub fn loop_interval(holding: bool, pointing: bool) -> f64 {
    if holding {
        1.0 / 60.0
    } else if pointing {
        1.0 / 30.0
    } else {
        1.0 / 16.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subtitles_stay_then_fade_linearly() {
        assert_eq!(fade_ratio(10.0, 5.0, 6.0, 2.0), 1.0);
        assert!((fade_ratio(12.0, 5.0, 6.0, 2.0) - 0.5).abs() < 1e-12);
        assert_eq!(fade_ratio(20.0, 5.0, 6.0, 2.0), 0.0);
        assert_eq!(fade_ratio(1e6, 5.0, 6.0, 0.0), 1.0);
        assert!(!subtitle_visible(2.0, 0.0) && subtitle_visible(0.0, 0.0));
    }

    #[test]
    fn toolbar_shows_after_pointing_and_fades_out_later() {
        let mut bar = Toolbar::default();
        assert!(bar.update(0.0, true, true, true).is_empty());
        assert_eq!(bar.update(0.3, true, true, true), vec![ToolbarEffect::Show(0.0)]);
        bar.fade(0.3);
        assert_eq!(bar.fade(0.425), vec![ToolbarEffect::Alpha(0.5)]);
        assert!(bar.update(2.2, false, true, true).is_empty());
        assert_eq!(bar.update(2.4, false, true, true), vec![ToolbarEffect::ResetTooltip]);
        assert_eq!(bar.fade(2.4), vec![ToolbarEffect::Alpha(0.0), ToolbarEffect::Hide]);
        assert!(bar.fade(2.5).is_empty());
    }

    #[test]
    fn toolbar_waits_for_the_log_position() {
        let mut bar = Toolbar::default();
        bar.update(0.0, true, true, false);
        assert!(bar.update(1.0, true, true, false).is_empty());
        assert!(!bar.visible);
    }

    #[test]
    fn launcher_waits_before_showing_and_hiding() {
        let mut launcher = Launcher::default();
        launcher.start(true);
        let look = LauncherView { within_show: Some(true), within_hide: Some(true) };
        let away = LauncherView { within_show: Some(false), within_hide: Some(false) };
        let tick = |now, view| LauncherTick { now, view, idle: true, ..Default::default() };
        launcher.update(tick(0.0, look));
        assert!(!launcher.shown);
        launcher.update(tick(0.05, look));
        assert!(launcher.shown);
        launcher.update(tick(0.15, look));
        assert_eq!(launcher.alpha, 1.0);
        assert!(!launcher.interactive);
        launcher.update(tick(0.3, look));
        assert!(launcher.interactive);
        launcher.update(tick(0.4, away));
        assert!(launcher.shown);
        assert!(launcher.update(tick(0.75, away)));
        assert!(!launcher.shown);
    }

    #[test]
    fn launcher_without_auto_hide_always_shows() {
        let mut launcher = Launcher { auto_hide: false, ..Default::default() };
        launcher.start(true);
        launcher.update(LauncherTick { now: 0.0, idle: true, ..Default::default() });
        assert!(launcher.shown && launcher.interactive);
    }

    #[test]
    fn intervals_follow_activity() {
        assert_eq!(panel_capture_interval(false, 10.0, 9.5), PANEL_CAPTURE_INTERVAL_SEC);
        assert_eq!(panel_capture_interval(false, 10.0, 8.0), PANEL_IDLE_CAPTURE_INTERVAL_SEC);
        assert_eq!(loop_interval(true, true), 1.0 / 60.0);
        assert_eq!(loop_interval(false, false), 1.0 / 16.0);
    }
}
