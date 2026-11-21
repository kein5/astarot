// The name of a translation engine as the user sees it (#565). The local translation keeps the id
// CTranslate2 in the settings, but CTranslate2 left the product in 0.5.0: it is named as its
// section of Settings is ("AI翻訳（ローカル）"), from the same text, so the two names cannot drift.
// The other engines are named by their services, as `translator_status` labels them.
import { translator_status } from "../ui_configs.ts";
import type { TranslatorStatus } from "../ui_configs.ts";
import { weightLabel } from "../translation/translationCatalog.ts";

export const LOCAL_TRANSLATION_ENGINE = "CTranslate2";
export const LOCAL_TRANSLATION_ENGINE_NAME_KEY = "config_page.translation.section_label_ai_translation";

export function translatorLabel(engine: Pick<TranslatorStatus, "id" | "label"> | null | undefined, t: (key: string) => string): string {
    if (!engine) return "";
    return engine.id === LOCAL_TRANSLATION_ENGINE ? t(LOCAL_TRANSLATION_ENGINE_NAME_KEY) : engine.label;
}

// The name of what translated, for a notice of the backend: a local model by its name (a built-in
// one by the download catalog's name of it), else an engine as the UI names it. Neither: as given.
export function translatorName(weight: unknown, engine: unknown, t: (key: string) => string): unknown {
    if (typeof weight === "string") return weightLabel(weight, null);
    if (typeof engine !== "string") return engine;
    return translatorLabel(translator_status.find(item => item.id === engine) ?? { id: engine, label: engine }, t);
}
