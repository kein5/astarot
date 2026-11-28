import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule } from "../../../test/hookHarness.ts";
import { localeAt, readLocale } from "../../../test/locales.ts";
import type { LocaleBranch, LocaleTree } from "../../../test/locales.ts";
import * as languageNames from "../../../common/languageNames.ts";
import { ui_configs } from "../../../ui_configs.ts";
import { SETTINGS_MENU_TABS } from "../../settingsMenu.ts";
import { CLOUD_TRANSCRIPTION_ENGINES } from "../../cloudTranscription.ts";
import { NOT_SETTINGS, settingTarget } from "./configSearchTargets.ts";
import * as searchTargets from "./configSearchTargets.ts";
import type { ConfigSearchEntry } from "./useConfigSearch.ts";

// The settings search (useConfigSearch.ts) over the real texts (locales/en.yml and ja.yml), with
// the real language names. What it finds is checked against the texts, the settings menu
// (settingsMenu.ts) and the pages' own sources, where each result must have a place.

const locales: Record<string, LocaleBranch> = { en: readLocale("en"), ja: readLocale("ja") };
const textIn = (language: string, key: string): string | undefined => {
    const text = localeAt(locales[language], key) ?? localeAt(locales.en, key);
    return typeof text === "string" ? text : undefined;
};
// t as the page fills it: the text at the key, with {{name}} filled from the values given; a
// key without a text reads as the key.
const translations = Object.fromEntries(["en", "ja"].map(language => [language, (key: string, values?: Record<string, string>) => {
    const text = textIn(language, key);
    return text === undefined ? key : text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? "");
}]));
const tOf = (language: string) => translations[language] ?? translations.en;

interface SearchState {
    language: string;
    // The texts the search reads, by language (getResource); the real locales unless a test gives its own.
    resources: Record<string, unknown>;
    tab: string;
    ocrList: Record<string, string> | null;
    ocrLanguage: string | null;
    models: unknown;
    settings: unknown;
}

const loadSearch = async (options: Partial<SearchState> = {}) => {
    const runtime = hooks();
    const state: SearchState = { language: "en", resources: locales, tab: "device", ocrList: null, ocrLanguage: null, models: {}, settings: null, ...options };
    const opened: [string, unknown][] = [], revealed: ConfigSearchEntry[] = [];
    const module = await loadModule<typeof import("./useConfigSearch.ts")>(new URL("./useConfigSearch.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: tOf(state.language), i18n: { language: state.language } }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: state.tab },
            updateSelectedConfigTabId: (tab: string, update: unknown) => { opened.push([tab, update]); } }) },
        "@logics_configs": { useOcr: () => ({ currentSelectableOcrSourceLanguageList: { data: state.ocrList }, currentOcrSourceLanguage: { data: state.ocrLanguage } }) },
        "../../../transcription/useRealtimeASR": { useRealtimeASR: () => ({ models: state.models, settings: state.settings }) },
        "../../../common/languageNames.ts": languageNames,
        "@ui_configs": { ui_configs },
        // i18next gives the whole namespace for the key "".
        "@root/locales/config.ts": { getResource: (language: string, namespace: string, key: string) => namespace === "translation" && key === "" ? state.resources[language] : undefined },
        
        "./configSearchTargets.ts": searchTargets,
        "../../revealSetting.ts": { revealSetting: (target: ConfigSearchEntry) => { revealed.push(target); } },
    });
    const hook = () => runtime.render(module.useConfigSearch);
    const search = (query: string) => {
        hook().setQuery(query);
        return hook().results;
    };
    return { state, search, hook, opened, revealed, module };
};
type Search = Awaited<ReturnType<typeof loadSearch>>;

// --- What the pages have ---------------------------------------------------------------------

const box = "../../../../views/app/config_page/setting_section/setting_box/";
const sourcesIn = (path: string): string[] => readdirSync(new URL(path, import.meta.url)).flatMap(name => {
    const full = `${path}${name}`;
    if (statSync(new URL(full, import.meta.url)).isDirectory()) return sourcesIn(`${full}/`);
    return /\.(jsx|tsx)$/.test(name) && !name.includes(".test.") ? [readFileSync(new URL(full, import.meta.url), "utf8")] : [];
});
const pageSources = new Map<string, string>();
const pageSource = (page: string) => {
    const known = pageSources.get(page);
    if (known !== undefined) return known;
    const source = sourcesIn(`${box}${page}/`).join("\n");
    pageSources.set(page, source);
    return source;
};
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// --- What the texts hold -----------------------------------------------------------------------

