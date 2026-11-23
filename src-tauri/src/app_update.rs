//! In-app updates through the Tauri updater (issue #330).
//!
//! Only copies the user installed themselves from the official downloads replace themselves:
//! the Windows installer (NSIS) and the Linux AppImage. The Windows ZIP and the Linux tar.gz
//! are told about a new version and link to the release page. A deb or rpm install, marked by
//! the `package-manager` file `tools/linux_packages.py` puts beside the binary, never checks:
//! its package manager owns the files. So does an AppImage in a folder the user cannot write.
//!
//! The update metadata (`latest.json`) and the signed files are assets of the GitHub release.
//! The stable channel asks the project's Cloudflare Worker, which forwards to the latest.json of
//! the latest release (prereleases are never "latest"); the beta channel, which a `-beta` version
//! is on, reads the newest release of either kind through the GitHub API and falls back to the
//! stable address. The download is verified against the public key in tauri.conf.json, and the
//! signature has to name the announced version (`requireSignedVersion`).
//!
//! The backend core's update endpoints (`/get/data/available_releases`, the start-up
//! `/run/software_update_info`, `/run/update_software`) use the same updater through
//! [`CoreUpdates`], which `backend_host.rs` gives the core. The release list comes from the same
//! GitHub release list and channel rule as the beta manifest ([`list_releases`]).
//!
//! Nothing here sees the user's text or voice. The log gets error kinds and URLs only.

use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url, WebviewWindow};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use astarot_core::controller::updates::{SoftwareUpdates, UpdateOutcome, no_update};

/// The owner of the project's releases. Their downloads are the only ones taken ([`project_download`]).
const OWNER: &str = "kein5";
/// The repository, for the release list and the release pages. GitHub forwards an old name only
/// while nothing else takes it: the old name kein5/VRCT-VOX is now a repository of its own that
/// holds a copy of 0.5.0 and nothing newer (Issue #534), so the current name is used.
const REPOSITORY: &str = "kein5/astarot";
const STABLE_MANIFEST: &str = "https://vrct-vox-updates.kei9d09.workers.dev/latest.json";
/// The beta channel's latest.json (#466): the Worker forwards it to beta/latest.json of the branch
/// updater-channels, which a published release points at the newest release, beta or stable
/// (`tools/update_channels.py`). The app no longer reads the release list for it.
const BETA_MANIFEST: &str = "https://vrct-vox-updates.kei9d09.workers.dev/beta/latest.json";
const RELEASES_API: &str = "https://api.github.com/repos/kein5/astarot/releases?per_page=30";
const MANIFEST_NAME: &str = "latest.json";

/// How this copy of the app was installed, which decides what an update can do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallKind {
    /// A debug build: never checks.
    Development,
    /// Installed by the NSIS installer (`uninstall.exe` beside the binary). There is one package
    /// (#288): a CUDA install from 0.4 or earlier updates as any other.
    WindowsInstaller,
    /// Extracted from VRCT-VOX.zip (or VRCT-VOX_cuda.zip up to 0.5).
    WindowsPortable,
    /// A writable AppImage.
    AppImage,
    /// An AppImage in a place the user cannot write (a system or distribution package).
    AppImageReadOnly,
    /// Extracted from the tar.gz.
    LinuxArchive,
    /// Installed by a package manager (deb, rpm).
    PackageManager(String),
    Unsupported,
}

impl InstallKind {
    fn name(&self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::WindowsInstaller => "windows_installer",
            Self::WindowsPortable => "windows_portable",
            Self::AppImage => "appimage",
            Self::AppImageReadOnly => "appimage_read_only",
            Self::LinuxArchive => "linux_archive",
            Self::PackageManager(_) => "package_manager",
            Self::Unsupported => "unsupported",
        }
    }

    /// `install`: checks and applies in the app. `manual`: checks, the user downloads.
    /// `package_manager`: no check, the package manager updates. `disabled`: no check.
    fn mode(&self) -> &'static str {
        match self {
            Self::WindowsInstaller | Self::AppImage => "install",
            Self::WindowsPortable | Self::LinuxArchive | Self::AppImageReadOnly => "manual",
            Self::PackageManager(_) => "package_manager",
            Self::Development | Self::Unsupported => "disabled",
        }
    }

    fn checks(&self) -> bool {
        matches!(self.mode(), "install" | "manual")
    }

    /// The `platforms` key of latest.json when this copy checks for updates at all.
    fn checking_target(&self) -> Option<&'static str> {
        if self.checks() { self.target() } else { None }
    }

    /// The `platforms` key of latest.json this copy reads.
    fn target(&self) -> Option<&'static str> {
        match self {
            Self::WindowsInstaller | Self::WindowsPortable => Some("windows-x86_64"),
            Self::AppImage | Self::AppImageReadOnly | Self::LinuxArchive => Some("linux-x86_64"),
            _ => None,
        }
    }
}

/// Decides the install kind from the running binary and, on Linux, `$APPIMAGE`.
pub fn detect_install(executable: &Path, appimage: Option<&Path>, debug: bool) -> InstallKind {
    if debug {
        return InstallKind::Development;
    }
    let Some(directory) = executable.parent() else {
        return InstallKind::Unsupported;
    };
    if cfg!(windows) {
        if directory.join("uninstall.exe").is_file() {
            return InstallKind::WindowsInstaller;
        }
        return InstallKind::WindowsPortable;
    }
    if cfg!(target_os = "linux") {
        if let Ok(kind) = std::fs::read_to_string(directory.join("package-manager")) {
            let kind = kind.trim();
            let kind = if matches!(kind, "deb" | "rpm") { kind } else { "unknown" };
            return InstallKind::PackageManager(kind.to_owned());
        }
        if let Some(appimage) = appimage.filter(|path| path.is_file()) {
            // The app writes the new AppImage beside it and renames it over ([`replace_appimage`]).
            let writable = appimage.parent().is_some_and(directory_is_writable);
            return if writable { InstallKind::AppImage } else { InstallKind::AppImageReadOnly };
        }
        return InstallKind::LinuxArchive;
    }
    InstallKind::Unsupported
}

