//! The Python suites `tests/voice/test_model_downloads.py` and `test_model_download_http.py`,
//! case for case: no network, no model, the real file transaction.

use super::*;
use crate::downloads::catalog::{Artifact, Remote};
use crate::downloads::transport::{self, open_loopback, open_via, validate_url, Body, HOSTS};
use crate::testing::{answer, serve};
use serde_json::json;
use std::io::Cursor;
use std::sync::atomic::AtomicUsize;

const CONTENT: &[u8] = b"GGUFexample tensor bytesexample tensor bytesexample tensor bytesexample tensor bytes";

fn sha(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

fn entry() -> Model {
    Model {
        id: "test-model".into(),
        target: "japanese".into(),
        name: "Test".into(),
        provider: "Author".into(),
        repo: "author/model".into(),
        revision: "a".repeat(40),
        license: "MIT".into(),
        licenses: vec![format!("https://huggingface.co/author/model/blob/{}/LICENSE", "a".repeat(40))],
        notice: "irodori".into(),
        artifacts: vec![Artifact { filename: "model.gguf".into(), size: CONTENT.len() as u64, sha256: sha(CONTENT), role: "model".into(), remote: None }],
    }
}

fn body(data: &[u8]) -> Result<Box<dyn Body>, Error> {
    Ok(Box::new(Cursor::new(data.to_vec())))
}

struct Setup {
    _dir: tempfile::TempDir,
    root: PathBuf,
    opened: Arc<Mutex<Vec<String>>>,
    manager: Downloads,
}

fn setup_with(entry: Model, free: Option<u64>) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("models");
    let opened = Arc::new(Mutex::new(Vec::new()));
    let seen = opened.clone();
    let transport = move |url: &str| {
        seen.lock().unwrap().push(url.to_string());
        body(CONTENT)
    };
    let mut options = Options { reserve_bytes: 0, ..Options::default() };
    if let Some(free) = free {
        options.free_space = Arc::new(move |_| Ok(free));
    }
    let manager = Downloads::with(&root, vec![entry], Arc::new(transport), options).unwrap();
    Setup { _dir: dir, root, opened, manager }
}

fn setup() -> Setup {
    setup_with(entry(), None)
}

impl Drop for Setup {
    fn drop(&mut self) {
        self.manager.close(Duration::from_secs(2));
    }
}

fn start(m: &Downloads) -> Result<Json, Error> {
    m.start(&json!({"id": "test-model", "consent": true, "catalog_version": m.catalog_version()}))
}

fn job(m: &Downloads) -> Json {
    m.state().get("jobs").and_then(|j| j.get("test-model")).cloned().unwrap_or(Json::Null)
}

fn phase(job: &Json) -> &str {
    job.get("phase").and_then(Json::as_str).unwrap_or("")
}

fn text<'a>(job: &'a Json, key: &str) -> &'a str {
    job.get(key).and_then(Json::as_str).unwrap_or("")
}

fn finish(m: &Downloads) -> Json {
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end {
        let job = job(m);
        if ["ready", "failed", "cancelled", "applied"].contains(&phase(&job)) {
            return job;
        }
        thread::sleep(Duration::from_millis(5));
    }
    panic!("job did not finish: {:?}", m.state());
}

fn model_path(job: &Json) -> PathBuf {
    PathBuf::from(job.get("paths").and_then(|p| p.get("model")).and_then(Json::as_str).unwrap())
}

fn files_named(root: &Path, name: &str) -> Vec<PathBuf> {
    fn walk(dir: &Path, name: &str, out: &mut Vec<PathBuf>) {
        let Ok(items) = fs::read_dir(dir) else { return };
        for item in items.flatten() {
            let path = item.path();
            if fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) {
                walk(&path, name, out);
            } else if path.file_name().is_some_and(|n| n.to_string_lossy().ends_with(name)) {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, name, &mut out);
    out
}

fn partials(root: &Path) -> Vec<PathBuf> {
    fs::read_dir(root).map(|items| items.flatten().map(|i| i.path()).filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(".partial-")).collect()).unwrap_or_default()
}

fn code(error: Error) -> &'static str {
    error.code().unwrap_or("other")
}

#[test]
fn explicit_consent_before_any_files_or_network() {
    let s = setup();
    assert_eq!(s.manager.state().get("jobs"), Some(&Json::Object(Object::new())));
    assert!(!s.manager.catalog().get("models").unwrap().as_array().unwrap().is_empty());
    for consent in [json!(false), json!(1), json!("yes"), json!(null)] {
        let request = json!({"id": "test-model", "consent": consent, "catalog_version": CATALOG_VERSION});
        assert_eq!(code(s.manager.start(&request).unwrap_err()), "consent_required");
    }
    assert!(s.opened.lock().unwrap().is_empty() && !s.root.exists());
}

#[test]
fn only_fixed_catalog_requests_are_accepted() {
    let s = setup();
    for (request, expected) in [
        (json!({"id": "../outside", "consent": true, "catalog_version": CATALOG_VERSION}), "catalog_changed"),
        (json!({"id": "test-model", "consent": true, "catalog_version": "stale"}), "catalog_changed"),
        (json!({"id": "test-model", "consent": true, "catalog_version": CATALOG_VERSION, "url": "https://elsewhere/model"}), "download_request_invalid"),
        (json!({"id": 7, "consent": true, "catalog_version": CATALOG_VERSION}), "catalog_changed"),
        (json!("test-model"), "download_request_invalid"),
    ] {
        assert_eq!(code(s.manager.start(&request).unwrap_err()), expected, "{request}");
    }
    assert!(s.opened.lock().unwrap().is_empty());
}

