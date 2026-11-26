// Experimental features the user turns on one by one in the settings (Issue #361).
//
// A feature tried on the experimental branch comes to develop once it has passed the hands-on
// checks, and waits here until it graduates into a normal setting. Each one is off until the
// user turns it on in the "Experimental features" page, and its code runs only while it is on.
//
// The ids are also listed in src-python/models/experimental_features.py (FEATURE_IDS) and
// native/core/src/config/schema.rs (EXPERIMENTAL_FEATURE_IDS); a backend test keeps the three
// lists equal. Each entry here is { id }, and its name and description are the locale keys
// config_page.experimental_features.items.<id>.label and .desc (in en.yml and ja.yml).
//
// No hooks here: the settings page and the code a feature gates read the same helpers.

export type ExperimentalFeature = { readonly id: string };

// What the backend answers for /get/data/experimental_features: { feature_id: bool }.
export type ExperimentalFeatureValues = Readonly<Record<string, boolean>>;

export const EXPERIMENTAL_FEATURES: readonly ExperimentalFeature[] = Object.freeze([
    // The app lives in the system tray, with a small control panel and a handle beside the
    // desktop captions (src-tauri/src/companion.rs, views/companion_panel, Issue #355).
    { id: "tray_companion" },
    // Talk AI (#388, ADR-018): a spoken conversation with an external service that can be shown
    // the screen. On, settings gain its page (settingsMenu.ts, FEATURE_TABS); nothing is sent until
    // the user starts a conversation there and consents to it.
    { id: "talk_ai" },
]);

const KNOWN_IDS = new Set(EXPERIMENTAL_FEATURES.map(feature => feature.id));

export const isExperimentalFeatureId = (id: string): boolean => KNOWN_IDS.has(id);

// Only a listed feature the backend confirmed as true counts as on. Anything else, including
// a value that has not arrived yet, is off.
export const isExperimentalFeatureEnabled = (values: unknown, id: string): boolean =>
    isExperimentalFeatureId(id) && values !== null && typeof values === "object"
    && (values as Record<string, unknown>)[id] === true;

export const experimentalFeatureLabelKey = (id: string): string => `config_page.experimental_features.items.${id}.label`;
export const experimentalFeatureDescKey = (id: string): string => `config_page.experimental_features.items.${id}.desc`;
// What turning a feature on changes beyond the feature, in a sentence that stays on screen
// (#614): the tray companion makes the app start in the tray, and Talk AI adds a settings page.
const FEATURES_WITH_LEAD: readonly string[] = ["tray_companion", "talk_ai"];
export const experimentalFeatureLeadKey = (id: string): string | null =>
    FEATURES_WITH_LEAD.includes(id) ? `config_page.experimental_features.items.${id}.lead` : null;

// The request that turns one feature on or off; the backend keeps the others as they are.
export const experimentalFeatureRequest = (id: string, enabled: unknown): ExperimentalFeatureValues =>
    ({ [id]: enabled === true });
