// Where the translator list popover goes in the window. No DOM is touched here:
// the component measures the button, rail, panel and window, and hands them in.

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface PopoverInput {
    anchor: Box;
    railRight: number;
    panel: Size;
    viewport: Size;
    gap: number;
    margin: number;
    topEdge: number;
}

export interface PopoverPlacement {
    left: number;
    top: number;
    maxHeight: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));

// Opens beside the rail on the right, aligned with the translator button's foot, so neither
// the rail's switches and language controls nor the conversation moves (#1095). When a narrow
// window has no room beside the rail, it stays inside the window above the button instead,
// capped to the workspace below the title bar.
export function placeTranslatorPopover({ anchor, railRight, panel, viewport, gap, margin, topEdge }: PopoverInput): PopoverPlacement {
    const minTop = Math.max(margin, topEdge + margin);
    const maxHeight = Math.max(120, Math.floor(viewport.height - minTop - margin));
    const width = Math.min(panel.width, Math.max(0, viewport.width - margin * 2));
    const height = Math.min(panel.height, maxHeight);
    const rightStart = Math.max(anchor.left + anchor.width, railRight) + gap;

    if (rightStart + width <= viewport.width - margin) {
        return {
            left: Math.round(rightStart),
            top: Math.round(clamp(anchor.top + anchor.height - height, minTop, viewport.height - margin - height)),
            maxHeight,
        };
    }

    return {
        left: Math.round(clamp(anchor.left, margin, viewport.width - margin - width)),
        top: Math.round(clamp(anchor.top - gap - height, minTop, viewport.height - margin - height)),
        maxHeight,
    };
}

// Whether the trigger button is still in sight inside the scrolling rail.
export function isAnchorInScrollport(anchor: Box, scrollport: Box): boolean {
    return anchor.top + anchor.height > scrollport.top && anchor.top < scrollport.top + scrollport.height;
}
