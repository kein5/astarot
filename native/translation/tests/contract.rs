//! The provider contract (issue #277): every case of `tests/contract/providers.json` run against
//! the Rust providers and compared with what the Python clients did.
//!
//! A case gives what is asked of a provider and what the provider answers. The network is a
//! stand-in [`Transport`] that answers from the case and keeps every request, so the real
//! addresses are used and nothing leaves the process. What the Rust provider sent (method, URL,
//! headers, JSON body, timeouts) and returned must equal the case's `python` record, which
//! `src-python/test/test_translation_contract.py` recorded from the Python clients. A case may
//! carry `rust` instead, where the core differs on purpose (the case's `note` and the
//! `differences` entry say why), or `expect`, for a provider Python never had. A case with
//! `retry_pause` also checks the time between the first two requests: the SDK's pause before its
//! retry, which has a random part.

use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use vrct_translation::http::{HttpError, Request, Response, Timeouts, Transport};
use vrct_translation::prompt::HistoryItem;
use vrct_translation::providers::{deepl, Access, Endpoints, Provider, Translation};

const CONTRACT: &str = include_str!("contract/providers.json");

/// Headers an HTTP library adds on its own (`NOISE_HEADERS` of the Python test).
const NOISE_HEADERS: [&str; 8] = [
    "host",
    "accept",
    "accept-encoding",
    "connection",
    "content-length",
    "user-agent",
    "x-goog-api-client",
    "x-server-timeout",
];

fn document() -> Value {
    serde_json::from_str(CONTRACT).expect("the contract is JSON")
}

/// The URL as the record keeps it: the path `/` when it is empty.
fn normalized_url(url: &str) -> String {
    let (scheme, rest) = url.split_once("://").expect("an absolute URL");
    let (authority, target) = match rest.find(['/', '?']) {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, ""),
    };
    let target = if target.is_empty() || target.starts_with('?') { format!("/{target}") } else { target.to_string() };
    format!("{scheme}://{authority}{target}")
}

fn without_query(url: &str) -> String {
    let url = normalized_url(url);
    url.split('?').next().unwrap_or_default().to_string()
}

fn seconds(duration: std::time::Duration) -> Value {
    json!(duration.as_secs_f64())
}

/// One request as the record keeps it.
fn record(request: &Request<'_>, timeouts: Timeouts) -> Value {
    let body: Value = match &request.body {
        Some(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(bytes)))
        }
        _ => Value::Null,
    };
    let mut headers: Vec<(String, String)> = request
        .headers
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
        .filter(|(name, _)| !NOISE_HEADERS.contains(&name.as_str()) && !name.starts_with("x-stainless-"))
        .filter(|(name, _)| !(name == "content-type" && body.is_null()))
        .collect();
    headers.sort();
    let headers: Map<String, Value> = headers.into_iter().map(|(name, value)| (name, json!(value))).collect();
    json!({
        "method": request.method,
        "url": normalized_url(request.url),
        "headers": headers,
        "body": body,
        "timeout": { "connect": seconds(timeouts.connect), "read": seconds(timeouts.read), "write": seconds(timeouts.write) },
    })
}

/// What the stand-in network saw: each request as the record keeps it, and when it was sent.
type Seen = Arc<Mutex<Vec<(Value, Instant)>>>;

/// A network that answers from the case's `answers` and keeps every request.
fn network(answers: &Value) -> (Transport, Seen) {
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let script: Vec<(String, String, Vec<Value>)> = answers
        .as_array()
        .expect("answers")
        .iter()
        .map(|a| {
            let method = a["method"].as_str().unwrap().to_string();
            let url = without_query(a["url"].as_str().unwrap());
            (method, url, a["replies"].as_array().unwrap().clone())
        })
        .collect();
    let used = Arc::new(Mutex::new(vec![0usize; script.len()]));
    let kept = Arc::clone(&seen);
    let transport: Transport = Arc::new(move |request: &Request<'_>, timeouts: Timeouts| {
        kept.lock().unwrap().push((record(request, timeouts), Instant::now()));
        let url = without_query(request.url);
        let Some(at) = script.iter().position(|(m, u, _)| m == request.method && *u == url) else {
            return Ok(Response::new(404, br#"{"error":"no answer in the contract"}"#.to_vec()));
        };
        let mut used = used.lock().unwrap();
        let replies = &script[at].2;
        let reply = &replies[used[at].min(replies.len() - 1)];
        used[at] += 1;
        if reply.get("status").is_none() {
            return Err(HttpError::Unreachable);
        }
        let headers = reply["headers"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, value)| (name.to_ascii_lowercase(), value.as_str().unwrap_or_default().to_string()))
            .collect();
        let status = reply["status"].as_u64().unwrap() as u16;
        Ok(Response { status, headers, body: serde_json::to_vec(&reply["body"]).unwrap() })
    });
    (transport, seen)
}

