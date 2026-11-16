//! The audio devices: the lists, the choice of microphone and speaker, Auto Select following
//! the OS default, and the virtual microphone guide (#321).
//!
//! Port of the device parts of `src-python/controller.py` (`_audioTarget`,
//! `_publishAudioDeviceLocked`, `_queueAudioReconciliation`, `applyAuto*Select`,
//! `setSelected*`, `getVirtualMicStatus`, `runVirtualMicTest`) and of `model.getList*`. The
//! lists, the identities, the change watching and the checks live in `native/audio-routing`
//! (`DeviceManager`, `selection`, `virtual_mic`); this module keeps the choice in the settings and
//! tells the UI, in Python's order.
//!
//! # What other areas use
//!
//! Speech recognition (capture from the chosen microphone or speaker loopback, `check_*_volume`)
//! and TTS / voice conversion (`/get/data/voice_output_devices`, the voice route) reach this area
//! through [`Core::audio_devices`]:
//!
//! - [`AudioDevices::target`]: the row a capture opens (the saved choice, or the OS default while
//!   Auto Select follows it). [`AudioDevices::selected`]: the saved choice only.
//! - [`AudioDevices::set_capture_owner`]: the recognition registers a [`CaptureOwner`]. While
//!   `ENABLE_TRANSCRIPTION_*` or `ENABLE_CHECK_ENERGY_*` is on, a device change, a new choice or
//!   Auto Select asks it to move the capture (under the source's lock) instead of only saving the
//!   choice; its answer is what is published.
//! - [`AudioDevices::publish_device`]: a capture that moved by itself (its device vanished and it
//!   opened another) publishes the device it opened; with `previous` it also sends
//!   `/run/audio_device_switched`. Never call it from inside [`CaptureOwner::reconfigure`].
//! - [`AudioDevices::refresh`]: lists the devices again now (after a read error, before deciding
//!   that the device is gone). [`AudioDevices::reconcile`]: `restartAccess*Devices`.
//! - [`AudioDevices::notify_device_missing`]: `/run/error_device` with `DEVICE_NO_MIC` or
//!   `DEVICE_NO_SPEAKER`.
//! - [`AudioDevices::outputs`]: the outputs speech can play to (`enumerate_outputs`, with the
//!   saved choices from other Windows hosts in `keep`).
//! - [`AudioDevices::stop_virtual_mic_check`]: the stop and mute requests end a running check.
//!   [`AudioDevices::set_voice_muted`]: the voice route tells whether the voice is muted (until
//!   it does, the saved mute intent `voice_mute_state.json` is read).
//!
//! Log lines are fixed strings: no device name or identity goes into the log.

use super::routes::{Builder, OPEN};
use super::{Core, error, ok, run_endpoint};
use crate::config::Config;
use crate::dispatch::Output;
use crate::errors::ErrorReply;
use crate::log::Log;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use vrct_audio_routing::graph::OutputOption;
use vrct_audio_routing::identity::{Device, NO_DEVICE, device_id, device_options, resolve_device};
use vrct_audio_routing::manager::DeviceManager;
use vrct_audio_routing::mute_state::{MuteState, MuteStore};
use vrct_audio_routing::naming::same_output;
use vrct_audio_routing::platform::AudioPlatform;
use vrct_audio_routing::report::Reporter;
use vrct_audio_routing::selection::{self, Saved};
use vrct_audio_routing::snapshot::DeviceSnapshot;
use vrct_audio_routing::virtual_mic::{CablePair, VirtualMicCheck};

pub use vrct_audio_routing::selection::Source;

/// The capture of one source, owned by the speech recognition (`model._mic_session`).
pub trait CaptureOwner: Send + Sync {
    /// Move the running capture of `source` to `target` (`session.reconfigure`), under the
    /// source's lock. `previous` is the device a failed read came from, if any. Must not call
    /// back into [`AudioDevices`].
    fn reconfigure(&self, source: Source, target: &Device, previous: Option<&Device>) -> Reopened;
    /// The source's device was lost while its features were on: turn transcription and the meter
    /// off and tell the UI (`_disableAudioAfterDeviceLossLocked`).
    fn device_lost(&self, source: Source);
    /// The device the running capture has open, kept in the options until it stops.
    fn active_device(&self, source: Source) -> Option<Device>;
}

