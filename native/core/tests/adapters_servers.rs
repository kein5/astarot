//! The WebSocket server and the OBS browser source through the IPC surface (Issue #285), on
//! real sockets on loopback addresses. The behaviours are those of
//! `src-python/test/test_websocket_*.py`, `test_obs_*.py`, [`test_security_audit_fixes.py`] and
//! the WebSocket parts of [`test_endpoints.py`].
//!
//! [`test_security_audit_fixes.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_security_audit_fixes.py
//! [`test_endpoints.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_endpoints.py

mod common;

use common::net::{closed, eventually, free_port, obs_get, port_free, read_text, websocket, websocket_status};
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::net::TcpListener;
use std::time::Duration;

const LOCAL: &str = "127.0.0.1";
/// Another loopback address: a host change that never leaves this PC.
const OTHER: &str = "127.0.0.2";
const TOKEN: &str = "test-token";

fn start(saved: Value) -> Ui {
    let ui = Ui::with(Setup { saved: Some(saved), ..Setup::default() });
    ui.ready();
    ui
}

/// A 400 answer: its code and the value the UI rolls back to.
fn refused(ui: &Ui, endpoint: &str, data: Value) -> (String, Value) {
    let answer = ui.request(endpoint, Some(data));
    assert_eq!(answer["status"], 400, "{endpoint}: {answer}");
    (error_code(&answer).to_string(), answer["result"]["data"].clone())
}

fn page(host: &str, port: u16, token: &str) -> (u16, String) {
    obs_get(host, port, &format!("/obs?token={token}"))
}

#[test]
fn the_server_starts_from_the_saved_settings_accepts_only_the_token_and_stops_at_shutdown() {
    let port = free_port();
    let ui = Ui::with(Setup { saved: Some(json!({ "WEBSOCKET_SERVER": true, "WEBSOCKET_PORT": port })), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/websocket_server"], true);
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 101);
    assert_eq!(websocket_status(LOCAL, port, None), 403, "refused before any WebSocket traffic");
    assert_eq!(websocket_status(LOCAL, port, Some("wrong")), 403);

    assert_eq!(ui.ok("/run/shutdown", None), true);
    assert!(port_free(LOCAL, port), "the port is free again");
    assert_eq!(ui.saved()["WEBSOCKET_SERVER"], true, "still on for the next start");
    ui.stop();
}

#[test]
fn the_switch_starts_and_stops_the_server_and_a_taken_port_is_reported() {
    let port = free_port();
    let ui = start(json!({ "WEBSOCKET_PORT": port }));
    assert_eq!(ui.ok("/set/enable/websocket_server", None), true);
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 101);
    assert_eq!(ui.ok("/set/enable/websocket_server", None), true, "already on");
    assert_eq!(ui.ok("/set/disable/websocket_server", None), false);
    assert!(port_free(LOCAL, port));

    let _taken = TcpListener::bind((LOCAL, port)).unwrap();
    assert_eq!(
        refused(&ui, "/set/enable/websocket_server", Value::Null),
        ("WEBSOCKET_SERVER_UNAVAILABLE".into(), json!(false))
    );
    assert_eq!(ui.ok("/get/data/websocket_server", None), false);
    ui.stop();
}

#[test]
fn a_port_change_moves_the_running_server_or_keeps_the_old_port() {
    let (old, new, taken, later) = (free_port(), free_port(), free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_SERVER": true, "WEBSOCKET_PORT": old }));
    for bad in [json!("2231"), json!(true), json!(0), json!(70000), json!(2231.0), Value::Null] {
        assert_eq!(refused(&ui, "/set/data/websocket_port", bad), ("WEBSOCKET_PORT_INVALID".into(), json!(old)));
    }
    assert_eq!(ui.ok("/set/data/websocket_port", Some(json!(new))), new);
    assert_eq!(websocket_status(LOCAL, new, Some(TOKEN)), 101);
    assert!(port_free(LOCAL, old), "the old port was let go");

    let _held = TcpListener::bind((LOCAL, taken)).unwrap();
    assert_eq!(refused(&ui, "/set/data/websocket_port", json!(taken)), ("WEBSOCKET_PORT_UNAVAILABLE".into(), json!(new)));
    assert_eq!(websocket_status(LOCAL, new, Some(TOKEN)), 101, "still on the saved port");
    assert_eq!(ui.ok("/set/data/websocket_port", Some(json!(new))), new, "the same port");

    // While off, the port is only saved.
    ui.ok("/set/disable/websocket_server", None);
    assert_eq!(ui.ok("/set/data/websocket_port", Some(json!(later))), later);
    assert!(port_free(LOCAL, later));
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["WEBSOCKET_PORT"], later);
    ui.stop();
}

