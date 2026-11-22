import { useEffect } from "react";
import { useAppearance } from "@logics_configs";
import { applyThemeTokens, themeSetting, themeTokens } from "../../../logics/theme/themes.ts";

// The app's theme (#965): the colours of the theme in use, set over variables.css on <html>, or
// none for the default theme, which is the stylesheet itself. The main window only: its pages,
// dialogs and menus all read these tokens.
export const ThemeController = () => {
    const { currentTheme } = useAppearance();
    // The setting is an object; its text is what changes.
    const saved = JSON.stringify(currentTheme.data ?? null);
    useEffect(() => {
        applyThemeTokens(document.documentElement.style, themeTokens(themeSetting(JSON.parse(saved))));
    }, [saved]);
    return null;
};
