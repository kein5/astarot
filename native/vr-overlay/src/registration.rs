//! ASTAROT in SteamVR's list of applications, so that SteamVR can start it with itself (#1384).
//!
//! The Windows package ships an application manifest beside the executable
//! ([`astarot_app_identity::steamvr::MANIFEST`], from `src-tauri/steamvr/`). It names the
//! executable beside it and makes ASTAROT a dashboard overlay application, the kind whose
//! auto-launch flag SteamVR keeps (`SetApplicationAutoLaunch`). SteamVR's flag is the only record
//! of the choice: its own startup settings change it too, and nothing in `config.json` copies it.
//!
//! SteamVR takes one manifest per application key and refuses a second one with the same key
//! (`VRApplicationError_AppKeyAlreadyExists`). An install that moved, or that was removed while
//! SteamVR did not run, leaves its manifest in SteamVR's list with a binary that is gone: this
//! install takes the key over. The manifest of another install whose binary is still there stays,
//! unless the user turns the auto-launch on in this one.
//!
//! [`plan`] decides from what SteamVR reports, with no I/O; [`apply`] asks SteamVR and carries
//! the plan out over a [`Session`].

use crate::runtime::{ApplicationError, Session};
use astarot_app_identity::steamvr::{APP_KEY, MANIFEST};
use std::path::{Component, Path, PathBuf};

/// This install: its manifest and the executable the manifest names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Install {
    pub manifest: PathBuf,
    pub binary: PathBuf,
}

impl Install {
    /// The install of `executable`, with the manifest beside it; `None` where none is there:
    /// the Linux packages and a development build ship none, so SteamVR cannot start them.
    pub fn beside(executable: &Path) -> Option<Install> {
        let manifest = executable.parent()?.join(MANIFEST);
        manifest.is_file().then(|| Install { manifest, binary: executable.to_path_buf() })
    }
}

/// What the app asks of SteamVR.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Want {
    /// Keep this install in SteamVR's list, with the manifest read again: the first time a run
    /// finds SteamVR. The auto-launch flag stays as it is.
    Upkeep,
    /// The user turned SteamVR's auto-launch on or off.
    AutoLaunch(bool),
    /// Take this install out of SteamVR's list, with its auto-launch off: the uninstaller.
    Unregister,
}

/// Who holds ASTAROT's application key in SteamVR.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Holder {
    /// No application of the key is installed.
    Nobody,
    /// This install's manifest.
    This,
    /// Another manifest whose binary is gone: an install that moved or was removed. Its manifest
    /// is the one beside the binary it named, if it named one.
    Stale(Option<PathBuf>),
    /// Another install, whose binary is there.
    Other(Option<PathBuf>),
}

impl Holder {
    /// Who holds the key, from the binary SteamVR starts for it (`None`: not installed).
    pub fn of(binary: Option<&str>, install: &Install, exists: &dyn Fn(&Path) -> bool) -> Holder {
        let Some(binary) = binary else { return Holder::Nobody };
        if same_path(Path::new(binary), &install.binary) {
            return Holder::This;
        }
        let path = Path::new(binary);
        let manifest = (!binary.is_empty()).then(|| path.parent().map(|folder| folder.join(MANIFEST))).flatten();
        if !binary.is_empty() && !exists(path) { Holder::Stale(manifest) } else { Holder::Other(manifest) }
    }
}

/// One call on SteamVR's list of applications.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    /// `RemoveApplicationManifest`. Its failure stops nothing: the manifest may be gone already.
    Remove(PathBuf),
    /// `AddApplicationManifest`.
    Add(PathBuf),
    /// `SetApplicationAutoLaunch`.
    AutoLaunch(bool),
}