const labelOf = (value: LocaleTree | undefined): string | undefined => {
    if (typeof value === "string") return value;
    if (value === undefined) return undefined;
    for (const name of ["label", "label_for_automatic", "label_for_manual"]) {
        const label = value[name];
        if (typeof label === "string" && label) return label;
    }
    return undefined;
};
const clean = (text: string) => text.replace(/\{\{[^}]+\}\}/g, "").trim();
const searchable = (text: string) => clean(text).normalize("NFKC").toLowerCase();

// The namespaces of config_page the search reads: each page of the menu that has texts of its own,
// but for the page about the app, which has no settings; and "others", whose settings moved to
// other pages.
const SEARCHED = [...SETTINGS_MENU_TABS.filter(page => page !== "about_vrct" && typeof localeAt(locales.en, `config_page.${page}`) === "object"), "others"];

// Every labelled text of a namespace that names a setting: not a placeholder or a message
// (NOT_SETTINGS), and not a section's description, which belongs to its title.
const settingTexts = (namespace: string): [key: string, label: string][] => {
    const texts = localeAt(locales.en, `config_page.${namespace}`);
    if (texts === undefined || typeof texts === "string") return [];
    return Object.entries(texts).flatMap(([key, value]): [string, string][] => {
        const label = labelOf(value);
        if (label === undefined || NOT_SETTINGS.has(`${namespace}.${key}`)) return [];
        if (/_desc$/.test(key) && typeof value === "string" && ["_title", "_label"].some(suffix => texts[key.replace(/_desc$/, suffix)] !== undefined)) return [];
        return [[key, label]];
    });
};


const labelIn = (language: string, namespace: string, key: string) => labelOf(localeAt(locales[language], `config_page.${namespace}.${key}`) ?? localeAt(locales.en, `config_page.${namespace}.${key}`));
const descIn = (language: string, namespace: string, key: string): string => {
    const value = localeAt(locales[language], `config_page.${namespace}.${key}`);
    if (value === undefined || typeof value === "string") return "";
    for (const name of ["desc", "desc_for_automatic", "desc_for_manual"]) {
        const desc = value[name];
        if (typeof desc === "string" && desc) return desc;
    }
    return "";
};
const menuName = (language: string, page: string) => textIn(language, `config_page.side_menu_labels.${page}`);
const describe = (results: readonly ConfigSearchEntry[]) => JSON.stringify(results.map(result => [result.tab, result.setting_id, result.label]));

test("every setting text of a page is found by its label, on its own page, under the menu's name for the page", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        let found = 0;
        for (const namespace of SEARCHED.filter(name => name !== "others")) {
            for (const [key] of settingTexts(namespace)) {
                const label = labelIn(language, namespace, key) ?? "";
                const id = settingTarget(namespace, key);
                const results = s.search(searchable(label));
                const result = results.find(item => item.setting_id === id && item.tab === namespace && (label.includes("{{") || item.label === clean(label)));
                assert.ok(result, `${language} ${namespace}.${key}: ${describe(results)}`);
                assert.equal(result.tab_label, menuName(language, namespace), `${namespace}.${key}`);
                assert.equal(result.prereq, null, `${namespace}.${key}`);
                const desc = descIn(language, namespace, key);
                if (desc) assert.equal(result.desc, clean(desc), `${namespace}.${key}`);
                found++;
            }
        }
        assert.ok(found > 150, `${language}: ${found}`);
    }
});

// The shared settings (shared_items/SharedItems.tsx) a page draws: each component's own setting id
// and texts, by the component's name.
const shared = readFileSync(new URL(`${box}shared_items/SharedItems.tsx`, import.meta.url), "utf8");
const sharedParts = shared.split(/^export const /m).slice(1).map(part => [part.slice(0, part.indexOf(" ")), part] as const);
const drawnOn = (page: string, id: string, textKey: string) => {
    const source = pageSource(page);
    const own = (text: string) => text.includes(`"${id}"`) || text.includes(textKey);
    return own(source) || sharedParts.some(([name, part]) => own(part) && source.includes(`<${name}`));
};

test("a setting kept under 'others' is found on the page that draws it", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        const keys = settingTexts("others");
        assert.ok(keys.length > 10);
        for (const [key] of keys) {
            const label = labelIn(language, "others", key) ?? "";
            const id = settingTarget("others", key);
            const results = s.search(searchable(label)).filter(item => item.setting_id === id && item.label === clean(label));
            assert.ok(results.length > 0, `${language} others.${key}`);
            for (const result of results) {
                assert.ok(SETTINGS_MENU_TABS.includes(result.tab), `others.${key} -> ${result.tab}`);
                assert.ok(drawnOn(result.tab, id, `config_page.others.${key}`), `others.${key} is not on ${result.tab}`);
                assert.equal(result.tab_label, menuName(language, result.tab));
            }
        }
    }
});

