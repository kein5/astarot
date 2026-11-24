import { useLayoutEffect, type ReactNode } from "react";
import type { Decorator, Preview } from "@storybook/react-vite";
import i18n from "../../../locales/config.ts";
import "../app/_index_css/root.css";
import { applyThemeTokens, DEFAULT_PRESET, PRESETS, themeTokens } from "../../logics/theme/themes.ts";
import * as styles from "./Catalog.css.ts";

// The catalog's page: the app's stylesheet (root.css, with the tokens of variables.css), its theme and
// its language, chosen in Storybook's toolbar, so that a part looks here as it does in the app.

type Ground = keyof typeof styles.ground;
const GROUNDS: readonly Ground[] = ["canvas", "surface", "rail"];
const LANGUAGES = ["en", "ja"] as const;
type Language = (typeof LANGUAGES)[number];

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
    list.find(item => item === value) ?? fallback;

// The app's first language: the system's when it is Japanese, English otherwise (locales/config.ts).
const startLanguage: Language = i18n.language === "ja" ? "ja" : "en";

type AppLookProps = { theme: string; language: Language; ground: Ground; children: ReactNode };

const AppLook = ({ theme, language, ground, children }: AppLookProps) => {
    // The theme's tokens go on <html>, as ThemeController sets them in the app; none for Dark Plum,
    // which is the stylesheet itself.
    useLayoutEffect(() => {
        const preset = PRESETS.find(item => item.id === theme) ?? PRESETS[0];
        applyThemeTokens(document.documentElement.style, themeTokens({ preset: preset.id, custom: preset.colors }));
    }, [theme]);
    // locales/config.ts sets <html lang> when the language changes, as in the app.
    useLayoutEffect(() => {
        if (i18n.language !== language) void i18n.changeLanguage(language);
    }, [language]);
    return <div className={styles.ground[ground]}>{children}</div>;
};

const withAppLook: Decorator = (Story, { globals }) => (
    <AppLook
        theme={String(globals.theme ?? DEFAULT_PRESET)}
        language={oneOf(LANGUAGES, globals.language, startLanguage)}
        ground={oneOf(GROUNDS, globals.ground, "canvas")}
    >
        <Story />
    </AppLook>
);

const preview: Preview = {
    decorators: [withAppLook],
    parameters: {
        // The frame above is the page: the ground, the gutter and the scrolling are the app's.
        layout: "fullscreen",
        // The grounds come from the theme's tokens (the toolbar's Ground), not from fixed colours.
        backgrounds: { disable: true },
        controls: { expanded: true },
    },
    globalTypes: {
        theme: {
            description: "The app's theme (#965); the presets of Settings → Appearance",
            toolbar: {
                title: "Theme",
                dynamicTitle: true,
                // The presets' names are the same English words in every language (locales/).
                items: PRESETS.map(({ id }) => ({ value: id, title: i18n.t(`config_page.appearance.theme.presets.${id}`, { lng: "en" }) })),
            },
        },
        language: {
            description: "The UI language",
            toolbar: {
                title: "Language",
                dynamicTitle: true,
                items: [
                    { value: "en", title: "English" },
                    { value: "ja", title: "日本語" },
                ],
            },
        },
        ground: {
            description: "What the part stands on: the canvas of the main window and the settings, a surface, or the settings menu's rail",
            toolbar: {
                title: "Ground",
                dynamicTitle: true,
                items: GROUNDS.map(value => ({ value, title: `${value[0].toUpperCase()}${value.slice(1)}` })),
            },
        },
    },
    initialGlobals: { theme: DEFAULT_PRESET, language: startLanguage, ground: "canvas" },
};

export default preview;
