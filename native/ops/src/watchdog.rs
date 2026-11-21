//! The backend's watchdog ([`src-python/models/watchdog/watchdog.py`]).
//!
//! The UI feeds it every 20 seconds (`/run/feed_watchdog`). When no feed has come for longer
//! than the timeout (60 seconds), the callback runs, and again at every check until fed: the
//! backend stops itself when its UI is gone.
//!
//! Time is measured on the monotonic clock, so a change of the wall clock neither fires it nor
//! holds it back. A wait between two checks that took far longer than the interval means the
//! PC slept: the timer then starts again instead of stopping the backend before the woken UI has
//! had a chance to feed it.
//!
//! [`src-python/models/watchdog/watchdog.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/watchdog/watchdog.py

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const TIMEOUT: Duration = Duration::from_secs(60);
pub const INTERVAL: Duration = Duration::from_secs(20);
/// A wait between checks that overran the interval by more than this was a suspend (sleep or
/// hibernation), not a slow thread.
pub const SUSPEND_GAP: Duration = Duration::from_secs(10);

type Callback = Arc<dyn Fn() + Send + Sync>;

struct Shared {
    timeout: Duration,
    interval: Duration,
    last_feed: Mutex<Instant>,
    callback: Mutex<Option<Callback>>,
    stop: Mutex<bool>,
    wake: Condvar,
}

pub struct Watchdog {
    shared: Arc<Shared>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Default for Watchdog {
    fn default() -> Self {
        Self::new(TIMEOUT, INTERVAL)
    }
}

impl Watchdog {
    pub fn new(timeout: Duration, interval: Duration) -> Self {
        Watchdog {
            shared: Arc::new(Shared { timeout, interval, last_feed: Mutex::new(Instant::now()), callback: Mutex::new(None), stop: Mutex::new(false), wake: Condvar::new() }),
            thread: Mutex::new(None),
        }
    }

    pub fn timeout(&self) -> Duration {
        self.shared.timeout
    }

    pub fn interval(&self) -> Duration {
        self.shared.interval
    }

    /// Restarts the timer.
    pub fn feed(&self) {
        *self.shared.last_feed.lock().unwrap() = Instant::now();
    }

    /// The callback run on timeout. It runs on the watchdog thread; a panic in it is caught.
    pub fn set_callback(&self, callback: impl Fn() + Send + Sync + 'static) {
        *self.shared.callback.lock().unwrap() = Some(Arc::new(callback));
    }

    /// One check: runs the callback if the last feed is older than the timeout. `true` if it ran.
    pub fn check(&self) -> bool {
        self.shared.check()
    }

    /// Checks every interval on a thread of its own until [`stop`](Self::stop). A second call
    /// while running does nothing.
    pub fn start_in_thread(&self) {
        let mut slot = self.thread.lock().unwrap();
        if slot.as_ref().is_some_and(|t| !t.is_finished()) {
            return;
        }
        *self.shared.stop.lock().unwrap() = false;
        let shared = self.shared.clone();
        *slot = thread::Builder::new()
            .name("watchdog".into())
            .spawn(move || loop {
                shared.check();
                let waited = Instant::now();
                let stop = shared.stop.lock().unwrap();
                let (stop, _) = shared.wake.wait_timeout_while(stop, shared.interval, |stop| !*stop).unwrap();
                if *stop {
                    break;
                }
                drop(stop);
                shared.after_wait(waited.elapsed());
            })
            .ok();
    }

    /// Stops the thread and waits for it, at most `timeout` (`None`: as long as it takes).
    /// The wait between checks is cut short. `false` if it is still running (a callback that
    /// does not return); a later call waits again.
    pub fn stop(&self, timeout: Option<Duration>) -> bool {
        let mut slot = self.thread.lock().unwrap();
        let Some(thread) = slot.take() else { return true };
        *self.shared.stop.lock().unwrap() = true;
        self.shared.wake.notify_all();
        let deadline = timeout.map(|t| std::time::Instant::now() + t);
        while !thread.is_finished() && deadline.is_none_or(|d| std::time::Instant::now() < d) {
            thread::sleep(Duration::from_millis(5));
        }
        if thread.is_finished() {
            let _ = thread.join();
            true
        } else {
            *slot = Some(thread);
            false
        }
    }
}

impl Shared {
    /// After the wait between two checks: one that took far longer than the interval spanned a
    /// suspend, and the time asleep does not count as time without a feed.
    fn after_wait(&self, waited: Duration) {
        if waited > self.interval + SUSPEND_GAP {
            *self.last_feed.lock().unwrap() = Instant::now();
        }
    }