test("a label that names another text is filled as the page fills it, and found by those words", async () => {
    const filled: [string, string[]][] = [
        ["toggle_translation", ["main_page.translation"]],
        ["toggle_transcription_send", ["main_page.transcription_send"]],
        ["toggle_transcription_receive", ["main_page.transcription_receive"]],
        ["toggle_voice_switch", ["main_page.tts", "main_page.rvc"]],
    ];
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        for (const [key, names] of filled) {
            const words = names.map(name => tOf(language)(name));
            const expected = clean(tOf(language)(`config_page.hotkeys.${key}.label`, key === "toggle_voice_switch"
                ? { name: words.join(" / ") } : { [names[0].replace("main_page.", "")]: words[0] }));
            assert.ok(words.every(word => expected.includes(word)), `${language} ${expected}`);
            const results = s.search(searchable(expected)).filter(result => result.tab === "hotkeys" && result.setting_id === settingTarget("hotkeys", key));
            assert.deepEqual(results.map(result => result.label), [expected], `${language} hotkeys.${key}`);
        }
    }
});

test("a section's description is its title's, and finds the title rather than a result of its own", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        const desc = textIn(language, "config_page.ocr.section_desc") ?? "";
        const results = s.search(searchable(desc));
        assert.ok(results.some(result => result.setting_id === "section_title" && result.desc === clean(desc)), describe(results));
        assert.ok(!results.some(result => result.setting_id === "section_desc"), describe(results));
    }
});

// Every text of a group of texts, in order.
const stringsOf = (value: LocaleTree | undefined): string[] => value === undefined ? []
    : typeof value === "string" ? [value] : Object.values(value).flatMap(stringsOf);
// Settings whose search adds more than their texts: language names, a section's description, or
// the texts a label names.
const ADDED = new Set(["ocr.source_language", "appearance.ui_language", "ocr.section_title", "hotkeys.toggle_translation",
    "hotkeys.toggle_transcription_send", "hotkeys.toggle_transcription_receive", "hotkeys.toggle_voice_switch"]);

test("a setting is searched by all its texts: in English once, in Japanese with the English ones after them", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        let checked = 0;
        for (const namespace of SEARCHED) {
            for (const [key] of settingTexts(namespace)) {
                if (ADDED.has(`${namespace}.${key}`)) continue;
                const label = labelIn(language, namespace, key) ?? "";
                const result = s.search(searchable(label)).find(item => item.setting_id === settingTarget(namespace, key) && item.label === clean(label));
                assert.ok(result, `${language} ${namespace}.${key}`);
                const own = stringsOf(localeAt(locales[language], `config_page.${namespace}.${key}`));
                const english = language === "en" ? [] : stringsOf(localeAt(locales.en, `config_page.${namespace}.${key}`));
                assert.deepEqual(result.searchTarget, [...own, ...english].map(searchable).filter(Boolean), `${language} ${namespace}.${key}`);
                checked++;
            }
        }
        assert.ok(checked > 150, `${language}: ${checked}`);
    }
    const sectionDesc = (language: string) => textIn(language, "config_page.ocr.section_desc") ?? "";
    const title = (language: string) => textIn(language, "config_page.ocr.section_title") ?? "";
    const en = await loadSearch({ language: "en" });
    assert.deepEqual(en.search(searchable(title("en"))).find(item => item.setting_id === "section_title")?.searchTarget,
        [title("en"), sectionDesc("en")].map(searchable));
    const ja = await loadSearch({ language: "ja" });
    assert.deepEqual(ja.search(searchable(title("ja"))).find(item => item.setting_id === "section_title")?.searchTarget,
        [title("ja"), title("en"), sectionDesc("ja"), sectionDesc("en")].map(searchable));
});

test("the OCR source language is found by the names of the languages it offers and the one chosen", async () => {
    const ocrResults = (s: Search, query: string) => s.search(query).filter(result => result.setting_id === "ocr_source_language").map(result => result.tab);
    const s = await loadSearch({ language: "ja", ocrList: { Korean: "Korean", German: "German" }, ocrLanguage: "French" });
    for (const query of ["韓国語", "korean", "ドイツ語", "french", "フランス語"]) assert.deepEqual(ocrResults(s, query), ["ocr"], query);
    assert.deepEqual(s.search("韓国語").filter(result => result.tab === "ocr").map(result => result.setting_id), ["ocr_source_language"],
        "the other OCR settings are not found by language names");
    const unknown = await loadSearch({ language: "ja", ocrList: {}, ocrLanguage: null });
    const target = unknown.search(searchable(labelIn("ja", "ocr", "source_language") ?? "")).find(result => result.setting_id === "ocr_source_language");
    assert.deepEqual(target?.searchTarget, stringsOf(localeAt(locales.ja, "config_page.ocr.source_language")).concat(stringsOf(localeAt(locales.en, "config_page.ocr.source_language")))
        .map(searchable).filter(Boolean), "a language not yet known adds nothing");
    const none = await loadSearch({ language: "ja" });
    assert.deepEqual(ocrResults(none, "韓国語"), []);
    none.state.ocrList = { Korean: "Korean" };
    assert.deepEqual(ocrResults(none, "韓国語"), ["ocr"], "the list that arrives later is searched");
});

