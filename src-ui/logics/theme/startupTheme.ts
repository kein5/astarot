import { applyThemeTokens, themeSetting, themeTokens } from "./themes.ts";
import type { ThemeSetting } from "./themes.ts";

// The theme a window shows from its first paint (#1259). The app's shell gives each window's page
// the theme before the page loads (src-tauri/src/startup_theme.rs): the one the main window
// reported last, or the saved one at start. The page puts it in place before its first render,
// and keeps it until its own source of the setting answers (the core's settings, the main
// window's state or reports). A browser has no shell: there is no global, and nothing changes.
export const STARTUP_THEME_GLOBAL = "__ASTAROT_STARTUP_THEME__";

// The theme the shell gave this page: a setting, null for the default theme (or a value that is
// not a theme), or undefined where no shell gave one.
export const startupTheme = (scope: object = globalThis): ThemeSetting | null | undefined =>
    Object.hasOwn(scope, STARTUP_THEME_GLOBAL) ? themeSetting(Reflect.get(scope, STARTUP_THEME_GLOBAL)) : undefined;

// Puts the shell's theme in place on the page's root, before the first render, and answers it.
// The default theme sets nothing over the stylesheet, so a page on it starts as it always did.
export const applyStartupTheme = (style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> = document.documentElement.style,
    scope: object = globalThis): ThemeSetting | null | undefined => {
    const theme = startupTheme(scope);
    if (theme !== undefined) applyThemeTokens(style, themeTokens(theme));
    return theme;
};