/// The fixed address of a cloud provider, as the core takes it (`fixed_url`).
fn fixed_url(endpoints: &Endpoints, provider: Provider, key: &str) -> String {
    match provider {
        Provider::DeepL => deepl::base_url(&endpoints.deepl, &endpoints.deepl_free, key).to_string(),
        Provider::GoogleCloud => endpoints.google_cloud.clone(),
        Provider::Papago => endpoints.papago.clone(),
        Provider::Plamo => endpoints.plamo.clone(),
        Provider::Gemini => endpoints.gemini.clone(),
        Provider::OpenAi => endpoints.openai.clone(),
        Provider::Groq => endpoints.groq.clone(),
        Provider::OpenRouter => endpoints.openrouter.clone(),
        Provider::OpenAiCompatible | Provider::LmStudio | Provider::Ollama => String::new(),
    }
}

/// `HH:MM` of an ISO timestamp, as the history keeps the time it was said.
fn time_of(timestamp: &str) -> String {
    timestamp.get(11..16).unwrap_or_default().to_string()
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect()
}

/// Runs one case against the Rust provider: what it sent and returned, and the pause between
/// its first two requests.
fn run(document: &Value, case: &Value) -> (Value, Option<f64>) {
    let engine = case["provider"].as_str().unwrap();
    let provider = Provider::from_engine(engine).unwrap_or_else(|| panic!("{engine} is a provider"));
    let (transport, seen) = network(&case["answers"]);
    let access = &case["access"];
    let key = access["key"].as_str().unwrap_or("");
    let fixed = fixed_url(&Endpoints::default(), provider, key);
    let base = access["base"].as_str().map(str::to_string).unwrap_or(fixed);
    let mut call = Access::at(&base).key(key).client_id(access["client_id"].as_str().unwrap_or(""));
    if let Some(model) = access["model"].as_str() {
        call = call.model(model);
    }
    let outcome = match case["operation"].as_str().unwrap() {
        "check" => match provider.check(&transport, &call) {
            Ok(models) => json!({ "accepted": true, "models": models }),
            Err(_) => json!({ "accepted": false }),
        },
        "models" => json!({ "models": provider.models(&transport, &call) }),
        "translate" => {
            let t = &case["translation"];
            let history: Vec<HistoryItem> = t["history"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|h| HistoryItem {
                    source: h["source"].as_str().unwrap().into(),
                    text: h["text"].as_str().unwrap().into(),
                    time: time_of(h["timestamp"].as_str().unwrap_or("")),
                })
                .collect();
            let supported = strings(&document["supported_languages"][engine]);
            let request = Translation {
                text: t["text"].as_str().unwrap(),
                source: t["source"].as_str().unwrap(),
                target: t["target"].as_str().unwrap(),
                supported_languages: &supported,
                history: &history,
                glossary: &[],
            };
            match provider.translate(&transport, &call, &request) {
                Ok(text) => json!({ "text": text }),
                Err(_) => json!({ "failed": true }),
            }
        }
        other => panic!("unknown operation {other}"),
    };
    let seen = seen.lock().unwrap().clone();
    let pause = (seen.len() >= 2).then(|| (seen[1].1 - seen[0].1).as_secs_f64());
    let requests: Vec<Value> = seen.into_iter().map(|(request, _)| request).collect();
    (json!({ "requests": requests, "outcome": outcome }), pause)
}

/// Slack for the time a test machine takes besides the pause itself.
const PAUSE_SLACK: f64 = 0.6;

/// What the Rust provider must have done: `rust` or `expect` when the case has one, else the
/// Python record. A timeout Python's library did not have (requests has no write timeout) is
/// taken from the Rust record, as there is nothing to compare it with.
fn expected(case: &Value, actual: &Value) -> Value {
    let mut wanted = case
        .get("rust")
        .or_else(|| case.get("expect"))
        .or_else(|| case.get("python"))
        .unwrap_or_else(|| panic!("{} has no record", case["id"]))
        .clone();
    if let Some(requests) = wanted["requests"].as_array_mut() {
        for (at, request) in requests.iter_mut().enumerate() {
            if request["timeout"]["write"].is_null() {
                request["timeout"]["write"] = actual["requests"][at]["timeout"]["write"].clone();
            }
        }
    }
    wanted
}

