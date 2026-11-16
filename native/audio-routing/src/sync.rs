//! Small blocking primitives with the semantics of Python's `threading.Event` and a
//! lock that can be waited for with a time limit.

use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// A flag that threads can wait on. `wait` returns as soon as the flag is set,
/// including when it is already set.
#[derive(Debug, Default)]
pub struct Event {
    flag: Mutex<bool>,
    changed: Condvar,
}

impl Event {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&self) {
        *lock(&self.flag) = true;
        self.changed.notify_all();
    }

    pub fn clear(&self) {
        *lock(&self.flag) = false;
    }

    pub fn is_set(&self) -> bool {
        *lock(&self.flag)
    }

    /// Wait until set or until `timeout` passes. Returns whether the flag is set.
    pub fn wait(&self, timeout: Duration) -> bool {
        let deadline = Instant::now().checked_add(timeout);
        let mut flag = lock(&self.flag);
        while !*flag {
            let Some(deadline) = deadline else {
                flag = self.changed.wait(flag).unwrap_or_else(|e| e.into_inner());
                continue;
            };
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            flag = self.changed.wait_timeout(flag, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
        }
        true
    }

    /// Wait without a time limit.
    pub fn wait_forever(&self) {
        let mut flag = lock(&self.flag);
        while !*flag {
            flag = self.changed.wait(flag).unwrap_or_else(|e| e.into_inner());
        }
    }
}

/// A non-reentrant lock that can be acquired with a time limit.
///
/// It stands in for the `pyaudio_op_lock` of the Python backend: every operation that
/// opens, closes or inspects an OS audio endpoint runs under it, so that a device
/// enumeration never overlaps a stream being opened. One exception: a WASAPI capture
/// finds its device under it but opens the stream outside, since that can wait for the
/// user to answer the microphone permission.
#[derive(Debug, Default)]
pub struct TimedLock {
    held: Mutex<bool>,
    released: Condvar,
}

/// Holds a [`TimedLock`] until dropped.
#[derive(Debug)]
pub struct TimedGuard<'a> {
    lock: &'a TimedLock,
}

impl TimedLock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn lock(&self) -> TimedGuard<'_> {
        let mut held = lock(&self.held);
        while *held {
            held = self.released.wait(held).unwrap_or_else(|e| e.into_inner());
        }
        *held = true;
        TimedGuard { lock: self }
    }

    /// `None` when the lock was not free within `timeout`.
    pub fn try_lock_for(&self, timeout: Duration) -> Option<TimedGuard<'_>> {
        let deadline = Instant::now() + timeout;
        let mut held = lock(&self.held);
        while *held {
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            held = self.released.wait_timeout(held, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
        }
        *held = true;
        Some(TimedGuard { lock: self })
    }
}

impl Drop for TimedGuard<'_> {
    fn drop(&mut self) {
        *lock(&self.lock.held) = false;
        self.lock.released.notify_one();
    }
}

/// The process-wide lock for OS audio endpoint operations.
pub fn audio_op_lock() -> &'static TimedLock {
    static LOCK: OnceLock<TimedLock> = OnceLock::new();
    LOCK.get_or_init(TimedLock::new)
}

/// Lock a mutex, recovering the data when another thread panicked while holding it.
/// The state guarded here stays consistent between statements, so a panic elsewhere
/// is no reason to stop audio control.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// A thread handle whose end can be awaited with a time limit, like
/// `Thread.join(timeout)` followed by `is_alive()`.
#[derive(Debug, Clone)]
pub struct Worker {
    done: Arc<Event>,
}

impl Worker {
    /// Run `body` on a new named thread.
    pub fn spawn(name: &str, body: impl FnOnce() + Send + 'static) -> std::io::Result<Self> {
        let done = Arc::new(Event::new());
        let finished = done.clone();
        std::thread::Builder::new().name(name.to_owned()).spawn(move || {
            struct Finish(Arc<Event>);
            impl Drop for Finish {
                fn drop(&mut self) {
                    self.0.set();
                }
            }
            let _finish = Finish(finished);
            body();
        })?;
        Ok(Self { done })
    }

    pub fn is_alive(&self) -> bool {
        !self.done.is_set()
    }

    /// Whether both handles refer to one thread.
    pub fn same(&self, other: &Worker) -> bool {
        Arc::ptr_eq(&self.done, &other.done)
    }

    /// Whether the thread ended within `timeout`.
    pub fn join(&self, timeout: Duration) -> bool {
        self.done.wait(timeout)
    }
}

/// Seconds on a monotonic clock, as `time.monotonic()` gives them.
pub fn monotonic() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}

/// Nanoseconds on a monotonic clock, as `time.monotonic_ns()` gives them.
pub fn monotonic_ns() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    // Offset by one so that the first reading is never zero.
    START.get_or_init(Instant::now).elapsed().as_nanos() as u64 + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_wait_returns_at_once_when_set() {
        let event = Event::new();
        event.set();
        assert!(event.wait(Duration::from_secs(5)));
        event.clear();
        assert!(!event.wait(Duration::from_millis(1)));
    }

    #[test]
    fn timed_lock_gives_up_while_held() {
        let lock = TimedLock::new();
        let guard = lock.lock();
        assert!(lock.try_lock_for(Duration::from_millis(5)).is_none());
        drop(guard);
        assert!(lock.try_lock_for(Duration::from_millis(5)).is_some());
    }

    #[test]
    fn worker_join_reports_a_thread_that_is_still_running() {
        let release = Arc::new(Event::new());
        let held = release.clone();
        let worker = Worker::spawn("test", move || held.wait_forever()).unwrap();
        assert!(!worker.join(Duration::from_millis(5)));
        assert!(worker.is_alive());
        release.set();
        assert!(worker.join(Duration::from_secs(5)));
    }
}
