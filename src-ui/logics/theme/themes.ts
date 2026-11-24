// The app's themes (#965): a few presets and the user's own, each made of two colours. The base
// colour gives the grounds, the greys and the text their hue; the accent colour gives the primary
// actions, the selection, the active state and the keyboard focus theirs. Every derived step keeps
// the lightness it has in the default theme (DESIGN.md "Colors": Dark Plum and Lilac with only the
// lightness changed), so a theme changes hues, never what is light or dark. A step that misses a
// contrast DESIGN.md asks for is then made lighter or darker within its hue until it reaches it.
// Warning, failed, the sent and received roles and VRChat's chatbox keep their colours in every
// theme: they carry a meaning, not the theme's look.
import { contrast, fromOklch, fromOklchKeepingHue, hueApart, isHexColor, luminance, splitHex, toOklch } from "./color.ts";
import { DERIVED_TOKENS } from "./palette.ts";
import type { TokenSource } from "./palette.ts";

export interface ThemeColors {
    base: string;
    accent: string;
}

// What is saved (config THEME): the preset in use, or "custom"; and the user's own two colours,
// kept while a preset is in use so that choosing "custom" again brings them back.
export interface ThemeSetting {
    preset: string;
    custom: ThemeColors;
}

export const CUSTOM = "custom";
export const DEFAULT_PRESET = "dark_plum";

// The brand colours the default palette is derived from (DESIGN.md "Colors").
const SOURCES: Readonly<Record<TokenSource, string>> = { base: "#261633", accent: "#a47af5" };

// The presets, in the order the settings show them. The default first.
export const PRESETS: readonly { id: string; colors: ThemeColors }[] = [
    { id: DEFAULT_PRESET, colors: { base: "#261633", accent: "#a47af5" } },
    { id: "midnight", colors: { base: "#14203a", accent: "#6ea8fe" } },
    { id: "lagoon", colors: { base: "#10272b", accent: "#3fc8c2" } },
    { id: "forest", colors: { base: "#15261c", accent: "#62c98c" } },
    { id: "rose", colors: { base: "#2a1523", accent: "#ec7fc0" } },
    { id: "graphite", colors: { base: "#1f1f22", accent: "#9aa8f0" } },
];

export const DEFAULT_THEME: ThemeSetting = { preset: DEFAULT_PRESET, custom: { ...PRESETS[0].colors } };

const isColors = (value: unknown): value is ThemeColors => typeof value === "object" && value !== null
    && isHexColor((value as ThemeColors).base) && isHexColor((value as ThemeColors).accent)
    && splitHex((value as ThemeColors).base).alpha === "" && splitHex((value as ThemeColors).accent).alpha === "";

// The setting as saved, or null when it is not one (the controller then keeps the default).
export const themeSetting = (value: unknown): ThemeSetting | null => {
    if (typeof value !== "object" || value === null) return null;
    const { preset, custom } = value as Partial<ThemeSetting>;
    if (typeof preset !== "string" || !isColors(custom)) return null;
    return { preset, custom: { base: splitHex(custom.base).rgb, accent: splitHex(custom.accent).rgb } };
};

// The two colours of the theme in use. A preset this version does not know (one a newer version
// saved) is the default.
export const themeColors = (setting: ThemeSetting | null): ThemeColors => {
    if (!setting) return PRESETS[0].colors;
    if (setting.preset === CUSTOM) return setting.custom;
    return (PRESETS.find(preset => preset.id === setting.preset) ?? PRESETS[0]).colors;
};

// A step of the default palette moved to another colour: the same lightness, the new hue, and the
// chroma in the same proportion to the new colour's as the step's is to its brand colour's.
const derive = (value: string, source: TokenSource, colors: ThemeColors): string => {
    const { rgb, alpha } = splitHex(value);
    const step = toOklch(rgb), from = toOklch(SOURCES[source]), to = toOklch(colors[source]);
    const share = from.chroma > 0 ? Math.min(1, step.chroma / from.chroma) : 0;
    return fromOklchKeepingHue({ lightness: step.lightness, chroma: share * to.chroma, hue: to.hue }) + alpha;
};

// The log's sent and received colours keep their hues (blue and pink-violet) in every theme; only
// their lightness may move, so they stay readable on the theme's grounds as they are on Dark Plum's.
// So do the four speakers' colours (#1036), the hues of the desktop caption overlay's voices.
export const KEPT_HUE_TOKENS: Readonly<Record<string, string>> = { "--sent_400_color": "#6197b4", "--received_300_color": "#c084cc",
    "--vox_speaker_a": "#cf86e6", "--vox_speaker_b": "#e6a84a", "--vox_speaker_c": "#5fcf8c", "--vox_speaker_d": "#ee7f95" };

