//! Cancellation of one utterance, with an optional start deadline.
//!
//! One token follows an utterance from the HTTP request to the last output
//! write. Cancelling it runs the registered closers (which shut sockets down so
//! blocked reads return) and makes every later `check` fail with the reason.
//!
//! A start deadline expires the utterance only while nothing audible has been
//! written. The first nonzero sample written ends the deadline; speech that has
//! started is never cut short by it.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::clock::monotonic_ns;
use crate::error::SpeechError;
use crate::sync::lock;

type Closer = Box<dyn FnOnce() + Send>;

struct State {
    set: bool,
    reason: String,
    closers: Vec<Closer>,
    /// On [`monotonic_ns`].
    start_deadline_ns: Option<i64>,
    started: bool,
}

struct Inner {
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Clone)]
pub struct CancelToken(Arc<Inner>);

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancelToken {
    pub fn new() -> Self {
        Self::with_start_deadline(None)
    }

    /// `deadline_ns` is on [`monotonic_ns`]; `None` never expires.
    pub fn with_start_deadline(deadline_ns: Option<i64>) -> Self {
        Self(Arc::new(Inner { state: Mutex::new(State { set: false, reason: "cancelled".to_owned(), closers: Vec::new(), start_deadline_ns: deadline_ns, started: false }), changed: Condvar::new() }))
    }

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.0.state)
    }

    pub fn is_set(&self) -> bool {
        self.state().set
    }

    /// Why the token was cancelled: `cancelled`, `request_timeout`,
    /// `speech_expired`, `server_unavailable` or a caller's code.
    pub fn reason(&self) -> String {
        self.state().reason.clone()
    }

    /// Wait until cancelled or `timeout` passes. Returns whether cancelled.
    pub fn wait(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.state();
        while !state.set {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = self.0.changed.wait_timeout(state, deadline - now).unwrap_or_else(|p| p.into_inner()).0;
        }
        true
    }

    /// Fail with the reason once cancelled or past the start deadline.
    pub fn check(&self) -> Result<(), SpeechError> {
        self.expire_start();
        let state = self.state();
        if state.set {
            return Err(SpeechError::from_reason(&state.reason));
        }
        Ok(())
    }

    fn expire_start_locked(&self, state: &mut State) -> Vec<Closer> {
        match state.start_deadline_ns {
            Some(deadline) if !state.started && monotonic_ns() >= deadline => self.cancel_locked(state, "speech_expired"),
            _ => Vec::new(),
        }
    }

    /// Cancel with `speech_expired` if the start deadline has passed and
    /// nothing audible has been written.
    pub fn expire_start(&self) {
        let closers = {
            let mut state = self.state();
            self.expire_start_locked(&mut state)
        };
        close(closers);
    }

    /// Mark playback as started, unless the deadline won the race.
    /// For outputs that confirm a write only when it returns.
    pub fn begin_playback(&self) -> Result<(), SpeechError> {
        let closers = {
            let mut state = self.state();
            let closers = self.expire_start_locked(&mut state);
            if !state.set {
                state.started = true;
            }
            closers
        };
        close(closers);
        self.check()
    }

    /// Serialize the start deadline with one NONBLOCKING write.
    ///
    /// `write` runs under the token's lock and must never wait for readiness.
    /// It returns how many bytes of `pcm` it wrote (at least one). Only written
    /// nonzero bytes end the start deadline; a silent prefix or a refused write
    /// leaves it active.
    pub fn commit_audio_write<E>(&self, pcm: &[u8], write: impl FnOnce() -> Result<usize, E>) -> Result<usize, CommitError<E>> {
        let mut count = None;
        let closers = {
            let mut state = self.state();
            let closers = self.expire_start_locked(&mut state);
            if !state.set {
                let written = write().map_err(CommitError::Write)?;
                if written == 0 || written > pcm.len() {
                    return Err(CommitError::Speech(SpeechError::new("output_write_invalid")));
                }
                if pcm[..written].iter().any(|&b| b != 0) {
                    state.started = true;
                }
                count = Some(written);
            }
            closers
        };
        close(closers);
        self.check().map_err(CommitError::Speech)?;
        Ok(count.expect("a cancelled token failed the check above"))
    }

    /// Run `closer` on cancellation, or now if already cancelled.
    pub fn register(&self, closer: impl FnOnce() + Send + 'static) {
        {
            let mut state = self.state();
            if !state.set {
                state.closers.push(Box::new(closer));
                return;
            }
        }
        closer();
    }

    /// Cancel with `cancelled`.
    pub fn cancel(&self) {
        self.cancel_with("cancelled");
    }

    /// Cancel with a reason. The first reason wins.
    pub fn cancel_with(&self, reason: &str) {
        let closers = {
            let mut state = self.state();
            self.cancel_locked(&mut state, reason)
        };
        close(closers);
    }

    fn cancel_locked(&self, state: &mut State, reason: &str) -> Vec<Closer> {
        if state.set {
            return Vec::new();
        }
        state.reason = reason.to_owned();
        state.set = true;
        self.0.changed.notify_all();
        std::mem::take(&mut state.closers)
    }

    /// Whether two handles name the same utterance.
    pub fn same(&self, other: &CancelToken) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

