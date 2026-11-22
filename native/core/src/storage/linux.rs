//! Linux: the settings folder and the data folder move from `vrct-vox` to `astarot` (ADR-014,
//! 2.4).
//!
//! The packages keep the settings, the logs and the downloaded models in
//! `$XDG_CONFIG_HOME/<name>`, and the data in `$XDG_DATA_HOME/<name>`. The app settles each folder
//! once, at its start, before anything reads it ([`settle`]):
//!
//! - A folder named by a variable (`ASTAROT_CONFIG_DIR`, `VRCT_DATA_DIR`...) is used as it is.
//! - An old folder and no new one: the old one is renamed to the new name. Both are in the same
//!   parent folder, so even large models move at once, nothing is copied. A link with the old name
//!   is left, pointing to the new folder: 0.5.x, and scripts that name the old path, still find
//!   the files. Then the absolute paths saved under the old folder are rewritten
//!   ([`super::relocate_saved_paths`]); a path left as it was still works through the link.
//! - Neither: the new folder is made.
//! - The new folder, alone or with the old one: the new one is used and the old one is not
//!   touched. A new folder this app did not make (it has no record) is not used while there is
//!   an old one, which is used instead.
//! - When the old folder cannot be moved now (another file system, no permission, ASTAROT or
//!   VRCT-VOX running) it is used where it is, and the next start tries again. A running app is
//!   found by its single-instance name on the session bus, under the old app ID and the new one
//!   ([`other_instance`]).
//!
//! Each folder the app uses under the new name holds a record ([`RECORD`]) of how it came to be.
//! A move writes the record into the old folder before the rename, so that it travels with the
//! files: a start that finds it unfinished finishes the move (the link, the paths). The record
//! names the old folder; nothing here writes a path to the log, only the codes ([`Settled::summary`]).

use super::{Move, relocate_saved_paths};
use serde_json::{Value, json};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The record a folder under the new name holds.
pub const RECORD: &str = "storage_migration.json";
const RECORD_VERSION: u64 = 1;

/// Where a folder is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Location {
    /// Named by a variable: used as it is, never moved.
    Given(PathBuf),
    /// The packages' default, under the old name and under the new one, in the same parent.
    Default { legacy: PathBuf, current: PathBuf },
}

/// Whether another ASTAROT or VRCT-VOX runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Others {
    None,
    Running,
    /// The session bus could not be asked.
    Unknown,
}

/// How a folder was settled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Named by a variable.
    Given,
    /// Neither folder was there: the new one was made.
    Created,
    /// The old folder was moved at this start.
    Moved,
    /// A move an earlier start began was finished at this one.
    Finished,
    /// Already under the new name.
    InPlace,
    /// The old folder is used, for this reason.
    Kept(&'static str),
}

impl Outcome {
    pub fn code(&self) -> String {
        match self {
            Outcome::Given => "given".into(),
            Outcome::Created => "created".into(),
            Outcome::Moved => "moved".into(),
            Outcome::Finished => "finished".into(),
            Outcome::InPlace => "in_place".into(),
            Outcome::Kept(reason) => format!("kept_old:{reason}"),
        }
    }
}

/// The folders to use, and how they were settled.
#[derive(Clone, Debug)]
pub struct Settled {
    pub state_dir: PathBuf,
    pub data_dir: PathBuf,
    pub settings: Outcome,
    pub data: Outcome,
    /// When a move was finished at this start: `rewritten`, `unchanged`, or `failed` (the paths
    /// are rewritten at the next start; the link keeps the old ones working meanwhile).
    pub paths: Option<&'static str>,
    /// A link with the old name that could not be made, for the settings and the data.
    pub link_failed: [bool; 2],
}

impl Settled {
    /// One line for the start-up log: codes only, never a path.
    pub fn summary(&self) -> String {
        let mut line = format!("settings={} data={}", self.settings.code(), self.data.code());
        if let Some(paths) = self.paths {
            line.push_str(&format!(" paths={paths}"));
        }
        for (name, failed) in ["settings", "data"].into_iter().zip(self.link_failed) {
            if failed {
                line.push_str(&format!(" {name}_link=failed"));
            }
        }
        line
    }
}

/// Where one folder stands after its first look.
enum Step {
    /// Use this folder; nothing more to do.
    Use(PathBuf, Outcome),
    /// Moved (now or before): the link, the paths and the record remain.
    Pending { legacy: PathBuf, current: PathBuf, from: PathBuf, outcome: Outcome },
    /// The old folder is to be moved, if nothing else runs.
    Move { legacy: PathBuf, current: PathBuf },
}

