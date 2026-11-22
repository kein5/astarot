//! Interoperation with python-zeroconf, which the Python implementation used and which
//! stands in for VRChat's own mDNS here. Runs only when `ASTAROT_ZEROCONF_PYTHON` names a
//! Python with `zeroconf` installed (for example the backend venv); otherwise it passes
//! without doing anything.

use std::io::{BufRead, BufReader, Write};
use std::net::Ipv4Addr;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use vrct_adapters::osc::mdns::{Mdns, ServiceSpec};
use vrct_adapters::osc::query::OSCJSON_TYPE;

fn python() -> Option<String> {
    std::env::var("ASTAROT_ZEROCONF_PYTHON").ok().filter(|p| !p.is_empty())
}

const BROWSE: &str = r#"
import sys, time
from zeroconf import Zeroconf, ServiceBrowser, ServiceListener
wanted = sys.argv[1]
zc = Zeroconf()
found = {}
class L(ServiceListener):
    def add_service(self, zc, t, name):
        found[name] = zc.get_service_info(t, name)
    update_service = add_service
    def remove_service(self, zc, t, name):
        found.pop(name, None)
ServiceBrowser(zc, ["_oscjson._tcp.local."], L())
end = time.time() + 8
while time.time() < end:
    info = found.get(wanted)
    if info is not None and info.addresses:
        print("FOUND", info.port, ",".join(info.parsed_addresses()), flush=True)
        break
    time.sleep(0.1)
else:
    print("MISSING", flush=True)
zc.close()
"#;

const ADVERTISE: &str = r#"
import sys
from zeroconf import Zeroconf, ServiceInfo
name, port = sys.argv[1], int(sys.argv[2])
zc = Zeroconf()
zc.register_service(ServiceInfo("_oscjson._tcp.local.", name + "._oscjson._tcp.local.", port, 0, 0,
    {"txtvers": 1}, name + ".oscjson.local.", addresses=["127.0.0.1"]))
print("READY", flush=True)
sys.stdin.readline()
zc.unregister_all_services()
zc.close()
"#;

#[test]
fn python_zeroconf_finds_this_advertisement() {
    let Some(python) = python() else { return };
    let name = format!("VRCT:interop{}", std::process::id());
    let mdns = Mdns::start().unwrap();
    mdns.register(ServiceSpec {
        service_type: OSCJSON_TYPE.into(),
        instance: format!("{name}.{OSCJSON_TYPE}"),
        host: format!("{name}.oscjson.local."),
        port: 45678,
        txt: vec!["txtvers=1".into()],
        address: Ipv4Addr::LOCALHOST,
    });
    let output = Command::new(python).args(["-I", "-c", BROWSE, &format!("{name}.{OSCJSON_TYPE}")]).output().unwrap();
    mdns.close();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("FOUND 45678 127.0.0.1"), "{stdout}{}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn this_browser_finds_a_python_zeroconf_advertisement() {
    let Some(python) = python() else { return };
    let name = format!("VRChat-Client-PY{}", std::process::id());
    let mut child = Command::new(python)
        .args(["-I", "-c", ADVERTISE, &name, "45679"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "READY");
    let mdns = Mdns::start().unwrap();
    mdns.browse(OSCJSON_TYPE);
    let end = Instant::now() + Duration::from_secs(8);
    let full = format!("{name}.{OSCJSON_TYPE}");
    let mut found = None;
    while Instant::now() < end && found.is_none() {
        found = mdns.discovered(OSCJSON_TYPE).into_iter().find(|s| s.name == full && !s.addresses.is_empty());
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.stdin.take().unwrap().write_all(b"\n");
    let _ = child.wait();
    mdns.close();
    let found = found.expect("the Python advertisement was found");
    assert_eq!(found.port, 45679);
    assert_eq!(found.addresses, vec![Ipv4Addr::LOCALHOST]);
}
