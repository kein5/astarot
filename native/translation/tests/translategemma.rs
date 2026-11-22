//! The TranslateGemma client's contract (ADR-015): every case of
//! `tests/contract/translategemma.json` run against `translategemma::translate` over a stand-in
//! transport that answers from the case and keeps every request, as `tests/contract.rs` does
//! for the providers. Nothing leaves the process.

use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use astarot_translation::http::{HttpError, Request, Response, Timeouts, Transport};
use astarot_translation::translategemma::{self, language_name};

const CONTRACT: &str = include_str!("contract/translategemma.json");

fn seconds(duration: std::time::Duration) -> Value {
    json!(duration.as_secs_f64())
}

fn record(request: &Request<'_>, timeouts: Timeouts) -> Value {
    let body: Value = request.body.as_deref().map(|bytes| serde_json::from_slice(bytes).unwrap()).unwrap_or(Value::Null);
    let mut headers: Vec<(String, String)> = request.headers.iter().map(|(name, value)| (name.to_ascii_lowercase(), value.clone())).collect();
    headers.sort();
    json!({
        "method": request.method,
        "url": request.url,
        "headers": headers.into_iter().map(|(name, value)| (name, json!(value))).collect::<serde_json::Map<_, _>>(),
        "body": body,
        "timeout": { "connect": seconds(timeouts.connect), "read": seconds(timeouts.read), "write": seconds(timeouts.write) },
    })
}

fn network(answers: &Value) -> (Transport, Arc<Mutex<Vec<Value>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let kept = seen.clone();
    let answers = answers.clone();
    let transport: Transport = Arc::new(move |request: &Request<'_>, timeouts: Timeouts| {
        kept.lock().unwrap().push(record(request, timeouts));
        let Some(answer) = answers.as_array().unwrap().iter().find(|a| a["method"] == request.method && a["url"] == request.url) else {
            return Ok(Response::new(404, b"{}".to_vec()));
        };
        let reply = &answer["replies"][0];
        let Some(status) = reply["status"].as_u64() else { return Err(HttpError::Unreachable) };
        Ok(Response::new(status as u16, serde_json::to_vec(&reply["body"]).unwrap()))
    });
    (transport, seen)
}

/// The case's prompt written out: the template's sentence with its names, codes and text.
fn expected_prompt(p: &Value) -> String {
    let (source, target) = (p["source"].as_str().unwrap(), p["target"].as_str().unwrap());
    let (source_code, target_code) = (p["source_code"].as_str().unwrap(), p["target_code"].as_str().unwrap());
    format!(
        "<start_of_turn>user\nYou are a professional {source} ({source_code}) to {target} ({target_code}) translator. Your goal is to accurately convey the meaning and nuances of the original {source} text while adhering to {target} grammar, vocabulary, and cultural sensitivities.\nProduce only the {target} translation, without any additional explanations or commentary. Please translate the following {source} text into {target}:\n\n\n{}<end_of_turn>\n<start_of_turn>model\n",
        p["text"].as_str().unwrap()
    )
}

#[test]
fn every_case_keeps_the_contract() {
    let document: Value = serde_json::from_str(CONTRACT).unwrap();
    let (base, key) = (document["base"].as_str().unwrap(), document["key"].as_str().unwrap());
    let mut broken = Vec::new();
    for case in document["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let t = &case["translation"];
        let (transport, seen) = network(&case["answers"]);
        let outcome = match translategemma::translate(&transport, base, key, t["text"].as_str().unwrap(), t["source"].as_str().unwrap(), t["target"].as_str().unwrap()) {
            Ok(text) => json!({ "text": text }),
            Err(error) => json!({ "failed": error.code() }),
        };
        let seen = seen.lock().unwrap().clone();
        let expect = &case["expect"];
        if outcome != expect["outcome"] {
            broken.push(format!("{id}: outcome {outcome}, not {}", expect["outcome"]));
        }
        match expect["requests"].as_array() {
            Some(requests) => {
                let wanted: Vec<Value> = requests
                    .iter()
                    .map(|r| {
                        let mut r = r.clone();
                        r["body"]["prompt"] = json!(expected_prompt(&r["body"]["prompt"]));
                        r
                    })
                    .collect();
                if seen != wanted {
                    broken.push(format!("{id}: sent {}, not {}", json!(seen), json!(wanted)));
                }
            }
            None => {
                if seen.len() as u64 != expect["request_count"].as_u64().unwrap() {
                    broken.push(format!("{id}: {} requests", seen.len()));
                }
            }
        }
    }
    assert!(broken.is_empty(), "{}", broken.join("\n"));
}

#[test]
fn no_system_message_no_context_and_greedy_sampling() {
    let (transport, seen) = network(&json!([{ "method": "POST", "url": "http://127.0.0.1:1/completion", "replies": [{ "status": 200, "body": { "content": "ok" } }] }]));
    translategemma::translate(&transport, "http://127.0.0.1:1/", "k", "テスト", "ja", "en").unwrap();
    let body = &seen.lock().unwrap()[0]["body"];
    // One user turn and the model's turn opened: the template has no system role.
    let prompt = body["prompt"].as_str().unwrap();
    assert!(prompt.starts_with("<start_of_turn>user\n") && prompt.ends_with("<end_of_turn>\n<start_of_turn>model\n"));
    assert_eq!(prompt.matches("<start_of_turn>").count(), 2);
    assert!(!prompt.contains("<bos>"), "the server adds the BOS token");
    assert_eq!((body["temperature"].as_f64(), body["top_k"].as_u64()), (Some(0.0), Some(1)));
    assert!(body.get("messages").is_none() && body.get("system_prompt").is_none());
    assert_eq!(language_name("zh-Hant"), Some("Chinese"));
}
