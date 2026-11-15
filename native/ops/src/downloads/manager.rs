//! Consent-gated file transactions; applying to the settings is a separate explicit call
//! (`manager.py`).

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::MutexGuard;
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::catalog::{self, artifact_url, Model, CATALOG_VERSION};
use super::guidance::model_guidance;
use super::speechcpp::speech_model;
use super::staging::{mark_owned, recover_owned, RootLease};
use super::transport::{Aborter, Public, Transport};
use super::verification::{hex, verify_file_chunked};
use super::{absolute_root, create_private_dir, directory, is_disk_full, Error};
use crate::json::{Json, Object};

const CHUNK: usize = 1024 * 1024;
/// The phases of a job that still owns the root or its files.
pub const ACTIVE: [&str; 4] = ["queued", "downloading", "verifying", "cancelling"];
/// Failure codes a job reports as they are; anything else is `download_failed`.
const KNOWN: [&str; 8] = ["insufficient_space", "size_mismatch", "hash_mismatch", "unsafe_destination", "destination_exists", "download_url_rejected", "download_http_error", "download_busy"];

type FreeSpace = dyn Fn(&Path) -> io::Result<u64> + Send + Sync;

/// What the manager needs besides the root, the catalog and the transport.
#[derive(Clone)]
pub struct Options {
    /// Room left free on the disk after a download (`insufficient_space` otherwise).
    pub reserve_bytes: u64,
    /// The free bytes of the volume holding a path.
    pub free_space: Arc<FreeSpace>,
}

impl Default for Options {
    fn default() -> Self {
        Options { reserve_bytes: 64 * 1024 * 1024, free_space: Arc::new(super::free_space) }
    }
}

/// A role and the path of its verified file, in catalog order.
pub type Paths = Vec<(String, String)>;

#[derive(Clone)]
struct Job {
    job_id: String,
    phase: &'static str,
    received_bytes: u64,
    total_bytes: u64,
    paths: Paths,
    error_code: Option<&'static str>,
}

impl Job {
    fn to_json(&self) -> Json {
        let paths = self.paths.iter().fold(Object::new(), |o, (role, path)| o.with(role.as_str(), path.as_str()));
        Object::new()
            .with("job_id", self.job_id.as_str())
            .with("phase", self.phase)
            .with("received_bytes", self.received_bytes)
            .with("total_bytes", self.total_bytes)
            .with("paths", paths)
            .with("error_code", self.error_code)
            .into()
    }
}

/// A one-way signal that can be waited for with a deadline.
#[derive(Default)]
struct Flag {
    set: Mutex<bool>,
    changed: Condvar,
}

impl Flag {
    fn set(&self) {
        *self.set.lock().unwrap() = true;
        self.changed.notify_all();
    }

    fn wait(&self, timeout: Duration) -> bool {
        let guard = self.set.lock().unwrap();
        let (guard, _) = self.changed.wait_timeout_while(guard, timeout, |set| !*set).unwrap();
        *guard
    }
}

struct Worker {
    handle: JoinHandle<()>,
    done: Arc<Flag>,
}

#[derive(Default)]
struct State {
    closed: bool,
    jobs: Vec<(String, Job)>,
    worker: Option<Worker>,
    apply_done: Option<Arc<Flag>>,
    response: Option<Aborter>,
}

impl State {
    fn job(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|(k, _)| k == id).map(|(_, j)| j)
    }

    fn checked_job(&mut self, id: &str, job_id: &str) -> Result<&mut Job, Error> {
        self.job(id).filter(|j| j.job_id == job_id).ok_or(Error::Code("stale_job"))
    }

    fn busy(&self) -> bool {
        self.jobs.iter().any(|(_, j)| ACTIVE.contains(&j.phase))
    }

    fn to_json(&self) -> Json {
        let jobs = self.jobs.iter().fold(Object::new(), |o, (id, job)| o.with(id.as_str(), job.to_json()));
        Object::new().with("observation_id", observation_id()).with("jobs", jobs).into()
    }
}

/// `str(time.monotonic_ns())`: distinct for every answer of one process.
fn observation_id() -> String {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_nanos().to_string()
}

#[cfg(test)]
type SyncHook = Box<dyn Fn(&File) -> io::Result<()> + Send + Sync>;

#[cfg(test)]
#[derive(Default)]
pub(crate) struct TestHooks {
    pub sync: Option<SyncHook>,
    pub before_lease_close: Option<Box<dyn Fn() + Send + Sync>>,
}