/// The test entry under a non-commercial license (as NLLB-200's CC-BY-NC-4.0).
fn non_commercial() -> Model {
    Model { license: "CC-BY-NC-4.0".into(), ..entry() }
}

fn with_acknowledged(acknowledged: Option<serde_json::Value>, consent: bool) -> serde_json::Value {
    let mut request = json!({"id": "test-model", "consent": consent, "catalog_version": CATALOG_VERSION});
    if let Some(acknowledged) = acknowledged {
        request["acknowledged"] = acknowledged;
    }
    request
}

fn restrictions(m: &Downloads) -> Json {
    m.catalog().get("models").unwrap().as_array().unwrap()[0].get("restrictions").cloned().unwrap()
}

#[test]
fn a_non_commercial_entry_starts_only_with_its_acknowledgement() {
    let s = setup_with(non_commercial(), None);
    assert_eq!(restrictions(&s.manager), Json::from(vec![Json::from("non_commercial")]));
    for (acknowledged, consent, expected) in [
        (None, true, "model_download_restriction_unacknowledged"),
        (Some(json!([])), true, "model_download_restriction_unacknowledged"),
        // The acknowledgement does not stand in for the consent.
        (Some(json!(["non_commercial"])), false, "consent_required"),
        // Not a list of distinct known kinds.
        (Some(json!(["non_commercial", "non_commercial"])), true, "download_request_invalid"),
        (Some(json!(["non_commercial", "gemma_terms"])), true, "download_request_invalid"),
        (Some(json!("non_commercial")), true, "download_request_invalid"),
        (Some(json!([true])), true, "download_request_invalid"),
        (Some(json!(null)), true, "download_request_invalid"),
    ] {
        let request = with_acknowledged(acknowledged, consent);
        assert_eq!(code(s.manager.start(&request).unwrap_err()), expected, "{request}");
    }
    assert!(s.opened.lock().unwrap().is_empty() && !s.root.exists(), "a refused start writes and fetches nothing");
    assert_eq!(s.manager.state().get("jobs"), Some(&Json::Object(Object::new())));
    s.manager.start(&with_acknowledged(Some(json!(["non_commercial"])), true)).unwrap();
    let job = finish(&s.manager);
    assert_eq!(phase(&job), "ready");
    // The receipt stays the entry itself: the acknowledgement is not recorded in it.
    let receipt = fs::read_to_string(model_path(&job).with_file_name("receipt.json")).unwrap();
    assert_eq!(receipt, Json::from_serialize(&non_commercial()).to_python_indented());
}

/// The test entry as a local translation model, the only kind that asks for the Gemma terms. A
/// translation entry holds the folder's `manifest.json` and ONNX files (`validate_catalog`).
fn translation_entry() -> Model {
    let file = |filename: &str, role: &str| Artifact { filename: filename.into(), size: CONTENT.len() as u64, sha256: sha(CONTENT), role: role.into(), remote: None };
    Model {
        target: catalog::TRANSLATION_TARGET.into(),
        notice: "translation".into(),
        artifacts: vec![file("manifest.json", "manifest"), file("encoder.onnx", "encoder")],
        ..entry()
    }
}

#[test]
fn a_speech_entry_under_the_gemma_terms_needs_no_acknowledgement() {
    // As Irodori-TTS v4 Large: the license names the Gemma terms, but only translation
    // entries ask for them (decision 4 of the LLM runtime plan).
    let s = setup_with(Model { license: "Gemma Terms of Use + MIT".into(), ..entry() }, None);
    assert_eq!(restrictions(&s.manager), Json::from(Vec::<Json>::new()));
    let request = with_acknowledged(Some(json!(["gemma_terms"])), true);
    assert_eq!(code(s.manager.start(&request).unwrap_err()), "download_request_invalid");
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
}

#[test]
fn an_entry_under_the_gemma_terms_starts_only_with_that_acknowledgement() {
    let s = setup_with(Model { license: "Gemma Terms of Use + MIT".into(), ..translation_entry() }, None);
    assert_eq!(restrictions(&s.manager), Json::from(vec![Json::from("gemma_terms")]));
    for (acknowledged, expected) in [
        (None, "model_download_restriction_unacknowledged"),
        (Some(json!([])), "model_download_restriction_unacknowledged"),
        // Another kind does not stand in for it.
        (Some(json!(["non_commercial"])), "download_request_invalid"),
        (Some(json!(["gemma_terms", "gemma_terms"])), "download_request_invalid"),
    ] {
        let request = with_acknowledged(acknowledged, true);
        assert_eq!(code(s.manager.start(&request).unwrap_err()), expected, "{request}");
    }
    assert!(s.opened.lock().unwrap().is_empty() && !s.root.exists(), "a refused start writes and fetches nothing");
    s.manager.start(&with_acknowledged(Some(json!(["gemma_terms"])), true)).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
}