#[test]
fn a_host_is_checked_and_a_change_moves_both_servers_or_rolls_both_back() {
    let (port, obs) = (free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs }));
    for bad in ["0.0.0.0", "not an address", "::1", "0210.1564.845.0", ""] {
        assert_eq!(refused(&ui, "/set/data/websocket_host", json!(bad)), ("VALIDATION_INVALID_IP".into(), json!(LOCAL)), "{bad}");
    }
    assert_eq!(refused(&ui, "/set/data/websocket_host", json!(7)), ("VALIDATION_INVALID_IP".into(), json!(LOCAL)));
    // Beyond this PC only with a certificate, refused before anything stops.
    assert_eq!(refused(&ui, "/set/data/websocket_host", json!("192.0.2.10")), ("WEBSOCKET_HOST_NEEDS_TLS".into(), json!(LOCAL)));
    // While off, the host is only saved.
    assert_eq!(ui.ok("/set/data/websocket_host", Some(json!(OTHER))), OTHER);
    assert_eq!(ui.ok("/set/data/websocket_host", Some(json!(LOCAL))), LOCAL);

    assert_eq!(ui.ok("/set/enable/obs_browser_source", None), true);
    assert_eq!(ui.ok("/set/data/websocket_host", Some(json!(OTHER))), OTHER);
    assert_eq!(websocket_status(OTHER, port, Some(TOKEN)), 101);
    assert_eq!(page(OTHER, obs, TOKEN).0, 200, "the page moved with it");
    assert!(port_free(LOCAL, port) && port_free(LOCAL, obs), "nothing is left on the old host");

    // The page cannot follow: both go back to the saved host.
    let _held = TcpListener::bind((LOCAL, obs)).unwrap();
    assert_eq!(
        refused(&ui, "/set/data/websocket_host", json!(LOCAL)),
        ("OBS_BROWSER_SOURCE_HOST_UNAVAILABLE".into(), json!(OTHER))
    );
    assert_eq!(websocket_status(OTHER, port, Some(TOKEN)), 101);
    assert_eq!(page(OTHER, obs, TOKEN).0, 200);
    assert_eq!(ui.ok("/get/data/obs_browser_source", None), true);
    assert_eq!(ui.ok("/get/data/websocket_host", None), OTHER);
    ui.stop();
}

#[test]
fn a_new_token_closes_old_connections_reaches_both_servers_and_stays_out_of_the_log() {
    let (port, obs) = (free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs, "OBS_BROWSER_SOURCE": true }));
    let (status, client) = websocket(LOCAL, port, Some(TOKEN));
    assert_eq!(status, 101);
    let mut client = client.unwrap();

    let token = ui.ok("/run/regenerate_websocket_auth_token", None).as_str().unwrap().to_string();
    assert!(token.len() >= 40 && token != TOKEN, "a fresh URL-safe token");
    assert!(closed(&mut client, Duration::from_secs(5)), "the connection made with the old token is closed");
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 403);
    assert_eq!(websocket_status(LOCAL, port, Some(&token)), 101);
    assert_eq!(page(LOCAL, obs, TOKEN).0, 403, "the page refuses the old token");
    let (status, body) = page(LOCAL, obs, &token);
    assert_eq!(status, 200);
    assert!(body.contains(&token), "the page embeds the new token");
    assert_eq!(ui.ok("/get/data/websocket_auth_token", None), token.as_str());

    let again = ui.ok("/run/regenerate_websocket_auth_token", None);
    assert_ne!(again, token.as_str(), "each new token is different");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["WEBSOCKET_AUTH_TOKEN"], again);
    let log = std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap();
    assert!(log.contains("WebSocket token replaced"), "the change is logged");
    assert!(!log.contains(&token) && !log.contains(again.as_str().unwrap()), "the token is not");
    ui.stop();
}

