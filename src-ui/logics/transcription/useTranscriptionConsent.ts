import { atom, useAtom, type SetStateAction } from "jotai";

export type TranscriptionEndpoint = "/set/enable/transcription_send" | "/set/enable/transcription_receive";

// "choose": no engine is selected; the dialog offers one. "settings": the selected engine
// cannot run; the dialog leads to its settings.
export type TranscriptionConsentMode = "choose" | "settings";

export interface TranscriptionConsentRequest {
    endpoint: TranscriptionEndpoint;
    mode: TranscriptionConsentMode;
}

export interface TranscriptionConsent {
    request: TranscriptionConsentRequest | null;
    open: (endpoint: string, mode?: TranscriptionConsentMode) => void;
    setRequest: (request: SetStateAction<TranscriptionConsentRequest | null>) => void;
}

const ENDPOINTS: readonly string[] = ["/set/enable/transcription_send", "/set/enable/transcription_receive"];
const isTranscriptionEndpoint = (endpoint: string): endpoint is TranscriptionEndpoint => ENDPOINTS.includes(endpoint);

// Main-window only. A rejected enable request is the sole source of a continuation.
const requestAtom = atom<TranscriptionConsentRequest | null>(null);
export const useTranscriptionConsent = (): TranscriptionConsent => {
    const [request, setRequest] = useAtom(requestAtom);
    const open = (endpoint: string, mode: TranscriptionConsentMode = "choose"): void => {
        if (!isTranscriptionEndpoint(endpoint)) return;
        setRequest(previous => previous ?? { endpoint, mode });
    };
    return { request, open, setRequest };
};