struct Inner {
    root: PathBuf,
    entries: Vec<Model>,
    transport: RwLock<Arc<dyn Transport>>,
    options: Options,
    state: Mutex<State>,
    /// Kept apart from `state` so that closing never waits for a committing callback.
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    closing: AtomicBool,
    #[cfg(test)]
    hooks: Mutex<TestHooks>,
}

/// Why a transaction stopped.
enum Stop {
    Cancelled,
    Failed(Error),
}

impl From<Error> for Stop {
    fn from(error: Error) -> Self {
        Stop::Failed(error)
    }
}

impl From<io::Error> for Stop {
    fn from(error: io::Error) -> Self {
        Stop::Failed(Error::Io(error))
    }
}

/// The download manager of one root. Every method is safe to call from any thread.
pub struct Downloads {
    inner: Arc<Inner>,
}

impl Downloads {
    /// A manager for `root` with the reviewed catalog and the public transport.
    pub fn new(root: impl AsRef<Path>) -> Result<Self, Error> {
        Self::with(root, catalog::catalog(), Arc::new(Public::default()), Options::default())
    }

    /// A manager with its own catalog, transport and options (tests, stand-ins).
    pub fn with(root: impl AsRef<Path>, entries: Vec<Model>, transport: Arc<dyn Transport>, options: Options) -> Result<Self, Error> {
        catalog::validate_catalog(&entries).map_err(Error::Code)?;
        Ok(Downloads {
            inner: Arc::new(Inner {
                root: absolute_root(root.as_ref()),
                entries,
                transport: RwLock::new(transport),
                options,
                state: Mutex::new(State::default()),
                cancel: Mutex::new(None),
                closing: AtomicBool::new(false),
                #[cfg(test)]
                hooks: Mutex::new(TestHooks::default()),
            }),
        })
    }

