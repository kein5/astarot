//! Native file and folder selection dialogs for settings paths (#1096, #1115, #1231).
//!
//! Only the main window may open them (SEC-05). On Linux, `gtk::FileChooserNative`
//! delegates to the desktop's FileChooser portal when available and falls back to GTK3.
//! On Windows, `IFileOpenDialog` opens the native dialog, with `FOS_PICKFOLDERS` for a folder.
//! A file dialog shows only the kinds of file its field takes, when the field names them.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// One kind of file a field takes: the name the dialog shows for it, and its extensions
/// without the dot (`gguf`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

// A field takes one or a few kinds of file; the UI sends no more than this.
const MAX_FILTERS: usize = 4;
const MAX_EXTENSIONS: usize = 8;
const MAX_NAME_CHARS: usize = 120;
const MAX_EXTENSION_CHARS: usize = 16;

/// The filters as the UI sent them, checked before they reach the system dialog: a few, each
/// with a name of plain text and with extensions of letters and digits only.
fn checked_filters(filters: Option<Vec<FileFilter>>) -> Result<Vec<FileFilter>, String> {
    let filters = filters.unwrap_or_default();
    let extension_ok = |extension: &String| {
        (1..=MAX_EXTENSION_CHARS).contains(&extension.len()) && extension.chars().all(|c| c.is_ascii_alphanumeric())
    };
    let filter_ok = |filter: &FileFilter| {
        let name = filter.name.trim();
        !name.is_empty()
            && name.chars().count() <= MAX_NAME_CHARS
            && !name.chars().any(char::is_control)
            && (1..=MAX_EXTENSIONS).contains(&filter.extensions.len())
            && filter.extensions.iter().all(extension_ok)
    };
    if filters.len() <= MAX_FILTERS && filters.iter().all(filter_ok) {
        Ok(filters)
    } else {
        Err("file_picker_invalid".into())
    }
}

/// The folder a folder dialog opens in: the field's folder, when it exists.
fn initial_directory(path: Option<&str>) -> Option<PathBuf> {
    let candidate = path?.trim();
    if candidate.is_empty() {
        return None;
    }
    let dir = Path::new(candidate);
    dir.is_dir().then(|| dir.to_path_buf())
}

/// The folder a file dialog opens in: the folder that holds the field's file, or the field's
/// folder, when it exists.
fn containing_directory(path: Option<&str>) -> Option<PathBuf> {
    let candidate = path?.trim();
    if candidate.is_empty() {
        return None;
    }
    let path = Path::new(candidate);
    if path.is_dir() {
        return Some(path.to_path_buf());
    }
    path.parent().filter(|parent| parent.is_dir()).map(Path::to_path_buf)
}

/// GTK's patterns for one extension. They match case by case, so the upper case too (`*.GGUF`).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn gtk_patterns(extension: &str) -> Vec<String> {
    let mut patterns = vec![format!("*.{}", extension.to_ascii_lowercase())];
    let upper = format!("*.{}", extension.to_ascii_uppercase());
    if !patterns.contains(&upper) {
        patterns.push(upper);
    }
    patterns
}

/// The Windows dialog's pattern for a kind of file (`*.pem;*.crt`). Windows matches it in any case.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn windows_spec(extensions: &[String]) -> String {
    extensions.iter().map(|extension| format!("*.{extension}")).collect::<Vec<_>>().join(";")
}

/// What a dialog asks for: a folder, or a file of the kinds given (any file when there are none).
#[cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]
enum Pick {
    Folder,
    File(Vec<FileFilter>),
}

