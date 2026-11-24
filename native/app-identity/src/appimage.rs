//! The host's environment under the AppImage (#924, item 22).
//!
//! `packaging/appimage/AppRun` points `LD_LIBRARY_PATH`, `PATH` and the GTK and WebKit variables at
//! the AppImage's own libraries for the GUI. Before it does, it keeps each one's host value in
//! `ASTAROT_APPIMAGE_HOST_<NAME>`, and in `ASTAROT_APPIMAGE_HOST_<NAME>_SET` whether the host
//! had it at all (`x`) or not (empty). A program the app starts (speech.cpp, the RVC worker, the
//! audio helpers, `xdg-open`, the clipboard tools) is not part of the GUI: it gets the host's
//! values back, so that it does not load the AppImage's libraries first. Outside an AppImage
//! nothing is recorded and nothing changes.
//!
//! The Tauri plugins start programs this module does not reach (#1016). The URL opener runs
//! `xdg-open`, which the AppImage's own `packaging/appimage/xdg-open` answers first in `PATH`: it
//! gives the same values back from the record before it runs the host's. The restart after an
//! in-app update starts the image again with the GUI's environment; `AppRun` then keeps the
//! record it was given instead of recording the GUI's values as the host's.

use std::process::Command;

/// The variables `AppRun` keeps, in its order. A test holds this list to `AppRun`'s and to the
/// one the AppImage's `xdg-open` gives back (#1016).
pub const HOST_VARIABLES: [&str; 16] = [
    "LD_LIBRARY_PATH",
    "PATH",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GTK_THEME",
    "GDK_PIXBUF_MODULE_FILE",
    "GI_TYPELIB_PATH",
    "XDG_DATA_DIRS",
    "GDK_BACKEND",
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "GTK_IM_MODULE",
    "XMODIFIERS",
];

/// What a started program gets of each kept variable: `Some(value)` to set, `None` to remove.
/// Empty outside an AppImage. `read` gives the app's own variables (`std::env::var`).
pub fn host_environment(read: impl Fn(&str) -> Option<String>) -> Vec<(&'static str, Option<String>)> {
    HOST_VARIABLES
        .iter()
        .filter_map(|name| {
            let set = read(&format!("ASTAROT_APPIMAGE_HOST_{name}_SET"))?;
            if set == "x" {
                Some((*name, Some(read(&format!("ASTAROT_APPIMAGE_HOST_{name}")).unwrap_or_default())))
            } else {
                Some((*name, None))
            }
        })
        .collect()
}

/// Gives a program the app starts the host's environment back (see the module). A variable the
/// command already sets or removes is left as it is: the caller's choice wins.
pub fn restore_host_environment(command: &mut Command) -> &mut Command {
    let chosen: Vec<String> = command.get_envs().filter_map(|(name, _)| name.to_str().map(str::to_string)).collect();
    for (name, value) in host_environment(|name| std::env::var(name).ok()) {
        if chosen.iter().any(|chosen| chosen == name) {
            continue;
        }
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn reader(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn outside_an_appimage_nothing_changes() {
        assert!(host_environment(reader(&[("LD_LIBRARY_PATH", "/opt/app/usr/lib")])).is_empty());
    }

    #[test]
    fn a_kept_value_comes_back_and_an_unset_one_goes() {
        let read = reader(&[
            ("ASTAROT_APPIMAGE_HOST_LD_LIBRARY_PATH_SET", ""),
            ("ASTAROT_APPIMAGE_HOST_LD_LIBRARY_PATH", ""),
            ("ASTAROT_APPIMAGE_HOST_PATH_SET", "x"),
            ("ASTAROT_APPIMAGE_HOST_PATH", "/usr/local/bin:/usr/bin"),
            // Set at the host, but empty.
            ("ASTAROT_APPIMAGE_HOST_GTK_THEME_SET", "x"),
            ("ASTAROT_APPIMAGE_HOST_GTK_THEME", ""),
        ]);
        let restored = host_environment(read);
        assert_eq!(
            restored,
            vec![("LD_LIBRARY_PATH", None), ("PATH", Some("/usr/local/bin:/usr/bin".into())), ("GTK_THEME", Some(String::new()))]
        );
    }

    #[test]
    fn a_started_program_sees_the_host_values() {
        let mut command = Command::new("true");
        for (name, value) in host_environment(reader(&[
            ("ASTAROT_APPIMAGE_HOST_LD_LIBRARY_PATH_SET", ""),
            ("ASTAROT_APPIMAGE_HOST_XMODIFIERS_SET", "x"),
            ("ASTAROT_APPIMAGE_HOST_XMODIFIERS", "@im=fcitx"),
        ])) {
            match value {
                Some(value) => command.env(name, value),
                None => command.env_remove(name),
            };
        }
        let envs: Vec<_> = command.get_envs().map(|(k, v)| (k.to_str().unwrap().to_string(), v.map(|v| v.to_str().unwrap().to_string()))).collect();
        assert_eq!(envs, vec![("LD_LIBRARY_PATH".to_string(), None), ("XMODIFIERS".to_string(), Some("@im=fcitx".to_string()))]);
    }

    #[test]
    fn the_list_is_the_one_apprun_keeps_and_xdg_open_gives_back() {
        for script in ["AppRun", "xdg-open"] {
            let path = format!("{}/../../packaging/appimage/{script}", env!("CARGO_MANIFEST_DIR"));
            let text = std::fs::read_to_string(path).unwrap();
            let line = text.lines().find(|line| line.starts_with("for name in ")).expect("the loop over the kept names");
            let names: Vec<&str> = line.trim_start_matches("for name in ").trim_end_matches("; do").split_whitespace().collect();
            assert_eq!(names, HOST_VARIABLES, "{script}");
        }
    }
}
