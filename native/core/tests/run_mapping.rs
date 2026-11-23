//! CT-02 (`docs/spec/contracts.md`): every notification the core pushes is named in
//! `RUN_MAPPING`. A name missing from it stops the core at the moment of the push (`run_endpoint`
//! panics), so a path no other test walks would fail only in use, as the VRAM error once did in
//! Python. The core builds the names in four ways, and each is checked here against the table:
//!
//! - written at the place that pushes (`notify("…")`, `notify_named("…")`, `run_endpoint("…")`,
//!   a closure made by `notifier()`, and the `push` and `vram_notification` of a message spec);
//! - a `format!` template at that place, whose placeholders take the values listed in
//!   [`placeholder_values`];
//! - chosen first into `name` (`let name = if … { "…" } else { "…" }`) and pushed as `name`;
//! - the lower-case name of a settings key: a model list and its choice.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use astarot_core::controller::RUN_MAPPING;

fn names() -> BTreeSet<&'static str> {
    RUN_MAPPING.iter().map(|(name, _)| *name).collect()
}

fn endpoints() -> BTreeSet<&'static str> {
    RUN_MAPPING.iter().map(|(_, endpoint)| *endpoint).collect()
}

/// The core's sources, tests included: a test that pushes a name must use a real one too.
fn sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                out.push((path, text));
            }
        }
    }
    let mut out = Vec::new();
    walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
    assert!(out.len() > 50, "the sources were not found");
    out
}

/// The string literal at the start of `text` (after spaces), if there is one.
fn literal(text: &str) -> Option<&str> {
    let rest = text.trim_start().strip_prefix('"')?;
    rest.find('"').map(|end| &rest[..end])
}

/// What follows each call of `callee` that is not part of a longer name (`.notify(` and
/// `notify(` count; `fn notify(` and `try_notify(` do not).
fn arguments<'a>(text: &'a str, callee: &str) -> Vec<&'a str> {
    let pattern = format!("{callee}(");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = text[from..].find(&pattern) {
        let start = from + at;
        from = start + pattern.len();
        let before = text[..start].chars().next_back();
        if before.is_some_and(|c| c.is_alphanumeric() || c == '_') || text[..start].ends_with("fn ") {
            continue;
        }
        found.push(&text[from..]);
    }
    found
}

/// The values a placeholder of a `format!` template takes where the core pushes it.
fn placeholder_values(placeholder: &str) -> Vec<String> {
    match placeholder {
        // `audio_devices`: the source of a device list.
        "s" => vec!["mic".into(), "speaker".into()],
        // `transcription`: a recognition engine with models (its settings keep a model list).
        "lower" => {
            let keys: BTreeSet<&str> = astarot_core::config::schema::keys().iter().map(|k| k.name).collect();
            let engines: Vec<String> = astarot_core::languages::transcription_engines()
                .into_iter()
                .filter(|engine| keys.contains(format!("SELECTABLE_{}_MODEL_LIST", engine.to_uppercase()).as_str()))
                .map(|engine| engine.to_lowercase())
                .collect();
            assert!(!engines.is_empty(), "no recognition engine keeps a model list");
            engines
        }
        other => panic!("the placeholder {{{other}}} of a pushed name has no values here; list them in placeholder_values"),
    }
}

/// The names a `format!` template makes, one for each value of each placeholder.
fn expand(template: &str) -> Vec<String> {
    let Some(open) = template.find('{') else { return vec![template.to_string()] };
    let close = open + template[open..].find('}').expect("a closed placeholder");
    let (head, placeholder, tail) = (&template[..open], &template[open + 1..close], &template[close + 1..]);
    placeholder_values(placeholder)
        .into_iter()
        .flat_map(|value| expand(&format!("{head}{value}{tail}")))
        .collect()
}

/// The names (or `/run/…` endpoints) written at the places that push, with where they are.
fn pushed() -> Vec<(String, String)> {
    let mut pushed = Vec::new();
    for (path, text) in sources() {
        let file = path.file_name().unwrap().to_string_lossy().into_owned();
        // Closures made by `notifier()` push the name they are called with.
        let mut callees = vec!["notify".to_string(), "notify_named".to_string(), "run_endpoint".to_string()];
        for line in text.lines() {
            if let Some(bound) = line.trim().strip_prefix("let ").and_then(|l| l.strip_suffix(" = self.notifier();")) {
                callees.push(bound.trim().to_string());
            }
        }
        for callee in &callees {
            for rest in arguments(&text, callee) {
                if let Some(name) = literal(rest) {
                    pushed.push((file.clone(), name.to_string()));
                } else if let Some(template) = rest.trim_start().strip_prefix("&format!(").and_then(literal) {
                    pushed.extend(expand(template).into_iter().map(|name| (file.clone(), name)));
                }
            }
        }
        // A message spec pushes its `push` and reports running out of VRAM on `vram_notification`.
        for field in ["push: Some(", "vram_notification:"] {
            for (at, _) in text.match_indices(field) {
                if let Some(name) = literal(&text[at + field.len()..]) {
                    pushed.push((file.clone(), name.to_string()));
                }
            }
        }
        // A name chosen first and pushed as `name`.
        if text.contains("notify(name,") {
            for (at, _) in text.match_indices("let ") {
                let statement = &text[at..at + text[at..].find(';').unwrap_or(0)];
                let binding = statement.split('=').next().unwrap_or("");
                let binds_name = binding.split(|c: char| !(c.is_alphanumeric() || c == '_')).any(|word| word == "name");
                if binds_name {
                    for (index, piece) in statement.split('"').enumerate() {
                        if index % 2 == 1 && !piece.is_empty() && piece.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
                            pushed.push((file.clone(), piece.to_string()));
                        }
                    }
                }
            }
        }
    }
    pushed
}

#[test]
fn every_name_the_core_pushes_is_in_run_mapping() {
    let (names, endpoints) = (names(), endpoints());
    let pushed = pushed();
    // The four ways above find most of the table; a scan that finds little has stopped working.
    assert!(pushed.len() > 60, "{}", pushed.len());
    let missing: Vec<String> = pushed
        .iter()
        .filter(|(_, name)| if name.starts_with('/') { !endpoints.contains(name.as_str()) } else { !names.contains(name.as_str()) })
        .map(|(file, name)| format!("{file}: {name}"))
        .collect();
    assert_eq!(missing, Vec::<String>::new());
}

#[test]
fn the_model_lists_and_choices_are_pushed_under_their_settings_names() {
    // The translation and recognition services push a model list and its choice under the
    // lower-case name of the settings key (`publish_models`, `forget_models` and the engines').
    let names = names();
    let keys: Vec<&str> = astarot_core::config::schema::keys()
        .iter()
        .map(|key| key.name)
        .filter(|name| {
            (name.starts_with("SELECTABLE_") && name.ends_with("_MODEL_LIST")) || (name.starts_with("SELECTED_") && name.ends_with("_MODEL"))
        })
        .collect();
    assert!(keys.len() >= 10, "{keys:?}");
    let missing: Vec<&str> = keys.into_iter().filter(|key| !names.contains(key.to_lowercase().as_str())).collect();
    assert_eq!(missing, Vec::<&str>::new());
}

#[test]
fn each_name_and_each_endpoint_appears_once() {
    assert_eq!(names().len(), RUN_MAPPING.len());
    assert_eq!(endpoints().len(), RUN_MAPPING.len());
    for (name, endpoint) in RUN_MAPPING {
        assert!(endpoint.starts_with("/run/") || endpoint.starts_with("/set/"), "{name}: {endpoint}");
    }
}