fn directory_is_writable(directory: &Path) -> bool {
    let probe = directory.join(format!(".vrct-vox-update-probe-{}", std::process::id()));
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The channel of the running build, like the release branches: a `-beta.N` version is on the
/// beta channel. It is also the update channel until the user chooses one (#466).
pub fn channel_of(version: &semver::Version) -> &'static str {
    if version.pre.is_empty() { "stable" } else { "beta" }
}

/// The update channel: the one named (`SELECTED_RELEASE_CHANNEL`, the user's choice or else the
/// build's), or the build's when none or an unknown one is named (#466).
pub fn update_channel(named: Option<&str>, version: &semver::Version) -> &'static str {
    match named {
        Some("beta") => "beta",
        Some("stable") => "stable",
        _ => channel_of(version),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, serde::Deserialize)]
pub struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// The version and latest.json of a release the channel takes and the updater can install.
/// Stable takes stable releases only; beta takes betas and stable releases alike, so a beta
/// tester moves on to the stable release once it is out. Drafts, tags that are not a version,
/// releases without latest.json and anything but the project's release downloads are left out.
fn installable(release: &GithubRelease, channel: &str) -> Option<(semver::Version, Url)> {
    if release.draft || (channel != "beta" && release.prerelease) {
        return None;
    }
    let version = semver::Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
    let asset = release.assets.iter().find(|asset| asset.name == MANIFEST_NAME)?;
    let url = Url::parse(&asset.browser_download_url).ok().filter(project_download)?;
    Some((version, url))
}

/// A release download of the project's owner: `https://github.com/<owner>/<repository>/releases/download/…`.
/// The repository's name is not checked. GitHub still answers the API at a renamed repository's
/// old name, and the downloads it lists then carry the new name: checking the name would empty
/// the beta channel and the release list without a word once the repository is renamed (Issue
/// #456). What proves a download is its signature (`requireSignedVersion`); this only keeps the
/// updater on the owner's GitHub release files.
fn project_download(url: &Url) -> bool {
    let plain = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    let segments: Vec<&str> = url.path_segments().map(Iterator::collect).unwrap_or_default();
    plain
        && matches!(segments.as_slice(), [owner, repository, "releases", "download", tag, _, ..]
            if owner.eq_ignore_ascii_case(OWNER) && !repository.is_empty() && !tag.is_empty())
}

/// The latest.json files the release list names outside the project's downloads. The list
/// leaves them out; they are logged so that a move of the downloads (another owner, another
/// host) shows in the log instead of only as an empty list.
fn foreign_manifests(releases: &[GithubRelease]) -> impl Iterator<Item = &str> {
    releases
        .iter()
        .flat_map(|release| release.assets.iter())
        .filter(|asset| asset.name == MANIFEST_NAME)
        .map(|asset| asset.browser_download_url.as_str())
        .filter(|url| !Url::parse(url).is_ok_and(|url| project_download(&url)))
}

/// The latest.json of the newest release the channel takes. The beta channel's is chosen so by
/// `tools/update_channels.py` now (#466); kept for the tests of what a channel takes.
#[cfg(test)]
pub fn pick_manifest(releases: &[GithubRelease], channel: &str) -> Option<Url> {
    releases
        .iter()
        .filter_map(|release| installable(release, channel))
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, url)| url)
}

/// One entry of `/get/data/available_releases` (`ReleaseInfo` of the Python backend).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReleaseEntry {
    pub tag: String,
    pub version: String,
    pub is_prerelease: bool,
    pub published_at: String,
}

/// The releases the channel can move to, newest first: the same choice as [`pick_manifest`],
/// the running version and older ones included (Python's version picker listed them too).
pub fn list_releases(releases: &[GithubRelease], channel: &str) -> Vec<ReleaseEntry> {
    let mut listed: Vec<(semver::Version, ReleaseEntry)> = releases
        .iter()
        .filter_map(|release| {
            let (version, _) = installable(release, channel)?;
            let entry = ReleaseEntry {
                tag: release.tag_name.clone(),
                version: version.to_string(),
                is_prerelease: release.prerelease,
                published_at: release.published_at.clone().unwrap_or_default(),
            };
            Some((version, entry))
        })
        .collect();
    listed.sort_by(|a, b| b.0.cmp(&a.0));
    listed.into_iter().map(|(_, entry)| entry).collect()
}

/// The version and latest.json of a listed release, by its version (`0.5.0` or `v0.5.0`).
pub fn find_release(releases: &[GithubRelease], channel: &str, wanted: &str) -> Option<(semver::Version, Url)> {
    let wanted = semver::Version::parse(wanted.trim().strip_prefix('v').unwrap_or(wanted.trim())).ok()?;
    releases
        .iter()
        .filter_map(|release| installable(release, channel))
        .find(|(version, _)| *version == wanted)
}

/// The project's releases from the GitHub API, newest 30, without authentication.
async fn fetch_releases() -> Result<Vec<GithubRelease>, String> {
    // The updater installs the same provider before its own requests.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("ASTAROT-updater")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub API answered {}", response.status()));
    }
    let body = response.bytes().await.map_err(|error| error.to_string())?;
    let releases: Vec<GithubRelease> = serde_json::from_slice(&body).map_err(|error| error.to_string())?;
    for url in foreign_manifests(&releases) {
        crate::startup_log(&format!("Update: skipped a latest.json outside the project's downloads: {url}"));
    }
    Ok(releases)
}

/// How long a finished check answers a check that starts after it. The core's start-up check
/// and the update page's check at start run at the same time; one request serves both.
const CHECK_REUSE: Duration = Duration::from_secs(30);

type LatestCheck = Result<Option<Update>, String>;

