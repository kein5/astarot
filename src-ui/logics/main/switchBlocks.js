import { downloadProgress } from "./setupNeeds.js";
import { directRouteReady, usesOutputDevice } from "../voice/routeState.js";

// Why a main switch cannot be turned on yet, read from the state the settings already hold:
// the setup needs (translation model, local speech recognition models), the chat reading
// models of the selected language, the saved speech settings and the saved direct voice
// settings. Each block names its reason and the settings page that provides it
// (`action`: a config tab id; "translation" opens the model review, "ocr_models" the chat
// reading models section; null when there is nothing to do but wait).
//
// Only what is known blocks a switch. State that has not arrived yet blocks nothing, so a
// switch that could start is never greyed out; the switch's own error and the setup
// dialogs still answer anything this does not see.
export const switchBlocks = ({ needs = [], ocr = null, voiceSettings = null, directState = null } = {}) => {
    const blocks = {};

    const translation = needs.find(need => need.id === "translation");
    if (translation) {
        blocks.translation = downloadProgress(translation.weight) === null
            ? { reason: "translation_model", action: "translation" }
            : { reason: "translation_downloading", action: null };
    }

    if (needs.some(need => need.id === "transcription")) {
        const block = { reason: "asr_models", action: "transcription" };
        blocks.transcription_send = block;
        blocks.transcription_receive = block;
    }

    // The same check the start makes: the language must be supported, then its models present.
    if (ocr?.language_supported === false) {
        blocks.ocr = { reason: "ocr_language", action: "ocr" };
    } else if (ocr?.language_supported === true && Array.isArray(ocr.missing_models) && ocr.missing_models.length > 0) {
        blocks.ocr = { reason: "ocr_models", action: "ocr_models" };
    }

    // Nothing to read aloud: the engine refuses with tts_source_not_selected.
    if (voiceSettings && voiceSettings.mode === "off" && voiceSettings.mic_mode === "off") {
        blocks.tts = { reason: "tts_source", action: "tts" };
    }

    // The saved settings the RVC switch starts from (MainFunctionSwitch's toggleRvc). The
    // input microphone is left out: its list arrives later and a missing entry there is
    // not yet a missing choice.
    const direct = directState?.observation_id ? directState.settings : null;
    if (direct) {
        if (direct.mode !== "converted" || direct.engine !== "rvc" || !direct.rvc_runtime || !direct.rvc_model) {
            blocks.rvc = { reason: "rvc_model", action: "rvc" };
        } else if (voiceSettings && !directRouteReady(voiceSettings, directState)) {
            blocks.rvc = usesOutputDevice(directState)
                ? { reason: "rvc_output_device", action: "tts" }
                : { reason: "rvc_route", action: "device" };
        }
    }

    return blocks;
};
