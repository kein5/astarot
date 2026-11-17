// What the main window tells the user when one of the windows it owns (the desktop captions, the
// VR panel) could not be opened or updated. The native side answers with an error code
// (src-tauri/src/caption_overlay.rs, src-tauri/src/lib.rs) or with a system error's text; the
// codes the user can act on have their own words, everything else gets the general one.

export type OwnedWindow = "caption_overlay" | "vr_panel";
export type WindowStep = "open" | "update";

const NAMED: ReadonlySet<string> = new Set([
    "caption_overlay_no_monitor",
    "caption_overlay_unsupported",
    "vr_panel_surface_unavailable",
]);

export const windowFailureKey = (window: OwnedWindow, step: WindowStep, error: unknown): string =>
    typeof error === "string" && NAMED.has(error)
        ? `common_error.window.${error}`
        : `common_error.window.${window}_${step}_failed`;

// One notice for a run of failures: the captions are updated at every message, and a window that
// keeps failing must not cover the screen with notices. A success ends the run.
export interface FailureRun {
    failed(notify: () => void): void;
    succeeded(): void;
}

export const failureRun = (): FailureRun => {
    let failing = false;
    return {
        failed: notify => {
            if (!failing) notify();
            failing = true;
        },
        succeeded: () => {
            failing = false;
        },
    };
};
