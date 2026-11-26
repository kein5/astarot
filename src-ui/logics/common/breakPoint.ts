// Where the narrow layout starts (useWindow.ts): a window as wide as 800 CSS pixels or less, at a
// UI size of 100%. CSS width queries miss the UI size: at 200% an 870px window lays out like a 435px
// one, so the limit grows with it.
export const isNarrowWidth = (width: number, uiScaling: number): boolean => width <= 800 * (uiScaling / 100);