    pub fn catalog_version(&self) -> &'static str {
        CATALOG_VERSION
    }

    pub fn root(&self) -> &Path {
        &self.inner.root
    }

    /// `<root>/<id>/<revision>`, where a verified download is published.
    pub fn destination(&self, entry: &Model) -> PathBuf {
        self.inner.destination(entry)
    }

    pub fn entries(&self) -> &[Model] {
        &self.inner.entries
    }

    #[cfg(test)]
    pub(crate) fn set_transport(&self, transport: Arc<dyn Transport>) {
        *self.inner.transport.write().unwrap() = transport;
    }

    #[cfg(test)]
    pub(crate) fn hooks(&self) -> MutexGuard<'_, TestHooks> {
        self.inner.hooks.lock().unwrap()
    }

    /// What the backend answers for the catalog: every entry with its size, destination,
    /// source pages and guidance.
    pub fn catalog(&self) -> Json {
        let models = self
            .inner
            .entries
            .iter()
            .map(|m| {
                let Json::Object(mut row) = Json::from_serialize(m) else { unreachable!("a model serializes as an object") };
                row.insert("total_bytes", m.total_bytes());
                row.insert("destination", self.destination(m).to_string_lossy().into_owned());
                row.insert("source", format!("https://huggingface.co/{}/tree/{}", m.repo, m.revision));
                row.insert("guidance", model_guidance(&m.id));
                row.insert("speech", speech_model(&m.id));
                let mut sources: Vec<String> = m
                    .artifacts
                    .iter()
                    .map(|a| match &a.remote {
                        Some(r) => format!("https://huggingface.co/{}/tree/{}", r.repo, r.revision),
                        None => format!("https://huggingface.co/{}/tree/{}", m.repo, m.revision),
                    })
                    .collect();
                sources.sort();
                sources.dedup();
                row.insert("sources", sources.into_iter().map(Json::from).collect::<Vec<_>>());
                Json::Object(row)
            })
            .collect::<Vec<_>>();
        Object::new().with("catalog_version", CATALOG_VERSION).with("models", models).into()
    }

    /// `{observation_id, jobs: {id: {job_id, phase, received_bytes, total_bytes, paths, error_code}}}`.
    pub fn state(&self) -> Json {
        self.inner.state.lock().unwrap().to_json()
    }

    /// Starts downloading one entry. The request is exactly `{id, consent, catalog_version}`,
    /// `consent` is `true`, and the version is the current catalog's.
    ///
    /// Errors: `download_request_invalid`, `consent_required`, `catalog_changed`,
    /// `downloads_closed`, `download_busy`.
    pub fn start(&self, request: &serde_json::Value) -> Result<Json, Error> {
        let fields = request.as_object().filter(|o| o.len() == 3 && ["id", "consent", "catalog_version"].iter().all(|k| o.contains_key(*k)));
        let Some(fields) = fields else { return Err(Error::Code("download_request_invalid")) };
        if fields["consent"] != serde_json::Value::Bool(true) {
            return Err(Error::Code("consent_required"));
        }
        let entry = match (fields["id"].as_str(), fields["catalog_version"].as_str()) {
            (Some(id), Some(CATALOG_VERSION)) => self.inner.entries.iter().find(|e| e.id == id),
            _ => None,
        };
        let Some(entry) = entry.cloned() else { return Err(Error::Code("catalog_changed")) };
        let mut state = self.inner.state.lock().unwrap();
        if state.closed || self.inner.closing.load(Ordering::SeqCst) {
            return Err(Error::Code("downloads_closed"));
        }
        if state.busy() {
            return Err(Error::Code("download_busy"));
        }
        let job = Job { job_id: uuid::Uuid::new_v4().simple().to_string(), phase: "queued", received_bytes: 0, total_bytes: entry.total_bytes(), paths: Vec::new(), error_code: None };
        let job_id = job.job_id.clone();
        match state.job(&entry.id) {
            Some(slot) => *slot = job,
            None => state.jobs.push((entry.id.clone(), job)),
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *self.inner.cancel.lock().unwrap() = Some(cancel.clone());
        let previous = state.worker.take();
        let done = Arc::new(Flag::default());
        let inner = self.inner.clone();
        let finished = done.clone();
        let handle = thread::Builder::new()
            .name("model-download".into())
            .spawn(move || {
                inner.run(entry, job_id, cancel, previous);
                finished.set();
            })
            .map_err(Error::Io)?;
        state.worker = Some(Worker { handle, done });
        Ok(state.to_json())
    }

    /// Cancels the job if it is still active. A job id that is not the entry's current one:
    /// `stale_job`.
    pub fn cancel(&self, id: &str, job_id: &str) -> Result<Json, Error> {
        let mut state = self.inner.state.lock().unwrap();
        let job = state.checked_job(id, job_id)?;
        if ACTIVE.contains(&job.phase) {
            job.phase = "cancelling";
            self.inner.signal_cancel();
            if let Some(response) = &state.response {
                response.abort();
            }
        }
        Ok(state.to_json())
    }

    /// Re-verifies a ready download and hands its paths to `callback`, which saves them in the
    /// settings. The callback runs while the manager's state is locked (the commit point), so
    /// it must not call back into this manager. If it fails, the download stays ready and its
    /// error is returned as it is.
    ///
    /// Errors: `downloads_closed`, `stale_job`, `download_not_ready`, `download_busy`, a
    /// verification failure, or the callback's.
    pub fn apply(&self, id: &str, job_id: &str, callback: impl FnOnce(&Model, &Paths) -> Result<(), Error>) -> Result<Json, Error> {
        let inner = &self.inner;
        let (entry, cancel, done) = {
            let mut state = inner.state.lock().unwrap();
            if state.closed || inner.closing.load(Ordering::SeqCst) {
                return Err(Error::Code("downloads_closed"));
            }
            if state.checked_job(id, job_id)?.phase != "ready" {
                return Err(Error::Code("download_not_ready"));
            }
            if state.busy() {
                return Err(Error::Code("download_busy"));
            }
            let entry = inner.entries.iter().find(|e| e.id == id).cloned().expect("a job exists only for a catalog entry");
            let cancel = Arc::new(AtomicBool::new(false));
            let done = Arc::new(Flag::default());
            *inner.cancel.lock().unwrap() = Some(cancel.clone());
            state.apply_done = Some(done.clone());
            state.checked_job(id, job_id)?.phase = "verifying";
            (entry, cancel, done)
        };
        let result = (|| -> Result<Json, Stop> {
            let destination = inner.destination(&entry);
            directory(&destination)?;
            for artifact in &entry.artifacts {
                inner.verify(&destination.join(&artifact.filename), artifact.size, &artifact.sha256, &cancel)?;
            }
            let mut state = inner.state.lock().unwrap();
            inner.checkpoint(&cancel)?;
            let job = state.checked_job(id, job_id)?;
            if job.phase != "verifying" {
                return Err(Error::Code("download_not_ready").into());
            }
            // Commit point: the callback rechecks the current settings and target under their
            // own locks before saving only the paths.
            callback(&entry, &job.paths.clone())?;
            job.phase = "applied";
            job.error_code = None;
            Ok(state.to_json())
        })();
        let outcome = match result {
            Ok(answer) => Ok(answer),
            Err(stop) => {
                let mut state = inner.state.lock().unwrap();
                let cancelled = cancel.load(Ordering::SeqCst) || inner.closing.load(Ordering::SeqCst);
                if let Ok(job) = state.checked_job(id, job_id) {
                    if job.phase == "verifying" || job.phase == "cancelling" {
                        if cancelled {
                            job.phase = "cancelled";
                            job.paths.clear();
                            job.error_code = None;
                        } else {
                            job.phase = "ready";
                        }
                    }
                }
                drop(state);
                match stop {
                    _ if cancelled => Err(Error::Code(if inner.closing.load(Ordering::SeqCst) { "downloads_closed" } else { "download_not_ready" })),
                    Stop::Cancelled => Err(Error::Code("download_not_ready")),
                    Stop::Failed(error) => Err(error),
                }
            }
        };
        done.set();
        outcome
    }

    /// Signals cancellation without waiting for the state lock or the workers. Nothing new
    /// starts afterwards, even if a later [`close`](Self::close) times out.
    pub fn request_close(&self) {
        self.inner.closing.store(true, Ordering::SeqCst);
        self.inner.signal_cancel();
    }

    /// Cancels everything and waits up to `timeout` for the worker and any apply to finish.
    /// `false` if something is still running.
    pub fn close(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        self.request_close();
        // A committing callback may hold the state lock; wait for it no longer than allowed.
        let mut state = loop {
            match self.inner.state.try_lock() {
                Ok(state) => break state,
                Err(std::sync::TryLockError::Poisoned(p)) => break p.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => {
                    if Instant::now() >= deadline {
                        return false;
                    }
                    thread::sleep(Duration::from_millis(1));
                }
            }
        };
        state.closed = true;
        self.inner.signal_cancel();
        if let Some(response) = &state.response {
            response.abort();
        }
        let worker = state.worker.as_ref().map(|w| w.done.clone());
        let apply = state.apply_done.clone();
        drop(state);
        let left = || deadline.saturating_duration_since(Instant::now());
        let worker_done = worker.is_none_or(|done| done.wait(left()));
        let apply_done = apply.is_none_or(|done| done.wait(left()));
        worker_done && apply_done
    }
}