/// What `app_update_install` installs: the update the check of the channel asked for last found
/// (#1017). A check of another channel drops the update at once, also when it is refused
/// (`update_busy`) or fails; a check that ends after another channel was asked for keeps nothing.
/// So the version of the channel set before is never installed, whatever the page shows.
struct Pending<U> {
    /// The channel the newest check asked about.
    channel: Option<&'static str>,
    update: Option<U>,
}

impl<U> Default for Pending<U> {
    fn default() -> Self {
        Self { channel: None, update: None }
    }
}

impl<U> Pending<U> {
    /// A check of `channel` starts.
    fn ask(&mut self, channel: &'static str) {
        if self.channel != Some(channel) {
            self.update = None;
        }
        self.channel = Some(channel);
    }

    /// The check of `channel` found `update` (none: nothing newer, or nothing to install here).
    fn found(&mut self, channel: &'static str, update: Option<U>) {
        if self.channel == Some(channel) {
            self.update = update;
        }
    }
}

#[derive(Default)]
pub struct AppUpdateState {
    pending: Mutex<Pending<Update>>,
    busy: AtomicBool,
    /// The last check of a channel's newest release, with the channel. Held while a check runs, so
    /// that a second one waits for it instead of asking again.
    last_check: tauri::async_runtime::Mutex<Option<(Instant, &'static str, LatestCheck)>>,
}

struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn acquire(state: &AppUpdateState) -> Result<BusyGuard<'_>, String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("update_busy".into());
    }
    Ok(BusyGuard(&state.busy))
}

fn install_kind<R: Runtime>(app: &AppHandle<R>) -> InstallKind {
    let executable = std::env::current_exe().unwrap_or_default();
    detect_install(&executable, appimage_of(app).as_deref(), cfg!(debug_assertions))
}

/// The AppImage this copy runs from (`$APPIMAGE`), on Linux.
fn appimage_of<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        app.env().appimage.map(PathBuf::from)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        None
    }
}

/// The AppImage an install replaces: this copy's, when it is a writable one.
fn replaced_appimage<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    (install_kind(app) == InstallKind::AppImage).then(|| appimage_of(app)).flatten()
}

/// An updater for this copy that reads `endpoints`. With `exactly`, the release of that version
/// is taken whether it is newer or not (an update to a chosen version); otherwise only a newer
/// one is.
fn build_updater<R: Runtime>(
    app: &AppHandle<R>,
    target: &str,
    endpoints: Vec<Url>,
    exactly: Option<semver::Version>,
) -> Result<Updater, String> {
    // The Windows installer fetches VRCT-VOX.zip again; there is no edition to name (#288).
    let mut builder = app
        .updater_builder()
        .target(target)
        .timeout(Duration::from_secs(30))
        .endpoints(endpoints)
        .map_err(|error| error.to_string())?;
    if let Some(wanted) = exactly {
        builder = builder.version_comparator(move |_, release| release.version == wanted);
    }
    // Windows: once the installer has started, the updater ends this process with
    // `std::process::exit`, so RunEvent::Exit never comes. The core is stopped here instead: it
    // saves a setting changed in the last two seconds and stops the speech servers, whose files
    // the installer replaces. Linux restarts through RunEvent::Exit, which stops it already.
    let stopping = app.clone();
    builder = builder.on_before_exit(move || {
        if let Some(host) = stopping.try_state::<crate::backend_host::BackendHost>() {
            crate::startup_log("Stopping the backend before the installer starts");
            CORE_STOPPED_FOR_INSTALLER.store(true, Ordering::SeqCst);
            host.stop_and_wait("The app is being updated; stopping", crate::backend_host::UPDATE_STOP_LIMIT);
        }
    });
    builder.build().map_err(|error| {
        crate::startup_log(&format!("Update: updater unavailable: {error}"));
        "update_check_failed".to_string()
    })
}

fn check_error_code(error: &tauri_plugin_updater::Error) -> &'static str {
    match error {
        // No latest.json (a release from before the updater) or no entry for this target.
        tauri_plugin_updater::Error::ReleaseNotFound
        | tauri_plugin_updater::Error::TargetNotFound(_)
        | tauri_plugin_updater::Error::TargetsNotFound(_) => "update_metadata_missing",
        _ => "update_check_failed",
    }
}

fn download_error_code(error: &tauri_plugin_updater::Error) -> &'static str {
    match error {
        tauri_plugin_updater::Error::Minisign(_)
        | tauri_plugin_updater::Error::Base64(_)
        | tauri_plugin_updater::Error::SignatureUtf8(_)
        | tauri_plugin_updater::Error::SignedVersionMismatch { .. }
        | tauri_plugin_updater::Error::MissingSignedVersion => "update_signature_invalid",
        _ => "update_download_failed",
    }
}

/// Asks for the newest release of `channel`. The updater offers only a version newer than the
/// running one, so a stable channel on a beta build waits for the next stable release (#466).
async fn check_channel<R: Runtime>(app: &AppHandle<R>, target: &str, channel: &'static str) -> LatestCheck {
    let stable = Url::parse(STABLE_MANIFEST).map_err(|error| error.to_string())?;
    let mut endpoints = Vec::new();
    if channel == "beta" {
        // The Worker's beta channel first; the updater asks the next endpoint when one fails, so
        // the stable channel still answers while the beta one cannot (#466).
        endpoints.push(Url::parse(BETA_MANIFEST).map_err(|error| error.to_string())?);
    }
    endpoints.push(stable);
    let updater = build_updater(app, target, endpoints, None)?;
    updater.check().await.map_err(|error| {
        crate::startup_log(&format!("Update check failed: {error}"));
        check_error_code(&error).to_string()
    })
}

