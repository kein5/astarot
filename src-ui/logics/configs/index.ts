import { createCategoryHook } from "./config_page_setter/ui_config_setter.js";
export { useSettingValue } from "./config_page_setter/ui_config_setter.js";

export const useAppearance = createCategoryHook("Appearance");
export const useDevice = createCategoryHook("Device");
export const useTranslation = createCategoryHook("Translation");
export const useTranscription = createCategoryHook("Transcription");
export const useVr = createCategoryHook("Vr");
export const useOthers = createCategoryHook("Others");
export const useAdvancedSettings = createCategoryHook("AdvancedSettings");
export const useOcr = createCategoryHook("Ocr");
export const useExperimentalFeatures = createCategoryHook("ExperimentalFeatures");
export const useUsagePresets = createCategoryHook("UsagePresets");

// Exceptional exports that are not part of SETTINGS_ARRAY or have custom logic.
export { useHotkeys } from "./config_page_setter/hotkeys/useHotkeys.js";
export { useOcrSharedWindow, ocrStartErrorKey, ocrShouldRestoreSharedWindow } from "./useOcrSharedWindow";
export { useExperimentalFeature } from "./useExperimentalFeature.ts";

export { useSettingBoxScrollPosition } from "./config_page_setter/_aux/useSettingBoxScrollPosition";
export { useConfigSearch } from "./config_page_setter/_aux/useConfigSearch.js";


export {
    useSliderLogic,
    useSaveButtonLogic,
} from "./config_page_setter/useSettingsLogics.js";