test("the display language is found by each language's own name, its name in the UI's language and in English", async () => {
    const found = (s: Search, query: string) => s.search(query).some(result => result.tab === "appearance" && result.setting_id === "ui_language");
    const ja = await loadSearch({ language: "ja" });
    for (const query of ["english", "英語", "日本語", "japanese"]) assert.ok(found(ja, query), query);
    const en = await loadSearch({ language: "en" });
    for (const query of ["日本語", "japanese"]) assert.ok(found(en, query), query);
});

test("the voice input is found on the RVC page by its words", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        const t = tOf(language);
        for (const key of ["voice.input_title", "voice.input_source", "voice.input_start"]) {
            const results = s.search(searchable(t(key))).filter(result => result.setting_id === "direct_voice_settings");
            assert.deepEqual(results.map(result => [result.tab, result.label, result.desc, result.tab_label, result.prereq]),
                [["rvc", t("voice.input_title"), t("voice.input_description"), menuName(language, "rvc"), null]], `${language} ${key}`);
        }
    }
});

// #1308 ★1, N-13: each input's speech recognition model is found by its fields' names, in both
// languages, where the fields are (「聞き取りのモデル」 found nothing before).
test("each input's speech recognition model is found by its fields' names", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language, models: { models: [] }, settings: null });
        const t = tOf(language);
        for (const query of [t("source_models.mic"), t("realtime.listening_model"), t("source_models.title")]) {
            assert.deepEqual(s.search(searchable(query)).filter(result => result.setting_id === "source_models")
                .map(result => [result.tab, result.label, result.desc, result.tab_label]),
                [["transcription", t("source_models.title"), t("source_models.help"), menuName(language, "transcription")]], `${language} ${query}`);
        }
    }
});

test("the real-time recognition is found by its words and by the languages its models and sources use", async () => {
    const models = { models: [{ languages: ["ko"] }, { languages: ["de", ""] }, { name: "no languages" }, null] };
    const settings = { mic: { language: "auto" }, speaker: { language: "fr" } };
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language, models, settings });
        const t = tOf(language);
        const realtime = (query: string) => s.search(query).filter(result => result.setting_id === "realtime_asr");
        for (const query of [t("realtime.title"), t("realtime.mic_language"), t("realtime.speaker_language"), t("realtime.auto_language"),
            "auto", "ko", "korean", "german", "french", "fr"]) {
            assert.deepEqual(realtime(searchable(query)).map(result => [result.tab, result.label, result.desc, result.tab_label, result.prereq]),
                [["transcription", t("realtime.title"), t("realtime.auto_help"), menuName(language, "transcription"), null]], `${language} ${query}`);
        }
    }
    const ja = await loadSearch({ language: "ja", models, settings });
    for (const query of ["韓国語", "ドイツ語", "フランス語"]) assert.equal(ja.search(query).filter(result => result.setting_id === "realtime_asr").length, 1, query);
    const [entry] = ja.search("auto").filter(result => result.setting_id === "realtime_asr");
    assert.ok(entry?.searchTarget.includes("auto"), "auto is searched as it is written");
    assert.ok(entry?.searchTarget.every(text => text !== ""), JSON.stringify(entry?.searchTarget));
    assert.deepEqual(ja.search("stryker was here"), [], "a model without languages adds none");
    const none = await loadSearch({ language: "en", models: { models: [] }, settings: null });
    assert.deepEqual(none.search("korean").filter(result => result.setting_id === "realtime_asr"), []);
    none.state.models = models;
    assert.equal(none.search("korean").filter(result => result.setting_id === "realtime_asr").length, 1, "models that arrive later are searched");
});

test("each experimental feature is found, and a feature's own setting is found under its feature", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        const items = localeAt(locales[language], "config_page.experimental_features.items");
        assert.ok(items !== undefined && typeof items !== "string");
        for (const [id, texts] of Object.entries(items)) {
            const label = labelOf(texts) ?? "";
            const desc = typeof texts === "object" && typeof texts.desc === "string" ? texts.desc : "";
            const results = s.search(searchable(label)).filter(result => result.setting_id === `experimental_features.${id}`);
            assert.deepEqual(results.map(result => [result.tab, result.label, result.desc, result.tab_label, result.prereq]),
                [["experimental_features", clean(label), clean(desc), menuName(language, "experimental_features"), null]], `${language} ${id}`);
            if (desc) assert.ok(s.search(searchable(desc).slice(0, 30)).some(result => result.setting_id === `experimental_features.${id}`), `${id} by its description`);
        }
    }
});

