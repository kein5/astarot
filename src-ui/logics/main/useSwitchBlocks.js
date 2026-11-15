import { useEffect } from "react";
import { useOcr } from "@logics_configs";
import { useStore_IsBackendReady, useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useSetupNeeds } from "./useSetupNeeds";
import { switchBlocks } from "./switchBlocks";
import { useVoice } from "../voice/useVoice";
import { useModelDownloads } from "../voice/useModelDownloads";
import { useTranslationSetup } from "../translation/useTranslationSetup";

// Main window only. Why each main switch cannot be turned on yet (switchBlocks.js), and how
// to start providing it: the translation model opens its review (provider, license, size,
// consent), everything else opens its settings page. Nothing here downloads or turns a
// switch on. A block follows the settings as they change, so a switch comes back as soon
// as what it needs is there.
export const useSwitchBlocks = () => {
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const { needs } = useSetupNeeds();
    const { currentOcrModelReadiness, getOcrModelReadiness, currentOcrSourceLanguage, currentOcrReadiness } = useOcr();
    const { settings: voiceSettings, directState } = useVoice();
    const { state: downloads } = useModelDownloads();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const translationSetup = useTranslationSetup();
    const ready = currentIsBackendReady.data === true;

    // The chat reading models come with the start-up settings. Ask again when the language
    // changes, a download finishes, or the chat reading page has looked for itself.
    const finished = Object.entries(downloads?.jobs ?? {})
        .filter(([, job]) => job?.phase === "ready").map(([id]) => id).sort().join(",");
    useEffect(() => {
        if (ready) getOcrModelReadiness();
    }, [ready, currentOcrSourceLanguage.data, finished, currentOcrReadiness.data]);

    // Until the engine has sent its settings, nothing is known to be missing.
    const blocks = ready ? switchBlocks({ needs, ocr: currentOcrModelReadiness.data, voiceSettings, directState }) : {};
    const prepare = action => {
        if (!action) return;
        if (action === "translation") return translationSetup.open(false);
        updateSelectedConfigTabId(action);
        updateIsOpenedConfigPage(true);
    };
    return { blocks, prepare };
};
