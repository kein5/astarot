import { useTranscription } from "@logics_configs";
import { useStore_IsBackendReady } from "@store";
import { useRealtimeASR } from "../transcription/useRealtimeASR";
import { useSpeechServers } from "../voice/useSpeechServers";
import { recognitionState } from "./firstRunSetup.ts";

// What the speech recognition needs, from the saved settings (firstRunSetup.ts), with the
// values it was read from. "unknown" until the engine has sent its settings.
export const useRecognitionState = () => {
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const { currentSelectedTranscriptionEngine } = useTranscription();
    const { settings: realtime } = useRealtimeASR();
    const { settings: speech } = useSpeechServers();
    const engine = currentSelectedTranscriptionEngine.state === "ok" ? currentSelectedTranscriptionEngine.data ?? null : undefined;
    const server = realtime?.server;
    const paths = speech?.profiles?.asr ?? null;
    const state = currentIsBackendReady.data === true ? recognitionState({ engine, server, paths }) : "unknown";
    return { state, engine, server, paths };
};
