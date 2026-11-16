//! The one OpenVR connection of the process.
//!
//! `VR_InitInternal2` and `VR_ShutdownInternal` act on the whole process: the client library
//! keeps one connection, and shutting it down invalidates every function table anyone fetched.
//! The VR overlay (`vrct-vr-overlay`) and the OCR capture (`ocr-runtime`) both connect, so each
//! takes a [`Lease`] here instead of calling them itself. The first lease initializes OpenVR as a
//! background application, the last one dropped shuts it down, and a part that lets go never
//! breaks the other's tables.
//!
//! When SteamVR asks applications to quit, the part that read the event calls
//! [`Lease::end_connection`]. The other part sees [`Lease::closing`] and lets go, and nobody can
//! take a new lease on the old connection until every holder has: the next lease then connects
//! anew.
//!
//! The library (`openvr_api`, BSD-3-Clause, Valve) is loaded on the first lease and kept loaded.

use std::ffi::{CString, c_char, c_void};
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

/// `VRApplication_Background`: never steals focus from the scene application.
const APPLICATION_BACKGROUND: i32 = 3;

/// Why no lease was given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// None of the candidates could be loaded.
    LibraryNotFound,
    /// The library lacks this entry point.
    MissingSymbol(&'static str),
    /// `VR_InitInternal2` failed with this `EVRInitError`.
    Init(i32),
    /// SteamVR asked to quit and another part still holds the old connection; try later.
    Closing,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::LibraryNotFound => f.write_str("openvr_api_not_found"),
            Error::MissingSymbol(name) => write!(f, "{name} missing"),
            Error::Init(error) => write!(f, "VRInitError {error}"),
            Error::Closing => f.write_str("openvr_connection_closing"),
        }
    }
}

impl std::error::Error for Error {}

/// The three entry points the connection needs; the real one is the client library.
trait Backend: Send + Sync {
    /// `VR_InitInternal2`; the `EVRInitError`, 0 on success.
    fn init(&self) -> i32;
    /// `VR_ShutdownInternal`.
    fn shutdown(&self);
    /// `VR_GetGenericInterface`.
    fn interface(&self, name: &str) -> Result<*const *const c_void, i32>;
}

struct State {
    backend: Option<Arc<dyn Backend>>,
    holders: usize,
    closing: bool,
}

struct Registry {
    state: Mutex<State>,
}

impl Registry {
    const fn new() -> Self {
        Registry { state: Mutex::new(State { backend: None, holders: 0, closing: false }) }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn acquire(&'static self, load: impl FnOnce() -> Result<Arc<dyn Backend>, Error>) -> Result<Lease, Error> {
        let mut state = self.lock();
        if state.holders > 0 {
            if state.closing {
                return Err(Error::Closing);
            }
            state.holders += 1;
            let backend = Arc::clone(state.backend.as_ref().expect("held connections have a library"));
            return Ok(Lease { registry: self, backend });
        }
        let backend = match &state.backend {
            Some(backend) => Arc::clone(backend),
            None => {
                let backend = load()?;
                state.backend = Some(Arc::clone(&backend));
                backend
            }
        };
        let error = backend.init();
        if error != 0 {
            return Err(Error::Init(error));
        }
        state.holders = 1;
        state.closing = false;
        Ok(Lease { registry: self, backend })
    }

    fn release(&self) {
        let mut state = self.lock();
        if state.holders == 0 {
            return;
        }
        state.holders -= 1;
        if state.holders == 0 {
            state.closing = false;
            if let Some(backend) = &state.backend {
                backend.shutdown();
            }
        }
    }
}

/// A hold on the process's OpenVR connection; dropping the last one shuts OpenVR down.
///
/// Function tables fetched through a lease stay valid while it is held. Drop whatever uses them
/// (overlays, mirror textures) before the lease.
pub struct Lease {
    registry: &'static Registry,
    backend: Arc<dyn Backend>,
}

impl Lease {
    /// The function table `name` (for example `FnTable:IVRSystem_023`), or the
    /// `EVRInitError` that `VR_GetGenericInterface` gave.
    pub fn interface(&self, name: &str) -> Result<*const *const c_void, i32> {
        self.backend.interface(name)
    }