#[test]
fn an_entry_with_both_restrictions_needs_both() {
    let s = setup_with(Model { license: "Gemma Terms of Use + CC-BY-NC-4.0".into(), ..translation_entry() }, None);
    assert_eq!(restrictions(&s.manager), Json::from(vec![Json::from("non_commercial"), Json::from("gemma_terms")]));
    for acknowledged in [json!(["gemma_terms"]), json!(["non_commercial"])] {
        let request = with_acknowledged(Some(acknowledged), true);
        assert_eq!(code(s.manager.start(&request).unwrap_err()), "model_download_restriction_unacknowledged", "{request}");
    }
    // The order the dialog lists them in does not matter.
    s.manager.start(&with_acknowledged(Some(json!(["gemma_terms", "non_commercial"])), true)).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
}

#[test]
fn an_unrestricted_entry_takes_the_request_as_before_and_no_acknowledgement_it_does_not_carry() {
    let s = setup();
    assert_eq!(restrictions(&s.manager), Json::from(Vec::<Json>::new()));
    // Acknowledging what the entry does not carry, or what no entry can, is not a request
    // the dialog makes.
    for acknowledged in [json!(["non_commercial"]), json!(["other"]), json!(null)] {
        let request = with_acknowledged(Some(acknowledged), true);
        assert_eq!(code(s.manager.start(&request).unwrap_err()), "download_request_invalid", "{request}");
    }
    assert!(s.opened.lock().unwrap().is_empty() && !s.root.exists());
    // An empty list names nothing, as leaving it out does.
    s.manager.start(&with_acknowledged(Some(json!([])), true)).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
}

#[test]
fn verified_completion_does_not_apply_or_load_and_can_be_applied_explicitly() {
    let s = setup();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!(phase(&job), "ready");
    assert_eq!(job.get("received_bytes"), Some(&Json::from(CONTENT.len() as u64)));
    let target = model_path(&job);
    assert_eq!(fs::read(&target).unwrap(), CONTENT);
    assert_eq!(*s.opened.lock().unwrap(), [format!("https://huggingface.co/author/model/resolve/{}/model.gguf", "a".repeat(40))]);
    // The receipt is the entry as Python's json.dumps(indent=2) wrote it, in UTF-8.
    let receipt = fs::read_to_string(target.with_file_name("receipt.json")).unwrap();
    assert_eq!(receipt, Json::from_serialize(&entry()).to_python_indented());
    let mut applied = Vec::new();
    let answer = s
        .manager
        .apply("test-model", text(&job, "job_id"), |e, paths| {
            assert_eq!(e.id, "test-model");
            applied.push(paths.clone());
            Ok(())
        })
        .unwrap();
    assert_eq!(applied, [vec![("model".to_string(), target.to_string_lossy().into_owned())]]);
    assert_eq!(phase(answer.get("jobs").unwrap().get("test-model").unwrap()), "applied");
}

#[test]
fn state_reports_files_downloaded_in_an_earlier_run() {
    let s = setup();
    let downloaded = |m: &Downloads| m.state().get("downloaded").cloned().unwrap();
    assert_eq!(downloaded(&s.manager), Json::from(Object::new()));
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    let expected = Json::from(Object::new().with("test-model", job.get("paths").unwrap().clone()));
    assert_eq!(downloaded(&s.manager), expected);
    s.manager.close(Duration::from_secs(2));

    // After a restart there is no job, but the files are still reported.
    let restarted = Downloads::with(&s.root, vec![entry()], Arc::new(|_: &str| body(b"")), Options { reserve_bytes: 0, ..Options::default() }).unwrap();
    assert_eq!(restarted.state().get("jobs"), Some(&Json::from(Object::new())));
    assert_eq!(downloaded(&restarted), expected);
    // A file of the wrong size, or a folder in its place, is not reported (no hashing here).
    let model = model_path(&job);
    fs::write(&model, [CONTENT, b"x"].concat()).unwrap();
    assert_eq!(downloaded(&restarted), Json::from(Object::new()));
    fs::remove_file(&model).unwrap();
    fs::create_dir(&model).unwrap();
    assert_eq!(downloaded(&restarted), Json::from(Object::new()));
    restarted.close(Duration::from_secs(2));
    assert_eq!(s.opened.lock().unwrap().len(), 1);
}

#[test]
fn catalog_text_beyond_ascii_is_written_as_utf8() {
    let s = setup_with(Model { name: "PP-OCRv6 small · Japanese".into(), ..entry() }, None);
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!(phase(&job), "ready");
    assert!(fs::read_to_string(model_path(&job).with_file_name("receipt.json")).unwrap().contains("·"));
}

#[test]
fn incomplete_oversized_or_corrupt_download_never_publishes() {
    let corrupt = vec![b'x'; CONTENT.len()];
    for (data, expected) in [(b"GGUFwrong".to_vec(), "size_mismatch"), (vec![b'x'; 200], "size_mismatch"), (corrupt, "hash_mismatch")] {
        let s = setup();
        s.manager.set_transport(Arc::new(move |_: &str| body(&data)));
        start(&s.manager).unwrap();
        let job = finish(&s.manager);
        assert_eq!((phase(&job), text(&job, "error_code")), ("failed", expected));
        assert_eq!(job.get("paths"), Some(&Json::Object(Object::new())));
        assert!(files_named(&s.root, ".gguf").is_empty() && partials(&s.root).is_empty());
    }
}

/// A body that waits for a release before each read.
struct Gated {
    data: Cursor<Vec<u8>>,
    entered: Arc<Flag>,
    release: Arc<Flag>,
}

