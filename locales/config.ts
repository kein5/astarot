import yaml from "js-yaml";
import i18n from "i18next";
import type { ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";

import en_yml from "./en.yml?raw";
import ja_yml from "./ja.yml?raw";

// A locale file is a mapping of keys to text (tools/i18n_gate reads both). i18next takes a text or
// a mapping; anything else in a locale file stops the start here, with the file's name.
const translationOf = (name: string, text: string): ResourceKey => {
    const translation: unknown = yaml.load(text);
    if (typeof translation === "string" || (typeof translation === "object" && translation !== null)) return translation;
    throw new TypeError(`locales/${name} holds no translations`);
};

const translation_en = translationOf("en.yml", en_yml);
const translation_ja = translationOf("ja.yml", ja_yml);


const resources = {
    en: { translation: translation_en },
    ja: { translation: translation_ja },
};

// The saved display language arrives with the engine's settings. Until then the
// main page is drawn in the system's language when it is one of ours, so that
// for most people the text does not change (and move) when the settings arrive.
const systemLanguage = () => {
    const language = typeof navigator !== "undefined" ? String(navigator.language || "") : "";
    return /^ja(-|$)/i.test(language) ? "ja" : "en";
};

i18n
    .use(initReactI18next) // passes i18n down to react-i18next
    .init({
        resources,
        lng: systemLanguage(),
        fallbackLng: "en",
        // debug: true,
        interpolation: {
        escapeValue: false, // react already safes from xss
    },
});

// The page language follows the UI, so screen readers pick the right voice and
// shared CJK characters draw in the language's own forms.
i18n.on("languageChanged", (lng) => {
    if (typeof document !== "undefined") document.documentElement.lang = lng;
});

export default i18n;
