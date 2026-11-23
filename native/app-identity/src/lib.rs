//! The names ASTAROT goes by outside its own code: the folders it keeps settings and models in,
//! the IDs it registers with the OS, the names of the API keys it saves, the marker on the model
//! folders it owns, and the environment variables it reads (ADR-014).
//!
//! These names move from VRCT-VOX to ASTAROT one pull request at a time (ADR-014, 5); 0.6.0
//! shipped the first of them. A name that moves is a [`Renamed`]: the spelling earlier versions
//! used, the one ADR-014 gives it, and which of the two this build writes. The pull request that moves a name switches it to the
//! ASTAROT spelling together with the migration that name needs. Until then the build writes the
//! VRCT-VOX spelling, so nothing changes for a user.
//!
//! What an earlier version wrote is still read where ADR-014 says so (2.11): the environment
//! variables users and packagers set ([`env::Variable`]), the owner marker of a model download
//! ([`MODEL_DOWNLOAD_OWNER`]) and the Linux audio route's names ([`audio_route`]) are taken under
//! either spelling, and API keys saved under the [`credentials`] names of 0.6.0 are found and
//! copied to the new ones.
//!
//! Not here: the names ADR-014 keeps (2.3: the update and telemetry Workers, the chat box
//! detector's ID, the key file's DPAPI entropy, setting keys, the IPC endpoints and the OSC
//! addresses), the names of the helper programs, which ship with the app and move with it, and
//! names only the code uses (2.12).

/// A name that moves from its VRCT-VOX spelling to its ASTAROT one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Renamed {
    /// The spelling earlier versions used (0.5.x, and 0.6.0 for the names it did not move).
    pub legacy: &'static str,
    /// The spelling ADR-014 gives it (2.2).
    pub astarot: &'static str,
    /// Whether this build writes `astarot`. It stays off until the pull request that moves the
    /// name, which brings the migration with it.
    pub writes_astarot: bool,
}

impl Renamed {
    /// A name this build still writes under its VRCT-VOX spelling.
    const fn not_moved(legacy: &'static str, astarot: &'static str) -> Self {
        Renamed { legacy, astarot, writes_astarot: false }
    }

    /// A name this build writes under its ASTAROT spelling, with the migration it needs.
    const fn moved(legacy: &'static str, astarot: &'static str) -> Self {
        Renamed { legacy, astarot, writes_astarot: true }
    }

    /// The spelling this build writes, registers and creates.
    pub const fn current(&self) -> &'static str {
        if self.writes_astarot {
            self.astarot
        } else {
            self.legacy
        }
    }

    /// The spelling this build does not write: what an older or a newer build may have left.
    pub const fn other(&self) -> &'static str {
        if self.writes_astarot {
            self.legacy
        } else {
            self.astarot
        }
    }

    /// Whether `value` is either spelling, for names read back under both.
    pub fn accepts(&self, value: &str) -> bool {
        value == self.legacy || value == self.astarot
    }
}

/// The app ID (`identifier` in `src-tauri/tauri.conf.json`). The Wayland portals know the app by
/// it, and the desktop file the app writes for them is named after it (ADR-014, 2.6).
pub const APP_ID: Renamed = Renamed::moved("io.github.kein5.vrct-vox", "io.github.kein5.astarot");

/// The key that marks a desktop file the app wrote for the portals (`<key>=true`). The app
/// rewrites only a file that carries it; any other file is the user's or a packager's.
pub const DESKTOP_FILE_MARKER: Renamed = Renamed::moved("X-VRCT-VOX-Generated", "X-ASTAROT-Generated");

/// The folder the Linux packages keep settings, logs and models in, under `$XDG_CONFIG_HOME` and
/// under `$XDG_DATA_HOME` (ADR-014, 2.4). The app moves the VRCT-VOX folder at its start and
/// leaves a link with the old name (`astarot_core::storage::linux`).
pub const LINUX_FOLDER: Renamed = Renamed::moved("vrct-vox", "astarot");

/// The app's executable without `.exe` (`mainBinaryName` in `src-tauri/tauri.conf.json`), and the
/// Linux window class, which follows it (`StartupWMClass`; ADR-014, 2.5 and 2.6).
pub const EXECUTABLE: Renamed = Renamed::not_moved("vrct-vox", "astarot");

