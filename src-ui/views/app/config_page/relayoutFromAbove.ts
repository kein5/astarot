// Lays the settings page out again, from the frame that holds it (ConfigPage.tsx, as it opens).
//
// WebKitGTK 2.52 (the Linux app) sometimes stops laying the settings page out when a change of its
// style lands at its first layout, at the start: the narrow layout, or the menu turning to icons.
// The page keeps that first layout, later changes in it are not laid out, and what mounts in it
// afterwards (a page of settings) is not laid out at all: at 150% the settings menu stayed below the
// window, 0px tall, and could not be pressed. A change of the page itself, or of the grid in it,
// does not lay it out again; a change of the frame above it does, because the next layout then
// starts above the page. The change is made, laid out and undone at once, before anything is
// painted, so nothing on screen moves.
export const relayoutFromAbove = (page: HTMLElement | null | undefined) => {
    const frame = page?.parentElement;
    if (!frame) return;
    frame.style.setProperty("padding-top", "1px");
    frame.getBoundingClientRect();
    frame.style.removeProperty("padding-top");
};