#[test]
fn the_certificate_pair_is_saved_only_when_it_loads() {
    let ui = start(json!({}));
    let empty = json!({ "cert_file": "", "key_file": "" });
    assert_eq!(ui.ok("/get/data/websocket_tls", None), empty);
    for bad in [
        json!("cert.pem"),
        json!({}),
        json!({ "cert_file": "a.pem" }),
        json!({ "cert_file": 1, "key_file": 2 }),
        json!({ "cert_file": "", "key_file": "", "extra": "" }),
    ] {
        assert_eq!(refused(&ui, "/set/data/websocket_tls", bad.clone()), ("WEBSOCKET_TLS_INVALID".into(), empty.clone()), "{bad}");
    }
    let dir = tempfile::tempdir().unwrap();
    let made = rcgen::generate_simple_self_signed(vec!["192.0.2.10".to_string()]).unwrap();
    let cert = dir.path().join("server.pem");
    let key = dir.path().join("server-key.pem");
    std::fs::write(&cert, made.cert.pem()).unwrap();
    std::fs::write(&key, made.key_pair.serialize_pem()).unwrap();
    let broken = dir.path().join("broken.pem");
    std::fs::write(&broken, "not a certificate").unwrap();
    let (cert, key, broken) = (cert.to_string_lossy().into_owned(), key.to_string_lossy().into_owned(), broken.to_string_lossy().into_owned());
    let missing = dir.path().join("missing.pem").to_string_lossy().into_owned();
    for (c, k) in [(&cert, &String::new()), (&broken, &broken), (&cert, &missing), (&missing, &key)] {
        assert_eq!(
            refused(&ui, "/set/data/websocket_tls", json!({ "cert_file": c, "key_file": k })),
            ("WEBSOCKET_TLS_INVALID".into(), empty.clone())
        );
    }
    // A working pair is saved without the spaces around it.
    let pair = json!({ "cert_file": cert, "key_file": key });
    assert_eq!(ui.ok("/set/data/websocket_tls", Some(json!({ "cert_file": format!("  {cert} "), "key_file": format!("{key}\t") }))), pair);
    assert_eq!(ui.ok("/set/data/websocket_tls", Some(pair.clone())), pair, "the same pair");

    // With the certificate, a host beyond this PC can be chosen (nothing listens while off),
    // and then the pair cannot be cleared.
    assert_eq!(ui.ok("/set/data/websocket_host", Some(json!("192.0.2.10"))), "192.0.2.10");
    assert_eq!(refused(&ui, "/set/data/websocket_tls", empty.clone()), ("WEBSOCKET_HOST_NEEDS_TLS".into(), pair.clone()));
    assert_eq!(ui.ok("/set/data/websocket_host", Some(json!(LOCAL))), LOCAL);
    assert_eq!(ui.ok("/set/data/websocket_tls", Some(empty.clone())), empty, "cleared on this PC");
    ui.stop();
}

