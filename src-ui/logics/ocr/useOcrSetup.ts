import { atom, useAtom } from "jotai";

// DOM queries return Element, which has no focus(); every HTML and SVG element has one.
const isFocusable = (element: Element): element is Element & HTMLOrSVGElement =>
    "focus" in element && typeof element.focus === "function";

export interface OcrSetup {
    open: boolean;
    show: () => void;
    setOpen: (open: boolean) => void;
    // The models a download was started for from the dialog (#1241): once all of them are here,
    // chat reading is turned on. null while none was started.
    waiting: readonly string[] | null;
    setWaiting: (waiting: readonly string[] | null) => void;
}

// Main-window only. Raised when the user turns chat reading on and the models for
// its language are missing. The dialog it opens offers them, each with its review
// (source, license, size, consent) before it downloads (#1241). The wait for the
// downloads outlives the dialog.
const requestAtom = atom(false);
const waitingAtom = atom<readonly string[] | null>(null);
export const useOcrSetup = (): OcrSetup => {
    const [open, setOpen] = useAtom(requestAtom);
    const [waiting, setWaiting] = useAtom(waitingAtom);
    return { open, show: () => setOpen(true), setOpen, waiting, setWaiting };
};

export interface FocusOcrModelsOptions {
    doc?: Pick<Document, "querySelector"> | null;
    wait?: (callback: () => void, delay: number) => unknown;
    attempts?: number;
    delay?: number;
}

// The models section appears once the OCR settings have asked which models the
// language needs, a moment after the tab opens. Wait for it, open its part (closed
// at first, as every catalog's part), then bring it into view and put focus on a
// model's first action, so the keyboard lands where the download review starts,
// not on the catalog's layout buttons above the cards.
export const OCR_MODELS_SETTING_ID = "ocr_models";
export const focusOcrModels = ({ doc = globalThis.document, wait = setTimeout, attempts = 75, delay = 40 }: FocusOcrModelsOptions = {}): void => {
    const step = (left: number): void => {
        const section = doc?.querySelector?.(`[data-setting-id="${OCR_MODELS_SETTING_ID}"]`);
        if (!section) {
            if (left > 0) wait(() => step(left - 1), delay);
            return;
        }
        for (const fold of section.querySelectorAll<HTMLDetailsElement>("details[data-catalog-fold]")) fold.open = true;
        const action = [...section.querySelectorAll<HTMLButtonElement>("[data-model-download] button")].find(button => !button.disabled);
        const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        section.scrollIntoView?.({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
        const target = action ?? section;
        if (isFocusable(target)) target.focus({ preventScroll: true });
    };
    wait(() => step(attempts), delay);
};
