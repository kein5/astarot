import { revealSetting } from "../configs/revealSetting.ts";
import { OCR_MODELS_SETTING_ID, focusOcrModels } from "../ocr/useOcrSetup";

// Shows a setting on the settings page that is open (#1236: in the settings window, or in-page):
// its folds opened, focused and marked. The chat reading models are shown at their first download.
export const showSetting = (target: string): void => {
    if (target === OCR_MODELS_SETTING_ID) focusOcrModels();
    else revealSetting({ setting_id: target });
};