#[test]
fn a_saved_host_beyond_this_pc_without_a_certificate_goes_back_to_this_pc_and_the_ui_is_told() {
    let ui = Ui::with(Setup { saved: Some(json!({ "WEBSOCKET_HOST": "192.0.2.10" })), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/websocket_host"], LOCAL);
    let notice = ui.wait_endpoint(0, "/set/data/websocket_host");
    assert_eq!((notice["status"].clone(), error_code(&notice)), (json!(400), "WEBSOCKET_HOST_RESET_WITHOUT_TLS"));
    assert_eq!(notice["result"]["data"], LOCAL);
    let names: Vec<Value> = ui.lines().iter().map(|l| l["endpoint"].clone()).collect();
    let at = |e: &str| names.iter().position(|n| n == e).unwrap();
    assert!(at("/run/initialization_complete") < at("/set/data/websocket_host"), "after the UI has its settings");
    ui.stop();

    // A loopback host stays, with no notice.
    let ui = start(json!({ "WEBSOCKET_HOST": OTHER }));
    assert_eq!(ui.ok("/get/data/websocket_host", None), OTHER);
    assert!(ui.on(0, "/set/data/websocket_host").is_empty());
    ui.stop();
}

#[test]
fn at_start_up_obs_brings_the_websocket_server_and_a_failed_obs_start_is_reported() {
    // OBS on and the WebSocket server off: both start.
    let (port, obs) = (free_port(), free_port());
    let ui = Ui::with(Setup {
        saved: Some(json!({ "OBS_BROWSER_SOURCE": true, "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs })),
        ..Setup::default()
    });
    let snapshot = ui.ready();
    assert_eq!((snapshot["/get/data/websocket_server"].clone(), snapshot["/get/data/obs_browser_source"].clone()), (json!(true), json!(true)));
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 101);
    assert_eq!(page(LOCAL, obs, TOKEN).0, 200);
    ui.ok("/run/shutdown", None);
    assert!(port_free(LOCAL, port) && port_free(LOCAL, obs), "both stop at shutdown");
    ui.stop();

    // The page's port is taken: OBS is off, the WebSocket server stays, the UI is told.
    let (port, obs) = (free_port(), free_port());
    let _held = TcpListener::bind((LOCAL, obs)).unwrap();
    let ui = Ui::with(Setup {
        saved: Some(json!({ "OBS_BROWSER_SOURCE": true, "WEBSOCKET_SERVER": true, "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs })),
        ..Setup::default()
    });
    let snapshot = ui.ready();
    assert_eq!((snapshot["/get/data/websocket_server"].clone(), snapshot["/get/data/obs_browser_source"].clone()), (json!(true), json!(false)));
    let notice = ui.wait_endpoint(0, "/set/enable/obs_browser_source");
    assert_eq!((error_code(&notice), notice["result"]["data"].clone()), ("OBS_BROWSER_SOURCE_PORT_UNAVAILABLE", json!(false)));
    let names: Vec<Value> = ui.lines().iter().map(|l| l["endpoint"].clone()).collect();
    let at = |e: &str| names.iter().position(|n| n == e).unwrap();
    assert!(at("/run/initialization_complete") < at("/set/enable/obs_browser_source"));
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 101);
    ui.stop();

    // The WebSocket server's port is taken: both are off; OBS needs it, with no OBS notice.
    let (port, obs) = (free_port(), free_port());
    let _held = TcpListener::bind((LOCAL, port)).unwrap();
    let ui = Ui::with(Setup {
        saved: Some(json!({ "OBS_BROWSER_SOURCE": true, "WEBSOCKET_SERVER": true, "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs })),
        ..Setup::default()
    });
    let snapshot = ui.ready();
    assert_eq!((snapshot["/get/data/websocket_server"].clone(), snapshot["/get/data/obs_browser_source"].clone()), (json!(false), json!(false)));
    assert!(ui.on(0, "/set/enable/obs_browser_source").is_empty());
    assert!(port_free(LOCAL, obs));
    ui.stop();
}

#[test]
fn the_obs_page_is_served_with_the_token_only_and_needs_the_websocket_server() {
    let (port, obs) = (free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs }));
    assert_eq!(ui.ok("/set/enable/obs_browser_source", None), true);
    assert_eq!(ui.ok("/get/data/websocket_server", None), true, "OBS started the WebSocket server");
    for path in [format!("/obs?token={TOKEN}"), format!("/?token={TOKEN}")] {
        let (status, body) = obs_get(LOCAL, obs, &path);
        assert_eq!(status, 200, "{path}");
        assert!(body.contains(TOKEN) && body.contains(&port.to_string()), "the page knows the token and the port");
    }
    for path in ["/obs", "/obs?token=wrong", "/", "/obs/connection"] {
        assert_eq!(obs_get(LOCAL, obs, path).0, 403, "{path}");
    }
    let (status, body) =
        common::net::http_get(LOCAL, obs, "/obs/connection", &format!("{LOCAL}:{obs}"), &format!("Authorization: Bearer {TOKEN}\r\n"));
    assert_eq!((status, serde_json::from_str::<Value>(&body).unwrap()), (200, json!({ "wsPort": port })));
    assert_eq!(obs_get(LOCAL, obs, "/health"), (200, "ok".into()), "public, without secrets");
    // A domain name rebound to this PC does not get the page.
    let rebound = common::net::http_get(LOCAL, obs, &format!("/obs?token={TOKEN}"), "attacker.example", "");
    assert_eq!(rebound.0, 403);

    assert_eq!(ui.ok("/set/disable/obs_browser_source", None), false);
    assert!(port_free(LOCAL, obs));
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 101, "the WebSocket server stays");
    assert_eq!(ui.ok("/set/disable/obs_browser_source", None), false, "already off");

    // Turning the WebSocket server off turns OBS off too.
    assert_eq!(ui.ok("/set/enable/obs_browser_source", None), true);
    assert_eq!(ui.ok("/set/disable/websocket_server", None), false);
    assert_eq!(ui.ok("/get/data/obs_browser_source", None), false);
    assert!(port_free(LOCAL, obs) && port_free(LOCAL, port));
    ui.stop();
}

#[test]
fn a_failed_obs_start_releases_only_the_websocket_server_it_started() {
    let (port, obs) = (free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs }));
    let held = TcpListener::bind((LOCAL, obs)).unwrap();
    assert_eq!(
        refused(&ui, "/set/enable/obs_browser_source", Value::Null),
        ("OBS_BROWSER_SOURCE_PORT_UNAVAILABLE".into(), json!(false))
    );
    assert_eq!(ui.ok("/get/data/websocket_server", None), false);
    assert!(port_free(LOCAL, port), "the WebSocket server it started is stopped again");

    // A WebSocket server that already ran keeps running.
    ui.ok("/set/enable/websocket_server", None);
    assert_eq!(refused(&ui, "/set/enable/obs_browser_source", Value::Null).0, "OBS_BROWSER_SOURCE_PORT_UNAVAILABLE");
    assert_eq!(ui.ok("/get/data/websocket_server", None), true);
    assert_eq!(websocket_status(LOCAL, port, Some(TOKEN)), 101);
    drop(held);

    // The WebSocket server cannot start: its own cause is reported.
    ui.ok("/set/disable/websocket_server", None);
    let _held = TcpListener::bind((LOCAL, port)).unwrap();
    assert_eq!(refused(&ui, "/set/enable/obs_browser_source", Value::Null), ("WEBSOCKET_SERVER_UNAVAILABLE".into(), json!(false)));
    assert!(port_free(LOCAL, obs));
    ui.stop();
}

#[test]
fn a_port_change_of_the_obs_page_moves_it_or_keeps_the_existing_listener() {
    let (port, obs, taken, next) = (free_port(), free_port(), free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_PORT": port }));
    for bad in [json!("2232"), json!(true), json!(0), json!(65536)] {
        assert_eq!(refused(&ui, "/set/data/obs_browser_source_port", bad), ("OBS_BROWSER_SOURCE_PORT_INVALID".into(), json!(2232)));
    }
    // While off, only saved.
    assert_eq!(ui.ok("/set/data/obs_browser_source_port", Some(json!(obs))), obs);
    assert!(port_free(LOCAL, obs));
    ui.ok("/set/enable/obs_browser_source", None);
    assert_eq!(page(LOCAL, obs, TOKEN).0, 200);
    assert_eq!(ui.ok("/set/data/obs_browser_source_port", Some(json!(obs))), obs, "the same port");

    let _held = TcpListener::bind((LOCAL, taken)).unwrap();
    assert_eq!(
        refused(&ui, "/set/data/obs_browser_source_port", json!(taken)),
        ("OBS_BROWSER_SOURCE_PORT_UNAVAILABLE".into(), json!(obs))
    );
    assert_eq!(page(LOCAL, obs, TOKEN).0, 200, "the existing listener is kept");

    assert_eq!(ui.ok("/set/data/obs_browser_source_port", Some(json!(next))), next);
    assert_eq!(page(LOCAL, next, TOKEN).0, 200);
    assert!(port_free(LOCAL, obs));
    ui.stop();
}

#[test]
fn display_settings_are_checked_and_pushed_to_open_pages() {
    let (port, obs) = (free_port(), free_port());
    let ui = start(json!({ "WEBSOCKET_PORT": port, "OBS_BROWSER_SOURCE_PORT": obs }));
    // Off: nothing to push to, the value is still saved.
    assert_eq!(ui.ok("/set/data/obs_browser_source_max_messages", Some(json!(30))), 30);
    ui.ok("/set/enable/obs_browser_source", None);
    let (_, client) = websocket(LOCAL, port, Some(TOKEN));
    let mut client = client.unwrap();
    eventually("the client is registered", || {
        ui.ok("/set/data/obs_browser_source_max_messages", Some(json!(20)));
        read_text(&mut client, Duration::from_millis(300)).is_some_and(|text| {
            let pushed: Value = serde_json::from_str(&text).unwrap();
            pushed["type"] == "SETTINGS_UPDATED" && pushed["settings"]["maxMessages"] == 20
        })
    });

    // Decimal strings from the text controls are taken; anything else is refused with the
    // saved value and a message saying what is allowed.
    assert_eq!(ui.ok("/set/data/obs_browser_source_max_messages", Some(json!(" 12 "))), 12);
    assert_eq!(ui.ok("/set/data/obs_browser_source_max_messages", Some(json!("+5"))), 5);
    for bad in [json!("1.5"), json!(true), json!(0), json!(51), json!("abc"), json!(14.0), Value::Null, json!("１２")] {
        let answer = ui.request("/set/data/obs_browser_source_max_messages", Some(bad.clone()));
        assert_eq!(error_code(&answer), "OBS_BROWSER_SOURCE_MAX_MESSAGES_INVALID", "{bad}");
        assert_eq!(answer["result"]["data"], 5);
        assert_eq!(answer["result"]["message"], "Enter a whole number from 1 to 50");
    }
    for (name, good, bad, code, message) in [
        ("display_duration", 120, 0, "OBS_BROWSER_SOURCE_DISPLAY_DURATION_INVALID", "Enter a whole number from 1 to 120"),
        ("fadeout_duration", 0, 121, "OBS_BROWSER_SOURCE_FADEOUT_DURATION_INVALID", "Enter a whole number from 0 to 120"),
        ("font_size", 10, 201, "OBS_BROWSER_SOURCE_FONT_SIZE_INVALID", "Enter a whole number from 10 to 200"),
        ("font_outline_thickness", 20, -1, "OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS_INVALID", "Enter a whole number from 0 to 20"),
    ] {
        let endpoint = format!("/set/data/obs_browser_source_{name}");
        assert_eq!(ui.ok(&endpoint, Some(json!(good.to_string()))), good, "{name}");
        let answer = ui.request(&endpoint, Some(json!(bad)));
        assert_eq!((error_code(&answer), answer["result"]["data"].clone()), (code, json!(good)), "{name}");
        assert_eq!(answer["result"]["message"], message);
    }
    assert_eq!(ui.ok("/set/data/obs_browser_source_font_color", Some(json!(" #abcdef "))), "#ABCDEF");
    for bad in [json!("red"), json!("#12345"), json!("#12345g"), json!(123456)] {
        assert_eq!(
            refused(&ui, "/set/data/obs_browser_source_font_color", bad),
            ("OBS_BROWSER_SOURCE_FONT_COLOR_INVALID".into(), json!("#ABCDEF"))
        );
    }
    assert_eq!(ui.ok("/set/data/obs_browser_source_font_outline_color", Some(json!("#00ff00"))), "#00FF00");
    assert_eq!(
        refused(&ui, "/set/data/obs_browser_source_font_outline_color", json!("green")),
        ("OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR_INVALID".into(), json!("#00FF00"))
    );
    // The latest push carries every setting; a page loaded now is built from them too.
    let mut last = None;
    while let Some(text) = read_text(&mut client, Duration::from_millis(500)) {
        last = Some(serde_json::from_str::<Value>(&text).unwrap());
    }
    assert_eq!(
        last.unwrap()["settings"],
        json!({ "maxMessages": 5, "displayDuration": 120, "fadeoutDuration": 0, "fontSize": 10, "fontColor": "#ABCDEF",
                "outlineThickness": 20, "outlineColor": "#00FF00" })
    );
    let (_, body) = page(LOCAL, obs, TOKEN);
    assert!(body.contains("#ABCDEF") && body.contains("#00FF00"));
    ui.stop();
}