impl Read for Gated {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.entered.set();
        assert!(self.release.wait(Duration::from_secs(2)));
        self.data.read(buf)
    }
}

impl Body for Gated {}

#[test]
fn cancel_keeps_no_partial_path_and_old_job_cannot_cancel_retry() {
    let s = setup();
    let (entered, release) = (Arc::new(Flag::default()), Arc::new(Flag::default()));
    let (e, r) = (entered.clone(), release.clone());
    s.manager.set_transport(Arc::new(move |_: &str| -> Result<Box<dyn Body>, Error> { Ok(Box::new(Gated { data: Cursor::new(CONTENT.to_vec()), entered: e.clone(), release: r.clone() })) }));
    start(&s.manager).unwrap();
    assert!(entered.wait(Duration::from_secs(1)));
    let old = text(&job(&s.manager), "job_id").to_string();
    s.manager.cancel("test-model", &old).unwrap();
    release.set();
    assert_eq!(phase(&finish(&s.manager)), "cancelled");
    assert!(files_named(&s.root, ".gguf").is_empty());
    s.manager.set_transport(Arc::new(|_: &str| body(CONTENT)));
    start(&s.manager).unwrap();
    let retry = finish(&s.manager);
    assert_eq!(phase(&retry), "ready");
    assert_eq!(code(s.manager.cancel("test-model", &old).unwrap_err()), "stale_job");
    assert_eq!(text(&job(&s.manager), "job_id"), text(&retry, "job_id"));
}

#[test]
fn disk_preflight_fails_without_network() {
    let s = setup_with(entry(), Some(0));
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!((phase(&job), text(&job, "error_code")), ("failed", "insufficient_space"));
    assert!(s.opened.lock().unwrap().is_empty());
}

#[test]
fn disk_full_during_write_leaves_no_selectable_file() {
    let s = setup();
    s.manager.hooks().sync = Some(Box::new(|_| Err(io::Error::from(io::ErrorKind::StorageFull))));
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!((phase(&job), text(&job, "error_code")), ("failed", "insufficient_space"));
    assert!(files_named(&s.root, ".gguf").is_empty() && partials(&s.root).is_empty());
    #[cfg(unix)]
    {
        let s = setup();
        s.manager.hooks().sync = Some(Box::new(|_| Err(io::Error::from_raw_os_error(libc::ENOSPC))));
        start(&s.manager).unwrap();
        assert_eq!(text(&finish(&s.manager), "error_code"), "insufficient_space");
    }
}

#[test]
fn network_failure_removes_staging_and_preserves_unrelated_files() {
    let s = setup();
    fs::create_dir_all(&s.root).unwrap();
    fs::write(s.root.join("user.pth"), b"user model").unwrap();
    s.manager.set_transport(Arc::new(|_: &str| -> Result<Box<dyn Body>, Error> { Err(Error::Io(io::Error::other("network private details"))) }));
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!((phase(&job), text(&job, "error_code")), ("failed", "download_failed"));
    assert_eq!(fs::read(s.root.join("user.pth")).unwrap(), b"user model");
    assert!(partials(&s.root).is_empty());
}

#[test]
fn complete_cache_is_reverified_and_a_damaged_one_is_downloaded_again() {
    let s = setup();
    start(&s.manager).unwrap();
    let path = model_path(&finish(&s.manager));
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    assert_eq!(s.opened.lock().unwrap().len(), 1);
    // Truncated, same size but other bytes (a hash failure), and gone: each is replaced by a
    // fresh, verified download at the same place, and nothing is left beside it.
    let same_size = vec![b'x'; CONTENT.len()];
    for (n, damage) in [Some(b"bad cache".to_vec()), Some(same_size), None].into_iter().enumerate() {
        match damage {
            Some(bytes) => fs::write(&path, bytes).unwrap(),
            None => fs::remove_file(&path).unwrap(),
        }
        start(&s.manager).unwrap();
        let job = finish(&s.manager);
        assert_eq!(phase(&job), "ready", "{job:?}");
        assert_eq!(model_path(&job), path);
        assert_eq!(fs::read(&path).unwrap(), CONTENT);
        assert_eq!(s.opened.lock().unwrap().len(), n + 2);
        assert!(partials(&s.root).is_empty());
    }
}

#[test]
fn a_damaged_cache_holding_anything_else_is_kept_and_fails() {
    let s = setup();
    start(&s.manager).unwrap();
    let path = model_path(&finish(&s.manager));
    fs::write(&path, b"bad cache").unwrap();
    // A file this app did not write: the folder is not only its own, so nothing is moved.
    fs::write(path.with_file_name("notes.txt"), b"mine").unwrap();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!((phase(&job), text(&job, "error_code")), ("failed", "size_mismatch"));
    assert_eq!(fs::read(&path).unwrap(), b"bad cache");
    assert_eq!(fs::read(path.with_file_name("notes.txt")).unwrap(), b"mine");
    fs::remove_file(path.with_file_name("notes.txt")).unwrap();

    // No marker (placed by hand): kept as well.
    fs::remove_file(path.with_file_name("owner.json")).unwrap();
    start(&s.manager).unwrap();
    assert_eq!(text(&finish(&s.manager), "error_code"), "size_mismatch");
    assert_eq!(fs::read(&path).unwrap(), b"bad cache");
    assert_eq!(s.opened.lock().unwrap().len(), 1, "no download over kept files");
}

