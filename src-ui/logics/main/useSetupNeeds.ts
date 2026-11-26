import { useTranslation, useTranscription } from "@logics_configs";
import { useStore_IsBackendReady, useStore_SelectedPresetTabNumber, useStore_SelectedTranslationEngines } from "@store";
import { useOpenSettings } from "../common/useOpenSettings";
import { setupNeeds, translationDownloadable } from "./setupNeeds";
import type { SetupNeed } from "./setupNeeds";
import { useTranslationSetup } from "../translation/useTranslationSetup";
import { useModelDownloads } from "../voice/useModelDownloads";
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
    const openSettings = useOpenSettings();
    const translationSetup = useTranslationSetup();
    const { catalog } = useModelDownloads();
    // Until the engine has sent its settings, "not downloaded" is only the list's default.
    const needs: SetupNeed[] = currentIsBackendReady.data !== true ? [] : setupNeeds({
        translationEngine: currentSelectedTranslationEngines.data?.[currentSelectedPresetTabNumber.data],
        translationWeights: currentCTranslate2WeightTypeStatus.data,
        translationWeight: currentSelectedCTranslate2WeightType.data,
        translationDownloadable: translationDownloadable(catalog, currentSelectedCTranslate2WeightType.data),
        transcriptionEngine: currentSelectedTranscriptionEngine.data,
        realtimeServer: realtimeSettings?.server,
        asrProfile: serverSettings?.profiles?.asr,
    });
    const start = (id: string) => {
        if (id === "translation") {
            // No model to download yet: the way forward is another translator.
            if (needs.find(need => need.id === id)?.action === "choose") return translationSetup.chooseTranslator();
            return translationSetup.open(false);
        }
        openSettings({ page: "transcription" });
    };
    return { needs, start };
};
