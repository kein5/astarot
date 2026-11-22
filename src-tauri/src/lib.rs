#[cfg(not(target_os = "linux"))]
use tauri::PhysicalPosition;
use tauri::{Manager, RunEvent, Runtime, WebviewUrl, WindowEvent};
use std::fs::{create_dir_all, OpenOptions};
use std::io::{Error, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
mod backend_host;
mod app_update;
mod caption_overlay;
mod companion;
mod quick_chat;
mod single_instance;
mod vr_panel_state;
mod webview_environment;
mod window_placement;
#[cfg(test)]
mod opener_scope_tests;
#[cfg(target_os = "linux")]
mod portal_shortcuts;
// The portal worker's policy depends on neither Tauri nor D-Bus: its tests run on every platform
// (on Linux through portal_shortcuts, which includes it).
#[cfg(all(test, not(target_os = "linux")))]
#[path = "portal_shortcut_worker.rs"]
#[allow(dead_code)]
mod portal_shortcut_worker;
#[cfg(target_os = "linux")]
mod portal_screencast;
#[cfg(target_os = "linux")]
mod vr_panel_surface;
#[cfg(not(target_os = "linux"))]
mod portal_screencast {
    //! Sharing a window through the XDG ScreenCast portal exists only on Linux desktops.
    #[derive(Default)]
    pub struct Screencast;
    #[tauri::command]
    pub fn screencast_support() -> serde_json::Value {
        serde_json::json!({ "supported": false, "active": false })
    }
    #[tauri::command]
    pub fn screencast_start() -> Result<(), String> {
        Err("screencast_unavailable".into())
    }
    #[tauri::command]
    pub fn screencast_stop() -> Result<(), String> {
        Ok(())
    }
    pub fn shutdown<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {}
}
#[cfg(not(target_os = "linux"))]
mod portal_shortcuts {
    //! The XDG GlobalShortcuts portal exists only on Linux desktops.
    #[derive(Default)]
    pub struct PortalShortcuts;
    #[tauri::command]
    pub fn portal_shortcuts_bind() -> Result<(), String> {
        Err("portal_shortcuts_unsupported".into())
    }
}

// WebView2は同じプロセス内の全ウィンドウで起動引数が一致している必要があるため、
// tauri.conf.json の main ウィンドウと同じ値にする (テストで確かめる)。Tauri既定の --disable-features
// から msSmartScreenProtection を外し、WebView2 の SmartScreen を既定どおり動かす (第2回セキュリティ監査
// SEC-03)。隠れたウィンドウの描画停止は無効にする (VRパネルは画面外に置いて撮影するため)。
// --disable-background-networking は、画面と関係なくMicrosoftへ出る通信 (Edgeの実験の設定の取得
// config.edge.skype.com と、コンポーネント更新の繰り返し) を止める暫定対策。WebView2の公式の一覧に
// ないChromiumのスイッチなので、Runtimeの更新で効かなくなることがある (docs/spec/external-interfaces.md)。
// Windows では、全ウィンドウが共有する WebView2 の環境をアプリが作るときにも、この値を使う
// (webview_environment.rs。クラッシュダンプを Microsoft へ送らない設定とあわせて渡す)。
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-networking";

// VRオーバーレイに映す画面。Python側 (models/overlay) が撮影・入力する (Windows はタイトルで見つける)。
// VR UI が ON の間だけ作る (set_vr_panel_window)。OFF の間も動かしておくと、使わない人にも負荷がかかる
fn create_vr_panel_window<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<tauri::WebviewWindow<R>> {
    let window = webview_environment::window(manager, "vr_panel", WebviewUrl::App("vr.html".into()))
        .title("ASTAROT VR Panel")
        // 既定の並び (src-ui/views/vr/vr_layout.json の atlas)。ログの大きさを変えると Python が合わせて変える
        .inner_size(1628.0, 880.0)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    // 画面外に置く。Windows ではビルダーの .position() が効かず既定の位置 (画面内) に出るため、
    // 作ってから動かし、動かした後で表示する (撮影のため、表示状態で画面外に置いておく)。
    // Linux ではウィンドウを表示せず、中のページだけを画面に出ない場所へ移す (vr_panel_surface)。
    #[cfg(not(target_os = "linux"))]
    {
        window.set_position(PhysicalPosition::new(-10000, -10000))?;
        window.show()?;
    }
    Ok(window)
}

/// `logs/startup.log` in the settings folder the backend uses.
fn startup_log_path(executable_path: &Path) -> PathBuf {
    backend_host::state_dir(executable_path).join("logs").join("startup.log")
}

pub(crate) fn startup_log(message: &str) {
    let Ok(executable_path) = std::env::current_exe() else {
        return;
    };
    let log_path = startup_log_path(&executable_path);
    let Some(log_directory) = log_path.parent() else {
        return;
    };
    if create_dir_all(log_directory).is_err() {
        return;
    }
    let Ok(mut log_file) = OpenOptions::new().create(true).append(true).open(log_path) else {
        return;
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let _ = writeln!(log_file, "[{timestamp}] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // SAFETY: before Tauri, the backend or any other thread starts. ONNX Runtime reads the
    // variable when chat reading or translation first loads it; the RVC worker inherits it.
    unsafe { astarot_core::shipped_libraries::disable_onnx_runtime_telemetry() };
    // Before the backend starts: it learns from its environment where the VR page will be served.
    #[cfg(target_os = "linux")]
    let vr_panel = vr_panel_surface::prepare();
    // The folders, before anything reads them (the log below is in one of them) and after the
    // environment above is set: on Linux the folders of 0.5.x move to their new names here.
    let storage = std::env::current_exe().ok().and_then(|executable| backend_host::settle_folders(&executable));
    startup_log("ASTAROT startup began");
    if let Some(line) = storage {
        // Result codes only: no path, no setting.
        startup_log(&format!("Storage folders: {line}"));
    }
    #[cfg(target_os = "linux")]
    if vr_panel.is_none() {
        startup_log("VR panel surface unavailable: no runtime directory");
    }
    let context = tauri::generate_context!();
    #[cfg(target_os = "linux")]
    let context = {
        let mut context = context;
        // NVIDIA's WebKit shared-memory fallback can leave transparent X11
        // surfaces unpainted until hovered. WebDriver screenshots missed this
        // failure; ordinary-window capture reproduces it.
        if std::env::var_os("APPIMAGE").is_some()
            && Path::new("/sys/module/nvidia").is_dir()
            && std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref() == Ok("1")
        {
            if let Some(main) = context.config_mut().app.windows.iter_mut().find(|w| w.label == "main") {
                main.transparent = false;
                startup_log("Opaque main window enabled for NVIDIA AppImage shared-memory rendering");
            }
        }
        context
    };
    // The tray companion (an experimental feature, off by default) keeps the main window hidden:
    // it still runs the backend and the caption overlay, and the app lives in the tray.
    let companion = std::env::current_exe()
        .is_ok_and(|executable| companion::starts_in_tray(&backend_host::state_dir(&executable)));
    let context = if companion {
        let mut context = context;
        if let Some(main) = context.config_mut().app.windows.iter_mut().find(|w| w.label == "main") {
            main.visible = false;
            // Hidden, it must not hold the focus either.
            main.focus = false;
        }
        context
    } else {
        context
    };
    let mut builder = tauri::Builder::default();
    if single_instance::single_instance_enabled(
        cfg!(debug_assertions),
        astarot_app_identity::env::CONFIG_DIR.value_os().as_deref(),
    ) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            startup_log("Second launch requested; restoring main window");
            if let Err(error) = window.show() {
                startup_log(&format!("Main window show failed: {error}"));
            }
            if let Err(error) = window.unminimize() {
                startup_log(&format!("Main window unminimize failed: {error}"));
            }
            if let Err(error) = window.set_focus() {
                startup_log(&format!("Main window focus failed: {error}"));
            }
        }));
    }
    let result = builder
        .setup(move |app| {
            // The WebView2 environment every window shares comes first (Windows; #564). The main
            // window is made here, not by Tauri ("create": false), so that it gets it too.
            webview_environment::prepare(app);
            // An AppImage update that stopped before its rename left a file beside it (#517).
            app_update::clean_up_after_updates(app.handle());
            let main_config = app.config().app.windows.iter().find(|window| window.label == "main").cloned()
                .ok_or_else(|| Error::other("main webview window has no configuration"))?;
            let main_window = webview_environment::main_window(app, &main_config)?;
            // Made hidden (tauri.conf.json): it goes to its saved place before it is first shown,
            // so it does not show centred and then jump there once the engine is ready.
            if let Ok(executable) = std::env::current_exe() {
                window_placement::apply(&main_window, &backend_host::state_dir(&executable));
            }
            // The tray icon's Title (the name tray settings list it by) is the application name,
            // which GLib takes from the program's file name when none is set: "AppRun.wrapped"
            // in the AppImage. The program name itself stays, as the desktop entry matches it.
            #[cfg(target_os = "linux")]
            gtk::glib::set_application_name(MAIN_TITLE);
            // The app's one tray icon, there in every run (the overlay feature adds to its menu).
            if let Err(error) = companion::install_tray(app.handle()) {
                startup_log(&format!("Tray icon could not be made: {error}"));
            }
            if companion {
                match companion::install(app.handle()) {
                    Ok(()) if companion::may_start_hidden(app.handle()) => {
                        startup_log("Tray companion: the main window stays hidden in the tray");
                        return Ok(());
                    }
                    // Nothing could bring a hidden window back (Issue #455): start as usual.
                    Ok(()) => startup_log("Tray companion: no tray icon, so the main window shows"),
                    // Without a tray the app could not be reached: start as usual.
                    Err(error) => startup_log(&format!("Tray companion could not start: {error}")),
                }
            }
            main_window.show()?;
            if let Err(error) = main_window.set_focus() {
                startup_log(&format!("Main window focus failed: {error}"));
            }
            startup_log("Main window is ready");

            #[cfg(debug_assertions)]
            { main_window.open_devtools(); }

            Ok(())
        })
        // 画面外の vr_panel ウィンドウが残ることがあるため「最後のウィンドウが閉じたら終了」に頼れない。
        // main が閉じたらアプリを終了する。
        .on_window_event(|window, event| {
            companion::on_window_event(window, event);
            if window.label() == "quick_chat" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        // Only the plugins the windows use. The UI reads and writes no files and makes no HTTP
        // requests of its own, so the fs and http plugins are gone (security audit SEC-05). It starts
        // no programs either: the backend runs inside the app (backend_host.rs), so the shell plugin
        // went with the Python sidecar.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // In-app updates (app_update.rs). The window gets no updater permission: the UI goes
        // through the app_update_* commands, which only the main window may call.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_update::AppUpdateState::default())
        .manage(quick_chat::QuickChatState::default())
        .manage(caption_overlay::CaptionOverlayState::default())
        .manage(portal_shortcuts::PortalShortcuts::default())
        .manage(portal_screencast::Screencast::default())
        .manage(vr_panel_state::VrPanelState::default())
        .manage(backend_host::BackendHost::default())
        .manage(companion::CompanionState::default())
        .invoke_handler(tauri::generate_handler![get_font_list, set_vr_panel_window, main_window_restore,
            backend_host::backend_start, backend_host::backend_write,
            backend_host::backend_kill,
            quick_chat::quick_chat_context, quick_chat::quick_chat_configure, quick_chat::quick_chat_submit,
            quick_chat::quick_chat_take, quick_chat::quick_chat_finish, quick_chat::quick_chat_hide,
            quick_chat::quick_chat_show, quick_chat::quick_chat_shortcut_platform,
            caption_overlay::caption_overlay_supported, caption_overlay::caption_overlay_set,
            caption_overlay::caption_overlay_update, caption_overlay::caption_overlay_snapshot,
            portal_shortcuts::portal_shortcuts_bind,
            portal_screencast::screencast_support, portal_screencast::screencast_start,
            portal_screencast::screencast_stop,
            vr_panel_state::vr_panel_state_subscribe, vr_panel_state::vr_panel_state_push,
            vr_panel_state::vr_panel_send,
            app_update::app_update_info, app_update::app_update_check, app_update::app_update_install,
            companion::companion_set, companion::companion_publish, companion::companion_take,
            companion::companion_show_main, companion::companion_hide_main, companion::companion_close_hides, companion::companion_status, companion::companion_request,
            companion::companion_panel_hide, companion::companion_panel_toggle, companion::companion_handle_layout, companion::companion_monitors])
        .build(context);
    let app = match result {
        Ok(app) => app,
        Err(error) => {
            startup_log(&format!("ASTAROT startup failed: {error}"));
            #[cfg(target_os = "linux")]
            vr_panel_surface::cleanup();
            panic!("error while running tauri application: {error}");
        }
    };
    // `run` never returns: Tauri ends the process once the loop exits, so whatever must happen at
    // the end happens on `Exit` (Issue #425).
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // A shared window must not stay shared after the app is gone.
            portal_screencast::shutdown(app);
            app.state::<backend_host::BackendHost>().shutdown();
            // The VR panel's last frame (it can show the conversation) must not outlive the app.
            #[cfg(target_os = "linux")]
            vr_panel_surface::cleanup();
            startup_log("ASTAROT event loop ended");
        }
    });
}