/// The calls that give `want`, with SteamVR's key held by `holder` and its auto-launch flag
/// `auto_launch`.
pub fn plan(want: Want, holder: &Holder, auto_launch: bool, install: &Install) -> Vec<Step> {
    let ours = || Step::Add(install.manifest.clone());
    // Take the key over: the holder's manifest out, this one in.
    let take_over = |manifest: &Option<PathBuf>, on: bool| {
        manifest.iter().map(|m| Step::Remove(m.clone())).chain([ours(), Step::AutoLaunch(on)]).collect()
    };
    match (want, holder) {
        (Want::Upkeep, Holder::Nobody) => vec![ours()],
        // Read again (an update may have changed it), the flag kept as it was.
        (Want::Upkeep, Holder::This) => vec![ours(), Step::AutoLaunch(auto_launch)],
        (Want::Upkeep, Holder::Stale(manifest)) => take_over(manifest, auto_launch),
        (Want::Upkeep, Holder::Other(_)) => Vec::new(),
        (Want::AutoLaunch(true), Holder::Nobody) => vec![ours(), Step::AutoLaunch(true)],
        (Want::AutoLaunch(false), Holder::Nobody) => Vec::new(),
        (Want::AutoLaunch(on), Holder::This) => vec![Step::AutoLaunch(on)],
        (Want::AutoLaunch(on), Holder::Stale(manifest)) => take_over(manifest, on),
        (Want::AutoLaunch(true), Holder::Other(manifest)) => take_over(manifest, true),
        // Off needs no manifest: the flag is the key's.
        (Want::AutoLaunch(false), Holder::Other(_)) => vec![Step::AutoLaunch(false)],
        (Want::Unregister, Holder::This) => vec![Step::AutoLaunch(false), Step::Remove(install.manifest.clone())],
        // Another install's manifest is that install's to remove.
        (Want::Unregister, Holder::Nobody | Holder::Stale(_) | Holder::Other(_)) => Vec::new(),
    }
}

/// What SteamVR holds for ASTAROT's key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Registration {
    pub holder: Holder,
    /// SteamVR's auto-launch flag of the key; false while nobody holds it.
    pub auto_launch: bool,
}

/// Asks SteamVR who holds the key and whether it starts with SteamVR.
pub fn read(session: &mut dyn Session, install: &Install, exists: &dyn Fn(&Path) -> bool) -> Result<Registration, ApplicationError> {
    let binary = session.application_binary(APP_KEY)?;
    let holder = Holder::of(binary.as_deref(), install, exists);
    let auto_launch = holder != Holder::Nobody && session.auto_launch(APP_KEY)?;
    Ok(Registration { holder, auto_launch })
}

/// Carries `want` out: reads SteamVR, makes the calls [`plan`] gives and reads SteamVR again,
/// whose answer is the result. A failed call stops there; a failed removal goes on.
pub fn apply(session: &mut dyn Session, install: &Install, want: Want, exists: &dyn Fn(&Path) -> bool) -> Result<Registration, ApplicationError> {
    let before = read(session, install, exists)?;
    for step in plan(want, &before.holder, before.auto_launch, install) {
        match step {
            Step::Remove(manifest) => {
                let _ = session.remove_application_manifest(&manifest);
            }
            Step::Add(manifest) => session.add_application_manifest(&manifest)?,
            Step::AutoLaunch(on) => session.set_auto_launch(APP_KEY, on)?,
        }
    }
    read(session, install, exists)
}