/// The Linux package: its name, `/opt/<name>`, the AppImage's `usr/lib/<name>` and the icon
/// (ADR-014, 2.7).
pub const LINUX_PACKAGE: Renamed = Renamed::not_moved("vrct-vox", "astarot");

/// The `product` in `owner.json`, the marker on a model download's folder. It tells a folder this
/// app wrote, which it may remove after an interrupted download or move aside when its files
/// fail their check. A reader takes either spelling (ADR-014, 2.11): 0.5.x wrote the VRCT-VOX one
/// and reads only that, so it leaves alone what an interrupted download of 0.6.0 left.
pub const MODEL_DOWNLOAD_OWNER: Renamed = Renamed::moved("VRCT-VOX-model-download-v1", "ASTAROT-model-download-v1");

/// The names of the Linux managed audio route (ADR-014, 2.8): the PipeWire nodes the core makes
/// and marks, the systemd user units that keep them, and the hand-placed configuration that
/// makes the same nodes. The virtual microphone's description is what VRChat lists.
///
/// The core of 0.6.0 and earlier made the route under the VRCT spellings. While
/// [`READS_LEGACY_NAMES`](audio_route::READS_LEGACY_NAMES) is on, the core finds a hand-placed
/// configuration under either file name, reports an old route that is not its own, and keeps
/// nodes and streams under either prefix out of the input lists (ADR-014, 2.11). Retiring the
/// units that core made goes on after that, for as long as
/// [`RETIRES_LEGACY_UNITS`](audio_route::RETIRES_LEGACY_UNITS) is on.
pub mod audio_route {
    use super::Renamed;

    /// Whether this build reads the route's VRCT spellings: nodes and streams under the old
    /// prefixes stay out of the input lists, a hand-placed configuration under the old file name
    /// stops the automatic setup, and an old route that is not the core's is reported. Decided on
    /// 2026-11-23 (ADR-014, note on 2.11): they are read during the release series that first
    /// ships the ASTAROT names (0.7.x when that is 0.7.0). The version after it turns this off;
    /// every reader of a legacy spelling below goes through it.
    pub const READS_LEGACY_NAMES: bool = true;

    /// Whether the core retires the units 0.6.0 and earlier made under the old names. It stops
    /// and removes only a unit identical to what that core wrote (`native/audio-routing`,
    /// `pipewire::managed`), so it has no end (decided on 2026-11-23, ADR-014, note on 2.11): an
    /// install that skips versions still loses the old virtual microphone. It stays on when
    /// [`READS_LEGACY_NAMES`] goes off.
    pub const RETIRES_LEGACY_UNITS: bool = true;