test("a query is trimmed, folded and read without case, and a query of nothing finds nothing", async () => {
    const s = await loadSearch();
    const plain = s.search("osc").map(result => result.setting_id);
    assert.ok(plain.length > 0);
    assert.deepEqual(s.search("  ＯＳＣ ").map(result => result.setting_id), plain);
    for (const query of ["", "   ", "stryker was here"]) assert.deepEqual(s.search(query), [], JSON.stringify(query));
    assert.ok(s.search("o").length > 50, "one letter is a query");
    const fresh = await loadSearch();
    assert.deepEqual([fresh.hook().query, fresh.hook().results], ["", []], "the search starts empty");
    s.hook().setQuery("osc");
    s.hook().clearQuery();
    assert.deepEqual([s.hook().query, s.hook().results], ["", []]);
});

test("choosing a result on another page opens the page and shows the setting; on the same page it shows it at once", async () => {
    // Every setting saves by itself (#1111): nothing waits to ask before the page changes.
    const s = await loadSearch({ tab: "device" });
    const [elsewhere] = s.search("osc").filter(result => result.tab === "advanced_settings");
    assert.ok(elsewhere);
    s.hook().navigateToSetting(elsewhere);
    assert.deepEqual(s.opened.map(([tab]) => tab), ["advanced_settings"]);
    assert.deepEqual(s.revealed, [elsewhere]);
    assert.equal(s.hook().query, "");
    const [here] = s.search("microphone").filter(result => result.tab === "device");
    assert.ok(here);
    s.hook().navigateToSetting(here);
    assert.deepEqual([s.opened.length, s.revealed], [1, [elsewhere, here]]);
    assert.equal(s.hook().query, "");
    s.state.tab = "advanced_settings";
    s.hook().navigateToSetting(elsewhere);
    assert.deepEqual([s.opened.length, s.revealed.length], [1, 3], "the page now open is known");
});

test("the results follow a change of the display language", async () => {
    const s = await loadSearch({ language: "en" });
    const japanese = labelIn("ja", "device", "mic_host_device") ?? "";
    assert.deepEqual(s.search(searchable(japanese)), []);
    s.state.language = "ja";
    assert.ok(s.search(searchable(japanese)).some(result => result.setting_id === "mic_host_device"));
});

// Texts of the test's own, for the rules the real texts happen not to use: config_page.<namespace>
// in each language.
const ownTexts = (ja: Record<string, unknown>, en: Record<string, unknown> = ja) => ({
    en: { config_page: { ...en, side_menu_labels: { device: "Device", hotkeys: "Hotkeys", experimental_features: "Labs" } } },
    ja: { config_page: { ...ja, side_menu_labels: { device: "デバイス", hotkeys: "ホットキー", experimental_features: "試験" } } },
});
const findIn = (s: Search, query: string) => s.search(query).map(result => [result.setting_id, result.label, result.desc]);

test("a text in one language only is found by it, with its label and description taken from either", async () => {
    const s = await loadSearch({ language: "ja", resources: ownTexts(
        { device: { only_ja: { label: "日本語だけ" }, both: { label: "両方", desc: "" }, template: { label: "  {{name}} 名前  " } } },
        { device: { only_en: { label: "English only", desc_for_manual: "By hand" }, plain_en: "Plain English", both: { label: "Both", desc: "Described" } } }) });
    assert.deepEqual(findIn(s, "日本語だけ"), [["only_ja", "日本語だけ", ""]]);
    assert.deepEqual(findIn(s, "english only"), [["only_en", "English only", "By hand"]]);
    assert.deepEqual(findIn(s, "plain english"), [["plain_en", "Plain English", ""]]);
    assert.deepEqual(findIn(s, "both"), [["both", "両方", "Described"]], "the description falls back to English");
    assert.deepEqual(findIn(s, "名前"), [["template", "名前", ""]], "a label's template is taken out and the rest trimmed");
    assert.deepEqual(findIn(s, "name"), [], "the template's name is not searched");
});