/// Settles the settings folder and the data folder. `others` is asked only when a folder is to
/// be moved, and at most once.
pub fn settle(settings: Location, data: Location, others: impl FnOnce() -> Others) -> Settled {
    let mut steps = [look(settings), look(data)];
    if steps.iter().any(|step| matches!(step, Step::Move { .. })) {
        let others = others();
        for step in &mut steps {
            if let Step::Move { legacy, current } = step {
                *step = match others {
                    Others::None => move_folder(legacy, current),
                    Others::Running => Step::Use(legacy.clone(), Outcome::Kept("app_running")),
                    Others::Unknown => Step::Use(legacy.clone(), Outcome::Kept("instance_check_unavailable")),
                };
            }
        }
    }
    let [settings, data] = steps;
    let mut link_failed = [false; 2];
    let mut moves = Vec::new();
    for (index, step) in [&settings, &data].into_iter().enumerate() {
        if let Step::Pending { legacy, current, from, .. } = step {
            link_failed[index] = !link_back(legacy, current);
            moves.extend(moves_for(from, current));
        }
    }
    let state_dir = path_of(&settings);
    let paths = (!moves.is_empty()).then(|| match relocate_saved_paths(&state_dir, &moves) {
        Ok(true) => "rewritten",
        Ok(false) => "unchanged",
        Err(_) => "failed",
    });
    if paths != Some("failed") {
        for step in [&settings, &data] {
            if let Step::Pending { current, from, .. } = step {
                // A record that cannot be written now is written at the next start.
                let _ = write_record(current, "done", Some(from));
            }
        }
    }
    Settled { data_dir: path_of(&data), state_dir, settings: outcome_of(&settings), data: outcome_of(&data), paths, link_failed }
}

fn path_of(step: &Step) -> PathBuf {
    match step {
        Step::Use(path, _) => path.clone(),
        Step::Pending { current, .. } => current.clone(),
        Step::Move { legacy, .. } => legacy.clone(),
    }
}

fn outcome_of(step: &Step) -> Outcome {
    match step {
        Step::Use(_, outcome) | Step::Pending { outcome, .. } => *outcome,
        Step::Move { .. } => Outcome::Kept("not_moved"),
    }
}

/// The first look at a folder: what is there, and what its record says.
fn look(location: Location) -> Step {
    let (legacy, current) = match location {
        Location::Given(path) => return Step::Use(path, Outcome::Given),
        Location::Default { legacy, current } if legacy == current => return Step::Use(current, Outcome::InPlace),
        Location::Default { legacy, current } => (legacy, current),
    };
    match read_record(&current) {
        Some((state, from)) if state == "moving" => {
            let from = from.unwrap_or_else(|| legacy.clone());
            return Step::Pending { legacy, current, from, outcome: Outcome::Finished };
        }
        Some((_, from)) => {
            // The link may have failed before; it is tried again while nothing has the old name.
            if from.is_some() {
                link_back(&legacy, &current);
            }
            return Step::Use(current, Outcome::InPlace);
        }
        None => {}
    }
    let legacy_is_folder = legacy.is_dir();
    if fs::symlink_metadata(&current).is_ok() {
        if !current.is_dir() || (legacy_is_folder && !same_folder(&legacy, &current)) {
            // Not a folder this app made: the old one, where the settings are, is used.
            return Step::Use(legacy, Outcome::Kept("new_folder_not_ours"));
        }
        if legacy_is_folder {
            // The old name already leads here (a record that was lost): finish the move.
            return Step::Pending { from: legacy.clone(), legacy, current, outcome: Outcome::Finished };
        }
        // The new folder alone: the app uses it, and records it as its own.
        let _ = write_record(&current, "created", None);
        return Step::Use(current, Outcome::InPlace);
    }
    if legacy_is_folder {
        return Step::Move { legacy, current };
    }
    // Neither: the new folder, with its record, so that it is known as this app's.
    let _ = fs::create_dir_all(&current).and_then(|()| write_record(&current, "created", None));
    Step::Use(current, Outcome::Created)
}

/// Renames the old folder to the new name, its record first.
fn move_folder(legacy: &Path, current: &Path) -> Step {
    if legacy.to_str().is_none() {
        // A saved path is JSON text: one under a folder whose name is not UTF-8 cannot be told.
        return Step::Use(legacy.to_path_buf(), Outcome::Kept("path_not_utf8"));
    }
    if write_record(legacy, "moving", Some(legacy)).is_err() {
        return Step::Use(legacy.to_path_buf(), Outcome::Kept("record_failed"));
    }
    match fs::rename(legacy, current) {
        Ok(()) => Step::Pending { legacy: legacy.to_path_buf(), current: current.to_path_buf(), from: legacy.to_path_buf(), outcome: Outcome::Moved },
        Err(error) => {
            // Another start of the app may have moved it meanwhile: follow what it recorded.
            if let Some((state, from)) = read_record(current) {
                let from = from.unwrap_or_else(|| legacy.to_path_buf());
                let outcome = if state == "moving" { Outcome::Finished } else { Outcome::InPlace };
                return Step::Pending { legacy: legacy.to_path_buf(), current: current.to_path_buf(), from, outcome };
            }
            let _ = fs::remove_file(legacy.join(RECORD));
            Step::Use(legacy.to_path_buf(), Outcome::Kept(rename_failure(&error)))
        }
    }
}