/// [`check_channel`], sharing a check of the same channel that runs or has just ended
/// (`CHECK_REUSE`). A failed check is shared only with the checks that waited for it: asking again
/// tries again.
async fn check_latest<R: Runtime>(app: &AppHandle<R>, state: &AppUpdateState, target: &str, channel: &'static str) -> LatestCheck {
    let mut last = state.last_check.lock().await;
    if let Some((at, checked, result)) = last.as_ref()
        && *checked == channel
        && ((result.is_ok() && at.elapsed() < CHECK_REUSE) || at.elapsed() < Duration::from_secs(1))
    {
        return result.clone();
    }
    let result = check_channel(app, target, channel).await;
    *last = Some((Instant::now(), channel, result.clone()));
    result
}

/// The core was stopped for the Windows installer (`on_before_exit`). Once that has happened the
/// app has no backend left, so a failure to start the installer must not leave it running so.
static CORE_STOPPED_FOR_INSTALLER: AtomicBool = AtomicBool::new(false);

/// Sent to the main window when a failed install is about to restart the app (Issue #561). It
/// carries nothing: the window says the update was not installed and the app restarts.
pub(crate) const RESTARTING_EVENT: &str = "app-update-restarting";

/// How long the main window has to say so before the app restarts.
const RESTART_NOTICE: Duration = Duration::from_secs(5);

/// After a failed install: when the core was already stopped for the installer (Windows: the
/// installer could not start, or the user declined it), the app restarts as it is, with its
/// backend, instead of going on without one (Issue #456). The user did not ask for that restart,
/// so the main window says it first ([`RESTARTING_EVENT`]) and the restart comes
/// [`RESTART_NOTICE`] later (Issue #561). Answers whether it restarts.
fn restart_if_core_stopped<R: Runtime>(app: &AppHandle<R>) -> bool {
    if !CORE_STOPPED_FOR_INSTALLER.swap(false, Ordering::SeqCst) {
        return false;
    }
    crate::startup_log("Update: the installer did not start after the backend stopped; restarting");
    let _ = app.emit_to("main", RESTARTING_EVENT, ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(RESTART_NOTICE);
        app.request_restart();
    });
    true
}

/// Downloads `update`, verifies its signature and installs it. On Windows the installer takes
/// over and this process exits; elsewhere it returns, and the caller restarts the app. A failure
/// before the core is stopped leaves the running app as it was; a failure after it (the Windows
/// installer did not start) restarts the app through [`restart_if_core_stopped`]. A writable
/// AppImage (`appimage`) is replaced here, in one rename ([`replace_appimage`]), not by the
/// updater, which writes the new file over the current one.
async fn download_and_install(update: &Update, appimage: Option<&Path>, mut progress: impl FnMut(InstallProgress)) -> Result<(), &'static str> {
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                progress(InstallProgress::Download { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|error| {
            crate::startup_log(&format!("Update download failed: {error}"));
            download_error_code(&error)
        })?;
    progress(InstallProgress::Install);
    crate::startup_log(&format!("Installing update {}", update.version));
    if let Some(appimage) = appimage {
        // The same check the updater's own install makes, then a replacement in one rename.
        update.verify(&bytes).map_err(|error| {
            crate::startup_log(&format!("Update verification failed: {error}"));
            "update_signature_invalid"
        })?;
        return replace_appimage(appimage, &bytes).map_err(|error| {
            crate::startup_log(&format!("Update install failed: {}", error.kind()));
            "update_install_failed"
        });
    }
    // Windows: starts the installer and exits.
    update.install(bytes).map_err(|error| {
        crate::startup_log(&format!("Update install failed: {error}"));
        "update_install_failed"
    })
}

/// The prefix of the file a replacement of the AppImage `name` writes beside it.
fn staged_prefix(name: &str) -> String {
    format!(".{name}.update-")
}

/// Puts the verified AppImage `bytes` in place of `appimage` in one rename (#517). The new file
/// is written beside it under a hidden name ([`staged_prefix`]), given the current file's
/// permissions, flushed to disk and renamed over it; the folder is flushed after. A failure or
/// a stop before the rename leaves the current AppImage as it was, and the file it left is
/// removed at the next start ([`remove_appimage_leftovers`]). The running copy keeps its old
/// file open, as the updater's own replacement does.
///
/// Decided in #881: once `tauri-plugin-updater` replaces an AppImage atomically itself (a new
/// file beside it, then a rename), this goes and a writable AppImage is installed with
/// `Update::install` again, as the Windows installer is. Check the plugin's `install_appimage`
/// when it is updated.
fn replace_appimage(appimage: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    // AppImages are ELF executables; anything else is not installed.
    if !bytes.starts_with(b"\x7fELF") {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "not an AppImage"));
    }
    let directory = appimage.parent().ok_or_else(|| std::io::Error::other("the AppImage has no folder"))?;
    let name = appimage.file_name().ok_or_else(|| std::io::Error::other("the AppImage has no name"))?.to_string_lossy();
    let permissions = std::fs::metadata(appimage)?.permissions();
    let (staged, mut file) = {
        let mut attempt = 0u32;
        loop {
            let candidate = directory.join(format!("{}{}-{attempt}", staged_prefix(&name), std::process::id()));
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
                Ok(file) => break (candidate, file),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && attempt < 100 => attempt += 1,
                Err(error) => return Err(error),
            }
        }
    };
    let written = (|| {
        file.write_all(bytes)?;
        file.set_permissions(permissions)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&staged, appimage)
    })();
    match written {
        Ok(()) => {
            #[cfg(unix)]
            if let Ok(folder) = std::fs::File::open(directory) {
                let _ = folder.sync_all();
            }
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&staged);
            Err(error)
        }
    }
}

