//! A settable flag that threads can wait on (Python's `threading.Event`).

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct Event(Arc<(Mutex<bool>, Condvar)>);

impl Event {
    pub fn new() -> Self {
        Self::default()
    }

    fn flag(&self) -> MutexGuard<'_, bool> {
        self.0 .0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set(&self) {
        *self.flag() = true;
        self.0 .1.notify_all();
    }

    pub fn clear(&self) {
        *self.flag() = false;
    }

    pub fn is_set(&self) -> bool {
        *self.flag()
    }

    /// Wait until set or until `timeout` passes (`None` waits without limit).
    /// Returns whether the flag is set. Spurious wakeups are waited out.
    pub fn wait(&self, timeout: Option<Duration>) -> bool {
        let deadline = timeout.map(|t| Instant::now() + t);
        let mut flag = self.flag();
        while !*flag {
            match deadline {
                None => flag = self.0 .1.wait(flag).unwrap_or_else(|p| p.into_inner()),
                Some(deadline) => {
                    let now = Instant::now();
                    if now >= deadline {
                        return false;
                    }
                    flag = self.0 .1.wait_timeout(flag, deadline - now).unwrap_or_else(|p| p.into_inner()).0;
                }
            }
        }
        true
    }

    /// Whether two handles name the same flag.
    pub fn same(&self, other: &Event) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

/// Lock a mutex, recovering the data when a panicking thread held it.
/// Speech state stays usable: every critical section leaves it consistent.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::Event;
    use std::time::{Duration, Instant};

    #[test]
    fn wait_returns_on_set_or_timeout() {
        let event = Event::new();
        let started = Instant::now();
        assert!(!event.wait(Some(Duration::from_millis(20))));
        assert!(started.elapsed() >= Duration::from_millis(20));
        let other = event.clone();
        let setter = std::thread::spawn(move || other.set());
        assert!(event.wait(Some(Duration::from_secs(2))));
        setter.join().unwrap();
        event.clear();
        assert!(!event.is_set());
    }
}
