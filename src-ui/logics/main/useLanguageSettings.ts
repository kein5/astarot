import { useStore_LanguageMutation, useStore_SelectedPresetTabNumber, useStore_SelectedYourLanguages, useStore_SelectedTargetLanguages, useStore_TranslationEngines, useStore_SelectedTranslationEngines, useStore_SelectableLanguageList } from "@store";
import type { SelectableLanguage } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { canChangeLanguageSettings, createLanguageRequestId } from "./languageMutations";
import type { LanguageSnapshot } from "./languageMutations";
import { store } from "@store";
import { translator_status } from "@ui_configs";
import type { LanguageSelection, LanguageSelections } from "../common/initializationFields.ts";

// A language chosen for one of the target slots ("1" to "3").
export interface TargetLanguageChoice extends SelectableLanguage {
    target_key: string;
}

// /run/swap_your_language_and_target_language and the like: both sides at once.
export interface BothSelectedLanguages {
    your: LanguageSelections;
    target: LanguageSelections;
}

export const useLanguageSettings = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentLanguageMutation } = useStore_LanguageMutation();

    const {
        currentSelectedYourLanguages,
        updateSelectedYourLanguages,
        pendingSelectedYourLanguages,
    } = useStore_SelectedYourLanguages();
    const {
        currentSelectedTargetLanguages,
        updateSelectedTargetLanguages,
        pendingSelectedTargetLanguages,
    } = useStore_SelectedTargetLanguages();
    const {
        currentSelectedPresetTabNumber,
        updateSelectedPresetTabNumber,
        pendingSelectedPresetTabNumber,
    } = useStore_SelectedPresetTabNumber();
    const {
        currentTranslationEngines,
        updateTranslationEngines,
        pendingTranslationEngines,
    } = useStore_TranslationEngines();
    const {
        currentSelectedTranslationEngines,
        updateSelectedTranslationEngines,
        pendingSelectedTranslationEngines,
    } = useStore_SelectedTranslationEngines();

    const {
        currentSelectableLanguageList,
        updateSelectableLanguageList,
    } = useStore_SelectableLanguageList();


    const sendMutation = (endpoint: string, value?: unknown): string => {
        const requestId = createLanguageRequestId();
        const expectedSnapshot: LanguageSnapshot = {
            tab: currentSelectedPresetTabNumber.data, your: currentSelectedYourLanguages.data,
            target: currentSelectedTargetLanguages.data, selectedEngines: currentSelectedTranslationEngines.data,
        };
        const request = { requestId, source: store.is_vr_panel ? "vr" : "pc", expectedSnapshot };
        // The main transport owns pending and completion. A /run notification
        // alone does not finish the operation.
        asyncStdoutToPython(endpoint, value, request).catch(console.error);
        return requestId;
    };

    const getSelectedPresetTabNumber = () => {
        pendingSelectedPresetTabNumber();
        asyncStdoutToPython("/get/data/selected_tab_no");
    };

    const setSelectedPresetTabNumber = (preset_number: string) => {


        return sendMutation("/set/data/selected_tab_no", preset_number);
    };


    const getSelectedYourLanguages = () => {
        pendingSelectedYourLanguages();
        asyncStdoutToPython("/get/data/selected_your_languages");
    };

    const setSelectedYourLanguages = (selected_language_data: SelectableLanguage) => {

        const send_obj: LanguageSelections = {
            ...currentSelectedYourLanguages.data,
            [currentSelectedPresetTabNumber.data]: {
                1: { // Fixed key 1.
                    language: selected_language_data.language,
                    country: selected_language_data.country,
                    enable: true,
                }
            }
        };
        return sendMutation("/set/data/selected_your_languages", send_obj);
    };


    const getSelectedTargetLanguages = () => {
        pendingSelectedTargetLanguages();
        asyncStdoutToPython("/get/data/selected_target_languages");
    };

    const setSelectedTargetLanguages = (selected_language_data: TargetLanguageChoice) => {

        const tab_no = currentSelectedPresetTabNumber.data;
        const target_key = selected_language_data.target_key;
        const send_obj: LanguageSelections = {
            ...currentSelectedTargetLanguages.data,
            [tab_no]: {
                ...currentSelectedTargetLanguages.data[tab_no],
                [target_key]: {
                    ...currentSelectedTargetLanguages.data[tab_no][target_key],
                    language: selected_language_data.language,
                    country: selected_language_data.country,
                },
            },
        };
        return sendMutation("/set/data/selected_target_languages", send_obj);
    };

    // 今のプリセットの相手の言語を、languages ([{language, country}], 1〜3件) の順に枠1から詰めて設定する。
    // 余った枠は無効にする (言語はそのまま残す)。VR UIで候補を選ぶ・外すときに使う
    const setTargetLanguagesInOrder = (languages: readonly SelectableLanguage[]) => {
        if (languages.length < 1 || languages.length > 3) return;

        const tab_no = currentSelectedPresetTabNumber.data;
        const current = currentSelectedTargetLanguages.data[tab_no];
        const updated: Record<string, LanguageSelection> = {};
        for (const target_key of ["1", "2", "3"]) {
            const language: SelectableLanguage | undefined = languages[Number(target_key) - 1];
            updated[target_key] = language
                ? { language: language.language, country: language.country, enable: true }
                : { ...current[target_key], enable: false };
        }
        return sendMutation("/set/data/selected_target_languages", {
            ...currentSelectedTargetLanguages.data,
            [tab_no]: updated,
        });
    };

    const addTargetLanguage = () => {

        const tab_no = currentSelectedPresetTabNumber.data;
        const target_key = currentSelectedTargetLanguages.data[tab_no]["2"].enable === true ? "3" : "2";
        const send_obj: LanguageSelections = {
            ...currentSelectedTargetLanguages.data,
            [tab_no]: {
                ...currentSelectedTargetLanguages.data[tab_no],
                [target_key]: {
                    ...currentSelectedTargetLanguages.data[tab_no][target_key],
                    enable: true,
                },
            },
        };
        return sendMutation("/set/data/selected_target_languages", send_obj);
    };
    const removeTargetLanguage = () => {

        const tab_no = currentSelectedPresetTabNumber.data;
        const target_key = currentSelectedTargetLanguages.data[tab_no]["3"].enable === false ? "2" : "3";
        const send_obj: LanguageSelections = {
            ...currentSelectedTargetLanguages.data,
            [tab_no]: {
                ...currentSelectedTargetLanguages.data[tab_no],
                [target_key]: {
                    ...currentSelectedTargetLanguages.data[tab_no][target_key],
                    enable: false,
                },
            },
        };
        return sendMutation("/set/data/selected_target_languages", send_obj);
    };


    const getTranslationEngines = () => {
        pendingTranslationEngines();
        asyncStdoutToPython("/get/data/selectable_translation_engines");
    };

    // payload: the ids of the translators that can be used now.
    const updateTranslatorAvailability = (payload: readonly string[]) => {
        const keys = payload;
        const updated_list = translator_status.map(translator => ({
            ...translator,
            is_available: keys.includes(translator.id),
        }));
        updateTranslationEngines(updated_list);
    };


    const getSelectedTranslationEngines = () => {
        pendingSelectedTranslationEngines();
        asyncStdoutToPython("/get/data/selected_translation_engines");
    };

    const setSelectedTranslationEngines = (selected_translator: string) => {

        const send_obj = {
            ...currentSelectedTranslationEngines.data,
            [currentSelectedPresetTabNumber.data]: selected_translator,
        };
        return sendMutation("/set/data/selected_translation_engines", send_obj);
    };

    const swapSelectedLanguages = () => {


        return sendMutation("/run/swap_your_language_and_target_language");
    };

    const updateBothSelectedLanguages = (payload: BothSelectedLanguages) => {
        updateSelectedYourLanguages(payload.your);
        updateSelectedTargetLanguages(payload.target);
    };


    const getSelectableLanguageList = () => {
        asyncStdoutToPython("/get/data/selectable_language_list");
    };


    return {
        currentLanguageMutation,
        canChangeLanguageSettings,
        refreshLanguageSettings: () => {
            getSelectedPresetTabNumber();
            getSelectedYourLanguages();
            getSelectedTargetLanguages();
            getSelectedTranslationEngines();
            getTranslationEngines();
        },
        isLanguageSettingsBusy: Boolean(currentLanguageMutation.data.inFlight)
            || currentLanguageMutation.data.isResyncing
            || [currentSelectedPresetTabNumber, currentSelectedYourLanguages, currentSelectedTargetLanguages, currentSelectedTranslationEngines, currentTranslationEngines].some(value => value.state !== "ok"),
        currentSelectedPresetTabNumber,
        getSelectedPresetTabNumber,
        updateSelectedPresetTabNumber,
        setSelectedPresetTabNumber,

        currentSelectedYourLanguages,
        getSelectedYourLanguages,
        updateSelectedYourLanguages,
        setSelectedYourLanguages,

        currentSelectedTargetLanguages,
        getSelectedTargetLanguages,
        updateSelectedTargetLanguages,
        setSelectedTargetLanguages,

        addTargetLanguage,
        removeTargetLanguage,
        setTargetLanguagesInOrder,

        currentTranslationEngines,
        getTranslationEngines,
        updateTranslationEngines,
        updateTranslatorAvailability,

        currentSelectedTranslationEngines,
        getSelectedTranslationEngines,
        updateSelectedTranslationEngines,
        setSelectedTranslationEngines,

        swapSelectedLanguages,
        updateBothSelectedLanguages,

        currentSelectableLanguageList,
        getSelectableLanguageList,
        updateSelectableLanguageList,
    };
};