    /// The first part of every node of the route: `<prefix>source` (the virtual microphone),
    /// `<prefix>tts`, `<prefix>vc`, `<prefix>mix` and the loopbacks' outputs.
    pub const NODE_PREFIX: Renamed = Renamed::moved("vrct.managed.", "astarot.managed.");
    /// The first part of the source bridge's two streams, `<prefix><tag>.capture` and
    /// `<prefix><tag>.playback`, which feed a microphone into the route's VC input.
    pub const BRIDGE_PREFIX: Renamed = Renamed::moved("vrct.source-bridge.", "astarot.source-bridge.");
    /// The first part of the streams realtime recognition captures through on Linux,
    /// `<prefix>mic` and `<prefix>speaker`.
    pub const ASR_CAPTURE_PREFIX: Renamed = Renamed::moved("vrct.asr.capture.", "astarot.asr.capture.");
    /// The property (`v1`) on every node of the route, the units' and a hand-placed one's.
    pub const ROUTE_PROPERTY: Renamed = Renamed::moved("vrct.managed.route", "astarot.managed.route");
    /// The property that holds [`OWNER`] on the nodes the units make.
    pub const OWNER_PROPERTY: Renamed = Renamed::moved("vrct.managed.owner", "astarot.managed.owner");
    /// The property (`v1`) on the source bridge's streams.
    pub const BRIDGE_PROPERTY: Renamed = Renamed::moved("vrct.source.bridge", "astarot.source.bridge");
    /// The owner marker of the units the core makes, on their nodes and in the units' files.
    pub const OWNER: Renamed = Renamed::moved("vrct-vox-service-v1", "astarot-service-v1");
    /// The first part of the node descriptions, which the sound settings and VRChat show:
    /// `<prefix> Virtual Microphone` and the inputs' `<prefix> TTS Input` and so on.
    pub const DESCRIPTION_PREFIX: Renamed = Renamed::moved("VRCT Managed", "ASTAROT Managed");
    /// The first part of the units' names, `<prefix>source.service` and so on, and of the names
    /// `pw-loopback` gives its streams.
    pub const UNIT_PREFIX: Renamed = Renamed::moved("vrct-managed-", "astarot-managed-");
    /// The first line of a unit file.
    pub const UNIT_HEADER: Renamed = Renamed::moved("# VRCT managed microphone v1; created by VRCT-VOX", "# ASTAROT managed microphone v1; created by ASTAROT");
    /// A unit's `Description=`.
    pub const UNIT_DESCRIPTION: Renamed = Renamed::moved("VRCT managed audio endpoint", "ASTAROT managed audio endpoint");
    /// The file a user places in `pipewire.conf.d` (under `$XDG_CONFIG_HOME/pipewire` or
    /// `/etc/pipewire`) to make the route by hand. The app ships it in `config/pipewire/`.
    pub const MANUAL_CONFIG: Renamed = Renamed::moved("90-vrct-managed.conf", "90-astarot-managed.conf");
    /// The lock in `$XDG_RUNTIME_DIR` that keeps two preparations of the route apart.
    pub const SETUP_LOCK: Renamed = Renamed::moved("vrct-managed-setup.lock", "astarot-managed-setup.lock");

    /// The spellings of `name` to read: the current one, and the legacy one while
    /// [`READS_LEGACY_NAMES`] is on.
    pub fn read(name: Renamed) -> impl Iterator<Item = &'static str> {
        read_with(name, READS_LEGACY_NAMES)
    }

    /// [`read`], with `legacy` in place of [`READS_LEGACY_NAMES`] (tests).
    pub fn read_with(name: Renamed, legacy: bool) -> impl Iterator<Item = &'static str> {
        std::iter::once(name.current()).chain(legacy.then_some(name.other()))
    }

    /// Whether `node` starts with a prefix of the route or of the source bridge under a
    /// spelling read: such a node feeds the virtual microphone, so it is never an input to
    /// choose, a monitor to play to or a device to record.
    pub fn is_route_name(node: &str) -> bool {
        is_route_name_with(node, READS_LEGACY_NAMES)
    }

    /// [`is_route_name`], with `legacy` in place of [`READS_LEGACY_NAMES`] (tests).
    pub fn is_route_name_with(node: &str, legacy: bool) -> bool {
        starts_with_any(node, &[NODE_PREFIX, BRIDGE_PREFIX], legacy)
    }

    /// Whether `node` is one of the app's own nodes or streams under a spelling read: the
    /// route's, the source bridge's, or a capture for recognition. Recognition never records it.
    pub fn is_own_name(node: &str) -> bool {
        is_own_name_with(node, READS_LEGACY_NAMES)
    }

    /// [`is_own_name`], with `legacy` in place of [`READS_LEGACY_NAMES`] (tests).
    pub fn is_own_name_with(node: &str, legacy: bool) -> bool {
        starts_with_any(node, &[NODE_PREFIX, BRIDGE_PREFIX, ASR_CAPTURE_PREFIX], legacy)
    }

    fn starts_with_any(node: &str, prefixes: &[Renamed], legacy: bool) -> bool {
        prefixes.iter().flat_map(|prefix| read_with(*prefix, legacy)).any(|prefix| node.starts_with(prefix))
    }

    /// The properties that mark a node of the route or of its streams, under the spellings read.
    pub fn markers() -> impl Iterator<Item = &'static str> {
        [ROUTE_PROPERTY, BRIDGE_PROPERTY].into_iter().flat_map(read)
    }
}

/// The names of the API keys in the OS credential store (ADR-013; ADR-014, 2.9). 0.6.0 kept its
/// keys under the `legacy` names; this build writes the `astarot` ones, copies a key it finds only
/// under the old names, and leaves the old item where it is while ADR-014 2.11 reads old names.
pub mod credentials {
    use super::Renamed;