    fn check(&self) -> bool {
        let elapsed = self.last_feed.lock().unwrap().elapsed();
        if elapsed <= self.timeout {
            return false;
        }
        let Some(callback) = self.callback.lock().unwrap().clone() else { return false };
        // A failing callback must not stop the watchdog; nothing about it is logged.
        let _ = catch_unwind(AssertUnwindSafe(|| callback()));
        true
    }
}

impl Drop for Watchdog {
    fn drop(&mut self) {
        *self.shared.stop.lock().unwrap() = true;
        self.shared.wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn fires_only_after_the_timeout_without_a_feed() {
        let watchdog = Watchdog::new(Duration::from_millis(50), Duration::from_millis(10));
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        watchdog.set_callback(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        assert!(!watchdog.check());
        thread::sleep(Duration::from_millis(80));
        assert!(watchdog.check() && fired.load(Ordering::SeqCst) == 1);
        watchdog.feed();
        assert!(!watchdog.check());
    }

    #[test]
    fn a_wait_that_spanned_a_suspend_restarts_the_timer() {
        // #427: after waking from sleep the check could run before the UI fed it, and the time
        // asleep counted as time without a feed, so the backend stopped.
        let interval = Duration::from_millis(10);
        let watchdog = Watchdog::new(Duration::from_millis(50), interval);
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        watchdog.set_callback(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        thread::sleep(Duration::from_millis(80));
        watchdog.shared.after_wait(interval + SUSPEND_GAP + Duration::from_secs(1));
        assert!(!watchdog.check(), "the time asleep is not time without a feed");
        // An ordinary wait changes nothing: without a feed it still fires.
        thread::sleep(Duration::from_millis(80));
        watchdog.shared.after_wait(interval + Duration::from_millis(5));
        assert!(watchdog.check());
        assert_eq!(fired.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn without_a_callback_nothing_runs() {
        let watchdog = Watchdog::new(Duration::ZERO, Duration::from_millis(10));
        thread::sleep(Duration::from_millis(5));
        assert!(!watchdog.check());
    }

    #[test]
    fn a_panicking_callback_does_not_stop_the_thread() {
        let watchdog = Watchdog::new(Duration::ZERO, Duration::from_millis(5));
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        watchdog.set_callback(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            panic!("callback failed");
        });
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        watchdog.start_in_thread();
        thread::sleep(Duration::from_millis(60));
        assert!(watchdog.stop(Some(Duration::from_secs(1))));
        std::panic::set_hook(previous);
        assert!(fired.load(Ordering::SeqCst) >= 2);
    }

    #[test]
    fn stop_does_not_wait_out_the_interval_and_it_can_start_again() {
        let watchdog = Watchdog::new(TIMEOUT, Duration::from_secs(20));
        watchdog.start_in_thread();
        watchdog.start_in_thread();
        let began = std::time::Instant::now();
        assert!(watchdog.stop(Some(Duration::from_secs(1))));
        assert!(began.elapsed() < Duration::from_millis(500));
        assert!(watchdog.stop(None));
        watchdog.start_in_thread();
        assert!(watchdog.stop(Some(Duration::from_secs(1))));
    }

    #[test]
    fn a_callback_that_does_not_return_leaves_stop_for_later() {
        let watchdog = Watchdog::new(Duration::ZERO, Duration::from_millis(5));
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let gate = release.clone();
        watchdog.set_callback(move || {
            let (lock, cv) = &*gate;
            let _held = cv.wait_while(lock.lock().unwrap(), |go| !*go).unwrap();
        });
        thread::sleep(Duration::from_millis(5));
        watchdog.start_in_thread();
        thread::sleep(Duration::from_millis(30));
        assert!(!watchdog.stop(Some(Duration::from_millis(50))));
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        assert!(watchdog.stop(Some(Duration::from_secs(2))));
    }
}
