//! An OSC link without mDNS: packets go out through the real sender of the adapters crate,
//! while receiving, OSCQuery and VRChat's answers are played by the test. The real link joins
//! mDNS on every interface (UDP 5353) as soon as the destination is this PC; tests never do.

use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use vrct_adapters::osc::{OscArg, OscError, OscHandler, Target, uses_osc_query};
use vrct_core::controller::Osc;
use vrct_core::controller::adapters::OpenOsc;

pub struct FakeOsc {
    sender: Mutex<(String, u16, OscHandler)>,
    /// Receiving and OSCQuery cannot start (mDNS unavailable, for example).
    pub receive_fails: AtomicBool,
    /// The user lets OSCQuery run (`OSC_QUERY`); off, nothing starts.
    pub allowed: AtomicBool,
    enabled: AtomicBool,
    shut: AtomicBool,
    pub stopped: AtomicBool,
    /// What VRChat answers: its presence and `MuteSelf`.
    pub presence: Mutex<Option<bool>>,
    pub mute: Mutex<Option<bool>>,
    pub mute_queries: AtomicUsize,
    targets: Mutex<Vec<(String, Target)>>,
}

impl FakeOsc {
    fn new(ip: &str, port: u16, receive_fails: bool) -> io::Result<Self> {
        Ok(Self {
            sender: Mutex::new((ip.to_string(), port, OscHandler::new(ip, port)?)),
            receive_fails: AtomicBool::new(receive_fails),
            allowed: AtomicBool::new(true),
            enabled: AtomicBool::new(false),
            shut: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            presence: Mutex::new(Some(true)),
            mute: Mutex::new(Some(false)),
            mute_queries: AtomicUsize::new(0),
            targets: Mutex::new(Vec::new()),
        })
    }

    pub fn ip(&self) -> String {
        self.sender.lock().unwrap().0.clone()
    }

    /// VRChat sends `args` to `address` (as the receive thread would deliver them).
    pub fn vrchat_sends(&self, address: &str, args: Vec<OscArg>) {
        let targets = self.targets.lock().unwrap().clone();
        for (listened, target) in targets {
            if listened == address {
                target(address, &args);
            }
        }
    }

    /// Starts receiving for `ip` as the real handler does: only for this PC, and only while
    /// OSCQuery is allowed.
    fn start_for(&self, ip: &str) -> Result<(), OscError> {
        self.enabled.store(false, Ordering::SeqCst);
        if !uses_osc_query(ip) || !self.allowed.load(Ordering::SeqCst) {
            return Ok(());
        }
        if self.receive_fails.load(Ordering::SeqCst) {
            return Err(OscError::Io(io::ErrorKind::AddrInUse));
        }
        self.enabled.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn replace(&self, ip: &str, port: u16) -> Result<(), OscError> {
        if self.shut.load(Ordering::SeqCst) {
            return Err(OscError::ShutDown);
        }
        let handler = OscHandler::new(ip, port)?;
        let previous = self.ip();
        if let Err(error) = self.start_for(ip) {
            // The real handler goes back to the previous destination.
            let _ = self.start_for(&previous);
            return Err(error);
        }
        *self.sender.lock().unwrap() = (ip.to_string(), port, handler);
        Ok(())
    }
}

impl Osc for FakeOsc {
    fn set_ip_address(&self, ip_address: &str) -> Result<(), OscError> {
        let port = self.sender.lock().unwrap().1;
        self.replace(ip_address, port)
    }

    fn set_port(&self, port: u16) -> Result<(), OscError> {
        let ip = self.ip();
        self.replace(&ip, port)
    }

    fn send_typing(&self, typing: bool) -> io::Result<()> {
        self.sender.lock().unwrap().2.send_typing(typing)
    }

    fn send_message(&self, text: &str, notification: bool, current: Option<&dyn Fn() -> bool>) -> io::Result<bool> {
        self.sender.lock().unwrap().2.send_message(text, notification, current)
    }

    fn receive(&self, targets: Vec<(String, Target)>) -> Result<(), OscError> {
        *self.targets.lock().unwrap() = targets;
        if self.shut.load(Ordering::SeqCst) {
            return Err(OscError::ShutDown);
        }
        if self.enabled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let ip = self.ip();
        self.start_for(&ip)
    }

    fn set_query_allowed(&self, allowed: bool) -> Result<(), OscError> {
        if self.shut.load(Ordering::SeqCst) {
            return Err(OscError::ShutDown);
        }
        self.allowed.store(allowed, Ordering::SeqCst);
        if !allowed {
            self.enabled.store(false, Ordering::SeqCst);
            return Ok(());
        }
        if self.enabled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let ip = self.ip();
        self.start_for(&ip)
    }

    fn query_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst) && !self.shut.load(Ordering::SeqCst)
    }

    fn vrchat_presence(&self) -> Option<bool> {
        if !self.query_enabled() {
            return None;
        }
        *self.presence.lock().unwrap()
    }

    fn mute_self(&self) -> Option<bool> {
        if !self.query_enabled() {
            return None;
        }
        self.mute_queries.fetch_add(1, Ordering::SeqCst);
        *self.mute.lock().unwrap()
    }

    fn request_stop(&self) {
        self.shut.store(true, Ordering::SeqCst);
    }

    fn stop(&self) -> Result<(), OscError> {
        self.shut.store(true, Ordering::SeqCst);
        self.enabled.store(false, Ordering::SeqCst);
        self.stopped.store(true, Ordering::SeqCst);
        Ok(())
    }
}

/// The links a backend opened, newest last.
#[derive(Clone, Default)]
pub struct Opened(pub Arc<Mutex<Vec<Arc<FakeOsc>>>>);

impl Opened {
    pub fn last(&self) -> Arc<FakeOsc> {
        self.0.lock().unwrap().last().cloned().expect("the backend opened its OSC link")
    }
}

/// A factory for [`vrct_core::controller::Services::osc`] and the links it opened.
pub fn factory(receive_fails: bool) -> (OpenOsc, Opened) {
    let opened = Opened::default();
    let list = opened.clone();
    let factory = Arc::new(move |ip: &str, port: u16| -> io::Result<Arc<dyn Osc>> {
        let osc = Arc::new(FakeOsc::new(ip, port, receive_fails)?);
        list.0.lock().unwrap().push(Arc::clone(&osc));
        Ok(osc as Arc<dyn Osc>)
    });
    (factory, opened)
}
