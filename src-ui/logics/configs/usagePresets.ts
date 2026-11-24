// Usage presets (#554; docs/design/information-architecture/README.md "用途別プリセット", the
// decisions Q-09 to Q-15 on the Issue). This is the one table of what each preset shows: the
// switches on the main page and the pages of the settings menu. The spec points here
// (docs/spec/cross-cutting.md "用途別プリセット").
//
// A preset only chooses what is shown. It never changes a setting: no feature is turned on or
// off, no device, route or model changes, and the microphone is not opened.
//   - Several presets can be picked; what any of them shows is shown (Q-09).
//   - A switch that is on, or on its way on or off, is shown whatever the presets (it can always
//     be turned off). The main page lists the others under 「ほかの機能」 (Q-10).
//   - The settings search finds every page; a page opened from it, or from a main page button,
//     is shown in the menu while it is open, and shows all its settings.
//   - The saved value is the config key USAGE_PRESETS (native/core/src/config/schema.rs,
//     USAGE_PRESET_IDS lists the same ids). A new install starts with "basic"; an update from a
//     version without presets gets "all", so nothing it showed goes away (Q-15).
//   - The names are provisional until users have tried them (Q-14): the texts are
//     config_page.usage_presets.items.<id>.label and .desc in en.yml and ja.yml.
//
// No hooks here: the settings menu, the main switches and their tests read the same helpers.

import { SETTINGS_MENU_TABS } from "./settingsMenu.ts";

export type UsagePreset = { readonly id: string; readonly switches: readonly string[]; readonly tabs: readonly string[] };

// The main page's switches, in their order (MainFunctionSwitch.tsx).
export const MAIN_SWITCHES: readonly string[] = Object.freeze(["translation", "transcription_send", "transcription_receive", "ocr", "tts", "rvc"]);

export const USAGE_PRESETS: readonly UsagePreset[] = Object.freeze([
    // Your own voice, recognized and translated, to the captions and the chatbox.
    { id: "basic", switches: ["translation", "transcription_send", "transcription_receive"],
        tabs: ["translation", "transcription", "vrchat", "vr", "device"] },
    // Talking in text without speaking; reading the others' voices and chat. TTS brings its own
    // route and virtual microphone help, on its page, so the device page is not needed.
    { id: "nonverbal", switches: ["translation", "transcription_receive", "tts", "ocr"],
        tabs: ["translation", "transcription", "vrchat", "vr", "tts", "ocr"] },
    // Speaking with people of several languages.
    { id: "multilingual", switches: ["translation", "transcription_send", "transcription_receive", "tts"],
        tabs: ["translation", "transcription", "vrchat", "vr", "tts"] },
    // Speaking in a changed voice; translation is optional.
    { id: "voice_changer", switches: ["rvc", "translation", "transcription_send"],
        tabs: ["rvc", "device", "vrchat", "translation"] },
    // Everything, as before the presets.
    { id: "all", switches: MAIN_SWITCHES, tabs: SETTINGS_MENU_TABS },
].map(preset => Object.freeze({ ...preset, switches: Object.freeze([...preset.switches]), tabs: Object.freeze([...preset.tabs]) })));

export const USAGE_PRESET_IDS: readonly string[] = Object.freeze(USAGE_PRESETS.map(preset => preset.id));

// The preset that shows every switch and page; mutually exclusive with specific presets (#1107).
export const ALL_PRESET_ID = "all";

// Shown whatever the presets: the design, the hotkeys and the app's own pages.
export const ALWAYS_SHOWN_TABS: readonly string[] = Object.freeze(["appearance", "hotkeys", "updater", "advanced_settings", "experimental_features", "about_vrct"]);

// The presets as saved, in the table's order, or null while they are not known (before the
// engine's first answer, or a value this version cannot read). Until then nothing is hidden.
// "all" and specific presets never stay active together (#1107); a previously saved mixed list
// collapses to ["all"] so nothing currently visible disappears unexpectedly.
export const pickedPresets = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const picked = USAGE_PRESET_IDS.filter(id => value.includes(id));
    if (picked.length === 0) return null;
    return picked.includes(ALL_PRESET_ID) ? [ALL_PRESET_ID] : picked;
};

const presetsOf = (picked: readonly string[] | null): readonly UsagePreset[] | null =>
    picked === null ? null : USAGE_PRESETS.filter(preset => picked.includes(preset.id));

// Whether a main switch is in sight. `active`: the switch is on or changing; it is never hidden.
export const isSwitchShown = (picked: readonly string[] | null, id: string, active = false): boolean => {
    const presets = presetsOf(picked);
    return active || presets === null || presets.some(preset => preset.switches.includes(id));
};

// Whether a settings page is in the menu. `selected`: the page open now; it stays in the menu so
// the user sees where they are, also when the search or a main page button opened it.
export const isTabShown = (picked: readonly string[] | null, tab: string, selected = false): boolean => {
    const presets = presetsOf(picked);
    return selected || presets === null || ALWAYS_SHOWN_TABS.includes(tab) || presets.some(preset => preset.tabs.includes(tab));
};

// Picking or unpicking one preset. "all" and specific presets are mutually exclusive (#1107):
// choosing "all" clears every specific preset, and choosing a specific preset clears "all".
// Specific presets remain multi-select; the last one cannot be unpicked.
export const togglePreset = (picked: readonly string[] | null, id: string): string[] => {
    const current = (picked ? pickedPresets(picked) : null) ?? [ALL_PRESET_ID];
    if (id === ALL_PRESET_ID) return [ALL_PRESET_ID];
    const specific = current.filter(item => item !== ALL_PRESET_ID);
    const next = specific.includes(id) ? specific.filter(item => item !== id) : [...specific, id];
    const ordered = USAGE_PRESET_IDS.filter(item => next.includes(item));
    return ordered.length === 0 ? [...current] : ordered;
};

export const usagePresetLabelKey = (id: string): string => `config_page.usage_presets.items.${id}.label`;
export const usagePresetDescKey = (id: string): string => `config_page.usage_presets.items.${id}.desc`;
