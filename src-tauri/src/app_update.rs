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
use tauri::{AppHandle, Manager, Runtime, Url, WebviewWindow};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use vrct_core::controller::updates::{SoftwareUpdates, UpdateOutcome, no_update};

const REPOSITORY: &str = "kein5/VRCT-VOX";
const STABLE_MANIFEST: &str = "https://vrct-vox-updates.kei9d09.workers.dev/latest.json";
const RELEASES_API: &str = "https://api.github.com/repos/kein5/VRCT-VOX/releases?per_page=30";
const MANIFEST_NAME: &str = "latest.json";

/// How this copy of the app was installed, which decides what an update can do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallKind {
    /// A debug build: never checks.
    Development,
    /// Installed by the NSIS installer (`uninstall.exe` beside the binary). `gpu` is the CUDA
    /// edition, which the installer has to fetch again.
    WindowsInstaller { gpu: bool },
    /// Extracted from VRCT-VOX.zip or VRCT-VOX_cuda.zip.
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
            Self::WindowsInstaller { .. } => "windows_installer",
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
            Self::WindowsInstaller { .. } | Self::AppImage => "install",
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
            Self::WindowsInstaller { .. } | Self::WindowsPortable => Some("windows-x86_64"),
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
            // The CUDA packages up to 0.4 carried the NVIDIA libraries in _internal/nvidia; from
            // 0.5.0 both packages are the same and an updated CUDA install counts as CPU.
            let gpu = directory.join("_internal").join("nvidia").is_dir();
            return InstallKind::WindowsInstaller { gpu };
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
            // The updater moves the AppImage aside and writes the new one in its place.
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

/// The release channel follows the running version, like the release branches do:
/// a `-beta.N` version is on the beta channel.
pub fn channel_of(version: &semver::Version) -> &'static str {
    if version.pre.is_empty() { "stable" } else { "beta" }
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
/// releases without latest.json and anything but this repository's release downloads are left
/// out.
fn installable(release: &GithubRelease, channel: &str) -> Option<(semver::Version, Url)> {
    if release.draft || (channel != "beta" && release.prerelease) {
        return None;
    }
    let prefix = format!("https://github.com/{REPOSITORY}/releases/download/");
    let version = semver::Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
    let asset = release.assets.iter().find(|asset| asset.name == MANIFEST_NAME)?;
    if !asset.browser_download_url.starts_with(&prefix) {
        return None;
    }
    let url = Url::parse(&asset.browser_download_url).ok()?;
    Some((version, url))
}

/// The latest.json of the newest release the channel takes.
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
        .user_agent("VRCT-VOX-updater")
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
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

async fn beta_manifest() -> Result<Option<Url>, String> {
    Ok(pick_manifest(&fetch_releases().await?, "beta"))
}

/// How long a finished check answers a check that starts after it. The core's start-up check
/// and the update page's check at start run at the same time; one request serves both.
const CHECK_REUSE: Duration = Duration::from_secs(30);

type LatestCheck = Result<Option<Update>, String>;

#[derive(Default)]
pub struct AppUpdateState {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    /// The last check of the channel's newest release. Held while a check runs, so that a
    /// second one waits for it instead of asking again.
    last_check: tauri::async_runtime::Mutex<Option<(Instant, LatestCheck)>>,
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
    #[cfg(target_os = "linux")]
    let appimage = app.env().appimage.map(PathBuf::from);
    #[cfg(not(target_os = "linux"))]
    let appimage: Option<PathBuf> = { let _ = app; None };
    detect_install(&executable, appimage.as_deref(), cfg!(debug_assertions))
}