test("a text's label is its label, else its automatic or manual label, else the text itself", async () => {
    const s = await loadSearch({ resources: ownTexts({ device: {
        sensitivity: { label_for_automatic: "Automatic", label_for_manual: "Manual", desc_for_automatic: "Picks itself" },
        manual: { label_for_manual: "By hand only", desc_for_manual: "Set by hand" },
        plain: "Plain text",
        unlabelled: { desc: "No label here" },
        nested: { label: { text: "Nested label" } },
        counted: { label: "Counted", desc: "{{count}}" },
    } }) });
    assert.deepEqual(findIn(s, "automatic"), [["sensitivity", "Automatic", "Picks itself"]]);
    assert.deepEqual(findIn(s, "manual"), [["sensitivity", "Automatic", "Picks itself"]]);
    assert.deepEqual(findIn(s, "by hand only"), [["manual", "By hand only", "Set by hand"]]);
    assert.deepEqual(findIn(s, "plain"), [["plain", "Plain text", ""]]);
    assert.deepEqual(findIn(s, "no label"), [], "a group of texts without a label is not a setting");
    assert.deepEqual(findIn(s, "nested label"), [["nested", "", ""]], "a label that is not a text shows as nothing");
    assert.deepEqual(s.search("counted").map(result => result.searchTarget), [["counted"]], "a text that is only a template is not searched");
});

test("a description named like a title belongs to that title in either language, and only to a title ending in _title or _label", async () => {
    const page = (english: boolean) => ({ device: {
        osc_label: "OSC", ...(english ? { osc_desc: "Where messages go" } : {}),
        ...(english ? { more_title: "More" } : {}), more_desc: english ? "More settings" : "その他の設定",
        thing_title: "Thing", thing_desc: { label: "Thing's own setting" },
        old_desc_note_title: "Old note", old_desc_note_desc: "About the old note",
        section_label_more: "More section", section_desc_more: "Words of the section",
    } });
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language, resources: ownTexts(page(false), page(true)) });
        assert.deepEqual(findIn(s, "osc"), [["osc_label", "OSC", "Where messages go"]], language);
        assert.deepEqual(findIn(s, "where messages go"), [["osc_label", "OSC", "Where messages go"]], language);
        assert.deepEqual(findIn(s, language === "ja" ? "その他の設定" : "more settings").map(([id]) => id), ["more_title"], `${language}: a title in English only`);
        assert.deepEqual(findIn(s, "thing's own"), [["thing_desc", "Thing's own setting", ""]], `${language}: a group of texts named _desc is a setting`);
        assert.deepEqual(findIn(s, "about the old note"), [["old_desc_note_title", "Old note", "About the old note"]], language);
        assert.deepEqual(findIn(s, "words of the section"), [["section_desc_more", "Words of the section", ""]], `${language}: section_label_ is not a title ending`);
    }
});

test("a label names other texts only where it is a group of texts, also when only English has it", async () => {
    const own = await loadSearch({ resources: ownTexts({ hotkeys: { toggle_translation: "Plain toggle" } }) });
    assert.deepEqual(findIn(own, "plain toggle"), [["toggle_translation", "Plain toggle", ""]]);
    const english = await loadSearch({ language: "ja", resources: ownTexts({ hotkeys: {} }, { hotkeys: { toggle_translation: { label: "Toggle {{translation}}" } } }) });
    const filled = clean(tOf("ja")("config_page.hotkeys.toggle_translation.label", { translation: tOf("ja")("main_page.translation") }));
    assert.deepEqual(findIn(english, searchable(filled)), [["toggle_translation", filled, ""]]);
});

test("an experimental feature without a description is found by its label alone", async () => {
    const s = await loadSearch({ resources: ownTexts({ experimental_features: { items: { bare: { label: "Bare feature" }, other: { label: "Other", desc: "Other words" } } } }) });
    const [bare] = s.search("bare feature");
    assert.deepEqual([bare?.setting_id, bare?.desc, bare?.searchTarget], ["experimental_features.bare", "", ["bare feature"]]);
});

// Texts under a page that are not settings: a field's placeholder or error, an option of a choice,
// the words of a button or row that leads elsewhere, a page's notice. Found, they would lead nowhere.
const NOT_RESULTS = ["hotkeys.input_placeholder", "hotkeys.unassigned_placeholder", "hotkeys.disabled_notice", "hotkeys.error_in_use",
    "hotkeys.error_failed_to_register_at_launch", "hotkeys.error_failed_to_register_all", "hotkeys.error_window_restore_failed",
    "hotkeys.error_window_minimize_failed", "vr.hmd", "vr.left_hand", "vr.right_hand", "device.none_found", "vrchat.tts_output_action", "device.mute_sync_action",
    "vrchat.tts_output_pointer", "device.mute_sync_pointer", "experimental_features.notice", "experimental_features.empty",
    "translation.setup_downloaded", "translation.setup_not_downloaded", "translation.setup_unavailable", "translation.provider_in_use",
    "translation.provider_ready", "translation.provider_not_set", "transcription.timing_status", "translation.download_unavailable",
    "translation.models_unavailable", "translation.llm_privacy_lead", "translation.llm_privacy_desc", "device.desc_vad_unavailable",
    "device.check_volume", "device.label_auto_select", "device.label_host", "device.label_device"];