/// What a reconfiguration left running.
#[derive(Debug, Clone, PartialEq)]
pub enum Reopened {
    /// The capture runs on this device; it is published as the choice.
    On(Box<Device>),
    /// Nothing runs any more (the owner turned the features off); "no device" is published.
    Off,
    /// The capture keeps going and will publish what it opens itself.
    Unchanged,
}

fn upper(source: Source) -> &'static str {
    match source {
        Source::Mic => "MIC",
        Source::Speaker => "SPEAKER",
    }
}

fn flags(source: Source) -> [&'static str; 2] {
    match source {
        Source::Mic => ["ENABLE_TRANSCRIPTION_SEND", "ENABLE_CHECK_ENERGY_SEND"],
        Source::Speaker => ["ENABLE_TRANSCRIPTION_RECEIVE", "ENABLE_CHECK_ENERGY_RECEIVE"],
    }
}

/// The lock and the generation of one source (`_audioLock`, `_audioGeneration`).
#[derive(Default)]
struct SourceState {
    lock: Mutex<()>,
    generation: AtomicU64,
}

/// The crate's diagnostics, into the core's log (fixed messages and codes only).
struct LogReporter(Arc<Log>);

impl Reporter for LogReporter {
    fn log(&self, message: &str) {
        self.0.step(message, None);
    }
}

type MutedProbe = Arc<dyn Fn() -> bool + Send + Sync>;

pub struct AudioDevices {
    config: Arc<Config>,
    output: Arc<dyn Output>,
    log: Arc<Log>,
    platform: Arc<dyn AudioPlatform>,
    manager: OnceLock<Arc<DeviceManager>>,
    mic: SourceState,
    speaker: SourceState,
    capture: Mutex<Option<Arc<dyn CaptureOwner>>>,
    check: VirtualMicCheck,
    voice_muted: Mutex<MutedProbe>,
    closed: AtomicBool,
}

impl AudioDevices {
    pub(crate) fn new(config: Arc<Config>, output: Arc<dyn Output>, log: Arc<Log>, platform: Arc<dyn AudioPlatform>) -> Arc<Self> {
        // `VoiceRoute` read the saved intent; an unreadable file counts as muted.
        let store = MuteState::new(config.path().with_file_name("voice_mute_state.json"));
        let muted: MutedProbe = Arc::new(move || store.read().unwrap_or(true));
        Arc::new(Self {
            config,
            output,
            log,
            platform,
            manager: OnceLock::new(),
            mic: SourceState::default(),
            speaker: SourceState::default(),
            capture: Mutex::new(None),
            check: VirtualMicCheck::new(),
            voice_muted: Mutex::new(muted),
            closed: AtomicBool::new(false),
        })
    }

    /// The device manager, listing the devices once when first asked (as importing
    /// `device_manager` did). Watching starts with [`start`](Self::start).
    pub fn manager(&self) -> &Arc<DeviceManager> {
        self.manager.get_or_init(|| {
            let reporter: Arc<dyn Reporter> = Arc::new(LogReporter(Arc::clone(&self.log)));
            DeviceManager::new(self.platform.backend(Arc::clone(&reporter)), reporter)
        })
    }

    pub fn snapshot(&self) -> Arc<DeviceSnapshot> {
        self.manager().snapshot()
    }

    fn state(&self, source: Source) -> &SourceState {
        match source {
            Source::Mic => &self.mic,
            Source::Speaker => &self.speaker,
        }
    }

    fn lock(&self, source: Source) -> MutexGuard<'_, ()> {
        self.state(source).lock.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The generation of a source's intent; a change of choice or of Auto Select advances it.
    pub fn generation(&self, source: Source) -> u64 {
        self.state(source).generation.load(Ordering::SeqCst)
    }