/// Whether two paths name the same file as SteamVR writes them: `/` or `\`, and on Windows in any
/// case. `.` parts drop out; nothing is resolved on disk.
fn same_path(a: &Path, b: &Path) -> bool {
    fn parts(path: &Path) -> Vec<String> {
        let text = if cfg!(windows) { path.to_string_lossy().replace('/', "\\") } else { path.to_string_lossy().into_owned() };
        Path::new(&text)
            .components()
            .filter(|part| *part != Component::CurDir)
            .map(|part| {
                let part = part.as_os_str().to_string_lossy();
                if cfg!(windows) { part.to_lowercase() } else { part.into_owned() }
            })
            .collect()
    }
    !a.as_os_str().is_empty() && parts(a) == parts(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::Vr;
    use crate::runtime::fake::FakeVr;
    use std::fs;

    /// A folder of its own for a test, removed after it (the crate has no `tempfile`).
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> TempDir {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let name = format!("astarot-registration-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
            let path = std::env::temp_dir().join(name);
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn install_in(folder: &Path) -> Install {
        fs::create_dir_all(folder).unwrap();
        let manifest = folder.join(MANIFEST);
        fs::write(&manifest, SHIPPED).unwrap();
        let binary = folder.join("astarot.exe");
        fs::write(&binary, b"").unwrap();
        Install { manifest, binary }
    }

    fn exists(path: &Path) -> bool {
        path.exists()
    }

    /// The manifest the Windows package ships.
    const SHIPPED: &str = include_str!("../../../src-tauri/steamvr/astarot.vrmanifest");

    #[test]
    fn the_shipped_manifest_makes_the_app_a_dashboard_overlay_started_from_beside_it() {
        let json: serde_json::Value = serde_json::from_str(SHIPPED).unwrap();
        let applications = json["applications"].as_array().unwrap();
        assert_eq!(applications.len(), 1);
        let app = &applications[0];
        assert_eq!(app["app_key"], APP_KEY);
        assert_eq!(app["launch_type"], "binary");
        // Relative to the manifest, which sits beside the executable.
        assert_eq!(app["binary_path_windows"], format!("{}.exe", astarot_app_identity::EXECUTABLE.current()));
        // SteamVR keeps an auto-launch flag only for a dashboard overlay application.
        assert_eq!(app["is_dashboard_overlay"], true);
        assert_eq!(app["strings"]["en_us"]["name"], "ASTAROT");
        // No arguments: SteamVR starts the app as the user does (#1384, no start of its own).
        assert!(app.get("arguments").is_none_or(|arguments| arguments == ""));
        assert!(app.get("binary_path_linux").is_none(), "the Linux packages ship no manifest");
    }

    #[test]
    fn an_install_is_its_executable_with_the_manifest_beside_it() {
        let dir = TempDir::new();
        let install = install_in(dir.path());
        assert_eq!(Install::beside(&install.binary), Some(install.clone()));
        fs::remove_file(&install.manifest).unwrap();
        assert_eq!(Install::beside(&install.binary), None, "a build without the manifest cannot be started by SteamVR");
    }

    #[test]
    fn the_holder_is_told_by_the_binary_steamvr_starts() {
        let install = Install { manifest: PathBuf::from("/app/astarot.vrmanifest"), binary: PathBuf::from("/app/astarot.exe") };
        let there = |path: &Path| path == Path::new("/other/astarot.exe");
        assert_eq!(Holder::of(None, &install, &there), Holder::Nobody);
        assert_eq!(Holder::of(Some("/app/astarot.exe"), &install, &there), Holder::This);
        assert_eq!(Holder::of(Some("/app/./astarot.exe"), &install, &there), Holder::This);
        assert_eq!(Holder::of(Some("/other/astarot.exe"), &install, &there), Holder::Other(Some(PathBuf::from("/other/astarot.vrmanifest"))));
        assert_eq!(Holder::of(Some("/moved/astarot.exe"), &install, &there), Holder::Stale(Some(PathBuf::from("/moved/astarot.vrmanifest"))));
        // Installed with no binary: someone else's, with no manifest to find.
        assert_eq!(Holder::of(Some(""), &install, &there), Holder::Other(None));
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_match_in_any_case_and_either_slash() {
        let install = Install {
            manifest: PathBuf::from(r"C:\Users\A\AppData\Local\Programs\ASTAROT\astarot.vrmanifest"),
            binary: PathBuf::from(r"C:\Users\A\AppData\Local\Programs\ASTAROT\astarot.exe"),
        };
        assert_eq!(Holder::of(Some("c:/users/a/appdata/local/programs/astarot/ASTAROT.EXE"), &install, &|_| true), Holder::This);
    }

    fn all_holders() -> Vec<Holder> {
        let elsewhere = Some(PathBuf::from("/old/astarot.vrmanifest"));
        vec![Holder::Nobody, Holder::This, Holder::Stale(elsewhere.clone()), Holder::Stale(None), Holder::Other(elsewhere), Holder::Other(None)]
    }

    #[test]
    fn every_plan_adds_only_this_manifest_and_removes_only_the_holders() {
        let install = Install { manifest: PathBuf::from("/app/astarot.vrmanifest"), binary: PathBuf::from("/app/astarot.exe") };
        for want in [Want::Upkeep, Want::AutoLaunch(true), Want::AutoLaunch(false), Want::Unregister] {
            for holder in all_holders() {
                for flag in [false, true] {
                    let steps = plan(want, &holder, flag, &install);
                    for step in &steps {
                        match step {
                            Step::Add(manifest) => assert_eq!(manifest, &install.manifest, "{want:?} {holder:?}"),
                            Step::Remove(manifest) => {
                                let holders = match &holder {
                                    Holder::Stale(m) | Holder::Other(m) => m.as_ref() == Some(manifest),
                                    Holder::This => *manifest == install.manifest,
                                    Holder::Nobody => false,
                                };
                                assert!(holders, "{want:?} {holder:?}: removes {manifest:?}, which does not hold the key");
                            }
                            Step::AutoLaunch(_) => {}
                        }
                    }
                    // A removal comes before the add it makes room for.
                    let add = steps.iter().position(|s| matches!(s, Step::Add(_)));
                    let remove = steps.iter().position(|s| matches!(s, Step::Remove(_)));
                    if let (Some(add), Some(remove)) = (add, remove) {
                        assert!(remove < add, "{want:?} {holder:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn the_flag_ends_as_asked_and_upkeep_keeps_it() {
        let install = Install { manifest: PathBuf::from("/app/astarot.vrmanifest"), binary: PathBuf::from("/app/astarot.exe") };
        let last_flag = |steps: &[Step]| steps.iter().rev().find_map(|s| if let Step::AutoLaunch(on) = s { Some(*on) } else { None });
        for holder in all_holders() {
            for flag in [false, true] {
                let upkeep = plan(Want::Upkeep, &holder, flag, &install);
                assert!(last_flag(&upkeep).is_none_or(|on| on == flag), "upkeep changed the flag: {holder:?} {flag}");
                for on in [false, true] {
                    let steps = plan(Want::AutoLaunch(on), &holder, flag, &install);
                    // Off with nobody holding the key: nothing to turn off.
                    let expected = if !on && holder == Holder::Nobody { None } else { Some(on) };
                    assert_eq!(last_flag(&steps), expected, "{holder:?} {flag} -> {on}");
                }
            }
        }
        // Only this install's own registration is taken out, with its flag off first.
        assert_eq!(plan(Want::Unregister, &Holder::This, true, &install), [
            Step::AutoLaunch(false),
            Step::Remove(install.manifest.clone()),
        ]);
        for holder in all_holders().into_iter().filter(|h| *h != Holder::This) {
            assert!(plan(Want::Unregister, &holder, true, &install).is_empty(), "{holder:?}");
        }
        // Another install whose binary is there is left alone by the upkeep.
        assert!(plan(Want::Upkeep, &Holder::Other(Some(PathBuf::from("/b/astarot.vrmanifest"))), true, &install).is_empty());
    }

    fn session(fake: &FakeVr) -> Box<dyn Session> {
        fake.connect().unwrap()
    }

    #[test]
    fn upkeep_registers_the_install_and_leaves_the_flag_off() {
        let dir = TempDir::new();
        let install = install_in(dir.path());
        let fake = FakeVr::running();
        let mut session = session(&fake);
        let registration = apply(session.as_mut(), &install, Want::Upkeep, &exists).unwrap();
        assert_eq!(registration, Registration { holder: Holder::This, auto_launch: false });
        assert_eq!(fake.with(|s| s.manifests.clone()), [install.manifest.clone()]);
        // Turned on, then the next run's upkeep reads the manifest again and keeps the flag.
        assert!(apply(session.as_mut(), &install, Want::AutoLaunch(true), &exists).unwrap().auto_launch);
        let again = apply(session.as_mut(), &install, Want::Upkeep, &exists).unwrap();
        assert_eq!(again, Registration { holder: Holder::This, auto_launch: true });
        assert_eq!(fake.with(|s| s.manifests.len()), 1);
    }

    #[test]
    fn a_moved_install_takes_the_key_over_with_its_flag() {
        let dir = TempDir::new();
        let old = install_in(&dir.path().join("old"));
        let fake = FakeVr::running();
        let mut session = session(&fake);
        apply(session.as_mut(), &old, Want::AutoLaunch(true), &exists).unwrap();
        // The install moves: the old folder is gone, SteamVR still lists its manifest.
        fs::remove_dir_all(dir.path().join("old")).unwrap();
        let new = install_in(&dir.path().join("new"));
        let registration = apply(session.as_mut(), &new, Want::Upkeep, &exists).unwrap();
        assert_eq!(registration, Registration { holder: Holder::This, auto_launch: true });
        assert_eq!(fake.with(|s| s.manifests.clone()), [new.manifest.clone()]);
    }

    #[test]
    fn another_install_keeps_the_key_until_the_user_turns_the_flag_on_here() {
        let dir = TempDir::new();
        let first = install_in(&dir.path().join("first"));
        let second = install_in(&dir.path().join("second"));
        let fake = FakeVr::running();
        let mut session = session(&fake);
        apply(session.as_mut(), &first, Want::Upkeep, &exists).unwrap();
        let seen = apply(session.as_mut(), &second, Want::Upkeep, &exists).unwrap();
        assert_eq!(seen.holder, Holder::Other(Some(first.manifest.clone())));
        // Off is the key's flag: it needs no manifest of this install.
        assert!(!apply(session.as_mut(), &second, Want::AutoLaunch(false), &exists).unwrap().auto_launch);
        assert_eq!(fake.with(|s| s.manifests.clone()), [first.manifest.clone()]);
        let on = apply(session.as_mut(), &second, Want::AutoLaunch(true), &exists).unwrap();
        assert_eq!(on, Registration { holder: Holder::This, auto_launch: true });
        assert_eq!(fake.with(|s| s.manifests.clone()), [second.manifest.clone()]);
        // The first one's uninstaller leaves the second one's registration.
        let after = apply(session.as_mut(), &first, Want::Unregister, &exists).unwrap();
        assert_eq!(after.holder, Holder::Other(Some(second.manifest.clone())));
        assert!(after.auto_launch);
    }

    #[test]
    fn the_uninstaller_takes_this_install_out_with_its_flag_off() {
        let dir = TempDir::new();
        let install = install_in(dir.path());
        let fake = FakeVr::running();
        let mut session = session(&fake);
        apply(session.as_mut(), &install, Want::AutoLaunch(true), &exists).unwrap();
        let after = apply(session.as_mut(), &install, Want::Unregister, &exists).unwrap();
        assert_eq!(after, Registration { holder: Holder::Nobody, auto_launch: false });
        assert!(fake.with(|s| s.manifests.is_empty()));
        assert_eq!(fake.with(|s| s.auto_launch.get(APP_KEY).copied()), Some(false), "no auto-launch is left for the key");
    }

    #[test]
    fn a_refused_call_is_reported_and_nothing_after_it_is_made() {
        let dir = TempDir::new();
        let install = install_in(dir.path());
        let fake = FakeVr::running();
        let mut session = session(&fake);
        fake.with(|s| s.refuse_applications = Some(105));
        assert_eq!(apply(session.as_mut(), &install, Want::AutoLaunch(true), &exists), Err(ApplicationError(105)));
        assert_eq!(fake.with(|s| s.application_calls.clone()), [format!("binary {APP_KEY}")]);
        // A manifest SteamVR cannot read stops the turn on before the flag.
        fake.with(|s| {
            s.refuse_applications = None;
            s.application_calls.clear();
        });
        fs::write(&install.manifest, "not json").unwrap();
        assert_eq!(apply(session.as_mut(), &install, Want::AutoLaunch(true), &exists), Err(ApplicationError::INVALID_MANIFEST));
        assert!(!fake.with(|s| s.application_calls.iter().any(|call| call.starts_with("auto_launch"))));
    }

    #[test]
    fn the_stand_in_refuses_a_second_manifest_of_the_key_as_steamvr_does() {
        // What the take-over is for: SteamVR keeps one manifest per key.
        let dir = TempDir::new();
        let first = install_in(&dir.path().join("first"));
        let second = install_in(&dir.path().join("second"));
        let fake = FakeVr::running();
        let mut session = session(&fake);
        session.add_application_manifest(&first.manifest).unwrap();
        assert_eq!(session.add_application_manifest(&second.manifest), Err(ApplicationError::KEY_TAKEN));
        // The same manifest again is read again.
        session.add_application_manifest(&first.manifest).unwrap();
        assert_eq!(fake.with(|s| s.manifests.clone()), [first.manifest.clone()]);
        // A manifest that is not in the list is not there to remove; the plan goes on after it.
        assert_eq!(session.remove_application_manifest(&second.manifest), Err(ApplicationError::UNKNOWN_APPLICATION));
        session.remove_application_manifest(&first.manifest).unwrap();
        assert!(fake.with(|s| s.manifests.is_empty() && s.applications.is_empty()));
        // The flag is the key's: SteamVR refuses it for a key nobody holds.
        assert_eq!(session.set_auto_launch(APP_KEY, true), Err(ApplicationError::UNKNOWN_APPLICATION));
    }
}