/// Brings the minimized main window back for the "minimize or restore" hotkey.
///
/// On native Wayland a client cannot raise itself without an activation token, and
/// the portal that reports the hotkey gives none; KWin can do it on the user's behalf.
#[tauri::command]
async fn main_window_restore(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main_window_forbidden".into());
    }
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    if quick_chat::native_wayland() {
        portal_shortcuts::raise_with_kwin(MAIN_TITLE);
    }
    Ok(())
}
#[cfg(target_os = "linux")]
const MAIN_TITLE: &str = "ASTAROT";

// VR UI の ON/OFF に合わせて、VR画面のウィンドウを作る・消す (メイン画面が設定に合わせて呼ぶ)。
// ウィンドウを作るので async にする (同期コマンドから作ると Windows で固まることがある)
//
// OFF→ON を素早く繰り返すと、destroy を頼んだ直後はラベルが残っていて、ON が「もうある」と見なされて
// 何もせず、そのあとウィンドウが消えて無い状態になる。呼び出しを1つずつにし (VR_PANEL_LOCK)、
// destroy はウィンドウが消えるのを待ってから戻る。
static VR_PANEL_LOCK: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

#[tauri::command]
async fn set_vr_panel_window(window: tauri::WebviewWindow, app: tauri::AppHandle, open: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("vr_panel_forbidden".into());
    }
    let _guard = VR_PANEL_LOCK.lock().await;
    match (open, app.get_webview_window("vr_panel")) {
        (true, None) => {
            let created = create_vr_panel_window(&app).map_err(|error| {
                startup_log(&format!("VR panel window creation failed: {error}"));
                error.to_string()
            })?;
            #[cfg(target_os = "linux")]
            if let Err(error) = vr_panel_surface::attach(&created).await {
                startup_log(&format!("VR panel surface failed: {error}"));
                vr_panel_surface::detach(&app).await;
                let _ = created.destroy();
                return Err(error);
            }
            #[cfg(not(target_os = "linux"))]
            let _ = created;
            Ok(())
        }
        (false, Some(window)) => {
            // The closed panel's channel must not keep receiving the state.
            app.state::<vr_panel_state::VrPanelState>().clear();
            #[cfg(target_os = "linux")]
            vr_panel_surface::detach(&app).await;
            window.destroy().map_err(|error| error.to_string())?;
            // 消えるのを待つ (最大2秒)。待たずに戻ると、次の ON がまだ残っているウィンドウを見てしまう
            for _ in 0..40 {
                if app.get_webview_window("vr_panel").is_none() {
                    break;
                }
                tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(50)))
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}


