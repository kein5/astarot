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

export const EXPERIMENTAL_FEATURES = Object.freeze([
    // Empty until a feature graduates from the experimental branch.
]);

const KNOWN_IDS = new Set(EXPERIMENTAL_FEATURES.map(feature => feature.id));

export const isExperimentalFeatureId = id => KNOWN_IDS.has(id);

// Only a listed feature the backend confirmed as true counts as on. Anything else, including
// a value that has not arrived yet, is off.
export const isExperimentalFeatureEnabled = (values, id) =>
    isExperimentalFeatureId(id) && values !== null && typeof values === "object" && values[id] === true;

export const experimentalFeatureLabelKey = id => `config_page.experimental_features.items.${id}.label`;
export const experimentalFeatureDescKey = id => `config_page.experimental_features.items.${id}.desc`;

// The request that turns one feature on or off; the backend keeps the others as they are.
export const experimentalFeatureRequest = (id, enabled) => ({ [id]: enabled === true });