/// Removes what a replacement of `appimage` that stopped before its rename left beside it: the
/// regular files named with [`staged_prefix`]. Nothing else in the folder is touched.
fn remove_appimage_leftovers(appimage: &Path) {
    let (Some(directory), Some(name)) = (appimage.parent(), appimage.file_name()) else { return };
    let prefix = staged_prefix(&name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(directory) else { return };
    for entry in entries.flatten() {
        let ours = entry.file_name().to_str().is_some_and(|n| n.starts_with(&prefix));
        if ours && entry.file_type().is_ok_and(|kind| kind.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// At start: the files an AppImage replacement left when it stopped part way.
pub fn clean_up_after_updates<R: Runtime>(app: &AppHandle<R>) {
    if let Some(appimage) = replaced_appimage(app) {
        remove_appimage_leftovers(&appimage);
    }
}

fn main_only<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("update_forbidden".into()) }
}

#[derive(Serialize)]
pub struct UpdateInfo {
    kind: &'static str,
    mode: &'static str,
    channel: &'static str,
    current_version: String,
    package_manager: Option<String>,
}

#[tauri::command]
pub fn app_update_info<R: Runtime>(window: WebviewWindow<R>, app: AppHandle<R>) -> Result<UpdateInfo, String> {
    main_only(&window)?;
    let kind = install_kind(&app);
    let version = &app.package_info().version;
    Ok(UpdateInfo {
        kind: kind.name(),
        mode: kind.mode(),
        channel: channel_of(version),
        current_version: version.to_string(),
        package_manager: match kind {
            InstallKind::PackageManager(name) => Some(name),
            _ => None,
        },
    })
}

#[derive(Serialize)]
pub struct CheckResult {
    available: bool,
    version: Option<String>,
    /// The release page, which the UI opens for notes and manual downloads.
    release_url: Option<String>,
}

#[tauri::command]
pub async fn app_update_check<R: Runtime>(
    window: WebviewWindow<R>,
    app: AppHandle<R>,
    state: tauri::State<'_, AppUpdateState>,
    channel: Option<String>,
) -> Result<CheckResult, String> {
    main_only(&window)?;
    let kind = install_kind(&app);
    let Some(target) = kind.checking_target() else {
        return Err("update_unsupported".into());
    };
    // The update channel the settings name (#466); the build's without one.
    let channel = update_channel(channel.as_deref(), &app.package_info().version);
    state.pending.lock().map_err(|_| "update_check_failed".to_string())?.ask(channel);
    let _busy = acquire(&state)?;
    let update = check_latest(&app, &state, target, channel).await?;
    let result = CheckResult {
        available: update.is_some(),
        version: update.as_ref().map(|update| update.version.clone()),
        release_url: update
            .as_ref()
            .map(|update| format!("https://github.com/{REPOSITORY}/releases/tag/v{}", update.version)),
    };
    state
        .pending
        .lock()
        .map_err(|_| "update_check_failed".to_string())?
        .found(channel, update.filter(|_| kind.mode() == "install"));
    Ok(result)
}

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum InstallProgress {
    Download { downloaded: u64, total: Option<u64> },
    Install,
}

/// Downloads the update found by the last check, verifies its signature and installs it.
/// On Windows the installer takes over and this process exits; on Linux the app restarts.
/// A failure before the core stops leaves the running app as it was; on Windows the core stops
/// just before the installer starts, so a failure after that restarts the app.
#[tauri::command]
pub async fn app_update_install<R: Runtime>(
    window: WebviewWindow<R>,
    app: AppHandle<R>,
    state: tauri::State<'_, AppUpdateState>,
    on_progress: Channel<InstallProgress>,
) -> Result<(), String> {
    main_only(&window)?;
    if install_kind(&app).mode() != "install" {
        return Err("update_unsupported".into());
    }
    let _busy = acquire(&state)?;
    let update = state
        .pending
        .lock()
        .map_err(|_| "update_install_failed".to_string())?
        .update
        .clone()
        .ok_or_else(|| "update_not_checked".to_string())?;
    download_and_install(&update, replaced_appimage(&app).as_deref(), |progress| {
        let _ = on_progress.send(progress);
    })
    .await
    .map_err(|code| {
        restart_if_core_stopped(&app);
        code.to_string()
    })?;
    app.restart();
}

/// `/run/software_update_info` from a check: the version found, or none.
fn update_info(found: Result<Option<&str>, &str>) -> Value {
    match found {
        Ok(Some(version)) => json!({ "is_update_available": true, "new_version": version }),
        // Python's answer when the check failed or found nothing newer.
        Ok(None) | Err(_) => no_update(),
    }
}

/// What the core reports for an `update_*` code of [`download_and_install`] or of the check.
fn outcome_of(code: &str) -> UpdateOutcome {
    if code == "update_signature_invalid" { UpdateOutcome::VerifyFailed } else { UpdateOutcome::DownloadFailed }
}

/// The updater behind the core's update endpoints (`docs/voice-stack/core-integration.md`,
/// decision 20): the same install kinds, channel, release list, check and signed download as
/// the update page. The calls come on the core's own threads, never on the async runtime.
pub struct CoreUpdates<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> CoreUpdates<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }

    async fn install_async(&self, target_version: Option<&str>, channel: &'static str) -> Result<(), &'static str> {
        let app = &self.app;
        let kind = install_kind(app);
        // A ZIP, a tar.gz, a read-only AppImage or a package is updated by the user or the
        // package manager; the update page says how.
        let target = match (kind.mode(), kind.target()) {
            ("install", Some(target)) => target,
            _ => return Err("update_unsupported"),
        };
        let state = app.state::<AppUpdateState>();
        let _busy = acquire(&state).map_err(|_| "update_busy")?;
        let update = match target_version {
            None => check_latest(app, &state, target, channel).await.map_err(|_| "update_check_failed")?,
            Some(wanted) => {
                let releases = fetch_releases().await.map_err(|error| {
                    crate::startup_log(&format!("Update: release list unavailable: {error}"));
                    "update_check_failed"
                })?;
                let (version, manifest) = find_release(&releases, channel, wanted).ok_or("update_not_listed")?;
                let updater = build_updater(app, target, vec![manifest], Some(version))
                    .map_err(|_| "update_check_failed")?;
                updater.check().await.map_err(|error| {
                    crate::startup_log(&format!("Update check failed: {error}"));
                    check_error_code(&error)
                })?
            }
        };
        let update = update.ok_or("update_not_found")?;
        download_and_install(&update, replaced_appimage(app).as_deref(), |_| {}).await
    }
}

impl<R: Runtime> SoftwareUpdates for CoreUpdates<R> {
    fn check(&self, channel: &str) -> Value {
        let kind = install_kind(&self.app);
        let Some(target) = kind.checking_target() else {
            return no_update();
        };
        let state = self.app.state::<AppUpdateState>();
        let channel = update_channel(Some(channel), &self.app.package_info().version);
        let result = tauri::async_runtime::block_on(check_latest(&self.app, &state, target, channel));
        update_info(result.as_ref().map(|update| update.as_ref().map(|update| update.version.as_str())).map_err(String::as_str))
    }

    fn releases(&self, channel: &str) -> Vec<Value> {
        if install_kind(&self.app).checking_target().is_none() {
            return Vec::new();
        }
        let channel = update_channel(Some(channel), &self.app.package_info().version);
        match tauri::async_runtime::block_on(fetch_releases()) {
            Ok(releases) => list_releases(&releases, channel)
                .into_iter()
                .filter_map(|entry| serde_json::to_value(entry).ok())
                .collect(),
            Err(error) => {
                crate::startup_log(&format!("Update: release list unavailable: {error}"));
                Vec::new()
            }
        }
    }

    /// Both update endpoints install the one package, as the update page does (#288).
    fn install(&self, target_version: Option<&str>, channel: &str) -> UpdateOutcome {
        let channel = update_channel(Some(channel), &self.app.package_info().version);
        match tauri::async_runtime::block_on(self.install_async(target_version, channel)) {
            Ok(()) => {
                // Linux: the AppImage is replaced. The restart ends the app through its normal
                // exit, which stops the core.
                self.app.request_restart();
                UpdateOutcome::Launched
            }
            Err(code) => {
                crate::startup_log(&format!("Update from the backend failed: {code}"));
                restart_if_core_stopped(&self.app);
                outcome_of(code)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An AppImage of `content` in a folder of its own, executable as a downloaded one is made.
    #[cfg(unix)]
    fn appimage(content: &[u8]) -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ASTAROT.AppImage");
        std::fs::write(&path, content).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, path)
    }

    #[cfg(unix)]
    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[cfg(unix)]
    #[test]
    fn an_appimage_is_replaced_in_one_rename_and_keeps_its_permissions() {
        use std::io::Read;
        use std::os::unix::fs::PermissionsExt;
        let (dir, path) = appimage(b"\x7fELF old");
        // The running copy keeps reading the file it started from.
        let mut running = std::fs::File::open(&path).unwrap();
        replace_appimage(&path, b"\x7fELF new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"\x7fELF new");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(names(dir.path()), ["ASTAROT.AppImage"], "the staged file was left");
        let mut old = Vec::new();
        running.read_to_end(&mut old).unwrap();
        assert_eq!(old, b"\x7fELF old");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_replacement_leaves_the_appimage_as_it_was() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, path) = appimage(b"\x7fELF old");
        // Not an AppImage: refused before anything is written.
        assert_eq!(replace_appimage(&path, b"PK\x03\x04 zip").unwrap_err().kind(), std::io::ErrorKind::InvalidData);
        // A folder that cannot be written: the new file cannot be made beside it.
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let writable_anyway = std::fs::File::create(dir.path().join("probe")).is_ok();
        if !writable_anyway {
            assert!(replace_appimage(&path, b"\x7fELF new").is_err());
        }
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let _ = std::fs::remove_file(dir.path().join("probe"));
        assert_eq!(std::fs::read(&path).unwrap(), b"\x7fELF old");
        assert_eq!(names(dir.path()), ["ASTAROT.AppImage"]);
    }

    #[cfg(unix)]
    #[test]
    fn what_a_stopped_replacement_left_goes_and_nothing_else() {
        let (dir, path) = appimage(b"\x7fELF current");
        // A replacement stopped between writing and renaming: its file, then others' files.
        std::fs::write(dir.path().join(".ASTAROT.AppImage.update-1234-0"), b"\x7fELF half").unwrap();
        std::fs::create_dir(dir.path().join(".ASTAROT.AppImage.update-folder")).unwrap();
        std::fs::write(dir.path().join(".Other.AppImage.update-1234-0"), b"x").unwrap();
        std::fs::write(dir.path().join("ASTAROT.AppImage.update-1234-0"), b"x").unwrap();
        remove_appimage_leftovers(&path);
        assert_eq!(names(dir.path()), [".ASTAROT.AppImage.update-folder", ".Other.AppImage.update-1234-0", "ASTAROT.AppImage", "ASTAROT.AppImage.update-1234-0"]);
        assert_eq!(std::fs::read(&path).unwrap(), b"\x7fELF current");
    }

    fn release(tag: &str, prerelease: bool, manifest: bool) -> GithubRelease {
        let mut assets = vec![GithubAsset {
            name: "VRCT-VOX.zip".into(),
            browser_download_url: format!("https://github.com/{REPOSITORY}/releases/download/{tag}/VRCT-VOX.zip"),
        }];
        if manifest {
            assets.push(GithubAsset {
                name: MANIFEST_NAME.into(),
                browser_download_url: format!("https://github.com/{REPOSITORY}/releases/download/{tag}/latest.json"),
            });
        }
        GithubRelease { tag_name: tag.into(), draft: false, prerelease, published_at: Some(format!("{tag}-date")), assets }
    }

    fn versions(entries: &[ReleaseEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.version.as_str()).collect()
    }

    /// #1017: the version of the channel set before is never what an install takes.
    #[test]
    fn only_the_channel_asked_for_last_keeps_its_update_for_the_install() {
        let mut pending = Pending::<&str>::default();
        pending.ask("stable");
        pending.found("stable", Some("0.6.1"));
        assert_eq!(pending.update, Some("0.6.1"));

        // The same channel again keeps the update until its own answer, which a failure never gives.
        pending.ask("stable");
        assert_eq!(pending.update, Some("0.6.1"));

        // Another channel drops it at once: the check may be refused (update_busy) or fail.
        pending.ask("beta");
        assert_eq!(pending.update, None);
        pending.found("beta", Some("0.7.0-beta.1"));
        assert_eq!(pending.update, Some("0.7.0-beta.1"));

        // A stable check that ends after beta was asked for keeps nothing.
        pending.ask("stable");
        pending.ask("beta");
        pending.found("stable", Some("0.6.1"));
        assert_eq!(pending.update, None);
        pending.found("beta", None);
        assert_eq!(pending.update, None, "nothing newer on beta");
    }

    #[test]
    fn the_list_follows_the_channel_newest_first() {
        let releases = vec![
            release("v0.4.0-beta.2", true, true),
            release("v0.5.0", false, true),
            release("v0.4.0", false, true),
            release("v0.5.1-beta.1", true, true),
            // Before the updater: nothing the updater could install.
            release("v0.3.0", false, false),
        ];
        assert_eq!(versions(&list_releases(&releases, "stable")), ["0.5.0", "0.4.0"]);
        let beta = list_releases(&releases, "beta");
        assert_eq!(versions(&beta), ["0.5.1-beta.1", "0.5.0", "0.4.0", "0.4.0-beta.2"]);
        assert_eq!(
            beta[0],
            ReleaseEntry {
                tag: "v0.5.1-beta.1".into(),
                version: "0.5.1-beta.1".into(),
                is_prerelease: true,
                published_at: "v0.5.1-beta.1-date".into(),
            }
        );
        // The list and the manifest the check reads agree on the newest release.
        assert!(pick_manifest(&releases, "beta").unwrap().as_str().ends_with("/v0.5.1-beta.1/latest.json"));
    }

    #[test]
    fn the_list_leaves_out_drafts_foreign_downloads_and_odd_tags() {
        let mut draft = release("v9.0.0", false, true);
        draft.draft = true;
        let mut foreign = release("v8.0.0", false, true);
        foreign.assets[1].browser_download_url = "https://example.com/latest.json".into();
        let mut odd = release("nightly", false, true);
        odd.published_at = None;
        let mut undated = release("v0.5.0", false, true);
        undated.published_at = None;
        let listed = list_releases(&[draft, foreign, odd, undated], "beta");
        assert_eq!(versions(&listed), ["0.5.0"]);
        assert_eq!(listed[0].published_at, "");
        let entry = serde_json::to_value(&listed[0]).unwrap();
        assert_eq!(entry, serde_json::json!({ "tag": "v0.5.0", "version": "0.5.0", "is_prerelease": false, "published_at": "" }));
    }

    #[test]
    fn a_chosen_version_must_be_listed_for_the_channel() {
        let releases = vec![release("v0.5.0", false, true), release("v0.5.1-beta.1", true, true), release("v0.4.0", false, false)];
        let (version, url) = find_release(&releases, "stable", "0.5.0").unwrap();
        assert_eq!(version.to_string(), "0.5.0");
        assert!(url.as_str().ends_with("/v0.5.0/latest.json"), "{url}");
        assert_eq!(find_release(&releases, "stable", "v0.5.0").unwrap().0.to_string(), "0.5.0");
        // A beta is not on the stable channel; a release without latest.json cannot be installed.
        assert!(find_release(&releases, "stable", "0.5.1-beta.1").is_none());
        assert!(find_release(&releases, "beta", "0.5.1-beta.1").is_some());
        assert!(find_release(&releases, "beta", "0.4.0").is_none());
        assert!(find_release(&releases, "beta", "0.9.9").is_none());
        assert!(find_release(&releases, "beta", "latest").is_none());
    }

    #[test]
    fn the_start_up_answer_and_the_reported_failure() {
        assert_eq!(update_info(Ok(Some("0.6.0"))), serde_json::json!({ "is_update_available": true, "new_version": "0.6.0" }));
        let none = serde_json::json!({ "is_update_available": false, "new_version": "" });
        assert_eq!(update_info(Ok(None)), none);
        assert_eq!(update_info(Err("update_check_failed")), none);
        assert_eq!(outcome_of("update_signature_invalid"), UpdateOutcome::VerifyFailed);
        for code in ["update_download_failed", "update_install_failed", "update_unsupported", "update_busy",
            "update_not_listed", "update_not_found", "update_check_failed", "update_metadata_missing"] {
            assert_eq!(outcome_of(code), UpdateOutcome::DownloadFailed, "{code}");
        }
    }

    #[test]
    fn only_copies_that_check_have_a_target() {
        assert_eq!(InstallKind::WindowsInstaller.checking_target(), Some("windows-x86_64"));
        assert_eq!(InstallKind::WindowsPortable.checking_target(), Some("windows-x86_64"));
        assert_eq!(InstallKind::AppImageReadOnly.checking_target(), Some("linux-x86_64"));
        assert_eq!(InstallKind::PackageManager("deb".into()).checking_target(), None);
        assert_eq!(InstallKind::Development.checking_target(), None);
        assert_eq!(InstallKind::Unsupported.checking_target(), None);
    }

    #[test]
    fn beta_takes_the_newest_release_with_metadata_of_either_kind() {
        let releases = vec![
            release("v0.4.0-beta.2", true, true),
            release("v0.4.0", false, true),
            release("v0.4.1-beta.1", true, true),
            release("v0.5.0-beta.1", true, false),
        ];
        let url = pick_manifest(&releases, "beta").unwrap();
        assert!(url.as_str().ends_with("/v0.4.1-beta.1/latest.json"), "{url}");
        let url = pick_manifest(&releases, "stable").unwrap();
        assert!(url.as_str().ends_with("/v0.4.0/latest.json"), "{url}");
    }

    #[test]
    fn drafts_and_foreign_downloads_are_never_used() {
        let mut draft = release("v9.0.0", false, true);
        draft.draft = true;
        let mut foreign = release("v8.0.0", false, true);
        foreign.assets[1].browser_download_url = "https://example.com/latest.json".into();
        assert!(pick_manifest(&[draft, foreign], "beta").is_none());
        assert!(pick_manifest(&[release("v0.3.0", false, false)], "stable").is_none());
    }

    #[test]
    fn a_renamed_repository_keeps_its_releases_and_another_owner_does_not_count() {
        // After a rename GitHub lists the downloads under the new name (Issue #456).
        let mut renamed = release("v0.5.1-beta.1", true, true);
        renamed.assets[1].browser_download_url = "https://github.com/kein5/astarot/releases/download/v0.5.1-beta.1/latest.json".into();
        let releases = vec![release("v0.5.0", false, true), renamed];
        assert_eq!(versions(&list_releases(&releases, "beta")), ["0.5.1-beta.1", "0.5.0"]);
        assert!(pick_manifest(&releases, "beta").unwrap().as_str().contains("/kein5/astarot/"));
        assert_eq!(foreign_manifests(&releases).count(), 0);

        for url in [
            "https://github.com/someone-else/VRCT-VOX/releases/download/v9.0.0/latest.json",
            "http://github.com/kein5/astarot/releases/download/v9.0.0/latest.json",
            "https://github.com:8443/kein5/astarot/releases/download/v9.0.0/latest.json",
            "https://user@github.com/kein5/astarot/releases/download/v9.0.0/latest.json",
            "https://github.com.example.com/kein5/astarot/releases/download/v9.0.0/latest.json",
            "https://github.com/kein5/astarot/archive/v9.0.0/latest.json",
            "https://github.com/kein5/astarot/releases/download/latest.json",
        ] {
            let mut foreign = release("v9.0.0", false, true);
            foreign.assets[1].browser_download_url = url.into();
            let releases = [foreign];
            assert!(pick_manifest(&releases, "beta").is_none(), "{url}");
            // Skipped, and said so in the log.
            assert_eq!(foreign_manifests(&releases).collect::<Vec<_>>(), [url]);
        }
    }

    #[test]
    fn the_release_list_and_pages_name_the_owners_repository() {
        assert!(REPOSITORY.starts_with(&format!("{OWNER}/")));
        assert!(RELEASES_API.starts_with(&format!("https://api.github.com/repos/{REPOSITORY}/releases")));
    }

    #[test]
    fn a_beta_version_is_on_the_beta_channel() {
        let beta = semver::Version::parse("0.4.0-beta.1").unwrap();
        let stable = semver::Version::parse("0.4.0").unwrap();
        assert_eq!(channel_of(&beta), "beta");
        assert_eq!(channel_of(&stable), "stable");
        // #466: the channel the settings name, the build's without one or for an unknown one.
        assert_eq!(update_channel(Some("beta"), &stable), "beta");
        assert_eq!(update_channel(Some("stable"), &beta), "stable");
        assert_eq!(update_channel(None, &beta), "beta");
        assert_eq!(update_channel(Some("nightly"), &stable), "stable");
    }

    #[test]
    fn debug_builds_never_check() {
        let kind = detect_install(Path::new("/nowhere/vrct-vox"), None, true);
        assert_eq!(kind, InstallKind::Development);
        assert_eq!(kind.mode(), "disabled");
    }

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("vrct-vox-update-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_install_kinds() {
        let directory = scratch("linux");
        let binary = directory.join("vrct-vox");
        assert_eq!(detect_install(&binary, None, false), InstallKind::LinuxArchive);

        let appimage = directory.join("VRCT-VOX.AppImage");
        std::fs::write(&appimage, b"").unwrap();
        assert_eq!(detect_install(&binary, Some(&appimage), false), InstallKind::AppImage);

        // The package manager owns the files even when they are writable.
        std::fs::write(directory.join("package-manager"), "rpm\n").unwrap();
        let kind = detect_install(&binary, Some(&appimage), false);
        assert_eq!(kind, InstallKind::PackageManager("rpm".into()));
        assert_eq!(kind.mode(), "package_manager");
        assert!(!kind.checks());
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn an_appimage_the_user_cannot_replace_only_reports() {
        use std::os::unix::fs::PermissionsExt;
        let directory = scratch("readonly");
        let appimage = directory.join("VRCT-VOX.AppImage");
        std::fs::write(&appimage, b"").unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o555)).unwrap();
        let kind = detect_install(Path::new("/tmp/.mount_x/usr/bin/vrct-vox"), Some(&appimage), false);
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::remove_dir_all(&directory).unwrap();
        // root can write anywhere; the probe then rightly reports a writable folder.
        if kind != InstallKind::AppImage {
            assert_eq!(kind, InstallKind::AppImageReadOnly);
            assert_eq!(kind.mode(), "manual");
        }
    }

    #[test]
    #[cfg(windows)]
    fn windows_install_kinds() {
        let directory = scratch("windows");
        let binary = directory.join("vrct-vox.exe");
        assert_eq!(detect_install(&binary, None, false), InstallKind::WindowsPortable);
        std::fs::write(directory.join("uninstall.exe"), b"").unwrap();
        assert_eq!(detect_install(&binary, None, false), InstallKind::WindowsInstaller);
        // A CUDA install of 0.4 or earlier (NVIDIA's libraries in _internal/nvidia) is the same
        // kind: it updates to the one package (#288).
        std::fs::create_dir_all(directory.join("_internal").join("nvidia")).unwrap();
        assert_eq!(detect_install(&binary, None, false), InstallKind::WindowsInstaller);
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn the_app_embeds_the_release_public_key_and_requires_signed_versions() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];
        assert_eq!(updater["requireSignedVersion"], true);
        assert_eq!(updater["endpoints"][0], STABLE_MANIFEST);
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let text = String::from_utf8(engine.decode(updater["pubkey"].as_str().unwrap()).unwrap()).unwrap();
        assert!(text.starts_with("untrusted comment: minisign public key: 1178836E5C9F510B\n"), "{text}");
    }
}
