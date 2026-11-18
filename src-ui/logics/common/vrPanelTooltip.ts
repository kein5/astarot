// A layout or session snapshot, as far as keepNewestVrLayout reads it.
export interface VrLayoutSnapshot {
    tooltip_epoch?: number;
}

// A rectangle in CSS pixels, such as a DOMRect.
export interface TooltipRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface TooltipGeometry {
    // [left, top, width, height] of the button within the tooltip region.
    button: number[];
    arrow_x: number;
}

// The epoch of a snapshot (VrLayoutSnapshot), 0 when it has none.
const tooltipEpoch = (snapshot: unknown): number => typeof snapshot === "object" && snapshot !== null
    && "tooltip_epoch" in snapshot && typeof snapshot.tooltip_epoch === "number" ? snapshot.tooltip_epoch : 0;

// Both the main window and VR WebView discard delayed layout/session snapshots. The store
// calls this for any value of its VrPanelLayout atom, so the snapshot is checked, not assumed.
export const keepNewestVrLayout = <T>(previous: T, next: T): T =>
    tooltipEpoch(next) < tooltipEpoch(previous) ? previous : next;

export const tooltipMarker = (epoch: number, revision: number): number[] => [
    ...Array.from({ length: 48 }, (_, bit) => Math.floor(epoch / 2 ** (47 - bit)) % 2),
    ...Array.from({ length: 32 }, (_, bit) => Math.floor(revision / 2 ** (31 - bit)) % 2),
];

export const tooltipGeometry = (region: TooltipRect, button: TooltipRect, width: number, height: number): TooltipGeometry | null => {
    const sx = region.width / width;
    const sy = region.height / height;
    if (!(sx > 0 && sy > 0)) return null;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const rect = [round((button.left - region.left) / sx), round((button.top - region.top) / sy),
        round(button.width / sx), round(button.height / sy)];
    if (rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 ||
        rect[0] + rect[2] > width || rect[1] + rect[3] > height) return null;
    const center = rect[0] + rect[2] / 2;
    const left = Math.max(12, Math.min(width - 372, center - 180));
    return { button: rect, arrow_x: Math.max(12, Math.min(348, center - left)) };
};