    /// The Windows Credential Manager: each key is `<prefix>/<store id>/<entry>`.
    pub const WINDOWS_PREFIX: Renamed = Renamed::moved("VRCT-VOX", "ASTAROT");
    /// Secret Service: the value of the `application` attribute.
    pub const APPLICATION: Renamed = Renamed::moved("vrct-vox", "astarot");
    /// Secret Service: the attribute that holds the store ID.
    pub const STORE_ATTRIBUTE: Renamed = Renamed::moved("vrct-vox-store", "astarot-store");
    /// Secret Service: the first word of an item's label (`<prefix> <entry>`), which the keyring
    /// shows.
    pub const LABEL_PREFIX: Renamed = Renamed::moved("VRCT-VOX", "ASTAROT");
}

/// The environment variables the app reads.
pub mod env {
    use std::ffi::OsString;

    /// A variable users and packagers set. It is read under its ASTAROT name first and then
    /// under its VRCT name, which the documents and scripts of 0.5.x use (ADR-014, 2.2 and 2.11).
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct Variable {
        pub astarot: &'static str,
        pub legacy: &'static str,
    }

    impl Variable {
        /// Both names, in the order they are read.
        pub const fn names(&self) -> [&'static str; 2] {
            [self.astarot, self.legacy]
        }

        /// The value under the first name that is set to something. An empty value counts as
        /// not set, as every reader of these variables has treated it.
        pub fn value_os(&self) -> Option<OsString> {
            self.value_os_with(|name| std::env::var_os(name))
        }

        /// [`Variable::value_os`], with `lookup` in place of the process environment.
        pub fn value_os_with(&self, lookup: impl Fn(&str) -> Option<OsString>) -> Option<OsString> {
            self.names().into_iter().filter_map(lookup).find(|value| !value.is_empty())
        }
    }

    /// The folder for settings, logs and downloaded models, in place of the default.
    pub const CONFIG_DIR: Variable = Variable { astarot: "ASTAROT_CONFIG_DIR", legacy: "VRCT_CONFIG_DIR" };
    /// The Linux packages' data folder (`weights/`, `translation-models/`,
    /// `telemetry_state.json`), in place of the default.
    pub const DATA_DIR: Variable = Variable { astarot: "ASTAROT_DATA_DIR", legacy: "VRCT_DATA_DIR" };
    /// `off` turns the usage events off for good (the privacy page).
    pub const TELEMETRY: Variable = Variable { astarot: "ASTAROT_TELEMETRY", legacy: "VRCT_TELEMETRY" };
    /// The OpenVR client library to load, in place of the one the app ships.
    pub const OPENVR_API: Variable = Variable { astarot: "ASTAROT_OPENVR_API", legacy: "VRCT_OPENVR_API" };

    // The variables below are for development, or are handed from the app to its own processes.
    // They took their ASTAROT names in 0.6.0 without keeping the old ones, together with the
    // tools and documents that use them (ADR-014, 2.2).

    /// A loopback HTTP receiver that takes the usage events in place of the real one.
    pub const TELEMETRY_URL: &str = "ASTAROT_TELEMETRY_URL";
    /// A local file the speech timings are appended to while measuring.
    pub const VOICE_TRACE: &str = "ASTAROT_VOICE_TRACE";
    /// `1` adds the `gc_pauses` field to the records of [`VOICE_TRACE`] (empty in Rust; Python
    /// filled it).
    pub const VOICE_GC_DIAGNOSTICS: &str = "ASTAROT_VOICE_GC_DIAGNOSTICS";
    /// The folder through which the Linux app hands the VR panel's frames and the captured
    /// screen to the VR overlay and chat reading in the same process tree.
    pub const VR_PANEL_DIR: &str = "ASTAROT_VR_PANEL_DIR";
}

pub mod appimage;

