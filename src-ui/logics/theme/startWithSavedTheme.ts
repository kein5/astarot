import { getDefaultStore } from "jotai";
import type { WritableAtom } from "jotai";
import { dynamicStoreRegistry } from "@store";
import type { AtomState } from "@store";
// The settings' atoms, Theme among them, are made as this list loads.
import "../configs/config_page_setter/ui_config_setter";
import type { ThemeSetting } from "./themes.ts";
import { applyStartupTheme } from "./startupTheme.ts";

type ThemeAtom = WritableAtom<AtomState<unknown>, [(previous: AtomState<unknown>) => AtomState<unknown>], void>;

// The windows whose theme is the Appearance setting (ThemeController: the main window, the
// settings window and the VR panel), before their first render (#1259). The shell's theme is put
// in place, and it is the setting's value until the setting itself comes, so the controller's
// first run keeps it rather than putting the default back. The setting stays pending: the value
// that comes replaces it.
export const startWithSavedTheme = (): ThemeSetting | null | undefined => {
    const theme = applyStartupTheme();
    const atom = dynamicStoreRegistry.Atom_Theme;
    if (theme && atom) getDefaultStore().set(atom as ThemeAtom, previous => ({ ...previous, data: theme }));
    return theme;
};