// The contrasts DESIGN.md "Colors" asks for, as the token moved and the grounds it must stand out
// from. The order matters: the text is settled before the deep fills that carry it.
interface ContrastRule {
    adjust: string;
    against: readonly string[];
    min: number;
}
const GROUNDS = ["--vox_canvas", "--vox_surface", "--vox_rail"];
export const CONTRAST_RULES: readonly ContrastRule[] = [
    ...["--dark_basic_text_color", "--dark_100_color", "--vox_secondary_text", "--vox_description_text", "--vox_state_active",
        ...Object.keys(KEPT_HUE_TOKENS)].map(adjust => ({ adjust, against: GROUNDS, min: 4.5 })),
    { adjust: "--primary_600_color", against: ["--vox_surface"], min: 4.5 },
    { adjust: "--vox_on_primary", against: [450, 500, 550, 600, 650, 700].map(step => `--primary_${step}_color`), min: 4.5 },
    ...[750, 800, 900].map(step => ({ adjust: `--primary_${step}_color`, against: ["--dark_basic_text_color", "--dark_100_color"], min: 4.5 })),
    { adjust: "--vox_field_border", against: ["--vox_surface"], min: 3.5 },
    { adjust: "--vox_field_border", against: [...GROUNDS, "--dark_875_color", "--dark_850_color", "--dark_925_color"], min: 3 },
    { adjust: "--vox_focus", against: GROUNDS, min: 3 },
];

// Lighter or darker within its hue until the token reaches the contrast against every ground: away
// from the grounds, which in every theme are darker than what stands on them except for the
// dark text on a fill.
const reach = (tokens: Record<string, string>, rule: ContrastRule) => {
    const { rgb, alpha } = splitHex(tokens[rule.adjust]);
    const against = rule.against.map(token => splitHex(tokens[token]).rgb);
    const lighter = luminance(rgb) >= Math.max(...against.map(luminance));
    const start = toOklch(rgb);
    let color = rgb;
    for (let step = 1; step <= 200 && against.some(ground => contrast(color, ground) < rule.min); step++) {
        color = fromOklch({ ...start, lightness: start.lightness + (lighter ? 1 : -1) * step * .005 });
    }
    tokens[rule.adjust] = color + alpha;
};

// Every derived token of a theme's two colours, its contrasts reached.
export const deriveTokens = (colors: ThemeColors): Record<string, string> => {
    const tokens: Record<string, string> = { ...KEPT_HUE_TOKENS, ...Object.fromEntries(Object.entries(DERIVED_TOKENS)
        .map(([token, { value, source }]) => [token, derive(value, source, colors)])) };
    // Text on a fill is the canvas, as Dark Plum is on Lilac.
    tokens["--vox_on_primary"] = tokens["--vox_canvas"];
    for (const rule of CONTRAST_RULES) reach(tokens, rule);
    return tokens;
};

// The tokens to set over the stylesheet, or null for the default theme, which is the stylesheet.
export const themeTokens = (setting: ThemeSetting | null): Record<string, string> | null => {
    const colors = themeColors(setting);
    const isDefault = colors.base === PRESETS[0].colors.base && colors.accent === PRESETS[0].colors.accent;
    return isDefault ? null : deriveTokens(colors);
};

// The states an accent this close to them would be mistaken for: warning (amber) and failed (red)
// keep their hues in every theme, and the active state takes the accent's.
const STATES = { warning: "#d4a162", failed: "#e4938e" } as const;
export type NearState = keyof typeof STATES;
export const accentNearStates = (accent: string): NearState[] => {
    const { chroma, hue } = toOklch(splitHex(accent).rgb);
    if (chroma < .04) return [];
    return (Object.keys(STATES) as NearState[]).filter(state => hueApart(hue, toOklch(STATES[state]).hue) < 25);
};

// Every token a theme may set over the stylesheet.
export const THEME_TOKENS: readonly string[] = [...Object.keys(KEPT_HUE_TOKENS), ...Object.keys(DERIVED_TOKENS)];

// Sets a theme's tokens on an element's style (the page's <html>), or takes them all away for the
// default theme, so the stylesheet's values apply again.
export const applyThemeTokens = (style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
    tokens: Readonly<Record<string, string>> | null) => {
    for (const token of THEME_TOKENS) {
        const value = tokens?.[token];
        if (value) style.setProperty(token, value);
        else style.removeProperty(token);
    }
};
