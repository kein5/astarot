import { downloadProgress } from "./setupNeeds.ts";
import type { SetupNeed } from "./setupNeeds.ts";
import { directRouteReady, usesOutputDevice } from "../voice/routeState.ts";

export type SwitchBlockId = "translation" | "transcription_send" | "transcription_receive" | "ocr" | "tts" | "rvc";

export type SwitchBlockReason = "translation_model" | "translation_unavailable" | "translation_downloading" | "asr_models"
    | "ocr_language" | "ocr_models" | "tts_source" | "tts_model" | "rvc_model" | "rvc_output_device" | "rvc_route";

// "translator" opens the translator list in the sidebar. "recognition_setup" opens the first-run
// setup, which shows the recommended speech recognition models and their size and downloads them
// after consent (#1225).
export type SwitchBlockAction = "translation" | "translator" | "transcription" | "recognition_setup" | "ocr" | "ocr_models" | "tts" | "rvc" | "device";

export interface SwitchBlock {
    reason: SwitchBlockReason;
    action: SwitchBlockAction | null;
}

export type SwitchBlocks = Partial<Record<SwitchBlockId, SwitchBlock>>;

// /get/data/ocr_model_readiness, as far as it is read here.
export interface OcrReadiness {
    language_supported?: unknown;
    missing_models?: unknown;
}

// The saved speech settings, as far as they are read here and by routeState.
export interface SwitchVoiceSettings {
    mode?: unknown;
    mic_mode?: unknown;
    output_device?: unknown;
    routing?: unknown;
    // Which engine reads Japanese, and which server each language's speech.cpp voice uses.
    japanese_engine?: unknown;
    japanese_server?: unknown;
    multilingual_server?: unknown;
}

// The speech server settings (/get/data/speech_server_settings), as far as they are read here:
// the model each profile has.
export interface SwitchSpeechServers {
    profiles?: Readonly<Record<string, { model?: unknown } | undefined>> | null;
}

// The saved direct voice settings.
export interface SwitchDirectSettings {
    mode?: unknown;
    engine?: unknown;
    rvc_runtime?: unknown;
    rvc_model?: unknown;
}

// The direct voice state, as far as it is read here and by routeState.
export interface SwitchDirectState {
    observation_id?: unknown;
    settings?: SwitchDirectSettings | null;
    output_route?: unknown;
}

export interface SwitchBlocksInput {
    needs?: readonly SetupNeed[];
    ocr?: OcrReadiness | null;
    voiceSettings?: SwitchVoiceSettings | null;
    speechServers?: SwitchSpeechServers | null;
    directState?: SwitchDirectState | null;
}

// A switch's state as the store holds it.
export interface SwitchStatus {
    data?: unknown;
    state?: unknown;
}

// Why a main switch cannot be turned on yet, read from the state the settings already hold:
// the setup needs (translation model, local speech recognition models), the chat reading
// models of the selected language, the saved speech settings and the saved direct voice
// settings. Each block names its reason and the settings page that provides it
// (`action`: a config tab id; "translation" opens the model review, "recognition_setup" the
// recognition models' setup, "ocr_models" the chat reading models section; null when there is
// nothing to do but wait).
//
// Only what is known blocks a switch. State that has not arrived yet blocks nothing, so a
// switch that could start is never greyed out; the switch's own error and the setup
// dialogs still answer anything this does not see.
export const switchBlocks = ({ needs = [], ocr = null, voiceSettings = null, speechServers = null, directState = null }: SwitchBlocksInput = {}): SwitchBlocks => {
    const blocks: SwitchBlocks = {};

    const translation = needs.find(need => need.id === "translation");
    if (translation) {
        // A model that cannot be downloaded yet points to the other translators instead.
        blocks.translation = downloadProgress(translation.weight) !== null
            ? { reason: "translation_downloading", action: null }
            : translation.action === "choose"
                ? { reason: "translation_unavailable", action: "translator" }
                : { reason: "translation_model", action: "translation" };
    }

    if (needs.some(need => need.id === "transcription")) {
        // The models are fixed where the switch is (#1225): the setup reviews and downloads them.
        const block: SwitchBlock = { reason: "asr_models", action: "recognition_setup" };
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
    } else if (voiceSettings && speechServers?.profiles && !ttsVoiceReady(voiceSettings, speechServers.profiles)) {
        // No voice to read with (#1266, TT-3): each language reads through the bundled speech.cpp
        // server, and neither has its model. The models are downloaded on the TTS page.
        blocks.tts = { reason: "tts_model", action: "tts" };
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

// Whether a language can be read aloud: Japanese through an engine the user installed (which has
// its own voices), or a speech.cpp voice on a server of the user's own (whose model is its own
// business) or on the bundled server with its model set. Unknown settings count as ready.
const ttsVoiceReady = (voice: SwitchVoiceSettings, profiles: NonNullable<SwitchSpeechServers["profiles"]>): boolean => {
    const bundledWithoutModel = (role: "japanese" | "multilingual") =>
        (voice[`${role}_server`] ?? "bundled") === "bundled" && !String(profiles[role]?.model ?? "").trim();
    const japanese = (voice.japanese_engine ?? "speechcpp") !== "speechcpp" || !bundledWithoutModel("japanese");
    return japanese || !bundledWithoutModel("multilingual");
};

// The block a switch shows now. A switch that is off and waits for nothing stays off while its
// setup is missing. One that is on, or on its way, stays as it is so it can be turned off; losing
// the setup afterwards is told by the switch's own error. The main window and the VR panel both
// decide with this.
export const activeSwitchBlock = (blocks: Readonly<Record<string, SwitchBlock | undefined>> | null | undefined,
    id: string, status: SwitchStatus | null | undefined): SwitchBlock | undefined =>
    status?.data !== true && status?.state !== "pending" ? blocks?.[id] : undefined;
