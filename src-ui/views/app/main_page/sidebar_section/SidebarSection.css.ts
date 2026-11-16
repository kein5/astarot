import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

const RAIL = "24rem";
const ICON_RAIL = "7.2rem";

// The rail is a column: the logo, the scrolling switches and languages, and the settings
// button at the foot. The button is a flex child, so the scrolling part ends where it
// starts, whatever its size (no hand-added margins).
export const container = style({
    position: "relative",
    width: RAIL,
    minWidth: RAIL,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: vars.vox_rail,
});

export const isCompactMode = style({ width: ICON_RAIL, minWidth: ICON_RAIL });

// Opened from the icon rail in a narrow window: the full rail lies over the conversation,
// which keeps the width of the icon rail beside it.
export const isOverlay = style({
    zIndex: 40,
    marginInlineEnd: `calc(${ICON_RAIL} - ${RAIL})`,
    boxShadow: vars.vox_shadow_overlay,
});

// The track is quiet and the thumb stands out from it, so a rail that goes on below the
// window says so. Without overflow there is no thumb to see.
export const scrollContainer = style({
    flex: "1 1 auto",
    minHeight: 0,
    width: "100%",
    overflowY: "scroll",
    overflowX: "hidden",
    selectors: {
        "&::-webkit-scrollbar": { width: "0.8rem" },
        // The icon rail has 72px; its scrollbar takes less of them.
        [`${isCompactMode} &::-webkit-scrollbar`]: { width: ".6rem" },
        "&::-webkit-scrollbar-track": { backgroundColor: "transparent" },
        "&::-webkit-scrollbar-thumb": {
            backgroundColor: vars.dark_750_color,
            border: `.2rem solid ${vars.vox_rail}`,
            borderRadius: "0.4rem",
        },
        "&:hover::-webkit-scrollbar-thumb": { backgroundColor: vars.dark_650_color },
    },
});

// Closes the opened rail; in the logo row, where the top bar's toggle would be.
export const closeOverlay = style({
    position: "absolute",
    top: `calc((${vars.main_page_topbar_height} - 4rem) / 2)`,
    right: ".8rem",
    width: "3.2rem",
    height: "4rem",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: ".8rem",
    color: vars.dark_400_color,
    cursor: "pointer",
    selectors: {
        "&:hover": { background: vars.dark_850_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
    },
});

export const closeOverlaySvg = style({ width: "1.2rem", height: "2rem" });
