import { atom, useAtom } from "jotai";
import type { RecognitionFix } from "./recognitionFix";

// A model download started from the fix (#1225): the switch it fixes, the catalog id, the job id
// the state showed before it was started (an earlier job is not this one), and the recognition
// model path saved when it started, which the apply expects and whose change says it was applied.
export interface RecognitionFixWait {
    fix: RecognitionFix;
    model: string;
    before: string | null;
    expected: string;
}

// Main-window only. A refused Mic transcription or Listening switch opens the fix; a newer refusal
// replaces the one shown. The wait for a download outlives the dialog.
const requestAtom = atom<RecognitionFix | null>(null);
const waitingAtom = atom<RecognitionFixWait | null>(null);

export const useRecognitionFix = () => {
    const [request, setRequest] = useAtom(requestAtom);
    const [waiting, setWaiting] = useAtom(waitingAtom);
    const open = (fix: RecognitionFix) => setRequest(fix);
    return { request, open, setRequest, waiting, setWaiting };
};