#[test]
fn a_damaged_cache_whose_staging_name_is_taken_is_kept() {
    let s = setup();
    start(&s.manager).unwrap();
    let path = model_path(&finish(&s.manager));
    fs::write(&path, b"bad cache").unwrap();
    let marker = fs::read_to_string(path.with_file_name("owner.json")).unwrap();
    let name = serde_json::from_str::<serde_json::Value>(&marker).unwrap()["directory"].as_str().unwrap().to_string();
    // Something else of the user's under that name.
    fs::create_dir(s.root.join(&name)).unwrap();
    fs::write(s.root.join(&name).join("keep"), b"keep").unwrap();
    start(&s.manager).unwrap();
    assert_eq!(text(&finish(&s.manager), "error_code"), "size_mismatch");
    assert_eq!(fs::read(&path).unwrap(), b"bad cache");
    assert_eq!(fs::read(s.root.join(&name).join("keep")).unwrap(), b"keep");
}

#[test]
fn a_damaged_cache_moved_aside_by_a_run_that_stopped_is_removed_by_the_next() {
    let s = setup();
    start(&s.manager).unwrap();
    let path = model_path(&finish(&s.manager));
    fs::write(&path, b"bad cache").unwrap();
    // What a run that stopped right after moving it leaves: the folder under its staging name.
    let published = path.parent().unwrap().to_path_buf();
    let marker = fs::read_to_string(published.join("owner.json")).unwrap();
    let name = serde_json::from_str::<serde_json::Value>(&marker).unwrap()["directory"].as_str().unwrap().to_string();
    fs::rename(&published, s.root.join(&name)).unwrap();
    assert_eq!(s.manager.state().get("downloaded"), Some(&Json::from(Object::new())), "not offered while aside");
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    assert_eq!(fs::read(&path).unwrap(), CONTENT);
    assert!(partials(&s.root).is_empty());
}

#[test]
fn restart_right_after_ready_waits_for_the_finishing_worker() {
    let s = setup();
    let release = Arc::new(Flag::default());
    let gate = release.clone();
    s.manager.hooks().before_lease_close = Some(Box::new(move || {
        gate.wait(Duration::from_secs(3));
    }));
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    // The first worker still holds the lease; the second waits for it instead of failing busy.
    start(&s.manager).unwrap();
    release.set();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    assert_eq!(s.opened.lock().unwrap().len(), 1);
}

#[cfg(unix)]
#[test]
fn symlink_destination_cannot_overwrite_outside_file() {
    let s = setup();
    let outside = s._dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("model.gguf"), b"do not change").unwrap();
    fs::create_dir_all(&s.root).unwrap();
    std::os::unix::fs::symlink(&outside, s.root.join("test-model")).unwrap();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!((phase(&job), text(&job, "error_code")), ("failed", "unsafe_destination"));
    assert_eq!(fs::read(outside.join("model.gguf")).unwrap(), b"do not change");
    assert!(s.opened.lock().unwrap().is_empty());
}

#[test]
fn tampered_file_cannot_be_applied() {
    let s = setup();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    fs::write(model_path(&job), b"changed").unwrap();
    let error = s.manager.apply("test-model", text(&job, "job_id"), |_, _| panic!("applied corrupt data")).unwrap_err();
    assert_eq!(code(error), "size_mismatch");
    // Still ready: the user can download again or put the file back.
    assert_eq!(phase(&self::job(&s.manager)), "ready");
}

#[test]
fn failed_setting_application_keeps_download_available() {
    let s = setup();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    let error = s.manager.apply("test-model", text(&job, "job_id"), |_, _| Err(Error::Code("settings_changed"))).unwrap_err();
    assert_eq!(code(error), "settings_changed");
    assert_eq!(phase(&self::job(&s.manager)), "ready");
    // A stale or unknown job id is refused before anything is verified.
    assert_eq!(code(s.manager.apply("test-model", "other", |_, _| Ok(())).unwrap_err()), "stale_job");
}

#[test]
fn close_prohibits_future_network_or_apply() {
    let s = setup();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert!(s.manager.close(Duration::from_secs(2)));
    assert_eq!(code(start(&s.manager).unwrap_err()), "downloads_closed");
    assert_eq!(code(s.manager.apply("test-model", text(&job, "job_id"), |_, _| Ok(())).unwrap_err()), "downloads_closed");
    assert_eq!(s.opened.lock().unwrap().len(), 1);
}

struct Failing;

impl Read for Failing {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::new(io::ErrorKind::UnexpectedEof, "incomplete read"))
    }
}

impl Body for Failing {}

#[test]
fn unexpected_stream_error_is_a_failure_not_a_stuck_job() {
    let s = setup();
    s.manager.set_transport(Arc::new(|_: &str| -> Result<Box<dyn Body>, Error> { Ok(Box::new(Failing)) }));
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    assert_eq!((phase(&job), text(&job, "error_code")), ("failed", "download_failed"));
}

/// A body whose read blocks until it is aborted.
struct Blocked {
    entered: Arc<Flag>,
    aborted: Arc<Flag>,
}

impl Read for Blocked {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        self.entered.set();
        self.aborted.wait(Duration::from_secs(2));
        Ok(0)
    }
}

