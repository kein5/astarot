import { style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

export const is_closed = style({});

export const page = style({
    position: "absolute",
    width: "100%",
    height: "100%",
    top: 0,
    left: 0,
    overflow: "hidden",
    visibility: "visible",
    transition: "visibility 0s linear 0s",
    selectors: {
        [`&.${is_closed}`]: {
            pointerEvents: "none",
            visibility: "hidden",
            // Keep settings behind the main page only for its short slide back.
            transition: "visibility 0s linear 0.12s",
        },
    },
});

// A narrow window: the search over the whole width, the save bar under it.
const NARROW_GRID = {
    gridTemplateColumns: "5.6rem minmax(0, 1fr) auto auto",
    gridTemplateRows: "auto auto minmax(0, 1fr)",
    gridTemplateAreas: '"search search stop stop" ". save save back" "sidebar main main main"',
} as const;

export const container = style({
    width: "100%",
    height: "100%",
    // Search and the top-bar controls share tracks. Their intrinsic sizes can
    // no longer overlap independently positioned elements.
    display: "grid",
    gridTemplateColumns: `${vars.config_page_sidebar_width} auto minmax(0, 1fr) auto`,
    gridTemplateRows: "auto minmax(0, 1fr)",
    gridTemplateAreas: '"search stop save back" "sidebar main main main"',
    backgroundColor: vars.vox_canvas,
    overflow: "hidden",
    position: "relative",
    "@media": { "(max-width: 800px)": NARROW_GRID },
    // The UI-size-aware breakpoint (useWindow.ts) also selects the narrow layout.
    selectors: { "html[data-narrow] &": NARROW_GRID },
});

export const content_wrapper = style({
    display: "contents",
});

export const main_container = style({
    gridArea: "main",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
});
