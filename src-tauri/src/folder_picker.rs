//! Native folder selection dialog for settings paths (#1096, #1115).
//!
//! Only the main window and the settings window may open the dialog (SEC-05, #1236). On Linux, `gtk::FileChooserNative`
//! delegates to the desktop's FileChooser portal when available and falls back to GTK3.
//! On Windows, `IFileOpenDialog` with `FOS_PICKFOLDERS` opens the native folder dialog.

use std::path::{Path, PathBuf};

fn initial_directory(path: Option<&str>) -> Option<PathBuf> {
    let candidate = path?.trim();
    if candidate.is_empty() {
        return None;
    }
    let dir = Path::new(candidate);
    dir.is_dir().then(|| dir.to_path_buf())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn pick_folder(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    initial_path: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    if !crate::settings_window::main_or_settings(window.label()) {
        return Err("main_window_forbidden".into());
    }
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::mpsc;

    let start_dir = initial_directory(initial_path.as_deref());
    let (tx, rx) = mpsc::channel::<Option<String>>();
    let win = window.clone();
    app.run_on_main_thread(move || {
        let parent = win.gtk_window().ok();
        let dialog = gtk::FileChooserNative::new(
            title.as_deref(),
            parent.as_ref(),
            gtk::FileChooserAction::SelectFolder,
            None,
            None,
        );
        if let Some(dir) = start_dir {
            let _ = dialog.set_current_folder(dir);
        }
        let sender = RefCell::new(Some(tx));
        let holder: Rc<RefCell<Option<gtk::FileChooserNative>>> = Rc::new(RefCell::new(Some(dialog.clone())));
        let holder_cb = holder.clone();
        dialog.connect_response(move |dlg, response| {
            let picked = if response == gtk::ResponseType::Accept {
                dlg.filename().and_then(|path| path.to_str().map(str::to_owned))
            } else {
                None
            };
            if let Some(tx) = sender.borrow_mut().take() {
                let _ = tx.send(picked);
            }
            dlg.destroy();
            *holder_cb.borrow_mut() = None;
        });
        dialog.show();
    })
    .map_err(|_| "folder_picker_unavailable".to_string())?;

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .map_err(|_| "folder_picker_unavailable".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn pick_folder(
    window: tauri::WebviewWindow,
    initial_path: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    if !crate::settings_window::main_or_settings(window.label()) {
        return Err("main_window_forbidden".into());
    }
    let hwnd_raw = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let start_dir = initial_directory(initial_path.as_deref());
    tauri::async_runtime::spawn_blocking(move || pick_folder_windows(hwnd_raw, start_dir.as_deref(), title.as_deref()))
        .await
        .map_err(|_| "folder_picker_unavailable".to_string())?
}

#[cfg(target_os = "windows")]
fn pick_folder_windows(hwnd_raw: isize, start_dir: Option<&Path>, title: Option<&str>) -> Result<Option<String>, String> {
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND, S_FALSE, S_OK};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::{
        FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, FileOpenDialog, IFileOpenDialog, IShellItem,
        SHCreateItemFromParsingName, SIGDN_FILESYSPATH,
    };
    use windows::core::{HRESULT, HSTRING};

    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let _guard = ComGuard(init == S_OK || init == S_FALSE);

        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|_| "folder_picker_unavailable".to_string())?;
        let options = dialog.GetOptions().map_err(|_| "folder_picker_unavailable".to_string())?;
        dialog
            .SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
            .map_err(|_| "folder_picker_unavailable".to_string())?;
        if let Some(text) = title {
            let _ = dialog.SetTitle(&HSTRING::from(text));
        }
        if let Some(dir) = start_dir.and_then(|path| path.to_str()) {
            if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(dir), None) {
                let _ = dialog.SetFolder(&item);
            }
        }
        let owner = HWND(hwnd_raw as *mut std::ffi::c_void);
        if let Err(err) = dialog.Show(Some(owner)) {
            if err.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
                return Ok(None);
            }
            return Err("folder_picker_unavailable".to_string());
        }
        let item = dialog.GetResult().map_err(|_| "folder_picker_unavailable".to_string())?;
        let raw = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|_| "folder_picker_unavailable".to_string())?;
        let selected = raw.to_string().map_err(|_| "folder_picker_unavailable".to_string());
        CoTaskMemFree(Some(raw.0 as *const std::ffi::c_void));
        selected.map(Some)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
pub async fn pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if !crate::settings_window::main_or_settings(window.label()) {
        return Err("main_window_forbidden".into());
    }
    Err("folder_picker_unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::initial_directory;

    #[test]
    fn initial_directory_accepts_only_existing_folders() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.txt");
        std::fs::write(&file, "hi").unwrap();
        let missing = dir.path().join("missing");

        assert_eq!(initial_directory(dir.path().to_str()), Some(dir.path().to_path_buf()));
        assert_eq!(initial_directory(file.to_str()), None);
        assert_eq!(initial_directory(missing.to_str()), None);
        assert_eq!(initial_directory(Some("   ")), None);
        assert_eq!(initial_directory(None), None);
    }
}
