//! A child that cannot outlive the thread that owns it (as `astarot-speech-server`'s).
//!
//! Linux: the kernel sends the child SIGKILL when the thread that started it ends. This
//! replaces the `vrct-vc-worker` helper the Python owner started the worker through.
//! Windows: the child sits in a kill-on-close job whose only handle this process holds.

use std::io;
use std::process::{Child, Command, ExitStatus};
use std::time::{Duration, Instant};

pub struct Owned {
    pub child: Child,
    #[cfg(windows)]
    _job: windows::Job,
}

/// Start `command` under this thread's ownership; its streams are the caller's choice.
#[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
pub fn spawn(mut command: Command) -> io::Result<Owned> {
    // Under the AppImage, the host's environment rather than the GUI's (#924, item 22).
    astarot_app_identity::appimage::restore_host_environment(&mut command);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let parent = std::process::id() as libc::pid_t;
        // Runs in the child between fork and exec: only async-signal-safe calls.
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    return Err(io::Error::from_raw_os_error(libc::ESRCH));
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        windows::spawn(command)
    }
    #[cfg(not(windows))]
    Ok(Owned { child: command.spawn()? })
}

/// Wait at most `timeout` for the child to end.
pub fn wait(child: &mut Child, timeout: Duration) -> io::Result<Option<ExitStatus>> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Ask the child to end, then end it. False when its end could not be confirmed.
pub fn end(child: &mut Child, grace: Duration) -> bool {
    let mut ended = || -> io::Result<bool> {
        if child.try_wait()?.is_some() {
            return Ok(true);
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
        }
        #[cfg(not(unix))]
        child.kill()?;
        if wait(child, grace)?.is_some() {
            return Ok(true);
        }
        child.kill()?;
        Ok(wait(child, grace)?.is_some())
    };
    ended().unwrap_or(false)
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        ProcessPowerThrottling, SetProcessInformation, CREATE_NO_WINDOW, CREATE_SUSPENDED, PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        PROCESS_POWER_THROTTLING_STATE,
    };

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtResumeProcess(process: HANDLE) -> i32;
    }

    /// A kill-on-close job object holding one child.
    pub struct Job(HANDLE);

    // The handle is only closed, once, by the thread that drops the job.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    impl Job {
        fn new() -> io::Result<Job> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Job(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = unsafe { SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, (&raw const limits).cast(), std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) };
            if set == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }
    }

    /// A process without a window counts as background work on Windows; the conversion is not.
    fn no_throttling(process: HANDLE) {
        let state = PROCESS_POWER_THROTTLING_STATE { Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION, ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED, StateMask: 0 };
        unsafe {
            SetProcessInformation(process, ProcessPowerThrottling, (&raw const state).cast(), std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32);
        }
    }

    /// Started suspended, so that it is in the job before it runs.
    pub fn spawn(mut command: Command) -> io::Result<super::Owned> {
        let job = Job::new()?;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = command.spawn()?;
        let process = child.as_raw_handle() as HANDLE;
        let held = unsafe { AssignProcessToJobObject(job.0, process) } != 0;
        let failure = if held { None } else { Some(io::Error::last_os_error()) };
        if held {
            no_throttling(process);
        }
        if !held || unsafe { NtResumeProcess(process) } != 0 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failure.unwrap_or_else(|| io::Error::other("resume_failed")));
        }
        Ok(super::Owned { child, _job: job })
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::process::ExitStatusExt;
    use std::process::Command;
    use std::time::Duration;

    use super::{end, spawn, wait};

    fn sleep() -> Command {
        let mut command = Command::new("sleep");
        command.arg("30");
        command
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_child_ends_with_the_thread_that_started_it() {
        // `test_vc_worker_native.py`: the worker never outlives its owner, whatever the owner
        // does with it. The thread hands the child out and ends.
        let mut owned = std::thread::spawn(|| spawn(sleep()).unwrap()).join().unwrap();
        let status = wait(&mut owned.child, Duration::from_secs(5)).unwrap().expect("the child outlived its thread");
        assert_eq!(status.signal(), Some(libc::SIGKILL));
    }

    #[test]
    fn end_asks_first_then_ends_a_child_that_does_not_listen() {
        let mut polite = spawn(sleep()).unwrap();
        assert!(end(&mut polite.child, Duration::from_secs(2)));
        assert_eq!(polite.child.try_wait().unwrap().and_then(|s| s.signal()), Some(libc::SIGTERM));
        let mut deaf = spawn({
            let mut command = Command::new("sh");
            command.args(["-c", "trap '' TERM; sleep 30"]);
            command
        })
        .unwrap();
        // The shell sets its trap before the test asks it to end.
        std::thread::sleep(Duration::from_millis(200));
        assert!(end(&mut deaf.child, Duration::from_millis(300)));
        assert_eq!(deaf.child.try_wait().unwrap().and_then(|s| s.signal()), Some(libc::SIGKILL));
    }
}