#[cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]
impl Pick {
    fn unavailable(&self) -> String {
        match self {
            Pick::Folder => "folder_picker_unavailable".into(),
            Pick::File(_) => "file_picker_unavailable".into(),
        }
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn pick_folder(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    initial_path: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    let start_dir = initial_directory(initial_path.as_deref());
    pick_linux(window, app, start_dir, title, Pick::Folder).await
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn pick_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    initial_path: Option<String>,
    title: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    let filters = checked_filters(filters)?;
    let start_dir = containing_directory(initial_path.as_deref());
    pick_linux(window, app, start_dir, title, Pick::File(filters)).await
}

#[cfg(target_os = "linux")]
async fn pick_linux(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    start_dir: Option<PathBuf>,
    title: Option<String>,
    pick: Pick,
) -> Result<Option<String>, String> {
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::mpsc;

    let unavailable = pick.unavailable();
    let (tx, rx) = mpsc::channel::<Option<String>>();
    let win = window.clone();
    app.run_on_main_thread(move || {
        let parent = win.gtk_window().ok();
        let action = match pick {
            Pick::Folder => gtk::FileChooserAction::SelectFolder,
            Pick::File(_) => gtk::FileChooserAction::Open,
        };
        let dialog = gtk::FileChooserNative::new(title.as_deref(), parent.as_ref(), action, None, None);
        if let Pick::File(filters) = &pick {
            for kind in filters {
                let filter = gtk::FileFilter::new();
                filter.set_name(Some(kind.name.trim()));
                for extension in &kind.extensions {
                    for pattern in gtk_patterns(extension) {
                        filter.add_pattern(&pattern);
                    }
                }
                dialog.add_filter(filter);
            }
        }
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
    .map_err(|_| unavailable.clone())?;

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .map_err(|_| unavailable)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn pick_folder(
    window: tauri::WebviewWindow,
    initial_path: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    let start_dir = initial_directory(initial_path.as_deref());
    pick_windows(&window, start_dir, title, Pick::Folder).await
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn pick_file(
    window: tauri::WebviewWindow,
    initial_path: Option<String>,
    title: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    let filters = checked_filters(filters)?;
    let start_dir = containing_directory(initial_path.as_deref());
    pick_windows(&window, start_dir, title, Pick::File(filters)).await
}

#[cfg(target_os = "windows")]
async fn pick_windows(
    window: &tauri::WebviewWindow,
    start_dir: Option<PathBuf>,
    title: Option<String>,
    pick: Pick,
) -> Result<Option<String>, String> {
    let hwnd_raw = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let unavailable = pick.unavailable();
    tauri::async_runtime::spawn_blocking(move || open_dialog_windows(hwnd_raw, start_dir.as_deref(), title.as_deref(), &pick))
        .await
        .map_err(|_| unavailable)?
}

#[cfg(target_os = "windows")]
fn open_dialog_windows(
    hwnd_raw: isize,
    start_dir: Option<&Path>,
    title: Option<&str>,
    pick: &Pick,
) -> Result<Option<String>, String> {
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND, S_FALSE, S_OK};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, FileOpenDialog, IFileOpenDialog,
        IShellItem, SHCreateItemFromParsingName, SIGDN_FILESYSPATH,
    };
    use windows::core::{HRESULT, HSTRING, PCWSTR};

    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    let unavailable = || pick.unavailable();
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let _guard = ComGuard(init == S_OK || init == S_FALSE);

        let dialog: IFileOpenDialog =
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(|_| unavailable())?;
        let options = dialog.GetOptions().map_err(|_| unavailable())?;
        let kind = match pick {
            Pick::Folder => FOS_PICKFOLDERS,
            Pick::File(_) => FOS_FILEMUSTEXIST,
        };
        dialog.SetOptions(options | kind | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST).map_err(|_| unavailable())?;
        if let Pick::File(filters) = pick {
            if !filters.is_empty() {
                // The strings stay alive until the dialog has copied them.
                let names: Vec<HSTRING> = filters.iter().map(|filter| HSTRING::from(filter.name.trim())).collect();
                let specs: Vec<HSTRING> =
                    filters.iter().map(|filter| HSTRING::from(windows_spec(&filter.extensions))).collect();
                let types: Vec<COMDLG_FILTERSPEC> = names
                    .iter()
                    .zip(&specs)
                    .map(|(name, spec)| COMDLG_FILTERSPEC {
                        pszName: PCWSTR(name.as_ptr()),
                        pszSpec: PCWSTR(spec.as_ptr()),
                    })
                    .collect();
                dialog.SetFileTypes(&types).map_err(|_| unavailable())?;
            }
        }
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
            return Err(unavailable());
        }
        let item = dialog.GetResult().map_err(|_| unavailable())?;
        let raw = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|_| unavailable())?;
        let selected = raw.to_string().map_err(|_| unavailable());
        CoTaskMemFree(Some(raw.0 as *const std::ffi::c_void));
        selected.map(Some)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
pub async fn pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    Err("folder_picker_unavailable".into())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
pub async fn pick_file(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    Err("file_picker_unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::{FileFilter, checked_filters, containing_directory, gtk_patterns, initial_directory, windows_spec};

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

    #[test]
    fn a_file_dialog_opens_in_the_folder_of_the_fields_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("model.gguf");
        std::fs::write(&file, "gguf").unwrap();

        assert_eq!(containing_directory(file.to_str()), Some(dir.path().to_path_buf()));
        // A file not there yet, in a folder that is: that folder.
        assert_eq!(containing_directory(dir.path().join("later.gguf").to_str()), Some(dir.path().to_path_buf()));
        assert_eq!(containing_directory(dir.path().to_str()), Some(dir.path().to_path_buf()));
        assert_eq!(containing_directory(dir.path().join("missing").join("model.gguf").to_str()), None);
        assert_eq!(containing_directory(Some("model.gguf")), None);
        assert_eq!(containing_directory(Some("  ")), None);
        assert_eq!(containing_directory(None), None);
    }

    fn filter(name: &str, extensions: &[&str]) -> FileFilter {
        FileFilter { name: name.into(), extensions: extensions.iter().map(|extension| extension.to_string()).collect() }
    }

    #[test]
    fn the_filters_are_a_few_named_kinds_of_plain_extensions() {
        assert_eq!(checked_filters(None), Ok(vec![]));
        let gguf = vec![filter("Files (*.gguf)", &["gguf"])];
        assert_eq!(checked_filters(Some(gguf.clone())), Ok(gguf));
        let many = vec![filter("Files", &["pth", "index", "onnx", "bin"])];
        assert_eq!(checked_filters(Some(many.clone())), Ok(many));
        for refused in [
            vec![filter("", &["gguf"])],
            vec![filter("Files", &[])],
            vec![filter("Files", &["*.gguf"])],
            vec![filter("Files", &["gg uf"])],
            vec![filter("Files", &["../x"])],
            vec![filter("Files", &["abcdefghijklmnopq"])],
            vec![filter("Files\u{7}", &["gguf"])],
            vec![filter(&"n".repeat(121), &["gguf"])],
            vec![filter("Files", &["a", "b", "c", "d", "e", "f", "g", "h", "i"])],
            vec![filter("A", &["a"]), filter("B", &["b"]), filter("C", &["c"]), filter("D", &["d"]), filter("E", &["e"])],
        ] {
            assert_eq!(checked_filters(Some(refused.clone())), Err("file_picker_invalid".into()), "{refused:?}");
        }
    }

    #[test]
    fn the_dialogs_match_an_extension_in_either_case() {
        assert_eq!(gtk_patterns("gguf"), ["*.gguf", "*.GGUF"]);
        assert_eq!(gtk_patterns("PTH"), ["*.pth", "*.PTH"]);
        assert_eq!(gtk_patterns("7z"), ["*.7z", "*.7Z"]);
        assert_eq!(gtk_patterns("123"), ["*.123"]);
        assert_eq!(windows_spec(&["gguf".into()]), "*.gguf");
        assert_eq!(windows_spec(&["pem".into(), "crt".into()]), "*.pem;*.crt");
    }
}
