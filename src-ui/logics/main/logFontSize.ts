// The log's font size, a percent of the UI size (the MessageLogUiScaling setting). The settings'
// slider and the A− and A＋ beside the composer (#1314, M-8) share its range and its step.
export const LOG_FONT_SIZE = { min: 40, max: 200, step: 10 } as const;

// The size one press of A− (-1) or A＋ (+1) sets: the next mark of the slider's scale from the
// size now, kept in the range. A size between two marks goes to the mark on the pressed side.
export const nextLogFontSize = (size: number, direction: -1 | 1): number => {
    const { min, max, step } = LOG_FONT_SIZE;
    const next = direction > 0 ? Math.floor(size / step) * step + step : Math.ceil(size / step) * step - step;
    return Math.min(max, Math.max(min, next));
};

// Whether a press on that side changes nothing: the size is at that end of the range.
export const atLogFontLimit = (size: number, direction: -1 | 1): boolean =>
    direction > 0 ? size >= LOG_FONT_SIZE.max : size <= LOG_FONT_SIZE.min;