/// An updater for this copy that reads `endpoints`. With `exactly`, the release of that version
/// is taken whether it is newer or not (an update to a chosen version); otherwise only a newer
/// one is.
fn build_updater<R: Runtime>(
    app: &AppHandle<R>,
    kind: &InstallKind,
    target: &str,
    endpoints: Vec<Url>,
    exactly: Option<semver::Version>,
) -> Result<Updater, String> {
    let mut builder = app
        .updater_builder()
        .target(target)
        .timeout(Duration::from_secs(30))
        .endpoints(endpoints)
        .map_err(|error| error.to_string())?;
    if let InstallKind::WindowsInstaller { gpu } = kind {
        // The installer fetches the app package again: keep the edition the user chose.
        builder = builder.installer_arg(if *gpu { "/EDITION=gpu" } else { "/EDITION=cpu" });
    }
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

/// Asks for the newest release of the running version's channel.
async fn check_channel<R: Runtime>(app: &AppHandle<R>, kind: &InstallKind, target: &str) -> LatestCheck {
    let channel = channel_of(&app.package_info().version);
    let stable = Url::parse(STABLE_MANIFEST).map_err(|error| error.to_string())?;
    let mut endpoints = Vec::new();
    if channel == "beta" {
        match beta_manifest().await {
            Ok(Some(url)) => endpoints.push(url),
            Ok(None) => {}
            // The stable manifest below still answers.
            Err(error) => crate::startup_log(&format!("Update: release list unavailable: {error}")),
        }
    }
    endpoints.push(stable);
    let updater = build_updater(app, kind, target, endpoints, None)?;
    updater.check().await.map_err(|error| {
        crate::startup_log(&format!("Update check failed: {error}"));
        check_error_code(&error).to_string()
    })
}

/// [`check_channel`], sharing a check that runs or has just ended (`CHECK_REUSE`). A failed
/// check is shared only with the checks that waited for it: asking again tries again.
async fn check_latest<R: Runtime>(app: &AppHandle<R>, state: &AppUpdateState, kind: &InstallKind, target: &str) -> LatestCheck {
    let mut last = state.last_check.lock().await;
    if let Some((at, result)) = last.as_ref()
        && ((result.is_ok() && at.elapsed() < CHECK_REUSE) || at.elapsed() < Duration::from_secs(1))
    {
        return result.clone();
    }
    let result = check_channel(app, kind, target).await;
    *last = Some((Instant::now(), result.clone()));
    result
}

/// Downloads `update`, verifies its signature and installs it. On Windows the installer takes
/// over and this process exits; elsewhere it returns, and the caller restarts the app. Any
/// failure before that leaves the running app as it was.
async fn download_and_install(update: &Update, mut progress: impl FnMut(InstallProgress)) -> Result<(), &'static str> {
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
    // Windows: starts the installer and exits. Linux: replaces the AppImage, keeping the old
    // one when writing the new one fails.
    update.install(bytes).map_err(|error| {
        crate::startup_log(&format!("Update install failed: {error}"));
        "update_install_failed"
    })
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
) -> Result<CheckResult, String> {
    main_only(&window)?;
    let kind = install_kind(&app);
    let Some(target) = kind.checking_target() else {
        return Err("update_unsupported".into());
    };
    let _busy = acquire(&state)?;
    let update = check_latest(&app, &state, &kind, target).await?;
    let result = CheckResult {
        available: update.is_some(),
        version: update.as_ref().map(|update| update.version.clone()),
        release_url: update
            .as_ref()
            .map(|update| format!("https://github.com/{REPOSITORY}/releases/tag/v{}", update.version)),
    };
    *state.pending.lock().map_err(|_| "update_check_failed".to_string())? =
        update.filter(|_| kind.mode() == "install");
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
/// Any failure before that leaves the running app as it was.
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
        .clone()
        .ok_or_else(|| "update_not_checked".to_string())?;
    download_and_install(&update, |progress| {
        let _ = on_progress.send(progress);
    })
    .await
    .map_err(str::to_string)?;
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

    async fn install_async(&self, target_version: Option<&str>) -> Result<(), &'static str> {
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
            None => check_latest(app, &state, &kind, target).await.map_err(|_| "update_check_failed")?,
            Some(wanted) => {
                let channel = channel_of(&app.package_info().version);
                let releases = fetch_releases().await.map_err(|error| {
                    crate::startup_log(&format!("Update: release list unavailable: {error}"));
                    "update_check_failed"
                })?;
                let (version, manifest) = find_release(&releases, channel, wanted).ok_or("update_not_listed")?;
                let updater = build_updater(app, &kind, target, vec![manifest], Some(version))
                    .map_err(|_| "update_check_failed")?;
                updater.check().await.map_err(|error| {
                    crate::startup_log(&format!("Update check failed: {error}"));
                    check_error_code(&error)
                })?
            }
        };
        let update = update.ok_or("update_not_found")?;
        download_and_install(&update, |_| {}).await
    }
}

impl<R: Runtime> SoftwareUpdates for CoreUpdates<R> {
    fn check(&self) -> Value {
        let kind = install_kind(&self.app);
        let Some(target) = kind.checking_target() else {
            return no_update();
        };
        let state = self.app.state::<AppUpdateState>();
        let result = tauri::async_runtime::block_on(check_latest(&self.app, &state, &kind, target));
        update_info(result.as_ref().map(|update| update.as_ref().map(|update| update.version.as_str())).map_err(String::as_str))
    }

    fn releases(&self) -> Vec<Value> {
        if install_kind(&self.app).checking_target().is_none() {
            return Vec::new();
        }
        let channel = channel_of(&self.app.package_info().version);
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

    /// The edition stays the one this copy was installed as (`/EDITION=gpu` only for a CUDA
    /// install, as the update page does); `edition` only tells which endpoint asked.
    fn install(&self, _edition: &str, target_version: Option<&str>) -> UpdateOutcome {
        match tauri::async_runtime::block_on(self.install_async(target_version)) {
            Ok(()) => {
                // Linux: the AppImage is replaced. The restart ends the app through its normal
                // exit, which stops the core.
                self.app.request_restart();
                UpdateOutcome::Launched
            }
            Err(code) => {
                crate::startup_log(&format!("Update from the backend failed: {code}"));
                outcome_of(code)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(InstallKind::WindowsInstaller { gpu: true }.checking_target(), Some("windows-x86_64"));
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
    fn a_beta_version_is_on_the_beta_channel() {
        let beta = semver::Version::parse("0.4.0-beta.1").unwrap();
        let stable = semver::Version::parse("0.4.0").unwrap();
        assert_eq!(channel_of(&beta), "beta");
        assert_eq!(channel_of(&stable), "stable");
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
        assert_eq!(detect_install(&binary, None, false), InstallKind::WindowsInstaller { gpu: false });
        std::fs::create_dir_all(directory.join("_internal").join("nvidia")).unwrap();
        assert_eq!(detect_install(&binary, None, false), InstallKind::WindowsInstaller { gpu: true });
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