impl Body for Blocked {
    fn aborter(&self) -> Option<Aborter> {
        let aborted = self.aborted.clone();
        Some(Aborter::new(move || aborted.set()))
    }
}

#[test]
fn cancel_aborts_a_blocked_body_and_never_publishes() {
    let s = setup();
    let (entered, aborted) = (Arc::new(Flag::default()), Arc::new(Flag::default()));
    let (e, a) = (entered.clone(), aborted.clone());
    s.manager.set_transport(Arc::new(move |_: &str| -> Result<Box<dyn Body>, Error> { Ok(Box::new(Blocked { entered: e.clone(), aborted: a.clone() })) }));
    start(&s.manager).unwrap();
    assert!(entered.wait(Duration::from_secs(1)));
    let id = text(&job(&s.manager), "job_id").to_string();
    s.manager.cancel("test-model", &id).unwrap();
    assert!(aborted.wait(Duration::from_millis(200)));
    assert_eq!(phase(&finish(&s.manager)), "cancelled");
    assert!(s.manager.close(Duration::from_secs(2)) && partials(&s.root).is_empty());
}

#[test]
fn multi_file_bundle_failure_never_publishes_first_file() {
    let mut model = entry();
    model.artifacts.push(Artifact { filename: "features.index".into(), role: "index".into(), ..model.artifacts[0].clone() });
    let s = setup_with(model, None);
    s.manager.set_transport(Arc::new(|url: &str| if url.ends_with(".gguf") { body(CONTENT) } else { body(b"bad second file") }));
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "failed");
    assert!(files_named(&s.root, "model.gguf").is_empty());
}

#[test]
fn a_second_start_while_one_runs_is_busy() {
    let s = setup();
    let (entered, release) = (Arc::new(Flag::default()), Arc::new(Flag::default()));
    let (e, r) = (entered.clone(), release.clone());
    s.manager.set_transport(Arc::new(move |_: &str| -> Result<Box<dyn Body>, Error> { Ok(Box::new(Gated { data: Cursor::new(CONTENT.to_vec()), entered: e.clone(), release: r.clone() })) }));
    start(&s.manager).unwrap();
    assert!(entered.wait(Duration::from_secs(1)));
    assert_eq!(code(start(&s.manager).unwrap_err()), "download_busy");
    release.set();
    assert_eq!(phase(&finish(&s.manager)), "ready");
}

#[test]
fn transport_rejects_unapproved_urls() {
    for url in [
        "http://huggingface.co/x",
        "https://huggingface.co.evil/x",
        "https://localhost/x",
        "https://user:pass@huggingface.co/x",
        "https://huggingface.co:444/x",
        "http://us.aws.cdn.hf.co/x",
        "https://us.aws.cdn.hf.co.evil/x",
        "https://other.aws.cdn.hf.co/x",
        "https://evil@us.aws.cdn.hf.co/x",
        "https://huggingface.co/x#fragment",
        "https://huggingface.co/x\u{1}",
    ] {
        assert!(validate_url(url, &HOSTS).is_err(), "{url}");
    }
    assert!(validate_url("https://us.aws.cdn.hf.co/bridge/file?test=nonsecret", &HOSTS).is_ok());
    assert!(validate_url("https://HuggingFace.co:443/x", &HOSTS).is_ok());
    // A port that is not a number is not a refusal code: a job reports download_failed.
    assert!(matches!(validate_url("https://huggingface.co:x/", &HOSTS), Err(Error::Other(_))));
}

/// Routes every connection to `port` on this PC, whatever the URL's host.
fn to_loopback(port: u16) -> impl Fn(&str, u16) -> io::Result<(crate::net::Stream, crate::net::Abort)> {
    move |_: &str, _: u16| crate::net::connect("127.0.0.1", port, Duration::from_secs(5), None)
}

#[test]
fn redirects_are_followed_only_to_the_fixed_hosts() {
    let server = serve(|request, stream| match request.path.as_str() {
        "/start" => answer(stream, 302, &[("Location", "https://us.aws.cdn.hf.co/bridge/file?sig=a%2Fb")], b""),
        "/relative" => answer(stream, 307, &[("Location", "/api/resolve-cache/x")], b""),
        "/api/resolve-cache/x" | "/bridge/file?sig=a%2Fb" => answer(stream, 200, &[], b"payload"),
        "/elsewhere" => answer(stream, 302, &[("Location", "https://evil.example/x")], b""),
        "/missing" => answer(stream, 404, &[], b"no"),
        "/partial" => answer(stream, 206, &[], b"part"),
        "/nolocation" => answer(stream, 302, &[], b""),
        path if path.starts_with("/loop") => {
            let n: u32 = path[5..].parse().unwrap_or(0);
            answer(stream, 302, &[("Location", &format!("/loop{}", n + 1))], b"");
        }
        _ => answer(stream, 500, &[], b""),
    });
    let connect = to_loopback(server.port);
    let open = |path: &str| open_via(&format!("https://huggingface.co{path}"), &HOSTS, &connect);
    let read = |path: &str| -> Result<Vec<u8>, Error> {
        let mut out = Vec::new();
        open(path)?.read_to_end(&mut out).unwrap();
        Ok(out)
    };
    assert_eq!(read("/start").unwrap(), b"payload");
    assert_eq!(read("/relative").unwrap(), b"payload");
    assert_eq!(code(read("/elsewhere").unwrap_err()), "download_url_rejected");
    assert_eq!(code(read("/partial").unwrap_err()), "download_http_error");
    assert!(matches!(read("/missing"), Err(Error::Other(_))));
    assert!(matches!(read("/nolocation"), Err(Error::Other(_))));
    // Five redirects are followed, the sixth is a loop.
    let before = server.requests().len();
    assert!(matches!(read("/loop0"), Err(Error::Other(_))));
    assert_eq!(server.requests().len() - before, 6);
    let sent = server.requests().into_iter().find(|r| r.path == "/start").unwrap();
    assert_eq!(
        sent.headers.iter().map(|(n, v)| (n.as_str(), v.as_str())).collect::<Vec<_>>(),
        [("Host", "huggingface.co"), ("User-Agent", "ASTAROT-model-download/1"), ("Accept-Encoding", "identity"), ("Connection", "close")]
    );
    // The first hop goes to the URL's own host only after it was checked.
    assert_eq!(code(open_via("https://evil.example/x", &HOSTS, &connect).err().unwrap()), "download_url_rejected");
}

