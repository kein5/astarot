// The VR launcher's band in logical px (#1248). The band is the launcher region's width
// (LAUNCHER_WIDTH_PX in native/vr-overlay/src/layout.rs, `launcher` in vr_layout.json), and the
// buttons must fit inside it: content wider than the band is pushed together, so neighbours
// overlap, and the last button is cut at the band's edge. The styles (VrLauncher.css.ts) take their
// sizes from here, and a test checks that the launcher's buttons fit.
export const LAUNCHER_PADDING = 12;
export const LAUNCHER_GAP = 8;
// All eight buttons are the same size; their names show in the tooltip, not on the button. Since
// #1314 they are five switches and the stop, then the log and the button that lists the other windows.
export const LAUNCHER_BUTTON = { width: 96, height: 104 } as const;
export const LAUNCHER_DIVIDER = { width: 4, height: 72, margin: 4 } as const;

// The width of the launcher's content for groups of `groups[i]` buttons, with `dividers` dividers
// between groups (one between each two unless fewer are given: the stop follows the text to speech
// switch with no divider, #1314).
export const launcherContentWidth = (groups: readonly number[], dividers: number = Math.max(groups.length - 1, 0)): number => {
    const buttons = groups.reduce((sum, count) => sum + count * LAUNCHER_BUTTON.width + Math.max(count - 1, 0) * LAUNCHER_GAP, 0);
    // The container's own gap sits between each group and divider.
    const items = groups.length + dividers;
    return 2 * LAUNCHER_PADDING + buttons + dividers * (LAUNCHER_DIVIDER.width + 2 * LAUNCHER_DIVIDER.margin) + Math.max(items - 1, 0) * LAUNCHER_GAP;
};