/// Numbers as `f64`, so that `2` and `2.0` compare equal.
fn comparable(value: &Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64()),
        Value::Array(items) => Value::Array(items.iter().map(comparable).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), comparable(v))).collect()),
        other => other.clone(),
    }
}

/// Where two values differ, as paths with both sides shortened.
fn differences(path: &str, wanted: &Value, actual: &Value, out: &mut Vec<String>) {
    let short = |v: &Value| {
        let text = v.to_string();
        if text.chars().count() > 160 {
            format!("{}...", text.chars().take(160).collect::<String>())
        } else {
            text
        }
    };
    match (wanted, actual) {
        (Value::Object(w), Value::Object(a)) => {
            for key in w.keys().chain(a.keys().filter(|k| !w.contains_key(*k))) {
                differences(
                    &format!("{path}.{key}"),
                    w.get(key).unwrap_or(&Value::Null),
                    a.get(key).unwrap_or(&Value::Null),
                    out,
                );
            }
        }
        (Value::Array(w), Value::Array(a)) if w.len() == a.len() => {
            for (at, (w, a)) in w.iter().zip(a).enumerate() {
                differences(&format!("{path}[{at}]"), w, a, out);
            }
        }
        (w, a) if w != a => out.push(format!("{path}: expected {} but was {}", short(w), short(a))),
        _ => {}
    }
}

/// What is wrong with one case, if anything.
fn check(document: &Value, case: &Value) -> Vec<String> {
    let (actual, pause) = run(document, case);
    let actual = comparable(&actual);
    let wanted = comparable(&expected(case, &actual));
    let mut found = Vec::new();
    differences("", &wanted, &actual, &mut found);
    // The pause before a retry is the SDK's rule, with a random part: a range, not a record.
    if let Some(range) = case["retry_pause"].as_array() {
        let (low, high) = (range[0].as_f64().unwrap(), range[1].as_f64().unwrap());
        match pause {
            Some(pause) if pause >= low - 0.05 && pause <= high + PAUSE_SLACK => {}
            other => found.push(format!("the pause before the retry was {other:?} s, not {low} to {high} s")),
        }
    }
    found
}

#[test]
fn every_provider_keeps_the_contract() {
    let document = document();
    let cases = document["cases"].as_array().unwrap();
    // The cases wait as the SDKs did before a retry, so they run side by side.
    let results: Vec<(String, Vec<String>)> = std::thread::scope(|scope| {
        let running: Vec<_> = cases
            .iter()
            .map(|case| {
                let document = &document;
                scope.spawn(move || (case["id"].as_str().unwrap().to_string(), check(document, case)))
            })
            .collect();
        running.into_iter().map(|r| r.join().expect("a case panicked")).collect()
    });
    let broken: Vec<String> = results
        .into_iter()
        .filter(|(_, found)| !found.is_empty())
        .map(|(id, found)| format!("{id}\n    {}", found.join("\n    ")))
        .collect();
    assert!(broken.is_empty(), "{} case(s) broke the contract:\n{}", broken.len(), broken.join("\n"));
}

#[test]
fn every_case_has_a_record_and_every_provider_has_cases() {
    let document = document();
    let cases = document["cases"].as_array().unwrap();
    for case in cases {
        let records = ["python", "rust", "expect"].iter().filter(|k| case.get(**k).is_some()).count();
        assert!(records >= 1, "{} has no record", case["id"]);
        assert!(
            !(case.get("expect").is_some() && case.get("python").is_some()),
            "{}: expect is for providers Python never had",
            case["id"]
        );
        if case.get("rust").is_some() {
            let named = case["differences"].as_array().map(|d| !d.is_empty()).unwrap_or(false);
            assert!(named, "{} differs from Python without naming why", case["id"]);
        }
        for id in strings(&case["differences"]) {
            assert!(document["differences"].get(&id).is_some(), "{}: unknown difference {id}", case["id"]);
        }
    }
    for provider in Provider::ALL {
        assert!(
            cases.iter().any(|c| c["provider"] == provider.engine()),
            "{} has no case in the contract",
            provider.engine()
        );
    }
}
