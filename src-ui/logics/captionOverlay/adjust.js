// Moving the desktop caption window and changing its text size with Ctrl held
// (src-tauri/src/caption_overlay.rs). The native side reports a drop or a size
// step; the main window saves them like any other setting.

// The same range and step as the size slider in the settings.
export const FONT_SIZE_MIN = 16;
export const FONT_SIZE_MAX = 72;
export const FONT_SIZE_STEP = 2;

// One press of Ctrl and + (1) or - (-1). Anything else keeps the size.
export const steppedFontSize = (size, change) => {
    if (change !== 1 && change !== -1) return size;
    const next = size + change * FONT_SIZE_STEP;
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next));
};

// The saved place, or a drop the native side reported, as the native command takes it:
// null for the band, and for anything malformed.
export const placementOf = data =>
    Number.isInteger(data?.x) && Number.isInteger(data?.y) ? { x: data.x, y: data.y } : null;