/// The first bytes of the files the app's processes hand each other on Linux. Both ends are in
/// the same version, so these change together with no migration (`VRCTVRP1` and `VRCTSCR1` up to
/// 0.5.x; eight bytes, so `ASTR` rather than `ASTAROT`).
pub mod handoff {
    /// The VR panel's frame, from the app to the VR overlay.
    pub const VR_PANEL_FRAME: &[u8; 8] = b"ASTRVRP1";
    /// The captured screen, from the capture helper (`native/screen-capture/main.c`, which
    /// writes the same eight bytes) to chat reading.
    pub const SCREEN_FRAME: &[u8; 8] = b"ASTRSCR1";
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsString;

    const ALL: [(&str, Renamed); 10] = [
        ("APP_ID", APP_ID),
        ("DESKTOP_FILE_MARKER", DESKTOP_FILE_MARKER),
        ("LINUX_FOLDER", LINUX_FOLDER),
        ("EXECUTABLE", EXECUTABLE),
        ("LINUX_PACKAGE", LINUX_PACKAGE),
        ("MODEL_DOWNLOAD_OWNER", MODEL_DOWNLOAD_OWNER),
        ("credentials::WINDOWS_PREFIX", credentials::WINDOWS_PREFIX),
        ("credentials::APPLICATION", credentials::APPLICATION),
        ("credentials::STORE_ATTRIBUTE", credentials::STORE_ATTRIBUTE),
        ("credentials::LABEL_PREFIX", credentials::LABEL_PREFIX),
    ];
    const VARIABLES: [Variable; 4] = [env::CONFIG_DIR, env::DATA_DIR, env::TELEMETRY, env::OPENVR_API];
    use env::Variable;

    /// The names that moved, each in its own pull request with its migration (ADR-014, 5). The
    /// pull request that moves another one adds it here.
    const MOVED: [&str; 8] = [
        "APP_ID",
        "DESKTOP_FILE_MARKER",
        "LINUX_FOLDER",
        "MODEL_DOWNLOAD_OWNER",
        "credentials::WINDOWS_PREFIX",
        "credentials::APPLICATION",
        "credentials::STORE_ATTRIBUTE",
        "credentials::LABEL_PREFIX",
    ];

    #[test]
    fn only_the_names_with_their_migration_are_written_the_astarot_way() {
        for (what, name) in ALL {
            let moved = MOVED.contains(&what);
            assert_eq!(name.writes_astarot, moved, "{what}");
            assert_eq!(name.current(), if moved { name.astarot } else { name.legacy }, "{what}");
            assert_eq!(name.other(), if moved { name.legacy } else { name.astarot }, "{what}");
        }
    }

    #[test]
    fn the_values_written_are_those_of_0_5_but_the_moved_names() {
        assert_eq!(APP_ID.current(), "io.github.kein5.astarot");
        assert_eq!(DESKTOP_FILE_MARKER.current(), "X-ASTAROT-Generated");
        assert_eq!(LINUX_FOLDER.current(), "astarot");
        assert_eq!(EXECUTABLE.current(), "vrct-vox");
        assert_eq!(LINUX_PACKAGE.current(), "vrct-vox");
        assert_eq!(MODEL_DOWNLOAD_OWNER.current(), "ASTAROT-model-download-v1");
        assert_eq!(credentials::WINDOWS_PREFIX.current(), "ASTAROT");
        assert_eq!(credentials::APPLICATION.current(), "astarot");
        assert_eq!(credentials::STORE_ATTRIBUTE.current(), "astarot-store");
        assert_eq!(credentials::LABEL_PREFIX.current(), "ASTAROT");
    }

    /// ADR-014, 2.2: paths, packages, executables and IDs in lower case `astarot`; what people
    /// read (the credential prefix and label, the desktop file's key, the marker) as `ASTAROT`.
    #[test]
    fn the_astarot_spellings_follow_the_adr() {
        for (what, name) in ALL {
            assert!(name.astarot.contains("astarot") ^ name.astarot.contains("ASTAROT"), "{what}: {}", name.astarot);
            assert!(!name.astarot.to_ascii_lowercase().contains("vrct"), "{what}: {}", name.astarot);
            assert!(name.legacy.to_ascii_lowercase().contains("vrct"), "{what}: {}", name.legacy);
            // The spelling changes nothing but the name: same case, same place.
            let (legacy, astarot) = (name.legacy.replace("VRCT-VOX", "ASTAROT").replace("vrct-vox", "astarot"), name.astarot);
            assert_eq!(legacy, astarot, "{what}");
        }
        assert_eq!(APP_ID.astarot, "io.github.kein5.astarot");
    }