#[test]
fn a_chunked_body_is_read_whole() {
    let server = serve(|_, stream| {
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nGGUF\r\n3;x=y\r\nabc\r\n0\r\nTrailer: 1\r\n\r\n");
    });
    let mut out = Vec::new();
    open_via("https://huggingface.co/x", &HOSTS, &to_loopback(server.port)).unwrap().read_to_end(&mut out).unwrap();
    assert_eq!(out, b"GGUFabc");
}

/// Answers 200 with a long declared length, sends one byte and stalls.
fn stalled_server() -> (crate::testing::Server, Arc<Flag>, Arc<Flag>) {
    let (entered, release) = (Arc::new(Flag::default()), Arc::new(Flag::default()));
    let (e, r) = (entered.clone(), release.clone());
    let server = serve(move |_, stream| {
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\nG");
        let _ = stream.flush();
        e.set();
        r.wait(Duration::from_secs(5));
    });
    (server, entered, release)
}

// A body that stalls after its first byte ends as soon as the manager closes, on Windows too:
// there a read blocked on the socket did not end when another thread shut the socket down, and
// closing waited for the read's timeout (15 s, #884). Reads now wait with poll and look whether
// they were stopped (`net::Socket`).
#[test]
fn real_stopped_http_body_is_aborted_on_close() {
    let s = setup();
    let (server, entered, release) = stalled_server();
    let url = server.url("/body");
    s.manager.set_transport(Arc::new(move |_: &str| -> Result<Box<dyn Body>, Error> { Ok(Box::new(open_loopback(&url)?)) }));
    start(&s.manager).unwrap();
    assert!(entered.wait(Duration::from_secs(2)));
    thread::sleep(Duration::from_millis(100));
    let began = Instant::now();
    assert!(s.manager.close(Duration::from_secs(1)));
    assert!(began.elapsed() < Duration::from_secs(1));
    assert_eq!(phase(&finish(&s.manager)), "cancelled");
    assert!(partials(&s.root).is_empty() && files_named(&s.root, ".gguf").is_empty());
    release.set();
}

#[test]
fn a_live_owners_partial_is_kept_and_a_dead_owners_is_reclaimed() {
    let s = setup();
    fs::create_dir_all(&s.root).unwrap();
    // What a killed owner leaves: a marked staging directory with a partial file.
    let partial = s.root.join(format!(".partial-{}", "0".repeat(32)));
    fs::create_dir(&partial).unwrap();
    mark_owned(&partial, &entry()).unwrap();
    fs::write(partial.join("model.gguf"), b"GGU").unwrap();
    // While another owner (another process, or a Python owner) holds the root, nothing is
    // touched and the start fails busy.
    let mut other = RootLease::new(&s.root);
    other.acquire().unwrap();
    start(&s.manager).unwrap();
    assert_eq!(text(&finish(&s.manager), "error_code"), "download_busy");
    assert!(partial.is_dir());
    other.close();
    // Unrecognized staging is never removed.
    let foreign = s.root.join(".partial-user-stuff");
    fs::create_dir(&foreign).unwrap();
    fs::write(foreign.join("keep"), "keep").unwrap();
    let unknown = s.root.join(format!(".partial-{}", "1".repeat(32)));
    fs::create_dir(&unknown).unwrap();
    mark_owned(&unknown, &entry()).unwrap();
    fs::write(unknown.join("notes.txt"), "mine").unwrap();
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    assert!(!partial.exists());
    assert_eq!(fs::read_to_string(foreign.join("keep")).unwrap(), "keep");
    assert_eq!(fs::read_to_string(unknown.join("notes.txt")).unwrap(), "mine");
}

#[test]
fn a_marker_written_by_python_is_recognized() {
    let s = setup();
    fs::create_dir_all(&s.root).unwrap();
    let partial = s.root.join(format!(".partial-{}", "a".repeat(32)));
    fs::create_dir(&partial).unwrap();
    // json.dump(dict(...)) as staging.py writes it, keys in a different order.
    let python = format!(
        r#"{{"product": "VRCT-VOX-model-download-v1", "id": "test-model", "revision": "{}", "files": ["model.gguf"], "directory": "{}"}}"#,
        "a".repeat(40),
        partial.file_name().unwrap().to_string_lossy()
    );
    fs::write(partial.join("owner.json"), python).unwrap();
    fs::write(partial.join("receipt.json"), "{}").unwrap();
    recover_owned(&s.root, &[entry()], &[]).unwrap();
    assert!(!partial.exists());
}

