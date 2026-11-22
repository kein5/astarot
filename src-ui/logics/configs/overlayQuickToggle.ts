// The quick settings' subtitle overlay (#939): one toggle for the two overlays in VR, the
// one-line and the multi-line, which the captions and VR page turns on one by one.

export interface OverlayPair {
    small: boolean;
    large: boolean;
}
export type OverlayName = keyof OverlayPair;

// Pressed while either is on: the ones on go off, and which they were is kept for the next press.
// Pressed while both are off: the ones kept come back on, or the one-line overlay when none is
// kept (the first press of a run, or both turned off on the settings page). Returns the overlays
// to switch and what to keep.
export const overlayToggle = (now: OverlayPair, kept: OverlayPair | null): { flip: OverlayName[]; keep: OverlayPair | null } => {
    const on = (pair: OverlayPair): OverlayName[] => (["small", "large"] as const).filter(name => pair[name]);
    if (now.small || now.large) return { flip: on(now), keep: { ...now } };
    const back = kept && (kept.small || kept.large) ? kept : { small: true, large: false };
    return { flip: on(back), keep: kept };
};