test("texts that are not settings are not results", async () => {
    for (const language of ["en", "ja"]) {
        const s = await loadSearch({ language });
        for (const name of NOT_RESULTS) {
            const [namespace, key] = name.split(".");
            const text = labelOf(localeAt(locales[language], `config_page.${name}`));
            assert.ok(text, name);
            assert.deepEqual(s.search(searchable(text)).filter(result => result.setting_id === key || result.label === clean(text)).map(result => result.setting_id), [], `${language} ${name}`);
            assert.ok(NOT_SETTINGS.has(`${namespace}.${key}`), name);
        }
    }
});

// The pages that mark every setting with its own id, so a result there leads to an element marked
// with the result's id: the VR page draws the overlay's position, rotation, size and timing inside
// the overlay's editor (vr_overlay), and the OCR source language under its own id.
const marked = (page: string, id: string) => new RegExp(`(data-setting-id|setting_id|hotkey_id|dropdown_id)(=|:\\s*)\\{?["']${escapeRegExp(id)}["']`).test(pageSource(page));

test("a result on the VR or OCR page leads to an element the page marks with the result's id", async () => {
    const s = await loadSearch();
    for (const page of ["vr", "ocr"]) {
        const keys = settingTexts(page);
        let checked = 0;
        for (const [key, label] of keys) {
            for (const result of s.search(searchable(label)).filter(item => item.tab === page && item.label === clean(label))) {
                if (!result.setting_id.startsWith("section_label") && !marked(page, result.setting_id) && !result.setting_id.endsWith("_pointer")) {
                    assert.ok(pageSource(page).includes(`config_page.${page}.${key}.label`) || pageSource(page).includes(`config_page.${page}.${key}"`), `${page}.${key} -> ${result.setting_id}`);
                }
                checked++;
            }
        }
        assert.ok(checked > 10, page);
    }
    for (const key of ["single_line", "multi_lines", "position", "rotation", "x_position", "y_position", "z_position", "x_rotation", "y_rotation", "z_rotation",
        "opacity", "ui_scaling", "display_duration", "fadeout_duration"]) {
        assert.ok(!marked("vr", key), `the VR page has no element of its own for ${key}`);
        const label = labelIn("en", "vr", key) ?? "";
        assert.ok(s.search(searchable(label)).some(result => result.tab === "vr" && result.label === clean(label) && marked("vr", result.setting_id)), `vr.${key}`);
    }
    assert.ok(marked("ocr", "ocr_source_language"));
});

// --- Where each result leads ---------------------------------------------------------------------

