//! The WebView2 environment every window shares (Windows; #564).
//!
//! WebView2 sends its crash reports (crash dumps) to Microsoft as Windows' diagnostic data
//! settings allow, unless the app that makes its environment turns on custom crash reporting
//! (`IsCustomCrashReportingEnabled`). Then WebView2 sends nothing and keeps the reports in the
//! user data folder. Tauri makes the environment of a window itself unless it is given one, and
//! has no setting for that option, so the app makes the environment once, at start, with what
//! Tauri and wry would have used (the user data folder, the browser arguments of every window,
//! the user's UI language) plus that option. Every window is built with it.
//!
//! Every window must use this one environment: for the same user data folder, WebView2 refuses a
//! second environment with other options, and that window would not open. So windows are made
//! only through [`window`] and [`main_window`]; a test checks the sources. The main window is
//! marked `"create": false` in tauri.conf.json, so that Tauri does not make it before there is
//! an environment to give it.
//!
//! If the environment cannot be made, nothing is kept and every window makes its own as before;
//! crash reports then follow Windows' settings. Nothing here changes Linux.

use tauri::utils::config::WindowConfig;
use tauri::{App, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// A window with the browser arguments every window shares, the theme its page starts with
/// (#1259) and, on Windows, the shared environment. Every window but the main one starts here.
pub(crate) fn window<'a, R: Runtime, M: Manager<R>>(
    manager: &'a M,
    label: &str,
    url: WebviewUrl,
) -> WebviewWindowBuilder<'a, R, M> {
    let builder = WebviewWindowBuilder::new(manager, label, url)
        .additional_browser_args(crate::BROWSER_ARGS)
        .initialization_script(crate::startup_theme::script(manager));
    shared(manager, builder)
}

/// Makes the main window from its entry in tauri.conf.json, with the theme its page starts with
/// (#1259) and the shared environment.
pub(crate) fn main_window<R: Runtime>(app: &App<R>, config: &WindowConfig) -> tauri::Result<WebviewWindow<R>> {
    let handle = app.handle();
    let builder = WebviewWindowBuilder::from_config(handle, config)?.initialization_script(crate::startup_theme::script(handle));
    shared(handle, builder).build()
}

/// Makes the shared environment. On the main thread, before any window: WebView2 answers through
/// the thread's message loop.
pub(crate) fn prepare<R: Runtime>(app: &App<R>) {
    #[cfg(windows)]
    {
        let made = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())
            .and_then(|folder| {
                std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
                webview2::create(&folder, crate::BROWSER_ARGS)
            });
        match made {
            Ok(environment) => {
                app.manage(Shared(environment));
                crate::startup_log("WebView2 environment made: crash reports are not sent");
            }
            Err(error) => crate::startup_log(&format!(
                "WebView2 environment could not be made, so each window makes its own: {error}"
            )),
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
fn shared<'a, R: Runtime, M: Manager<R>>(
    manager: &M,
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    match manager.try_state::<Shared>() {
        Some(shared) => builder.with_environment(shared.0.clone()),
        None => builder,
    }
}

#[cfg(not(windows))]
fn shared<'a, R: Runtime, M: Manager<R>>(
    _manager: &M,
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
}

#[cfg(windows)]
struct Shared(webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment);

// SAFETY: the environment is only handed to window builders, which Tauri carries to the main
// thread and builds there; WebView2 calls its methods only on that thread. A builder on another
// thread only adds a reference to it (a clone), as Tauri's own builders do with theirs
// (`WebviewAttributes` is `Send` and `Sync` for the same environment).
#[cfg(windows)]
unsafe impl Send for Shared {}
#[cfg(windows)]
unsafe impl Sync for Shared {}

#[cfg(windows)]
mod webview2 {
    use std::path::Path;
    use std::sync::mpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_SCROLLBAR_STYLE_DEFAULT, CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2Environment,
        ICoreWebView2EnvironmentOptions,
    };
    use webview2_com::{CoreWebView2EnvironmentOptions, CreateCoreWebView2EnvironmentCompletedHandler};
    use ::windows::Win32::Foundation::{E_POINTER, E_UNEXPECTED};
    use ::windows::Win32::Globalization::{
        GetUserDefaultUILanguage, LCIDToLocaleName, LOCALE_ALLOW_NEUTRAL_NAMES, MAX_LOCALE_NAME,
    };
    use ::windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
    use ::windows::core::{HSTRING, PCWSTR};

    /// The options wry gives a window's environment (wry 0.57, `InnerWebView::create_environment`)
    /// for a window with these browser arguments, plus custom crash reporting.
    fn options(arguments: &str) -> CoreWebView2EnvironmentOptions {
        let options = CoreWebView2EnvironmentOptions::default();
        // SAFETY: the options object is ours alone until it is handed to WebView2 below.
        unsafe {
            options.set_additional_browser_arguments(arguments.to_owned());
            options.set_are_browser_extensions_enabled(false);
            options.set_language(user_language());
            options.set_scroll_bar_style(COREWEBVIEW2_SCROLLBAR_STYLE_DEFAULT);
            // Crash reports stay in the user data folder instead of going to Microsoft.
            options.set_is_custom_crash_reporting_enabled(true);
        }
        options
    }

    /// The user's UI language as a locale name ("ja-JP"), as wry sets it.
    fn user_language() -> String {
        let mut name = [0u16; MAX_LOCALE_NAME as usize];
        // SAFETY: the buffer holds MAX_LOCALE_NAME characters, as the call requires.
        let length = unsafe {
            LCIDToLocaleName(u32::from(GetUserDefaultUILanguage()), Some(&mut name), LOCALE_ALLOW_NEUTRAL_NAMES)
        };
        let end = name.iter().position(|&unit| unit == 0).unwrap_or(usize::try_from(length).unwrap_or(0));
        String::from_utf16_lossy(&name[..end])
    }

    pub(super) fn create(folder: &Path, arguments: &str) -> Result<ICoreWebView2Environment, String> {
        // WebView2 needs COM in a single-threaded apartment on this thread. wry starts it the same
        // way before its first window (an apartment already started is kept), but at `setup` no
        // window exists yet.
        // SAFETY: called on the main thread, which stays in this apartment for the app's life.
        let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        let (sender, receiver) = mpsc::channel();
        let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |result, environment| {
            let made = result.and_then(|()| environment.ok_or_else(|| ::windows::core::Error::from(E_POINTER)));
            sender.send(made).map_err(|_| ::windows::core::Error::from(E_UNEXPECTED))
        }));
        // SAFETY: the arguments live until the call returns; WebView2 answers through `handler`
        // on this thread's message loop, which `wait_with_pump` runs.
        unsafe {
            CreateCoreWebView2EnvironmentWithOptions(
                PCWSTR::null(),
                &HSTRING::from(folder),
                &ICoreWebView2EnvironmentOptions::from(options(arguments)),
                &handler,
            )
        }
        .map_err(|error| error.to_string())?;
        webview2_com::wait_with_pump(receiver)
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::{options, user_language};

        #[test]
        fn the_environment_keeps_crash_reports_and_the_windows_arguments() {
            let made = options(crate::BROWSER_ARGS);
            // SAFETY: the options object is only read here.
            unsafe {
                assert!(made.is_custom_crash_reporting_enabled());
                assert_eq!(made.additional_browser_arguments(), crate::BROWSER_ARGS);
                assert!(!made.are_browser_extensions_enabled());
            }
        }

        #[test]
        fn the_language_is_a_locale_name_without_trailing_nuls() {
            let language = user_language();
            assert!(!language.contains('\0'), "{language:?}");
            assert!(!language.is_empty());
        }
    }
}