impl Drop for Downloads {
    fn drop(&mut self) {
        self.request_close();
    }
}

impl Inner {
    fn destination(&self, entry: &Model) -> PathBuf {
        self.root.join(&entry.id).join(&entry.revision)
    }

    fn signal_cancel(&self) {
        if let Some(cancel) = self.cancel.lock().unwrap().as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    fn checkpoint(&self, cancel: &AtomicBool) -> Result<(), Stop> {
        if cancel.load(Ordering::SeqCst) || self.closing.load(Ordering::SeqCst) {
            Err(Stop::Cancelled)
        } else {
            Ok(())
        }
    }

    fn verify(&self, path: &Path, size: u64, sha256: &str, cancel: &AtomicBool) -> Result<(), Stop> {
        verify_file_chunked(path, size, sha256, &mut || self.checkpoint(cancel), CHUNK)
    }

    fn set_phase(&self, job_id: &str, id: &str, phase: &'static str) {
        if let Some(job) = self.state.lock().unwrap().job(id).filter(|j| j.job_id == job_id) {
            job.phase = phase;
        }
    }

    fn sync(&self, file: &File) -> io::Result<()> {
        #[cfg(test)]
        if let Some(sync) = &self.hooks.lock().unwrap().sync {
            return sync(file);
        }
        file.sync_all()
    }

    fn run(&self, entry: Model, job_id: String, cancel: Arc<AtomicBool>, previous: Option<Worker>) {
        // A finished job is reported before its worker releases the root lease.
        if let Some(previous) = previous {
            let _ = previous.handle.join();
        }
        let mut staging = None;
        let mut lease = RootLease::new(&self.root);
        let outcome = self.download(&entry, &job_id, &cancel, &mut staging, &mut lease);
        let cancelled = cancel.load(Ordering::SeqCst);
        let mut terminal: Option<(&'static str, Option<&'static str>)> = match outcome {
            Ok(()) => None,
            Err(Stop::Cancelled) => Some(("cancelled", None)),
            Err(Stop::Failed(_)) if cancelled => Some(("cancelled", None)),
            Err(Stop::Failed(error)) => Some(("failed", Some(failure_code(&error)))),
        };
        if let Some(dir) = staging {
            if fs::remove_dir_all(&dir).is_err() {
                terminal = Some(("failed", Some("partial_cleanup_failed")));
            }
        }
        #[cfg(test)]
        if let Some(hook) = &self.hooks.lock().unwrap().before_lease_close {
            hook();
        }
        lease.close();
        let mut state = self.state.lock().unwrap();
        state.response = None;
        // A failure or cancellation is reported only once its partial files are gone, so a
        // finished job never leaves staging behind.
        if let Some((phase, code)) = terminal {
            if let Some(job) = state.job(&entry.id).filter(|j| j.job_id == job_id) {
                job.phase = phase;
                job.paths.clear();
                job.error_code = code;
            }
        }
    }

    fn download(&self, entry: &Model, job_id: &str, cancel: &AtomicBool, staging: &mut Option<PathBuf>, lease: &mut RootLease) -> Result<(), Stop> {
        directory(&self.root.join(&entry.id))?;
        lease.acquire()?;
        recover_owned(&self.root, &self.entries, &[])?;
        let destination = self.destination(entry);
        if fs::symlink_metadata(&destination).is_ok() {
            directory(&destination)?;
            self.set_phase(job_id, &entry.id, "verifying");
            for artifact in &entry.artifacts {
                self.verify(&destination.join(&artifact.filename), artifact.size, &artifact.sha256, cancel)?;
            }
        } else {
            if (self.options.free_space)(&self.root)? < entry.total_bytes() + self.options.reserve_bytes {
                return Err(Error::Code("insufficient_space").into());
            }
            let dir = self.root.join(format!(".partial-{}", uuid::Uuid::new_v4().simple()));
            create_private_dir(&dir)?;
            *staging = Some(dir.clone());
            mark_owned(&dir, entry)?;
            for artifact in &entry.artifacts {
                self.checkpoint(cancel)?;
                self.set_phase(job_id, &entry.id, "downloading");
                let url = artifact_url(entry, artifact);
                let transport = self.transport.read().unwrap().clone();
                let mut response = transport.open(&url)?;
                let mut output = OpenOptions::new().write(true).create_new(true).open(dir.join(&artifact.filename))?;
                {
                    let mut state = self.state.lock().unwrap();
                    state.response = response.aborter();
                    self.checkpoint(cancel)?;
                }
                let (mut digest, mut received) = (Sha256::new(), 0u64);
                let mut block = vec![0u8; CHUNK];
                loop {
                    let n = response.read(&mut block)?;
                    if n == 0 {
                        break;
                    }
                    self.checkpoint(cancel)?;
                    received += n as u64;
                    if received > artifact.size {
                        return Err(Error::Code("size_mismatch").into());
                    }
                    output.write_all(&block[..n])?;
                    digest.update(&block[..n]);
                    if let Some(job) = self.state.lock().unwrap().job(&entry.id).filter(|j| j.job_id == job_id) {
                        job.received_bytes += n as u64;
                    }
                }
                output.flush()?;
                self.sync(&output)?;
                drop(output);
                drop(response);
                self.checkpoint(cancel)?;
                self.set_phase(job_id, &entry.id, "verifying");
                if received != artifact.size {
                    return Err(Error::Code("size_mismatch").into());
                }
                if hex(&digest.finalize()) != artifact.sha256 {
                    return Err(Error::Code("hash_mismatch").into());
                }
            }
            // Written as UTF-8 whatever the system's code page ("·" is not in cp932).
            fs::write(dir.join("receipt.json"), Json::from_serialize(entry).to_python_indented())?;
        }
        // Cancellation and publication have one linearization point.
        let mut state = self.state.lock().unwrap();
        self.checkpoint(cancel)?;
        if let Some(dir) = staging.as_ref() {
            directory(destination.parent().expect("a destination has a parent"))?;
            if fs::symlink_metadata(&destination).is_ok() {
                return Err(Error::Code("destination_exists").into());
            }
            fs::rename(dir, &destination)?;
            *staging = None;
        }
        if let Some(job) = state.job(&entry.id).filter(|j| j.job_id == job_id) {
            job.phase = "ready";
            job.received_bytes = job.total_bytes;
            job.paths = entry.artifacts.iter().map(|a| (a.role.clone(), destination.join(&a.filename).to_string_lossy().into_owned())).collect();
        }
        Ok(())
    }
}

fn failure_code(error: &Error) -> &'static str {
    match error {
        Error::Code(code) if KNOWN.contains(code) => code,
        Error::Io(io) if is_disk_full(io) => "insufficient_space",
        _ => "download_failed",
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
