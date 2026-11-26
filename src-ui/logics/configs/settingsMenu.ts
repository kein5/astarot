// The settings menu: its pages in four groups, in the order a conversation uses them
// (#554, docs/design/information-architecture/README.md, decisions Q-02 and Q-03).
//
// Each id is a page of SettingBox.tsx; its name is config_page.side_menu_labels.<id>, and the
// group's heading is config_page.side_menu_groups.<group id> (in en.yml and ja.yml). The usage
// presets (usagePresets.ts) choose which of these pages the menu shows.
//
// No hooks here: the menu, the usage presets and their tests read the same lists.

export type SettingsMenuGroup = { readonly id: string; readonly tabs: readonly string[] };

export const SETTINGS_MENU_GROUPS: readonly SettingsMenuGroup[] = Object.freeze([
    // What a first conversation needs: translation, speech recognition, VRChat and the captions.
    { id: "conversation", tabs: Object.freeze(["translation", "transcription", "vrchat", "vr"]) },
    // The features that speak, change the voice or read the chatbox, and Talk AI, which listens,
    // answers by voice and can be shown the screen (#388; it is in the menu only while it is on).
    { id: "voice_and_reading", tabs: Object.freeze(["tts", "rvc", "ocr", "talk_ai"]) },
    // Set once and seldom changed. The devices are chosen at the first start (#557).
    { id: "comfort", tabs: Object.freeze(["device", "appearance", "hotkeys"]) },
    // The app itself: always in the menu, whatever the usage presets show.
    { id: "app", tabs: Object.freeze(["updater", "advanced_settings", "experimental_features", "about_vrct"]) },
]);

// Every page of the menu, in the menu's order.
export const SETTINGS_MENU_TABS: readonly string[] = Object.freeze(SETTINGS_MENU_GROUPS.flatMap(group => group.tabs));

// The page settings open on before any other was chosen: the first one in the menu.
export const FIRST_SETTINGS_TAB = SETTINGS_MENU_TABS[0];

// The groups with only the pages `isShown` keeps. A group left without a page is left out,
// so the menu never shows a heading over nothing.
export const visibleMenuGroups = (isShown: (tab: string) => boolean): SettingsMenuGroup[] =>
    SETTINGS_MENU_GROUPS
        .map(group => ({ id: group.id, tabs: group.tabs.filter(isShown) }))
        .filter(group => group.tabs.length > 0);

// Pages that exist only while an experimental feature is on (#969, decision 2): the page, and the
// feature (experimentalFeatures.ts). Off, the page is in neither the menu nor the settings.
export const FEATURE_TABS: Readonly<Record<string, string>> = Object.freeze({ talk_ai: "talk_ai" });

export const isTabAvailable = (tab: string, isFeatureOn: (id: string) => boolean): boolean => {
    const feature = FEATURE_TABS[tab];
    return feature === undefined || isFeatureOn(feature);
};