use font_kit::{source::SystemSource};
use std::collections::HashSet;

#[tauri::command]
async fn get_font_list() -> Vec<String> {
    let source = SystemSource::new();
    let mut font_families = HashSet::new();

    if let Ok(fonts) = source.all_fonts() {
        for font in fonts {
            if let Ok(info) = font.load() {
                font_families.insert(info.family_name().to_string());
            }
        }
    }

    font_families.into_iter().collect()
}


#[cfg(test)]
mod tests {
    use super::{startup_log_path, BROWSER_ARGS};
    use std::path::Path;

    #[test]
    fn every_window_starts_webview2_with_the_main_windows_arguments() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        // A window without a label is "main".
        let main = config["app"]["windows"].as_array().unwrap().iter()
            .find(|window| window.get("label").map_or(true, |label| label == "main")).expect("the main window");
        assert_eq!(main["additionalBrowserArgs"], BROWSER_ARGS);
    }

    #[test]
    fn every_window_is_made_with_the_shared_webview2_environment() {
        // #564: a window made with Tauri's own builder would get a WebView2 environment of its own,
        // without the crash report option; WebView2 refuses that next to the shared one, so the
        // window would not open. Windows are made only in webview_environment.rs.
        let builders = [concat!("WebviewWindowBuilder", "::new("), concat!("WebviewWindowBuilder", "::from_config(")];
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut read = 0;
        for entry in std::fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|extension| extension != "rs") || path.ends_with("webview_environment.rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).unwrap();
            read += 1;
            for builder in builders {
                assert!(!source.contains(builder), "{} calls {builder}", path.display());
            }
        }
        assert!(read > 5, "the sources were not found in {}", folder.display());
        // The main window is made in `setup`, after the environment; Tauri must not make it first.
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        assert!(windows.iter().all(|window| window["create"] == false), "{windows:?}");
    }

    #[test]
    fn smartscreen_stays_on() {
        // Second security audit SEC-03: WebView2's SmartScreen must not be switched off.
        let disabled = BROWSER_ARGS.split_whitespace()
            .filter_map(|argument| argument.strip_prefix("--disable-features="))
            .flat_map(|features| features.split(','));
        for feature in disabled {
            assert!(!feature.contains("SmartScreen"), "{feature} is disabled");
        }
    }

    #[test]
    fn webview2_background_networking_stays_off() {
        // WebView2 fetches Edge's experiment settings and repeats component updates on its own.
        // Keep that off for every window (docs/spec/external-interfaces.md, "WebView2の通信").
        assert!(BROWSER_ARGS.split_whitespace().any(|argument| argument == "--disable-background-networking"));
    }

    #[test]
    fn a_release_has_no_web_inspector() {
        // Tauri's `devtools` feature turns the inspector on in a release for every window that does
        // not turn it off itself (Issue #456). A debug build has it without the feature.
        let manifest = include_str!("../Cargo.toml");
        let tauri = manifest.lines().find(|line| line.starts_with("tauri = ")).expect("the tauri dependency");
        assert!(!tauri.contains("devtools"), "{tauri}");
    }

    #[test]
    fn no_window_may_make_a_tray_icon_or_a_menu() {
        // The tray and its menu are made in Rust; no page uses the menu, tray or image API, and
        // `core:default` would bring them all (Issue #456).
        let unused = ["core:default", "core:menu:", "core:tray:", "core:image:", "core:resources:", "core:path:", "core:app:"];
        for text in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/vrct_capability.json"),
            include_str!("../capabilities/quick-chat.json"),
            include_str!("../capabilities/caption-overlay.json"),
            include_str!("../capabilities/vr-panel.json"),
            include_str!("../capabilities/companion.json"),
        ] {
            let capability: serde_json::Value = serde_json::from_str(text).unwrap();
            for permission in capability["permissions"].as_array().unwrap() {
                let name = permission.as_str().or_else(|| permission["identifier"].as_str()).unwrap();
                assert!(!unused.iter().any(|prefix| name.starts_with(prefix)), "{} grants {name}", capability["identifier"]);
            }
        }
    }

    #[test]
    #[cfg(windows)]
    fn startup_log_is_stored_next_to_the_application() {
        assert_eq!(
            startup_log_path(Path::new(r"C:\VRCT\VRCT.exe")),
            Path::new(r"C:\VRCT\logs\startup.log")
        );
    }
}