    #[test]
    fn either_spelling_is_accepted_and_nothing_else() {
        for (what, name) in ALL {
            assert!(name.accepts(name.legacy), "{what}");
            assert!(name.accepts(name.astarot), "{what}");
            assert!(!name.accepts(""), "{what}");
            // Another case is another name.
            assert!(!name.accepts(&name.legacy.to_ascii_uppercase().replace("VRCT", "vrct")), "{what}");
            assert!(!name.accepts(&format!("{} ", name.legacy)), "{what}");
        }
    }

    #[test]
    fn a_moved_name_writes_astarot_and_still_knows_the_old_one() {
        let moved = Renamed { writes_astarot: true, ..LINUX_PACKAGE };
        assert_eq!(moved.current(), "astarot");
        assert_eq!(moved.other(), "vrct-vox");
        assert!(moved.accepts("vrct-vox") && moved.accepts("astarot"));
    }

    #[test]
    fn variables_are_named_astarot_first_then_vrct() {
        for variable in VARIABLES {
            let suffix = variable.astarot.strip_prefix("ASTAROT_").expect(variable.astarot);
            assert_eq!(variable.legacy.strip_prefix("VRCT_"), Some(suffix));
            assert_eq!(variable.names(), [variable.astarot, variable.legacy]);
        }
        assert_eq!(env::CONFIG_DIR.legacy, "VRCT_CONFIG_DIR");
        assert_eq!(env::DATA_DIR.legacy, "VRCT_DATA_DIR");
        assert_eq!(env::TELEMETRY.legacy, "VRCT_TELEMETRY");
        assert_eq!(env::OPENVR_API.legacy, "VRCT_OPENVR_API");
    }

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = pairs.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn the_astarot_name_wins_and_the_vrct_name_still_works() {
        let config = env::CONFIG_DIR;
        assert_eq!(config.value_os_with(lookup(&[])), None);
        assert_eq!(config.value_os_with(lookup(&[("VRCT_CONFIG_DIR", "/old")])), Some("/old".into()));
        assert_eq!(config.value_os_with(lookup(&[("ASTAROT_CONFIG_DIR", "/new")])), Some("/new".into()));
        assert_eq!(config.value_os_with(lookup(&[("ASTAROT_CONFIG_DIR", "/new"), ("VRCT_CONFIG_DIR", "/old")])), Some("/new".into()));
    }

    #[test]
    fn an_empty_value_counts_as_not_set() {
        let config = env::CONFIG_DIR;
        assert_eq!(config.value_os_with(lookup(&[("VRCT_CONFIG_DIR", "")])), None);
        assert_eq!(config.value_os_with(lookup(&[("ASTAROT_CONFIG_DIR", ""), ("VRCT_CONFIG_DIR", "/old")])), Some("/old".into()));
        assert_eq!(config.value_os_with(lookup(&[("ASTAROT_CONFIG_DIR", ""), ("VRCT_CONFIG_DIR", "")])), None);
    }

    const ROUTE: [(&str, Renamed); 13] = [
        ("NODE_PREFIX", audio_route::NODE_PREFIX),
        ("BRIDGE_PREFIX", audio_route::BRIDGE_PREFIX),
        ("ASR_CAPTURE_PREFIX", audio_route::ASR_CAPTURE_PREFIX),
        ("ROUTE_PROPERTY", audio_route::ROUTE_PROPERTY),
        ("OWNER_PROPERTY", audio_route::OWNER_PROPERTY),
        ("BRIDGE_PROPERTY", audio_route::BRIDGE_PROPERTY),
        ("OWNER", audio_route::OWNER),
        ("DESCRIPTION_PREFIX", audio_route::DESCRIPTION_PREFIX),
        ("UNIT_PREFIX", audio_route::UNIT_PREFIX),
        ("UNIT_HEADER", audio_route::UNIT_HEADER),
        ("UNIT_DESCRIPTION", audio_route::UNIT_DESCRIPTION),
        ("MANUAL_CONFIG", audio_route::MANUAL_CONFIG),
        ("SETUP_LOCK", audio_route::SETUP_LOCK),
    ];