fn close(closers: Vec<Closer>) {
    for closer in closers {
        closer();
    }
}

/// A failed [`CancelToken::commit_audio_write`].
#[derive(Debug)]
pub enum CommitError<E> {
    /// Cancelled, expired, or the write reported an impossible count.
    Speech(SpeechError),
    /// The output's own failure.
    Write(E),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn cancel_runs_closers_once_and_keeps_the_first_reason() {
        let token = CancelToken::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        token.register(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        assert!(token.check().is_ok());
        token.cancel_with("request_timeout");
        token.cancel();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(token.reason(), "request_timeout");
        assert_eq!(token.check().unwrap_err().code(), "request_timeout");
        let late = calls.clone();
        token.register(move || {
            late.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(calls.load(Ordering::SeqCst), 2, "a closer registered after cancel runs immediately");
    }

    #[test]
    fn wait_wakes_on_cancel() {
        let token = CancelToken::new();
        assert!(!token.wait(Duration::from_millis(10)));
        let other = token.clone();
        let canceller = std::thread::spawn(move || other.cancel());
        assert!(token.wait(Duration::from_secs(2)));
        canceller.join().unwrap();
    }

    #[test]
    fn start_deadline_expires_only_before_audible_output() {
        let past = monotonic_ns() - 1;
        let expired = CancelToken::with_start_deadline(Some(past));
        assert_eq!(expired.check().unwrap_err().code(), "speech_expired");

        let started = CancelToken::with_start_deadline(Some(monotonic_ns() + 30_000_000));
        started.begin_playback().unwrap();
        std::thread::sleep(Duration::from_millis(40));
        assert!(started.check().is_ok(), "started speech is never truncated by the start deadline");
    }

    #[test]
    fn only_written_nonzero_bytes_end_the_start_deadline() {
        let token = CancelToken::with_start_deadline(Some(monotonic_ns() + 20_000_000));
        let pcm = [0u8, 0, 1, 0];
        // A silent prefix does not count as audible.
        assert_eq!(token.commit_audio_write(&pcm, || Ok::<_, ()>(2)).unwrap(), 2);
        std::thread::sleep(Duration::from_millis(30));
        assert!(matches!(token.commit_audio_write(&pcm[2..], || Ok::<_, ()>(2)), Err(CommitError::Speech(e)) if e.code() == "speech_expired"));

        let token = CancelToken::with_start_deadline(Some(monotonic_ns() + 20_000_000));
        assert_eq!(token.commit_audio_write(&pcm, || Ok::<_, ()>(4)).unwrap(), 4);
        std::thread::sleep(Duration::from_millis(30));
        assert!(token.check().is_ok());
    }

    #[test]
    fn impossible_write_counts_and_write_errors_are_reported() {
        let token = CancelToken::new();
        for count in [0usize, 5] {
            assert!(matches!(token.commit_audio_write(&[1, 0, 1, 0], || Ok::<_, ()>(count)), Err(CommitError::Speech(e)) if e.code() == "output_write_invalid"));
        }
        assert!(matches!(token.commit_audio_write(&[1, 0], || Err("device")), Err(CommitError::Write("device"))));
        token.cancel();
        let mut called = false;
        assert!(token
            .commit_audio_write(&[1, 0], || {
                called = true;
                Ok::<_, ()>(2)
            })
            .is_err());
        assert!(!called, "a cancelled token never writes");
    }
}
