// How the direct voice settings form reads the saved settings on each page.
// "all" edits everything, "rvc" is the RVC page, "legacy" is input forwarding
// under the advanced settings.
export type DirectVoiceVariant = "all" | "rvc" | "legacy";

export interface DirectVoiceSelection {
    mode?: string;
    engine?: string;
    [key: string]: unknown;
}

// The form's saved value, with the mode and engine as saved on every page. A save
// from the save bar writes them back unchanged, so saving the RVC fields or input
// forwarding never switches what direct voice does (#429, #436). Switching to RVC
// is its own button on the RVC page (directRvcSelection).
export const directSavedDraft = <T extends DirectVoiceSelection>(defaults: T, settings: DirectVoiceSelection | null | undefined,
    _variant: DirectVoiceVariant): T | null => {
    if (!settings) return null;
    return { ...defaults, ...settings } as T;
};

// Whether the page shows and starts a conversion. Input forwarding only forwards;
// the RVC page always shows the RVC conversion, also before RVC is selected.
export const directShowsConversion = (draft: DirectVoiceSelection, variant: DirectVoiceVariant): boolean =>
    variant === "rvc" || (variant === "all" && draft.mode === "converted");

// Whether the RVC page still has to select converted RVC. The page says so and offers
// a button; nothing goes into the save bar until the user edits something.
export const directSelectionPending = (_draft: DirectVoiceSelection, settings: DirectVoiceSelection | null | undefined,
    variant: DirectVoiceVariant): boolean =>
    variant === "rvc" && !!settings && (settings.mode !== "converted" || settings.engine !== "rvc");

// What the RVC page's "Use RVC for direct voice" button writes: the saved settings,
// not the draft, with converted RVC selected. Unsaved edits stay in the draft.
export const directRvcSelection = <T extends DirectVoiceSelection>(defaults: T, settings: DirectVoiceSelection): T =>
    ({ ...defaults, ...settings, mode: "converted", engine: "rvc" }) as T;
