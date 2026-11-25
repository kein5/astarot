// Where the translator list popover opens. No DOM is touched here: the component measures the
// button, the rail, the panel and the window, and hands them in; the kit's Popover (Radix) places
// the panel from the side chosen here and keeps it inside the window.

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface SideInput {
    anchor: Box;
    railRight: number;
    panelWidth: number;
    viewportWidth: number;
    gap: number;
    margin: number;
}

export interface PopoverSide {
    side: "right" | "top";
    align: "end" | "start";
    // From the button's edge on that side, in px.
    sideOffset: number;
}

// Opens beside the rail on the right, its foot aligned with the button's, so neither the rail's
// switches and language controls nor the conversation moves (#1095): the offset reaches past the
// rail's edge. When a narrow window has no room beside the rail for the panel's full width, it
// opens above the button, from its left edge, inside the window (a panel shrunk to a window that
// cannot hold it never has room beside the rail).
export function translatorPopoverSide({ anchor, railRight, panelWidth, viewportWidth, gap, margin }: SideInput): PopoverSide {
    const anchorRight = anchor.left + anchor.width;
    const rightStart = Math.max(anchorRight, railRight) + gap;
    if (rightStart + panelWidth <= viewportWidth - margin) {
        return { side: "right", align: "end", sideOffset: Math.round(rightStart - anchorRight) };
    }
    return { side: "top", align: "start", sideOffset: Math.round(gap) };
}

// How tall the panel may be, in px: the window below the title bar (topEdge), less the margin
// above and below, and never less than 120. It is fixed from the window, not from where Radix places
// the panel: a height that followed the place would resize the panel each time Radix placed it, and
// WebKit reports that loop of its ResizeObserver as an error on the page.
export function translatorPanelMaxHeight({ viewportHeight, topEdge, margin }: { viewportHeight: number; topEdge: number; margin: number }): number {
    return Math.max(120, Math.floor(viewportHeight - topEdge - margin * 2));
}

// Whether the trigger button is still in sight inside the scrolling rail.
export function isAnchorInScrollport(anchor: Box, scrollport: Box): boolean {
    return anchor.top + anchor.height > scrollport.top && anchor.top < scrollport.top + scrollport.height;
}
