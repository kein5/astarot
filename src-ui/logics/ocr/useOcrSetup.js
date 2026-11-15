import { atom, useAtom } from "jotai";

// Main-window only. Raised when the user turns chat reading on and the models for
// its language are missing. The dialog it opens leads to the settings section that
// reviews and fetches them (source, license, size, consent); nothing downloads here.
const requestAtom = atom(false);
export const useOcrSetup = () => {
    const [open, setOpen] = useAtom(requestAtom);
    return { open, show: () => setOpen(true), setOpen };
};

// The models section appears once the OCR settings have asked which models the
// language needs, a moment after the tab opens. Wait for it, then bring it into
// view and put focus on its first action, so the keyboard lands where the
// download review starts.
export const OCR_MODELS_SETTING_ID = "ocr_models";
export const focusOcrModels = ({ doc = globalThis.document, wait = setTimeout, attempts = 75, delay = 40 } = {}) => {
    const step = left => {
        const section = doc?.querySelector?.(`[data-setting-id="${OCR_MODELS_SETTING_ID}"]`);
        if (!section) {
            if (left > 0) wait(() => step(left - 1), delay);
            return;
        }
        const action = [...section.querySelectorAll("button")].find(button => !button.disabled && !button.closest("dialog"));
        const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        section.scrollIntoView?.({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
        (action ?? section).focus({ preventScroll: true });
    };
    wait(() => step(attempts), delay);
};
