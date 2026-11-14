import { atom, useAtom } from "jotai";

// Main-window only. The request to review and fetch the built-in translation
// model: raised when the user turns Translation on without it, or asks from the
// empty conversation. `resume` is true when the switch should be tried again
// once the model is there. `weightType` names the model to review when it is not
// the selected one (retrying a failed download); null reviews the selected model.
const requestAtom = atom(null);
export const useTranslationSetup = () => {
    const [request, setRequest] = useAtom(requestAtom);
    const open = (resume = false, weightType = null) => setRequest(previous => previous ?? { resume, weightType });
    return { request, open, setRequest };
};
