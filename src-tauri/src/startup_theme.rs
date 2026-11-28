//! The theme a window shows from its first paint (#1259).
//!
//! The pages draw the app's theme (#965) from the Appearance setting, which reaches a page only
//! after it has loaded: from the core's settings in the main and settings windows, from the main
//! window's state in the VR panel, and from its reports in the tray panel and Quick Chat. Until
//! then the stylesheet's default theme showed, for a moment on every start. So the shell gives
//! each window's page the theme before the page loads, as it gives the main window its saved place
//! before it shows (`window_placement`): a script that sets `window.__ASTAROT_STARTUP_THEME__`,
//! which the page puts in place before its first render (`src-ui/logics/theme/startupTheme.ts`).
//! Every window is made through `webview_environment`, which adds the script.
//!
//! The theme is the one the main window reported last (`companion_publish`): the core saves a
//! change to `config.json` up to two seconds later. Before the main window's first report, which
//! is the case for the main window itself, it is the one saved in `config.json`. The default theme
//! sets nothing over the stylesheet, so a window on it starts as it always did.

use crate::quick_chat::ThemeSetting;
use tauri::{Manager, Runtime};

/// The global the page reads. The same name is in `startupTheme.ts`; a test checks both.
pub const GLOBAL: &str = "__ASTAROT_STARTUP_THEME__";

/// The theme saved in the text of `config.json`, or None: none saved, a file that is not JSON,
/// or a value that is not a theme.
fn saved(config: &str) -> Option<ThemeSetting> {
    let value: serde_json::Value = serde_json::from_str(config).ok()?;
    let theme: ThemeSetting = serde_json::from_value(value.get("THEME")?.clone()).ok()?;
    theme.is_valid().then_some(theme)
}

/// The script that gives a page the theme: null for none, which the page reads as the default.
/// A checked theme is a preset's name of letters, digits, `_` and `-`, and two hex colours, so
/// its JSON is a plain JavaScript literal.
fn script_for(theme: Option<&ThemeSetting>) -> String {
    let value = theme.filter(|theme| theme.is_valid()).and_then(|theme| serde_json::to_string(theme).ok());
    format!("window.{GLOBAL} = {};", value.as_deref().unwrap_or("null"))
}

/// The script for a window made now.
pub(crate) fn script<R: Runtime, M: Manager<R>>(manager: &M) -> String {
    let theme = crate::companion::published_theme(manager).or_else(|| {
        let executable = std::env::current_exe().ok()?;
        let config = std::fs::read_to_string(crate::backend_host::state_dir(&executable).join("config.json")).ok()?;
        saved(&config)
    });
    script_for(theme.as_ref())
}

#[cfg(test)]
mod tests {
    use super::{GLOBAL, saved, script_for};
    use crate::quick_chat::{ThemeColors, ThemeSetting};

    fn theme(preset: &str, base: &str, accent: &str) -> ThemeSetting {
        ThemeSetting { preset: preset.into(), custom: ThemeColors { base: base.into(), accent: accent.into() } }
    }

    #[test]
    fn the_saved_theme_is_read_from_the_settings_and_anything_else_is_none() {
        let midnight = theme("midnight", "#14203a", "#6ea8fe");
        assert_eq!(saved(r##"{"UI_LANGUAGE": "en", "THEME": {"preset": "midnight", "custom": {"base": "#14203a", "accent": "#6ea8fe"}}}"##),
            Some(midnight));
        // A user's own colours.
        assert_eq!(saved(r##"{"THEME": {"preset": "custom", "custom": {"base": "#102030", "accent": "#abcdef"}}}"##),
            Some(theme("custom", "#102030", "#abcdef")));
        for config in [
            "{}",
            "not json",
            r#"{"THEME": null}"#,
            r#"{"THEME": "midnight"}"#,
            r##"{"THEME": {"preset": "midnight"}}"##,
            // Not a colour, or a name that could end the script.
            r##"{"THEME": {"preset": "midnight", "custom": {"base": "red", "accent": "#6ea8fe"}}}"##,
            r##"{"THEME": {"preset": "a\"; alert(1); \"", "custom": {"base": "#14203a", "accent": "#6ea8fe"}}}"##,
        ] {
            assert_eq!(saved(config), None, "{config}");
        }
    }

    #[test]
    fn the_script_sets_the_global_the_page_reads() {
        assert_eq!(script_for(Some(&theme("midnight", "#14203a", "#6ea8fe"))),
            r##"window.__ASTAROT_STARTUP_THEME__ = {"preset":"midnight","custom":{"base":"#14203a","accent":"#6ea8fe"}};"##);
        assert_eq!(script_for(None), "window.__ASTAROT_STARTUP_THEME__ = null;");
        // A report that is not a theme gives none.
        assert_eq!(script_for(Some(&theme("", "#14203a", "#6ea8fe"))), "window.__ASTAROT_STARTUP_THEME__ = null;");
        // The page reads the same name.
        let page = include_str!("../../src-ui/logics/theme/startupTheme.ts");
        assert!(page.contains(&format!("\"{GLOBAL}\"")), "startupTheme.ts reads {GLOBAL}");
    }

    #[test]
    fn every_window_is_made_with_the_script() {
        let source = include_str!("webview_environment.rs");
        let body = |name: &str| source.split(&format!("pub(crate) fn {name}")).nth(1).and_then(|rest| rest.split("\n}\n").next()).unwrap_or("");
        for builder in ["window", "main_window"] {
            assert!(body(builder).contains(".initialization_script(crate::startup_theme::script("), "{builder}");
        }
    }
}
