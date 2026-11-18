import { useState, useMemo, useCallback } from "react";
import { useI18n } from "@useI18n";
import { useStore_SelectedConfigTabId } from "@store";
import { useOcr } from "@logics_configs";
import { useRealtimeASR } from "../../../transcription/useRealtimeASR";
import { createLanguageNames } from "../../../common/languageNames.ts";
import { ui_configs } from "@ui_configs";
import i18n from "@root/locales/config.js";
import { requestSettingsNavigation } from "../../../voice/settingsNavigation";
import { NOT_SETTINGS, settingTarget } from "./configSearchTargets.ts";
import { revealSetting } from "../../revealSetting.ts";
import type { SettingTarget } from "../../revealSetting.ts";

// The locale texts (en.yml, ja.yml), read as they are: a text or a group of texts.
type Texts = { readonly [key: string]: unknown };
const isTexts = (value: unknown): value is Texts => typeof value === "object" && value !== null;
const textsOf = (value: unknown): Texts => isTexts(value) ? value : {};
const isText = (value: unknown): value is string => typeof value === "string";

// A setting shown only under another one (SettingTarget.prereq).
interface Prerequisite {
    parent_id: string;
    required_label?: string;
}

// One result of the settings search.
export interface ConfigSearchEntry extends SettingTarget {
    tab: string;
    label: string;
    desc: string;
    tab_label: string;
    searchTarget: string[];
    prereq: Prerequisite | null;
}

// 検索の元にする config_page 以下の文言の名前空間
const VALID_TABS = [
    "device",
    "appearance",
    "translation",
    "transcription",
    "vrchat",
    "ocr",
    "vr",
    "hotkeys",
    "tts", "rvc",
    "advanced_settings",
    "experimental_features",
    "others",
];

// 名前空間と実際のページが違うもの。旧「その他」の項目は VRChat ページにある。
// チャット読み取りの項目は、同じ名前のページにだけある。
const NAMESPACE_TABS: Readonly<Record<string, string[]>> = {
    others: ["vrchat"],
};

// 名前空間の既定と違うページに置いた項目。複数のページに置いた項目は、
// 検索結果にもページごとに出す。
const SETTING_TABS: Readonly<Record<string, string[]>> = {
    "others.auto_clear_the_message_box": ["appearance"],
    "others.auto_export_message_logs": ["advanced_settings"],
    // On the VRChat page; the Device page has a row that leads there (#554, IA-03).
    "others.vrc_mic_mute_sync": ["vrchat"],
    "others.section_label_reading_aids": ["appearance"],
    "others.common_convert_message_hiragana_romaji": ["appearance"],
    "others.convert_message_to_romaji": ["appearance"],
    "others.convert_message_to_hiragana": ["appearance"],
};

export const settingTabs = (namespace: string, key: string): string[] =>
    SETTING_TABS[`${namespace}.${key}`] ?? NAMESPACE_TABS[namespace] ?? [namespace];

// Labels that name another text, filled in as the page fills them.
const labelValues = (t: (key: string) => string): Readonly<Record<string, Record<string, string>>> => ({
    "hotkeys.toggle_translation": { translation: t("main_page.translation") },
    "hotkeys.toggle_transcription_send": { transcription_send: t("main_page.transcription_send") },
    "hotkeys.toggle_transcription_receive": { transcription_receive: t("main_page.transcription_receive") },
    "hotkeys.toggle_voice_switch": { name: `${t("main_page.tts")} / ${t("main_page.rvc")}` },
});

const TAB_LABEL_KEYS: Readonly<Record<string, string>> = {
    vrchat: "config_page.side_menu_labels.vrchat",
    ocr: "config_page.side_menu_labels.ocr",
    device: "config_page.side_menu_labels.device",
    appearance: "config_page.side_menu_labels.appearance",
    translation: "config_page.side_menu_labels.translation",
    transcription: "config_page.side_menu_labels.transcription",
    vr: "config_page.side_menu_labels.vr",
    hotkeys: "config_page.side_menu_labels.hotkeys",
    tts: "config_page.side_menu_labels.tts",
    rvc: "config_page.side_menu_labels.rvc",
    advanced_settings: "config_page.side_menu_labels.advanced_settings",
    experimental_features: "config_page.side_menu_labels.experimental_features",
};

// 親項目（前提条件）の依存関係。{ 項目: { parent_id, required_label } }。
// 今はない（Whisper のモデルと処理デバイスの項目は #288 で削除した）。
const PREREQUISITES: Readonly<Record<string, Prerequisite>> = {};

// オブジェクト内のすべての文字列値を再帰的に収集
const collectStrings = (obj: unknown): string[] => {
    const list: string[] = [];
    if (!obj) return list;
    if (typeof obj === "string") {
        list.push(obj);
        return list;
    }
    if (typeof obj === "object") {
        for (const val of Object.values(obj)) {
            list.push(...collectStrings(val));
        }
    }
    return list;
};