// The files a page draws: its own folder and the files of setting_box they import, but for the
// shared templates and parts, whose rows take their ids and labels from the page.
const boxUrl = new URL(box, import.meta.url);
const filesIn = (url: URL): URL[] => readdirSync(url).flatMap(name => {
    const file = new URL(name, url);
    if (statSync(file).isDirectory()) return filesIn(new URL(`${name}/`, url));
    return /\.(tsx|ts)$/.test(name) && !/\.(test|css)\./.test(name) ? [file] : [];
});
const importsOf = (file: URL): URL[] => [...readFileSync(file, "utf8").matchAll(/from\s+["'](\.[^"']+)["']/g)].flatMap(([, spec]) => {
    const base = new URL(spec, file).href;
    const found = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.ts`].find(candidate => {
        try { return statSync(new URL(candidate)).isFile(); } catch { return false; }
    });
    return found?.startsWith(boxUrl.href) && !/\/(_templates|_components)\//.test(found) ? [new URL(found)] : [];
});
const drawn = new Map<string, URL[]>();
const pageFiles = (page: string): URL[] => {
    const known = drawn.get(page);
    if (known) return known;
    const seen = new Map<string, URL>(), todo = filesIn(new URL(`${page}/`, boxUrl));
    for (let file = todo.pop(); file; file = todo.pop()) {
        if (seen.has(file.href)) continue;
        seen.set(file.href, file);
        todo.push(...importsOf(file));
    }
    drawn.set(page, [...seen.values()]);
    return [...seen.values()];
};
const drawnSource = (page: string) => pageFiles(page).map(file => readFileSync(file, "utf8")).join("\n");
const boxFile = (path: string) => readFileSync(new URL(path, boxUrl), "utf8");

// An element the page marks with the id, as revealSetting.ts looks for it: data-setting-id, or a
// template's setting_id and the ids it falls back to.
const markedById = (source: string, id: string) =>
    new RegExp(`(data-setting-id|setting_id|dropdown_id|hotkey_id|\\bname|\\bid|target)\\s*[=:]\\s*\\{?\\s*["'\`]${escapeRegExp(id)}["'\`]`).test(source);
// A row labelled with the text: a template, form row or section heading given a text whose words
// are the result's label (the row's data-setting-label), or a setup fold given it as its title
// (SetupSection writes its title on the fold's line).
const labelledWith = (source: string, label: string) =>
    [...source.matchAll(/(?<![A-Za-z_])label\s*[=:]\s*\{?\s*t\(\s*["'`]([\w.]+)["'`]/g),
        ...source.matchAll(/<SetupSection\s+title=\{t\(\s*["'`]([\w.]+)["'`]/g)]
        .some(([, key]) => { const text = textIn("en", key); return text !== undefined && clean(text) === label; });

// Destinations the page builds in code: the lines that build each, by the result's id. The first
// file is one the page draws.
type Built = [file: string, lines: string[]][];
const CREDENTIALS: [string, string[]] = ["_components/credential_pair/CredentialPair.tsx",
    [`const label = (field: string) => t(\`config_page.\${section}.\${provider}_\${field}.label\`);`, "label: label(name)"]];
const ENGINE_ROWS = "transcription/Transcription.tsx";
const BUILT_IN_CODE: Readonly<Record<string, Built>> = {
    retired_models_folder: [["translation/Translation.tsx",
        [`\`config_page.translation.retired_models_folder.\${name}\``, "<FormRow group label={t(key(\"label\"))}"]]],
    ...Object.fromEntries(["url", "auth_key"].map(field => [`openai_compatible_${field}`,
        [["translation/Translation.tsx", ['provider="openai_compatible" section="translation"']], CREDENTIALS]])),
    rvc_settings: [["rvc/Rvc.tsx", ['<DirectVoiceSettings variant="rvc" monitor={false} />']],
        ["advanced_settings/DirectVoiceSettings.tsx", ['data-setting-id={variant === "rvc" ? "rvc_settings" : "direct_voice_settings"}']]],
    ...Object.fromEntries(["stop_voice", "toggle_voice_mute"].map(id => [id,
        [["hotkeys/Hotkeys.tsx", [`["${id}", t("config_page.hotkeys.${id}.label")]`, "hotkey_id={hotkey_id}"]]]])),
    toggle_tts: [["hotkeys/Hotkeys.tsx", ['{[["toggle_tts", "main_page.tts"], ["toggle_rvc", "main_page.rvc"]].map(([hotkey_id, name]) =>', "hotkey_id={hotkey_id}"]]],
    ...Object.fromEntries(["cert_file", "key_file"].map(name => [`websocket_tls_${name}`,
        [["advanced_settings/AdvancedSettings.tsx", [`setting_id: \`websocket_tls_\${name}\``, `{...field("${name}")}`]]]])),
    ...Object.fromEntries(CLOUD_TRANSCRIPTION_ENGINES.flatMap(engine => [
        [`select_${engine.key}_model`, [[ENGINE_ROWS, [`dropdown_id={\`select_\${engine.key}_model\`}`]]]],
        ...(engine.has_url
            ? ["url", "auth_key"].map(field => [`${engine.key}_${field}`,
                [[ENGINE_ROWS, ["<CredentialPair settings={transcription} base={engine.base} provider={engine.key} section=\"transcription\" />"]], CREDENTIALS]])
            : [[`${engine.key}_auth_key`, [[ENGINE_ROWS, [`const label = t(\`config_page.transcription.\${engine.key}_auth_key.label\`);`, "<AuthKeyContainer", "label={label}"]]]]]),
    ])),
};

test("every settings search result leads to an element its page marks with the result's id or labels with its text", async () => {
    const s = await loadSearch();
    let checked = 0;
    for (const namespace of SEARCHED) {
        for (const [key, label] of settingTexts(namespace)) {
            const name = `${namespace}.${key}`, id = settingTarget(namespace, key);
            for (const result of s.search(searchable(label)).filter(item => item.setting_id === id && (label.includes("{{") || item.label === clean(label)))) {
                checked++;
                const source = drawnSource(result.tab);
                if (markedById(source, id) || labelledWith(source, result.label)) continue;
                const built = BUILT_IN_CODE[id];
                if (built) {
                    assert.ok(pageFiles(result.tab).some(file => file.href.endsWith(built[0][0])), `${name}: ${result.tab} does not draw ${built[0][0]}`);
                    for (const [file, lines] of built) for (const line of lines) assert.ok(boxFile(file).includes(line), `${name}: ${file} no longer has ${line}`);
                    continue;
                }
                assert.fail(`${name} leads nowhere on ${result.tab}`);
            }
        }
    }
    assert.ok(checked > 150, String(checked));
});
