import { useTranslation, useTranscription } from "@logics_configs";
import { useStore_IsBackendReady, useStore_SelectedPresetTabNumber, useStore_SelectedTranslationEngines,
    useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { setupNeeds } from "./setupNeeds";
import { useTranslationSetup } from "../translation/useTranslationSetup";
import { useRealtimeASR } from "../transcription/useRealtimeASR";
import { useSpeechServers } from "../voice/useSpeechServers";

// The setup the selected engines still need, and how to start each one.
// Translation opens the same review (provider, license, size, consent) the settings use;
// the local speech recognition opens Settings → Speech recognition, where its models are
// reviewed and downloaded with consent.
export const useSetupNeeds = () => {
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const { currentSelectedPresetTabNumber } = useStore_SelectedPresetTabNumber();
    const { currentSelectedTranslationEngines } = useStore_SelectedTranslationEngines();
    const { currentCTranslate2WeightTypeStatus, currentSelectedCTranslate2WeightType } = useTranslation();
    const { currentSelectedTranscriptionEngine } = useTranscription();
    const { settings: realtimeSettings } = useRealtimeASR();
    const { settings: serverSettings } = useSpeechServers();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const translationSetup = useTranslationSetup();
    // Until the engine has sent its settings, "not downloaded" is only the list's default.
    const needs = currentIsBackendReady.data !== true ? [] : setupNeeds({
        translationEngine: currentSelectedTranslationEngines.data?.[currentSelectedPresetTabNumber.data],
        translationWeights: currentCTranslate2WeightTypeStatus.data,
        translationWeight: currentSelectedCTranslate2WeightType.data,
        transcriptionEngine: currentSelectedTranscriptionEngine.data,
        realtimeServer: realtimeSettings?.server,
        asrProfile: serverSettings?.profiles?.asr,
    });
    const start = id => {
        if (id === "translation") return translationSetup.open(false);
        updateSelectedConfigTabId("transcription");
        updateIsOpenedConfigPage(true);
    };
    return { needs, start };
};