// 文字列内の {{variable}} などのテンプレート変数を整理
const cleanTemplateStr = (str: unknown): string => {
    return typeof str === "string" ? str.replace(/\{\{[^}]+\}\}/g, "").trim() : "";
};

// The texts of one locale under config_page. i18next's types ask for a key; with none ("")
// getResource returns the whole namespace, as with no key at all.
const configPageTexts = (language: string): Texts => textsOf(textsOf(i18n.getResource(language, "translation", "")).config_page);

export const useConfigSearch = () => {
    const { t, i18n: i18nHook } = useI18n();
    const { currentSelectedConfigTabId, updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { currentSelectableOcrSourceLanguageList, currentOcrSourceLanguage } = useOcr();
    const { models, settings } = useRealtimeASR();
    const [query, setQuery] = useState("");

    // config_page 以下のリソースから動的に検索インデックスを生成
    const allEntries = useMemo(() => {
        const currentLng = i18nHook.language;
        const curRes = configPageTexts(currentLng);
        const enRes = configPageTexts("en");
        const isEn = currentLng === "en";

        const names = createLanguageNames(currentLng);
        const english = createLanguageNames("en");
        const values = labelValues(t);
        const entries: ConfigSearchEntry[] = [];

        for (const tab of VALID_TABS) {
            const curTab = textsOf(curRes[tab]);
            const enTab = textsOf(enRes[tab]);
            const allKeys = new Set([...Object.keys(curTab), ...Object.keys(enTab)]);

            for (const key of allKeys) {
                const curVal = curTab[key];
                const enVal = enTab[key];

                if (!curVal && !enVal) continue;
                if (NOT_SETTINGS.has(`${tab}.${key}`)) continue;
                // A group of texts with no label of its own (status messages, model
                // notes) is not a setting; listing it would show its raw key.
                const labelled = (v: unknown) => typeof v === "string" || (isTexts(v) && (v.label || v.label_for_automatic || v.label_for_manual));
                if (!labelled(curVal) && !labelled(enVal)) continue;
                // A section's description string belongs to its title (section_desc
                // → section_title); on its own it would be listed under its full text.
                const descKey = key.replace(/_(title|label)$/, "_desc");
                if (/_desc$/.test(key) && typeof (curVal ?? enVal) === "string" && ["_title", "_label"].some(suffix => { const title = key.replace(/_desc$/, suffix); return curTab[title] || enTab[title]; })) continue;
                const sectionDesc = descKey !== key && typeof (curTab[descKey] ?? enTab[descKey]) === "string" ? { cur: curTab[descKey], en: enTab[descKey] } : null;

                // label の抽出（currentLng → en フォールバック）。ほかの文言を名前に含むものは、ページと同じ値で埋める
                const labelValuesOf = values[`${tab}.${key}`];
                const filled = labelValuesOf && typeof (curVal ?? enVal) === "object"
                    ? t(`config_page.${tab}.${key}.label`, labelValuesOf) : null;
                const rawLabel = filled ?? (isTexts(curVal) ? (curVal.label || curVal.label_for_automatic || curVal.label_for_manual) : null)
                    ?? (isTexts(enVal) ? (enVal.label || enVal.label_for_automatic || enVal.label_for_manual) : null)
                    ?? (typeof curVal === "string" ? curVal : (typeof enVal === "string" ? enVal : key));

                // desc の抽出
                const rawDesc = (isTexts(curVal) ? (curVal.desc || curVal.desc_for_automatic || curVal.desc_for_manual) : null)
                    ?? (isTexts(enVal) ? (enVal.desc || enVal.desc_for_automatic || enVal.desc_for_manual) : null)
                    ?? sectionDesc?.cur ?? sectionDesc?.en
                    ?? "";

                // 検索対象テキストの収集（現在言語 + en の両方を包含）
                const searchStrings: unknown[] = [];
                if (curVal) {
                    searchStrings.push(...collectStrings(curVal));
                }
                if (!isEn && enVal) {
                    searchStrings.push(...collectStrings(enVal));
                }
                if (sectionDesc) searchStrings.push(...[sectionDesc.cur, isEn ? null : sectionDesc.en].filter(Boolean));
                if (filled) searchStrings.push(filled);

                if (tab === "ocr" && key === "source_language") {
                    const languages = new Set([...Object.keys(currentSelectableOcrSourceLanguageList.data ?? {}), currentOcrSourceLanguage.data]);
                    for (const language of languages) {
                        if (language) searchStrings.push(names.searchText({ language }));
                    }
                }
                if (tab === "appearance" && key === "ui_language") {
                    for (const option of ui_configs.selectable_ui_languages) {
                        searchStrings.push(option.label, names.fromCode(option.id), english.fromCode(option.id));
                    }
                }
                const searchTarget = searchStrings
                    .map((s) => cleanTemplateStr(s).normalize("NFKC").toLowerCase())
                    .filter(Boolean);

                for (const page of settingTabs(tab, key)) {
                    entries.push({
                        tab: page,
                        setting_id: settingTarget(tab, key),
                        label: cleanTemplateStr(rawLabel),
                        desc: cleanTemplateStr(rawDesc),
                        tab_label: t(TAB_LABEL_KEYS[page] ?? page),
                        searchTarget,
                        prereq: PREREQUISITES[key] || null,
                    });
                }
            }
        }
        const realtimeLanguages = new Set([
            ...(models.models?.flatMap(model => textsOf(model).languages ?? []) ?? []),
            textsOf(settings?.mic).language, textsOf(settings?.speaker).language,
        ]);
        // The experimental features' texts are one level down (items.<id>), with their own settings
        // under them. A feature's own setting shows only while it is on; until then the search
        // leads to the feature's switch.
        const curItems = textsOf(textsOf(curRes.experimental_features).items);
        const enItems = textsOf(textsOf(enRes.experimental_features).items);
        const experimental = (id: string) => curItems[id] ?? enItems[id];
        const experimentalIds = new Set([...Object.keys(curItems), ...Object.keys(enItems)]);
        for (const id of experimentalIds) {
            const item = experimental(id);
            const parts: [string, unknown, Prerequisite | null][] = [[`experimental_features.${id}`, item, null],
                ...Object.entries(textsOf(item)).filter(([, value]) => isTexts(value) && value.label)
                    .map(([key, value]): [string, unknown, Prerequisite] => [`experimental_features.${id}.${key}`, value, { parent_id: `experimental_features.${id}` }])];
            for (const [setting_id, texts, prereq] of parts) {
                if (!isTexts(texts) || !texts.label) continue;
                entries.push({
                    tab: "experimental_features", setting_id, label: cleanTemplateStr(texts.label), desc: cleanTemplateStr(texts.desc ?? ""),
                    tab_label: t(TAB_LABEL_KEYS.experimental_features), prereq,
                    searchTarget: [texts.label, texts.desc].filter(isText)
                        .map(text => cleanTemplateStr(text).normalize("NFKC").toLowerCase()),
                });
            }
        }
        // Input forwarding has its texts under voice.*; it is in the RVC page's 「詳細設定」 (#554, Q-07).
        entries.push({
            tab: "rvc", setting_id: "direct_voice_settings", label: t("voice.input_title"),
            desc: t("voice.input_description"), tab_label: t(TAB_LABEL_KEYS.rvc), prereq: null,
            searchTarget: [t("voice.input_title"), t("voice.input_source"), t("voice.input_start")]
                .map(text => text.normalize("NFKC").toLowerCase()),
        });
        entries.push({
            tab: "transcription", setting_id: "realtime_asr", label: t("realtime.title"),
            desc: t("realtime.auto_help"), tab_label: t(TAB_LABEL_KEYS.transcription), prereq: null,
            searchTarget: [t("realtime.title"), t("realtime.mic_language"), t("realtime.speaker_language"),
                ...[...realtimeLanguages].filter(isText).filter(Boolean).flatMap(code => code === "auto"
                    ? [t("realtime.auto_language"), "auto"] : [code, names.fromCode(code), english.fromCode(code)])]
                .filter(isText).map(text => text.normalize("NFKC").toLowerCase()),
        });
        return entries;
    }, [i18nHook.language, t, currentSelectableOcrSourceLanguageList.data, currentOcrSourceLanguage.data, models, settings]);

    const results = useMemo(() => {
        const q = query.normalize("NFKC").trim().toLowerCase();
        if (q.length < 1) return [];

        return allEntries.filter((entry) => {
            return entry.searchTarget.some((text) => text.includes(q));
        });
    }, [query, allEntries]);

    const clearQuery = useCallback(() => setQuery(""), []);

    const navigateToSetting = useCallback((result: ConfigSearchEntry) => {
        const navigate = () => {
            clearQuery();
            if (currentSelectedConfigTabId.data !== result.tab) {
                updateSelectedConfigTabId(result.tab, { voice_navigation_confirmed: true });
            }

            revealSetting(result);
        };
        if (currentSelectedConfigTabId.data !== result.tab) requestSettingsNavigation(navigate);
        else navigate();
    }, [clearQuery, currentSelectedConfigTabId.data, updateSelectedConfigTabId]);

    return { query, setQuery, results, clearQuery, navigateToSetting };
};