fn rename_failure(error: &io::Error) -> &'static str {
    match error.raw_os_error() {
        Some(libc::EXDEV) => "cross_device",
        Some(libc::EACCES) | Some(libc::EPERM) | Some(libc::EROFS) => "permission_denied",
        Some(libc::EBUSY) => "busy",
        Some(libc::ENOTEMPTY) | Some(libc::EEXIST) => "new_folder_appeared",
        _ => "rename_failed",
    }
}

/// Puts a link with the old name to the new folder, unless something has the old name. Answers
/// whether the old name leads to the new folder.
fn link_back(legacy: &Path, current: &Path) -> bool {
    if fs::symlink_metadata(legacy).is_ok() {
        return same_folder(legacy, current);
    }
    // Relative when both are in the same folder, so the link survives a move of that folder.
    let target = match (legacy.parent(), current.parent(), current.file_name()) {
        (Some(a), Some(b), Some(name)) if a == b => PathBuf::from(name),
        _ => current.to_path_buf(),
    };
    std::os::unix::fs::symlink(target, legacy).is_ok()
}

/// Whether both paths lead to the same folder.
fn same_folder(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.is_dir() && a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// The moves of a folder that went from `from` to `current`: the paths as the app built them, and
/// the same with the parent folder resolved (`/home` may be a link to `/var/home`), where the old
/// folder's own name stays (when it was a link, its target did not move).
fn moves_for(from: &Path, current: &Path) -> Vec<Move> {
    let mut moves = vec![Move { from: from.to_path_buf(), to: current.to_path_buf() }];
    if let (Some(parent), Some(old), Some(new)) = (current.parent(), from.file_name(), current.file_name())
        && from.parent() == Some(parent)
        && let Ok(resolved) = fs::canonicalize(parent)
    {
        let resolved = Move { from: resolved.join(old), to: resolved.join(new) };
        if resolved != moves[0] {
            moves.push(resolved);
        }
    }
    moves
}

/// The record of `folder`: its state and the old folder, when it is one this app wrote.
fn read_record(folder: &Path) -> Option<(String, Option<PathBuf>)> {
    let path = folder.join(RECORD);
    if !fs::symlink_metadata(&path).ok()?.is_file() {
        return None;
    }
    let data: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
    if data.get("version").and_then(Value::as_u64) != Some(RECORD_VERSION) {
        return None;
    }
    let state = data.get("state").and_then(Value::as_str).filter(|s| ["moving", "done", "created"].contains(s))?;
    let from = data.get("from").and_then(Value::as_str).map(PathBuf::from);
    Some((state.to_owned(), from))
}

fn write_record(folder: &Path, state: &str, from: Option<&Path>) -> io::Result<()> {
    let mut record = json!({ "version": RECORD_VERSION, "state": state });
    if let Some(from) = from.and_then(Path::to_str) {
        record["from"] = json!(from);
    }
    let text = serde_json::to_string_pretty(&record).expect("plain JSON");
    super::write_replacing(&folder.join(RECORD), text.as_bytes())
}

/// Whether another ASTAROT or VRCT-VOX runs: the single-instance name of either app ID is owned
/// on the session bus (`tauri-plugin-single-instance`: `<app ID>.SingleInstance`). The app asks
/// before its own single-instance plugin takes the name.
#[cfg(target_os = "linux")]
pub fn other_instance() -> Others {
    let Ok(connection) = zbus::blocking::Connection::session() else { return Others::Unknown };
    let Ok(bus) = zbus::blocking::fdo::DBusProxy::new(&connection) else { return Others::Unknown };
    for id in [app_identity::APP_ID.legacy, app_identity::APP_ID.astarot] {
        let name = format!("{id}.SingleInstance");
        let Ok(name) = zbus::names::BusName::try_from(name.as_str()) else { return Others::Unknown };
        match bus.name_has_owner(name) {
            Ok(true) => return Others::Running,
            Ok(false) => {}
            Err(_) => return Others::Unknown,
        }
    }
    Others::None
}