    fn advance(&self, source: Source) -> u64 {
        self.state(source).generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn notify(&self, endpoint: &str, value: Value) {
        if !self.closed.load(Ordering::SeqCst) {
            self.output.answer(200, Some(endpoint), &value);
        }
    }

    fn notify_named(&self, name: &str, value: Value) {
        self.notify(run_endpoint(name), value);
    }

    /// What the settings hold for a source.
    pub fn saved(&self, source: Source) -> Saved {
        let key = format!("SELECTED_{}_DEVICE", upper(source));
        Saved {
            host: if source == Source::Mic { self.config.get_str("SELECTED_MIC_HOST") } else { String::new() },
            name: self.config.get_str(&key),
            id: self.config.get_str(&format!("{key}_ID")),
            auto: self.config.get_bool(&format!("AUTO_{}_SELECT", upper(source))),
        }
    }

    /// The row the saved choice names (`_selectedAudioDevice`).
    pub fn selected(&self, source: Source) -> Option<Device> {
        selection::selected(&self.snapshot(), source, &self.saved(source))
    }

    /// The row a capture opens (`_audioTarget`).
    pub fn target(&self, source: Source, follow_default: bool) -> Option<Device> {
        selection::target(&self.snapshot(), source, &self.saved(source), follow_default)
    }

    fn features_on(&self, source: Source) -> bool {
        flags(source).iter().any(|flag| self.config.get_bool(flag))
    }

    fn owner(&self) -> Option<Arc<dyn CaptureOwner>> {
        self.capture.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_capture_owner(&self, owner: Arc<dyn CaptureOwner>) {
        *self.capture.lock().unwrap_or_else(|e| e.into_inner()) = Some(owner);
    }

    // The lists (`model.getList*`)

    pub fn host_list(&self) -> Vec<String> {
        self.snapshot().mic_hosts().into_iter().map(str::to_owned).collect()
    }

    /// The names under the chosen host, or `["NoDevice"]` when it is not listed.
    pub fn mic_device_list(&self) -> Vec<String> {
        let snapshot = self.snapshot();
        match snapshot.mics(&self.config.get_str("SELECTED_MIC_HOST")) {
            Some(devices) => devices.iter().map(|d| d.name.clone()).collect(),
            None => vec![NO_DEVICE.to_owned()],
        }
    }

    pub fn speaker_device_list(&self) -> Vec<String> {
        self.snapshot().speaker_devices.iter().map(|d| d.name.clone()).collect()
    }

    fn device_list(&self, source: Source) -> Vec<String> {
        match source {
            Source::Mic => self.mic_device_list(),
            Source::Speaker => self.speaker_device_list(),
        }
    }

    /// `[{id, label}]` of the rows the choice is made among; a running capture's device stays
    /// in it until the capture has stopped.
    pub fn options(&self, source: Source) -> Value {
        let _guard = self.lock(source);
        self.options_locked(source)
    }

    fn options_locked(&self, source: Source) -> Value {
        let mut devices = selection::candidates(&self.snapshot(), source, &self.config.get_str("SELECTED_MIC_HOST"));
        if let Some(active) = self.owner().and_then(|owner| owner.active_device(source)).filter(|a| !device_id(Some(a)).is_empty()) {
            let id = device_id(Some(&active)).to_owned();
            let mut found = false;
            for device in devices.iter_mut().filter(|d| device_id(Some(d)) == id) {
                *device = active.clone();
                found = true;
            }
            if !found {
                devices.push(active);
            }
        }
        Value::Array(device_options(&devices).into_iter().map(|o| json!({ "id": o.id, "label": o.label })).collect())
    }

    // Publishing the choice

    /// Saves `device` as the choice and tells the UI (`_publishAudioDeviceLocked`).
    fn publish_locked(&self, source: Source, device: Option<&Device>, previous: Option<&Device>) {
        let snapshot = self.snapshot();
        let saved = self.saved(source);
        let key = format!("SELECTED_{}_DEVICE", upper(source));
        let name = device.map_or_else(|| NO_DEVICE.to_owned(), |d| d.name.clone());
        let identity = device_id(device).to_owned();
        let ambiguous = selection::ambiguous(&snapshot, source, device, &saved);
        if source == Source::Mic && !ambiguous {
            let host = selection::host_of(&snapshot, device);
            self.config.put("SELECTED_MIC_HOST", json!(host));
            self.notify_named("selectable_mic_host_list", json!(self.host_list()));
            self.notify_named("selected_mic_host", json!(host));
        }
        if !ambiguous {
            self.config.put(&key, json!(name));
        }
        self.config.put(&format!("{key}_ID"), json!(identity));
        // Options first, so a newly opened fallback has a visible label.
        let s = source.as_str();
        self.notify(&format!("/run/selectable_{s}_device_options"), self.options_locked(source));
        self.notify(&format!("/run/selected_{s}_device"), json!(name));
        self.notify(&format!("/run/selected_{s}_device_id"), json!(identity));
        if let (Some(previous), Some(_)) = (previous, device)
            && (device_id(Some(previous)), previous.name.as_str()) != (identity.as_str(), name.as_str())
        {
            self.notify_named(
                "audio_device_switched",
                json!({
                    "source": s,
                    "old_device": { "id": device_id(Some(previous)), "name": previous.name },
                    "new_device": { "id": identity, "name": name },
                }),
            );
        }
    }

    /// A capture opened `device` by itself (its own fallback); `previous` is the one it left.
    pub fn publish_device(&self, source: Source, device: Option<&Device>, previous: Option<&Device>) {
        let _guard = self.lock(source);
        self.publish_locked(source, device, previous);
    }

    /// `_reconcileAudioLocked`: publish the target, or move the running capture to it.
    fn reconcile_locked(&self, source: Source, generation: Option<u64>, follow_default: bool, device: Option<Option<Device>>, previous: Option<&Device>) {
        if generation.is_some_and(|g| g != self.generation(source)) {
            return;
        }
        let target = device.unwrap_or_else(|| self.target(source, follow_default));
        let owner = self.owner().filter(|_| self.features_on(source));
        let Some(owner) = owner else {
            // Nothing captures: only the choice changes.
            self.publish_locked(source, target.as_ref(), None);
            return;
        };
        let Some(target) = target.filter(|t| !t.is_no_device()) else {
            owner.device_lost(source);
            self.publish_locked(source, None, None);
            return;
        };
        let speaker = source == Source::Speaker;
        if speaker {
            self.manager().pause_speaker_endpoint_tracker();
        }
        match owner.reconfigure(source, &target, previous) {
            Reopened::On(device) => self.publish_locked(source, Some(&device), None),
            Reopened::Off => self.publish_locked(source, None, None),
            Reopened::Unchanged => {}
        }
        if speaker {
            self.manager().resume_speaker_endpoint_tracker();
        }
    }

    /// `_reconcileAudio` (`restartAccess*Devices`).
    pub fn reconcile(&self, source: Source, generation: Option<u64>, follow_default: bool) {
        let _guard = self.lock(source);
        self.reconcile_locked(source, generation, follow_default, None, None);
    }

    /// `_queueAudioReconciliation`: after a device or default change.
    fn queue_reconciliation(&self, source: Source) {
        let generation = {
            let _guard = self.lock(source);
            if self.owner().is_none() || !self.features_on(source) {
                self.publish_locked(source, self.target(source, true).as_ref(), None);
                return;
            }
            self.generation(source)
        };
        // Python queued this on the source's lifecycle worker; it runs here on the caller.
        self.reconcile(source, Some(generation), true);
    }

    /// `updateMicDeviceList` / `updateSpeakerDeviceList`: the list changed.
    fn device_list_changed(&self, source: Source) {
        self.queue_reconciliation(source);
        let s = source.as_str();
        self.notify(&format!("/run/selectable_{s}_device_list"), json!(self.device_list(source)));
        let options = self.options(source);
        self.notify(&format!("/run/selectable_{s}_device_options"), options);
    }

    /// Lists the devices again now (`device_manager.update`).
    pub fn refresh(&self) {
        self.manager().update();
    }

    /// `/run/error_device` with `DEVICE_NO_MIC` or `DEVICE_NO_SPEAKER`.
    pub fn notify_device_missing(&self, source: Source) {
        let code = match source {
            Source::Mic => "DEVICE_NO_MIC",
            Source::Speaker => "DEVICE_NO_SPEAKER",
        };
        if !self.closed.load(Ordering::SeqCst) {
            self.output.answer(400, Some(run_endpoint("error_device")), &ErrorReply::new(code, Value::Null).into_body());
        }
    }

    /// The outputs speech can play to.
    pub fn outputs(&self, keep: &[String]) -> Result<Vec<OutputOption>, vrct_audio_routing::Error> {
        self.platform.outputs(keep)
    }

    // Auto Select

    /// `applyAutoMicSelect` / `applyAutoSpeakerSelect`.
    fn apply_auto(self: &Arc<Self>, source: Source) {
        let manager = Arc::clone(self.manager());
        let generation = {
            let _guard = self.lock(source);
            if !self.saved(source).auto {
                return;
            }
            let weak = Arc::downgrade(self);
            manager.update_callbacks(|callbacks| match source {
                Source::Mic => {
                    callbacks.before_update_mic_devices = None;
                    callbacks.after_update_mic_devices = None;
                    callbacks.default_mic_device = Some(Arc::new(move |_, _| {
                        if let Some(area) = weak.upgrade() {
                            area.queue_reconciliation(Source::Mic);
                        }
                    }));
                }
                Source::Speaker => {
                    callbacks.before_update_speaker_devices = None;
                    callbacks.after_update_speaker_devices = None;
                    callbacks.default_speaker_device = Some(Arc::new(move |_| {
                        if let Some(area) = weak.upgrade() {
                            area.queue_reconciliation(Source::Speaker);
                        }
                    }));
                }
            });
            match source {
                Source::Mic => manager.set_mic_auto_active(true),
                Source::Speaker => manager.set_speaker_auto_active(true),
            }
            self.generation(source)
        };
        // A forced listing does not run the change callbacks: apply it once, then send the names.
        manager.update();
        self.reconcile(source, Some(generation), true);
        let s = source.as_str();
        self.notify(&format!("/run/selectable_{s}_device_list"), json!(self.device_list(source)));
    }

    fn set_auto(self: &Arc<Self>, source: Source, on: bool) -> Reply {
        let key = format!("AUTO_{}_SELECT", upper(source));
        if on {
            {
                let _guard = self.lock(source);
                let _ = self.config.set(&key, json!(true));
                self.advance(source);
            }
            self.apply_auto(source);
        } else {
            let generation = {
                let _guard = self.lock(source);
                let _ = self.config.set(&key, json!(false));
                let generation = self.advance(source);
                let manager = self.manager();
                manager.update_callbacks(|callbacks| match source {
                    Source::Mic => callbacks.default_mic_device = None,
                    Source::Speaker => callbacks.default_speaker_device = None,
                });
                match source {
                    Source::Mic => manager.set_mic_auto_active(false),
                    Source::Speaker => manager.set_speaker_auto_active(false),
                }
                generation
            };
            self.reconcile(source, Some(generation), false);
        }
        ok(self.config.get(&key))
    }

    // Choosing

    fn rollback(&self, key: &str) -> Reply {
        error("VALIDATION_CONFIG_VALUE_INVALID", self.config.get(key))
    }

    /// `setSelectedMicHost`: the saved name under the new host, else its first device.
    fn set_mic_host(&self, data: &Value) -> Reply {
        if data.is_array() || data.is_object() {
            // Python looked the value up in a dict: an unhashable value raised.
            return Reply::status(500, "Internal error");
        }
        let _guard = self.lock(Source::Mic);
        let snapshot = self.snapshot();
        let Some(devices) = data.as_str().and_then(|host| snapshot.mics(host)) else {
            return self.rollback("SELECTED_MIC_HOST");
        };
        self.advance(Source::Mic);
        let saved_name = self.config.get_str("SELECTED_MIC_DEVICE");
        let chosen = resolve_device(devices, "", Some(&saved_name)).or_else(|| devices.iter().find(|d| !d.is_no_device())).cloned();
        self.reconcile_locked(Source::Mic, None, false, Some(Some(chosen.unwrap_or_else(Device::no_device))), None);
        self.notify_named("selectable_mic_device_list", json!(self.mic_device_list()));
        ok(self.config.get("SELECTED_MIC_HOST"))
    }

    /// `setSelected*Device` (a name, accepted when one row has it) and `setSelected*DeviceId`.
    fn set_device(&self, source: Source, data: &Value, by_id: bool) -> Reply {
        let key = format!("SELECTED_{}_DEVICE{}", upper(source), if by_id { "_ID" } else { "" });
        let _guard = self.lock(source);
        let devices = selection::candidates(&self.snapshot(), source, &self.config.get_str("SELECTED_MIC_HOST"));
        let chosen = match (by_id, data.as_str()) {
            (true, Some(id)) if !id.is_empty() => resolve_device(&devices, id, None),
            (false, Some(name)) => resolve_device(&devices, "", Some(name)),
            _ => None,
        };
        let Some(chosen) = chosen.cloned() else { return self.rollback(&key) };
        self.advance(source);
        self.reconcile_locked(source, None, false, Some(Some(chosen)), None);
        ok(self.config.get(&key))
    }

    // Start-up and shut-down

    /// `Init Device Manager` and `Init Auto Device Selection` of `Controller.init`.
    pub(crate) fn start(self: &Arc<Self>) {
        self.log.step("Init Device Manager", None);
        let manager = Arc::clone(self.manager());
        self.migrate_saved_choices();
        let (hosts, mics, speakers) = (Arc::downgrade(self), Arc::downgrade(self), Arc::downgrade(self));
        manager.update_callbacks(|callbacks| {
            callbacks.host_list = Some(Arc::new(move || {
                if let Some(area) = hosts.upgrade() {
                    area.notify_named("selectable_mic_host_list", json!(area.host_list()));
                }
            }));
            callbacks.mic_device_list = Some(Arc::new(move || {
                if let Some(area) = mics.upgrade() {
                    area.device_list_changed(Source::Mic);
                }
            }));
            callbacks.speaker_device_list = Some(Arc::new(move || {
                if let Some(area) = speakers.upgrade() {
                    area.device_list_changed(Source::Speaker);
                }
            }));
        });
        // The lists follow plugged and unplugged devices whatever Auto Select is.
        manager.set_device_list_monitoring_active(true);
        self.log.step("Init Auto Device Selection", None);
        if self.saved(Source::Mic).auto {
            self.apply_auto(Source::Mic);
        }
        if self.saved(Source::Speaker).auto {
            self.apply_auto(Source::Speaker);
        }
    }

    /// Choices saved by the Python backend under a Windows host this list no longer has (MME,
    /// DirectSound, WDM-KS) move to the same device under WASAPI, so the user keeps them. See
    /// decision 12 in `docs/voice-stack/core-integration.md`.
    fn migrate_saved_choices(&self) {
        let snapshot = self.snapshot();
        if let Some((host, device)) = selection::migrate_mic(&snapshot, &self.saved(Source::Mic)) {
            self.config.put("SELECTED_MIC_HOST", json!(host));
            self.config.put("SELECTED_MIC_DEVICE", json!(device.name));
            self.config.put("SELECTED_MIC_DEVICE_ID", json!(device_id(Some(&device))));
            self.log.step("Moved the saved microphone choice to the listed host", None);
        }
        if let Some(device) = selection::migrate_speaker(&snapshot, &self.saved(Source::Speaker)) {
            self.config.put("SELECTED_SPEAKER_DEVICE", json!(device.name));
            self.config.put("SELECTED_SPEAKER_DEVICE_ID", json!(device_id(Some(&device))));
            self.log.step("Moved the saved speaker choice to its listed identity", None);
        }
    }

    /// Stops the watching, the peak tracker and a running check; no notification after this.
    pub(crate) fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.check.stop();
        if let Some(manager) = self.manager.get() {
            // Auto Select off before the monitor stops, or it would start it again.
            manager.set_device_list_monitoring_active(false);
            manager.set_mic_auto_active(false);
            manager.set_speaker_auto_active(false);
            manager.stop_monitoring();
            manager.set_callbacks(Default::default());
        }
        self.platform.shutdown();
    }

    // The virtual microphone guide

    /// The voice route tells whether the voice is muted (`voice_route.status()['requested_muted']`).
    pub fn set_voice_muted(&self, probe: Arc<dyn Fn() -> bool + Send + Sync>) {
        *self.voice_muted.lock().unwrap_or_else(|e| e.into_inner()) = probe;
    }

    fn voice_muted(&self) -> bool {
        let probe = self.voice_muted.lock().unwrap_or_else(|e| e.into_inner()).clone();
        probe()
    }

    /// The stop and mute requests end a running check (`_stopVirtualMicCheck`).
    pub fn stop_virtual_mic_check(&self) {
        self.check.stop();
    }

    fn cable_json(pair: &CablePair) -> Value {
        json!({ "playback": pair.playback, "recording": pair.recording, "playback_label": pair.playback_label, "recording_label": pair.recording_label })
    }

    /// `getVirtualMicStatus`: the cables found and whether TTS already plays into one. Only
    /// reads the list: no device is opened and no choice changes.
    fn virtual_mic_status(&self) -> Value {
        let output = self.config.get("VOICE_SETTINGS")["output_device"].as_str().unwrap_or_default().to_owned();
        let cables = self.platform.cables();
        let mut result = json!({
            "supported": cables.is_some(),
            "cables": [],
            "error": null,
            "tts_output": if output.is_empty() { Value::Null } else { json!(output) },
            "tts_output_is_cable": false,
        });
        let Some(cables) = cables else { return result };
        match cables.find_cables() {
            Ok(pairs) => {
                result["tts_output_is_cable"] = json!(!output.is_empty() && pairs.iter().any(|p| same_output(&output, &p.playback)));
                result["cables"] = Value::Array(pairs.iter().map(Self::cable_json).collect());
            }
            Err(_) => result["error"] = json!("audio_devices_unavailable"),
        }
        result
    }

    /// `runVirtualMicTest`: the tone into one cable, its level sent as `/run/virtual_mic_level`.
    fn virtual_mic_test(&self, data: &Value) -> Reply {
        let Some(devices) = self.platform.cables() else { return Reply::conflict("virtual_mic_unsupported") };
        let playback = data.get("playback").filter(|_| data.is_object());
        let Ok(cables) = devices.find_cables() else { return Reply::conflict("audio_devices_unavailable") };
        let Some(pair) = cables.into_iter().find(|c| playback.and_then(Value::as_str) == Some(c.playback.as_str())) else {
            return Reply::conflict("virtual_mic_missing");
        };
        if self.voice_muted() {
            return Reply::conflict("virtual_mic_voice_muted");
        }
        let level = run_endpoint("virtual_mic_level");
        let mut report = |value: f64| self.notify(level, json!({ "playback": pair.playback, "level": value }));
        match self.check.run(&pair, &mut report, devices.as_ref()) {
            Ok(outcome) => ok(json!({
                "heard": outcome.heard,
                "peak_dbfs": outcome.peak_dbfs,
                "stopped": outcome.stopped,
                "playback": pair.playback,
                "recording": pair.recording,
            })),
            Err(error) => Reply::conflict(&error.code),
        }
    }
}

impl Core {
    /// The audio devices area (the lists, the choice, the virtual microphone check).
    pub fn audio_devices(&self) -> &Arc<AudioDevices> {
        &self.audio
    }