    /// ADR-014, 2.2 and 2.8: the route moved in one step, nodes and units in lower case
    /// `astarot`, the descriptions people read in `ASTAROT`. The spelling changes nothing but the
    /// name, so a unit or node of 0.6.0 is told by these values alone.
    #[test]
    fn the_route_writes_its_astarot_names_and_knows_the_vrct_ones() {
        for (what, name) in ROUTE {
            assert!(name.writes_astarot, "{what}");
            assert_eq!(name.current(), name.astarot, "{what}");
            assert!(name.legacy.contains("vrct") || name.legacy.contains("VRCT"), "{what}: {}", name.legacy);
            assert!(!name.astarot.to_ascii_lowercase().contains("vrct"), "{what}: {}", name.astarot);
            let renamed = name.legacy.replace("VRCT-VOX", "ASTAROT").replace("vrct-vox", "astarot").replace("VRCT", "ASTAROT").replace("vrct", "astarot");
            assert_eq!(renamed, name.astarot, "{what}");
        }
        assert_eq!(audio_route::DESCRIPTION_PREFIX.current(), "ASTAROT Managed");
        assert_eq!(audio_route::OWNER.legacy, "vrct-vox-service-v1");
        assert_eq!(audio_route::MANUAL_CONFIG.current(), "90-astarot-managed.conf");
    }

    #[test]
    fn the_legacy_route_names_are_read_only_while_the_period_lasts() {
        let prefix = audio_route::NODE_PREFIX;
        assert_eq!(audio_route::read_with(prefix, true).collect::<Vec<_>>(), ["astarot.managed.", "vrct.managed."]);
        assert_eq!(audio_route::read_with(prefix, false).collect::<Vec<_>>(), ["astarot.managed."]);
        for legacy in [true, false] {
            assert!(audio_route::is_route_name_with("astarot.managed.source", legacy));
            assert!(audio_route::is_route_name_with("astarot.source-bridge.0123.playback", legacy));
            assert_eq!(audio_route::is_route_name_with("vrct.managed.source", legacy), legacy);
            assert_eq!(audio_route::is_route_name_with("vrct.source-bridge.0123.capture", legacy), legacy);
            assert!(!audio_route::is_route_name_with("alsa_input.usb-mic", legacy));
            // A prefix is a whole word: a node merely named like the route is not one of it.
            assert!(!audio_route::is_route_name_with("astarot.managed", legacy));
            assert!(!audio_route::is_route_name_with("astarot.tts", legacy));
            // A capture for recognition is the app's own, but feeds no virtual microphone.
            assert!(!audio_route::is_route_name_with("astarot.asr.capture.mic", legacy));
            assert!(audio_route::is_own_name_with("astarot.asr.capture.mic", legacy));
            assert!(audio_route::is_own_name_with("astarot.managed.mix", legacy));
            assert_eq!(audio_route::is_own_name_with("vrct.asr.capture.speaker", legacy), legacy);
            assert!(!audio_route::is_own_name_with("alsa_output.headphones", legacy));
        }
        assert_eq!(audio_route::is_route_name("vrct.managed.mix"), audio_route::READS_LEGACY_NAMES);
        let markers: Vec<&str> = audio_route::markers().collect();
        assert!(markers.contains(&"astarot.managed.route") && markers.contains(&"astarot.source.bridge"));
        assert_eq!(markers.contains(&"vrct.managed.route"), audio_route::READS_LEGACY_NAMES);
    }

    #[test]
    fn the_development_and_handoff_names_are_astarot() {
        assert_eq!(env::VR_PANEL_DIR, "ASTAROT_VR_PANEL_DIR");
        assert_eq!(env::TELEMETRY_URL, "ASTAROT_TELEMETRY_URL");
        assert_eq!(env::VOICE_TRACE, "ASTAROT_VOICE_TRACE");
        assert_eq!(env::VOICE_GC_DIAGNOSTICS, "ASTAROT_VOICE_GC_DIAGNOSTICS");
        assert_eq!(handoff::VR_PANEL_FRAME, b"ASTRVRP1");
        assert_eq!(handoff::SCREEN_FRAME, b"ASTRSCR1");
    }
}
