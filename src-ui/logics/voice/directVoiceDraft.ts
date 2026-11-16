// How the direct voice settings form reads the saved settings on each page.
// "all" edits everything, "rvc" is the RVC page, "legacy" is input forwarding
// under the advanced settings.
export type DirectVoiceVariant = "all" | "rvc" | "legacy";

export interface DirectVoiceSelection {
    mode?: string;
    engine?: string;
    [key: string]: unknown;
}

// The form's saved value. The RVC page edits converted RVC, so it starts from that.
// Input forwarding keeps the saved mode as it is: the page never edits it, and a
// save from there must not drop the conversion chosen on the RVC page (#429).
export const directSavedDraft = <T extends DirectVoiceSelection>(defaults: T, settings: DirectVoiceSelection | null | undefined,
    variant: DirectVoiceVariant): T | null => {
    if (!settings) return null;
    const value = { ...defaults, ...settings } as T;
    if (variant === "rvc") return { ...value, mode: "converted", engine: "rvc" };
    return value;
};

// Whether the page shows and starts a conversion. Input forwarding only forwards;
// the conversion is the RVC page's.
export const directShowsConversion = (draft: DirectVoiceSelection, variant: DirectVoiceVariant): boolean =>
    variant !== "legacy" && draft.mode === "converted";

// Whether the draft selects a mode or engine the backend has not saved yet. The RVC
// page selecting RVC is itself a change to save. Input forwarding selects nothing.
export const directSelectionPending = (draft: DirectVoiceSelection, settings: DirectVoiceSelection | null | undefined,
    variant: DirectVoiceVariant): boolean =>
    variant !== "legacy" && (draft.mode !== settings?.mode || draft.engine !== settings?.engine);
