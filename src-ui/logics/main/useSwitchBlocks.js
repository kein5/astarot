import { useEffect } from "react";
import { useOcr } from "@logics_configs";
import { useStore_IsBackendReady, useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId, useStore_SwitchBlocks } from "@store";
import { useSetupNeeds } from "./useSetupNeeds";
import { switchBlocks } from "./switchBlocks";
import { useVoice } from "../voice/useVoice";
import { useModelDownloads } from "../voice/useModelDownloads";
import { useTranslationSetup } from "../translation/useTranslationSetup";import { focusOcrModels } from "../ocr/useOcrSetup";

// Main window only, once (SwitchBlocksController). Why each main switch cannot be turned on
// yet (switchBlocks.js), kept in the SwitchBlocks atom. The main window's switches and the VR
// panel's launcher both read that atom, so the two never disagree. A block follows the
// settings as they change, so a switch comes back as soon as what it needs is there.
export const useSwitchBlocksSource = () => {
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const { needs } = useSetupNeeds();
    const { currentOcrModelReadiness, getOcrModelReadiness, currentOcrSourceLanguage, currentOcrReadiness } = useOcr();
    const { settings: voiceSettings, directState } = useVoice();
    const { state: downloads } = useModelDownloads();
    const { updateSwitchBlocks } = useStore_SwitchBlocks();
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
    // Written only when a block changes: the VR panel is sent every change of the atom.
    const key = JSON.stringify(blocks);
    useEffect(() => { updateSwitchBlocks(JSON.parse(key)); }, [key]);
    // Nothing is blocked once nothing works it out (the window's contents are gone).
    useEffect(() => () => updateSwitchBlocks({}), []);
    return blocks;
};

// The main window's switches: the blocks, and how to start providing what is missing. The
// translation model opens its review (provider, license, size, consent), the chat reading
// models their section of the settings (as the dialog shown when chat reading is turned on
// without them does), everything else its settings page. Nothing here downloads or turns a
// switch on.
export const useSwitchBlocks = () => {
    const { currentSwitchBlocks } = useStore_SwitchBlocks();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const translationSetup = useTranslationSetup();
    const prepare = action => {
        if (!action) return;
        if (action === "translation") return translationSetup.open(false);
        if (action === "translator") return translationSetup.chooseTranslator();
        updateSelectedConfigTabId(action === "ocr_models" ? "ocr" : action);
        updateIsOpenedConfigPage(true);
        if (action === "ocr_models") focusOcrModels();
    };
    return { blocks: currentSwitchBlocks.data ?? {}, prepare };
};
