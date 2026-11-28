import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// An element that can take focus: every HTML and SVG element. DOM queries return Element,
// which has no focus(); this tells the two apart without assuming the element's kind.
type Focusable = Element & HTMLOrSVGElement;

const focusable = (element: Element | null | undefined): element is Focusable =>
    !!element && "focus" in element && typeof element.focus === "function";

// Not every element has `disabled`; one without it is enabled.
const available = (element: Element | null | undefined): element is Focusable => focusable(element) &&
    element.isConnected && !("disabled" in element && element.disabled) && !element.matches?.(":disabled") &&
    element.getAttribute("aria-disabled") !== "true";

export interface ConsentDialog {
    dialog: RefObject<HTMLDialogElement | null>;
    close: () => void;
}

// Close synchronously before removing the dialog. Restore focus after the commit,
// when download startup may have disabled or replaced the review button.
export function useConsentDialog(open: boolean, fallback?: RefObject<HTMLElement | null> | null): ConsentDialog {
    const dialog = useRef<HTMLDialogElement>(null);
    const opener = useRef<Focusable | null>(null);
    // The element that opened the dialog, read before the dialog takes the focus: the kit's Dialog,
    // drawn inside the caller, shows itself in its own effect, which runs before the caller's.
    useLayoutEffect(() => {
        if (!open) {
            opener.current = null;
            return;
        }
        // StrictMode replays the effects after closing the dialog, when focus is
        // already on the body. Keep the element that opened the dialog.
        const active = document.activeElement;
        if (!opener.current && focusable(active) && active !== document.body && !dialog.current?.contains?.(active)) opener.current = active;
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const node = dialog.current;
        const trigger = opener.current;
        const nearby = trigger?.closest("[data-model-download], [data-setting-id]");
        // Shown once: by the kit's Dialog when it holds the dialog, by this hook otherwise.
        if (!node?.open) node?.showModal();
        return () => {
            if (node?.open) node.close();
            queueMicrotask(() => {
                // React StrictMode may already have reopened this same dialog.
                if (node?.open) return;
                if (available(trigger)) { trigger.focus(); return; }
                const scope = nearby?.isConnected ? nearby : fallback?.current;
                const control = [...(scope?.querySelectorAll("button, input, select, summary, [tabindex]") ?? [])]
                    .find((element): element is Focusable => available(element) && !element.closest("dialog") && element.tabIndex >= 0);
                if (control) control.focus();
                // All actions may be busy. The caller's labelled section remains
                // focusable even when the nearer template wrapper is not.
                else if (fallback?.current?.isConnected) fallback.current.focus();
                else if (scope?.isConnected && focusable(scope)) { scope.tabIndex = -1; scope.focus(); }
            });
        };
    }, [open, fallback]);
    const close = (): void => { if (dialog.current?.open) dialog.current.close(); };
    return { dialog, close };
}
