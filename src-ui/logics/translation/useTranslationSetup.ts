import { atom, useAtom, type SetStateAction } from "jotai";

export interface TranslationSetupRequest {
    // Try the switch again once the model is there.
    resume: boolean;
    // The model to review when it is not the selected one; null reviews the selected model.
    weightType: string | null;
}

// The model whose arrival turns the switch on.
export interface TranslationWait {
    weightType: string;
    // The catalog download that brings it (#1015): its model, and the job that model had before
    // the start, whose end is an earlier try's and not this one's. null: the built-in download,
    // whose progress the weight carries.
    download: { model: string; before: string | null } | null;
}

export interface TranslationSetup {
    request: TranslationSetupRequest | null;
    open: (resume?: boolean, weightType?: string | null) => void;
    setRequest: (request: SetStateAction<TranslationSetupRequest | null>) => void;
    waiting: TranslationWait | null;
    setWaiting: (wait: SetStateAction<TranslationWait | null>) => void;
    chooseRequests: number;
    chooseTranslator: () => void;
}

// Main-window only. The request to review and fetch the built-in translation
// model: raised when the user turns Translation on without it, or asks from the
// empty conversation. `resume` is true when the switch should be tried again
// once the model is there. `weightType` names the model to review when it is not
// the selected one (retrying a failed download); null reviews the selected model.
const requestAtom = atom<TranslationSetupRequest | null>(null);
// The model whose arrival turns the switch on; null when nobody is waiting. Kept
// outside the controller: the engine starting again draws the controller again (the
// start-up lock takes it away), and the user who asked for the switch is still waiting for it.
const waitingAtom = atom<TranslationWait | null>(null);
// Counts the requests to open the translator list (the model cannot be downloaded yet,
// so another engine is the way forward). TranslationSetupController opens the list; the
// sidebar's state stays out of the hooks the VR panel's views import.
const chooseAtom = atom(0);
export const useTranslationSetup = (): TranslationSetup => {
    const [request, setRequest] = useAtom(requestAtom);
    const [waiting, setWaiting] = useAtom(waitingAtom);
    const [chooseRequests, setChooseRequests] = useAtom(chooseAtom);
    const open = (resume = false, weightType: string | null = null): void =>
        setRequest(previous => previous ?? { resume, weightType });
    const chooseTranslator = (): void => setChooseRequests(count => count + 1);
    return { request, open, setRequest, waiting, setWaiting, chooseRequests, chooseTranslator };
};