    pub(crate) fn start_audio_devices(&self) {
        self.audio.start();
    }

    pub(crate) fn stop_audio_devices(&self) {
        self.audio.shutdown();
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/selectable_mic_host_list", OPEN, |core, _| ok(json!(core.audio_devices().host_list())));
    b.with("/get/data/selectable_mic_device_list", OPEN, |core, _| ok(json!(core.audio_devices().mic_device_list())));
    b.with("/get/data/selectable_speaker_device_list", OPEN, |core, _| ok(json!(core.audio_devices().speaker_device_list())));
    for source in [Source::Mic, Source::Speaker] {
        let s = source.as_str();
        b.with(&format!("/set/enable/auto_{s}_select"), OPEN, move |core, _| core.audio_devices().set_auto(source, true));
        b.with(&format!("/set/disable/auto_{s}_select"), OPEN, move |core, _| core.audio_devices().set_auto(source, false));
        b.with(&format!("/get/data/selectable_{s}_device_options"), OPEN, move |core, _| ok(core.audio_devices().options(source)));
        b.with(&format!("/set/data/selected_{s}_device"), OPEN, move |core, data| core.audio_devices().set_device(source, data, false));
        b.with(&format!("/set/data/selected_{s}_device_id"), OPEN, move |core, data| core.audio_devices().set_device(source, data, true));
    }
    b.with("/set/data/selected_mic_host", OPEN, |core, data| core.audio_devices().set_mic_host(data));
    b.with("/get/data/virtual_mic_status", OPEN, |core, _| ok(core.audio_devices().virtual_mic_status()));
    b.with("/run/virtual_mic_test", OPEN, |core, data| core.audio_devices().virtual_mic_test(data));
}