/// A staging directory marked with `product`, as Python's `json.dump` writes the marker.
fn partial_marked(root: &Path, digit: char, product: &str) -> PathBuf {
    fs::create_dir_all(root).unwrap();
    let partial = root.join(format!(".partial-{}", digit.to_string().repeat(32)));
    fs::create_dir(&partial).unwrap();
    let marker = json!({"product": product, "id": "test-model", "revision": "a".repeat(40), "files": ["model.gguf"],
        "directory": partial.file_name().unwrap().to_string_lossy()});
    fs::write(partial.join("owner.json"), marker.to_string()).unwrap();
    fs::write(partial.join("model.gguf"), b"GGU").unwrap();
    partial
}

/// ADR-014: from 0.6.0 the marker names ASTAROT.
#[test]
fn the_marker_names_astarot() {
    let s = setup();
    start(&s.manager).unwrap();
    let path = model_path(&finish(&s.manager));
    let marker: serde_json::Value = serde_json::from_slice(&fs::read(path.with_file_name("owner.json")).unwrap()).unwrap();
    assert_eq!(marker["product"], "ASTAROT-model-download-v1");
}

/// ADR-014, 2.11: a staging directory marked under either spelling is this app's.
#[test]
fn a_marker_under_either_name_is_recognized_and_no_other() {
    let s = setup();
    let old = partial_marked(&s.root, 'b', "VRCT-VOX-model-download-v1");
    let new = partial_marked(&s.root, 'c', "ASTAROT-model-download-v1");
    let other = partial_marked(&s.root, 'd', "ASTAROT-model-download-v2");
    let empty = partial_marked(&s.root, 'e', "");
    recover_owned(&s.root, &[entry()], &[]).unwrap();
    assert!(!old.exists() && !new.exists());
    assert_eq!(fs::read(other.join("model.gguf")).unwrap(), b"GGU");
    assert_eq!(fs::read(empty.join("model.gguf")).unwrap(), b"GGU");
}

#[test]
fn a_damaged_cache_marked_by_0_5_is_downloaded_again() {
    let s = setup();
    start(&s.manager).unwrap();
    let path = model_path(&finish(&s.manager));
    // What 0.5.x left, with its own marker, damaged since.
    let marker_path = path.with_file_name("owner.json");
    let marker = fs::read_to_string(&marker_path).unwrap().replace("ASTAROT-model-download-v1", "VRCT-VOX-model-download-v1");
    assert!(marker.contains("VRCT-VOX-model-download-v1"));
    fs::write(&marker_path, marker).unwrap();
    fs::write(&path, b"bad cache").unwrap();
    start(&s.manager).unwrap();
    assert_eq!(phase(&finish(&s.manager)), "ready");
    assert_eq!(fs::read(&path).unwrap(), CONTENT);
    assert_eq!(s.opened.lock().unwrap().len(), 2);
    assert!(partials(&s.root).is_empty());
}

#[test]
fn closing_waits_no_longer_than_its_timeout_for_a_committing_callback() {
    let s = setup();
    start(&s.manager).unwrap();
    let job = finish(&s.manager);
    let id = text(&job, "job_id").to_string();
    let (inside, release) = (Arc::new(Flag::default()), Arc::new(Flag::default()));
    let applied = Arc::new(AtomicUsize::new(0));
    thread::scope(|scope| {
        let (i, r, a) = (inside.clone(), release.clone(), applied.clone());
        let manager = &s.manager;
        let applying = scope.spawn(move || {
            manager.apply("test-model", &id, |_, _| {
                i.set();
                r.wait(Duration::from_secs(3));
                a.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        });
        assert!(inside.wait(Duration::from_secs(2)));
        let began = Instant::now();
        assert!(!s.manager.close(Duration::from_millis(100)));
        assert!(began.elapsed() < Duration::from_secs(1));
        release.set();
        // The commit had begun before the close: it completes.
        assert!(applying.join().unwrap().is_ok());
    });
    assert_eq!(applied.load(Ordering::SeqCst), 1);
    assert!(s.manager.close(Duration::from_secs(1)));
}

#[test]
fn the_default_catalog_validates_and_names_each_remote() {
    let entries = catalog::catalog();
    catalog::validate_catalog(&entries).unwrap();
    let ocr = entries.iter().find(|m| m.id == "ppocrv6-small").unwrap();
    assert_eq!(ocr.artifacts[0].remote, Some(Remote { repo: "PaddlePaddle/PP-OCRv6_small_det_onnx".into(), revision: catalog::OCR_DET_REV.into(), path: "inference.onnx".into() }));
    let mut bad = entries.clone();
    bad[0].artifacts[0].filename = "../x.gguf".into();
    assert_eq!(catalog::validate_catalog(&bad), Err("catalog_invalid"));
    let mut bad = entries.clone();
    bad.push(bad[0].clone());
    assert_eq!(catalog::validate_catalog(&bad), Err("catalog_invalid"));
    let mut bad = entries;
    bad[0].revision = "main".into();
    assert_eq!(catalog::validate_catalog(&bad), Err("catalog_invalid"));
    let _ = transport::USER_AGENT;
}
