//! Running OCR below VRChat and the VR panels (Windows only; [`background_priority.py`]).
//!
//! ONNX Runtime creates native threads at normal priority. On hardware, OCR at normal
//! priority made the VR panel's work several times slower; below normal, it only runs
//! when the others leave the CPU free. Elsewhere these are no-ops, as in Python.
//!
//! Python lowered every thread that appeared while the models loaded and during the first two
//! reads: in its sidecar process those were OCR's. In the app's own process they could be any
//! part's, so OCR's sessions create their threads through [`BelowNormalThreads`] instead, and
//! only those run below normal (#924, item 19).
//!
//! [`background_priority.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/background_priority.py

/// The calling thread at below-normal priority.
pub fn lower_current_thread() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

/// The threads of OCR's ONNX Runtime sessions, each lowered as it starts
/// (`SessionBuilder::with_thread_manager`).
pub struct BelowNormalThreads;

impl ort::environment::ThreadManager for BelowNormalThreads {
    type Thread = std::thread::JoinHandle<()>;

    fn create(&self, work: impl FnOnce() + Send + 'static) -> ort::Result<Self::Thread> {
        std::thread::Builder::new()
            .name("ocr-onnx".into())
            .spawn(move || {
                lower_current_thread();
                work();
            })
            .map_err(|error| ort::Error::new(error.to_string()))
    }

    fn join(thread: Self::Thread) -> ort::Result<()> {
        let _ = thread.join();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ort::environment::ThreadManager;

    #[test]
    fn a_thread_onnx_runtime_asks_for_runs_its_work_below_normal() {
        let (sender, received) = std::sync::mpsc::channel();
        let thread = BelowNormalThreads
            .create(move || {
                #[cfg(windows)]
                let priority = unsafe {
                    use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority};
                    GetThreadPriority(GetCurrentThread())
                };
                #[cfg(not(windows))]
                let priority = 0;
                sender.send((std::thread::current().name().map(str::to_string), priority)).unwrap();
            })
            .unwrap();
        BelowNormalThreads::join(thread).unwrap();
        let (name, priority) = received.recv().unwrap();
        assert_eq!(name.as_deref(), Some("ocr-onnx"));
        #[cfg(windows)]
        assert_eq!(priority, windows::Win32::System::Threading::THREAD_PRIORITY_BELOW_NORMAL.0);
        #[cfg(not(windows))]
        assert_eq!(priority, 0, "only Windows lowers it");
    }

    #[test]
    fn the_app_s_own_threads_keep_their_priority() {
        // A thread made outside OCR's sessions is not lowered (Python's snapshot lowered it).
        let priority = std::thread::spawn(|| {
            #[cfg(windows)]
            return unsafe {
                use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority};
                GetThreadPriority(GetCurrentThread())
            };
            #[cfg(not(windows))]
            0
        })
        .join()
        .unwrap();
        assert_eq!(priority, 0, "normal priority");
    }
}
