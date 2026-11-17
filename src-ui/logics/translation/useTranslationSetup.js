import { atom, useAtom } from "jotai";

// Main-window only. The request to review and fetch the built-in translation
// model: raised when the user turns Translation on without it, or asks from the
// empty conversation. `resume` is true when the switch should be tried again
// once the model is there. `weightType` names the model to review when it is not
// the selected one (retrying a failed download); null reviews the selected model.
const requestAtom = atom(null);
// The model whose arrival turns the switch on; null when nobody is waiting. Kept
// outside the controller: changing the UI language draws the main page again, and
// the user who asked for the switch is still waiting for it.
const waitingAtom = atom(null);
// Counts the requests to open the translator list (the model cannot be downloaded yet,
// so another engine is the way forward). TranslationSetupController opens the list; the
// sidebar's state stays out of the hooks the VR panel's views import.
const chooseAtom = atom(0);
export const useTranslationSetup = () => {
    const [request, setRequest] = useAtom(requestAtom);
    const [waiting, setWaiting] = useAtom(waitingAtom);
    const [chooseRequests, setChooseRequests] = useAtom(chooseAtom);
    const open = (resume = false, weightType = null) => setRequest(previous => previous ?? { resume, weightType });
    const chooseTranslator = () => setChooseRequests(count => count + 1);
    return { request, open, setRequest, waiting, setWaiting, chooseRequests, chooseTranslator };
};