    /// SteamVR asked applications to quit: every holder should let go, and no new lease is
    /// given on this connection.
    pub fn end_connection(&self) {
        // This lease holds the connection, so it is the current one.
        self.registry.lock().closing = true;
    }

    /// Whether some holder ended this connection; let go of the lease and take a new one later.
    pub fn closing(&self) -> bool {
        self.registry.lock().closing
    }
}

impl fmt::Debug for Lease {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Lease").finish_non_exhaustive()
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.registry.release();
    }
}

type InitFn = unsafe extern "C" fn(*mut i32, i32, *const c_char) -> u32;
type ShutdownFn = unsafe extern "C" fn();
type InterfaceFn = unsafe extern "C" fn(*const c_char, *mut i32) -> *mut c_void;

struct Library {
    _library: libloading::Library,
    init: InitFn,
    shutdown: ShutdownFn,
    get_interface: InterfaceFn,
}

impl Library {
    fn open(library: libloading::Library) -> Result<Library, Error> {
        unsafe {
            let init = *library.get::<InitFn>(b"VR_InitInternal2\0").map_err(|_| Error::MissingSymbol("VR_InitInternal2"))?;
            let shutdown =
                *library.get::<ShutdownFn>(b"VR_ShutdownInternal\0").map_err(|_| Error::MissingSymbol("VR_ShutdownInternal"))?;
            let get_interface = *library
                .get::<InterfaceFn>(b"VR_GetGenericInterface\0")
                .map_err(|_| Error::MissingSymbol("VR_GetGenericInterface"))?;
            Ok(Library { _library: library, init, shutdown, get_interface })
        }
    }
}

impl Backend for Library {
    fn init(&self) -> i32 {
        let mut error = 0i32;
        unsafe { (self.init)(&mut error, APPLICATION_BACKGROUND, std::ptr::null()) };
        error
    }

    fn shutdown(&self) {
        unsafe { (self.shutdown)() };
    }

    fn interface(&self, name: &str) -> Result<*const *const c_void, i32> {
        let Ok(name) = CString::new(name) else { return Err(-1) };
        let mut error = 0i32;
        let pointer = unsafe { (self.get_interface)(name.as_ptr(), &mut error) };
        if error != 0 || pointer.is_null() {
            return Err(error);
        }
        Ok(pointer as *const *const c_void)
    }
}

fn load(candidates: &[PathBuf]) -> Result<Arc<dyn Backend>, Error> {
    for candidate in candidates {
        // A bare name goes through the system's search; a path must exist.
        if candidate.components().count() > 1 && !candidate.is_file() {
            continue;
        }
        if let Ok(library) = unsafe { libloading::Library::new(candidate) } {
            return Ok(Arc::new(Library::open(library)?));
        }
    }
    Err(Error::LibraryNotFound)
}

static REGISTRY: Registry = Registry::new();

/// A lease on the process's OpenVR connection, connecting first when nobody holds one.
///
/// `candidates` are where to look for the client library, in order. They are used only until a
/// library has loaded; after that every lease uses that one.
pub fn acquire(candidates: &[PathBuf]) -> Result<Lease, Error> {
    REGISTRY.acquire(|| load(candidates))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicI32, AtomicUsize, Ordering};

    #[derive(Default)]
    struct Fake {
        inits: AtomicUsize,
        shutdowns: AtomicUsize,
        refuse: AtomicI32,
    }

    impl Backend for Fake {
        fn init(&self) -> i32 {
            self.inits.fetch_add(1, Ordering::SeqCst);
            self.refuse.load(Ordering::SeqCst)
        }
        fn shutdown(&self) {
            self.shutdowns.fetch_add(1, Ordering::SeqCst);
        }
        fn interface(&self, _name: &str) -> Result<*const *const c_void, i32> {
            Ok(std::ptr::NonNull::dangling().as_ptr())
        }
    }

    fn registry() -> (&'static Registry, Arc<Fake>) {
        (Box::leak(Box::new(Registry::new())), Arc::new(Fake::default()))
    }

    fn take(registry: &'static Registry, fake: &Arc<Fake>) -> Result<Lease, Error> {
        let fake = Arc::clone(fake);
        registry.acquire(move || Ok(fake as Arc<dyn Backend>))
    }

    fn counts(fake: &Fake) -> (usize, usize) {
        (fake.inits.load(Ordering::SeqCst), fake.shutdowns.load(Ordering::SeqCst))
    }

    #[test]
    fn one_part_letting_go_keeps_the_other_connected() {
        let (registry, fake) = registry();
        let overlay = take(registry, &fake).unwrap();
        let ocr = take(registry, &fake).unwrap();
        assert_eq!(counts(&fake), (1, 0), "the second part shares the connection");
        drop(ocr);
        assert_eq!(counts(&fake), (1, 0), "the overlay still holds it");
        assert!(!overlay.closing());
        drop(overlay);
        assert_eq!(counts(&fake), (1, 1));
    }

    #[test]
    fn the_overlay_reconnecting_does_not_end_the_ocr_connection() {
        let (registry, fake) = registry();
        let ocr = take(registry, &fake).unwrap();
        let overlay = take(registry, &fake).unwrap();
        drop(overlay);
        let overlay = take(registry, &fake).unwrap();
        assert_eq!(counts(&fake), (1, 0));
        assert!(!ocr.closing());
        drop((ocr, overlay));
        assert_eq!(counts(&fake), (1, 1));
    }

    #[test]
    fn a_quit_makes_every_holder_let_go_before_a_new_connection() {
        let (registry, fake) = registry();
        let overlay = take(registry, &fake).unwrap();
        let ocr = take(registry, &fake).unwrap();
        overlay.end_connection();
        assert!(ocr.closing() && overlay.closing());
        drop(overlay);
        assert_eq!(take(registry, &fake).unwrap_err(), Error::Closing, "no lease on the old connection");
        assert_eq!(counts(&fake), (1, 0));
        drop(ocr);
        assert_eq!(counts(&fake), (1, 1));
        let fresh = take(registry, &fake).unwrap();
        assert_eq!(counts(&fake), (2, 1), "the next lease connects anew");
        assert!(!fresh.closing());
    }

    #[test]
    fn a_failed_init_holds_nothing_and_is_tried_again() {
        let (registry, fake) = registry();
        fake.refuse.store(108, Ordering::SeqCst);
        assert_eq!(take(registry, &fake).unwrap_err(), Error::Init(108));
        assert_eq!(counts(&fake), (1, 0), "no shutdown after a failed init");
        fake.refuse.store(0, Ordering::SeqCst);
        let lease = take(registry, &fake).unwrap();
        assert_eq!(counts(&fake), (2, 0));
        drop(lease);
        assert_eq!(counts(&fake), (2, 1));
    }

    #[test]
    fn a_missing_library_is_looked_for_again() {
        let registry: &'static Registry = Box::leak(Box::new(Registry::new()));
        assert_eq!(registry.acquire(|| Err(Error::LibraryNotFound)).unwrap_err(), Error::LibraryNotFound);
        let fake = Arc::new(Fake::default());
        let lease = take(registry, &fake).unwrap();
        assert_eq!(counts(&fake), (1, 0));
        drop(lease);
    }

    #[test]
    fn no_candidate_means_no_library() {
        let missing = std::env::temp_dir().join("vrct-openvr-client-test").join("no_such_openvr_api.dll");
        assert_eq!(load(&[missing]).err(), Some(Error::LibraryNotFound));
    }
}
