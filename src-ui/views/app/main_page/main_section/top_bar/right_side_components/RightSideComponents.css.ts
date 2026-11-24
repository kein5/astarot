import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, NARROW_COLUMN, shorterThan } from "../../../layout.ts";

// A narrow column keeps the icon; the words stay the button's accessible name.
// The same width as the stop actions' short words (TopBar.css.ts).
const NARROW = `${MAIN_SECTION_CONTAINER} (max-width: ${NARROW_COLUMN})`;
const SHORT = shorterThan(MAIN_SECTION_CONTAINER);
// Out of sight in a narrow column, still read: the words of the quick settings and the update buttons.
const readOnly = {
    position: "absolute",
    width: ".1rem",
    height: ".1rem",
    margin: "-.1rem",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
} as const;

export const container = style({
    // The quick settings panel hangs from this group's right edge.
    position: "relative",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: ".8rem",
    // As high as the bar, on its line or on a second one of its own; at the bar's end either
    // way (TopBar.css.ts, #562).
    alignSelf: "stretch",
    minHeight: `calc(${vars.main_page_topbar_height} - .1rem)`,
    marginInlineStart: "auto",
    flexShrink: 0,
    "@container": { [NARROW]: { gap: ".4rem" } },
});

// Quick settings: one button for the window and VRChat toggles, saying how many are on.
export const menu = style({ height: "100%", display: "flex", alignItems: "center" });
export const menu_button = style({
    display: "flex",
    alignItems: "center",
    gap: ".8rem",
    minHeight: "3.6rem",
    padding: ".4rem 1rem",
    borderRadius: vars.vox_radius,
    color: vars.dark_200_color,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
        '&[aria-expanded="true"]': { backgroundColor: vars.dark_850_color },
    },
    "@container": {
        [NARROW]: { padding: ".4rem .8rem" },
        [SHORT]: { minHeight: "3.2rem", paddingBlock: ".2rem" },
    },
});
export const has_on = style({});
export const menu_svg = style({
    width: "2rem",
    height: "2rem",
    flexShrink: 0,
    fill: "currentColor",
    color: vars.dark_400_color,
    selectors: { [`${has_on} &`]: { color: vars.primary_300_color } },
});
export const menu_text = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: ".1rem",
    "@container": { [NARROW]: readOnly },
});
export const menu_label = style({ fontSize: "1.3rem", whiteSpace: "nowrap" });
export const menu_state = style({
    fontSize: "1.2rem",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    color: vars.vox_secondary_text,
    selectors: { [`${has_on} &`]: { color: vars.primary_300_color } },
});
// Sized by the conversation column it opens in (cqw, cqh: MainSection), not by the
// window, so it never runs past the column's left edge, and a short window
// scrolls the panel instead of pushing its end out of sight.
export const menu_panel = style({
    position: "absolute",
    top: "calc(100% - .4rem)",
    right: 0,
    zIndex: 30,
    width: "max-content",
    minWidth: "min(26rem, calc(100cqw - 2.4rem))",
    maxWidth: "min(34rem, calc(100cqw - 2.4rem))",
    maxHeight: `calc(100cqh - ${vars.main_page_topbar_height})`,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: ".4rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    background: vars.vox_surface,
    boxShadow: vars.vox_shadow_overlay,
});
export const menu_readout = style({ margin: ".4rem", fontSize: "1.2rem" });
// Under the subtitle overlay's row: where its position and look are set (#939). A link, as the
// guide links are: it leads to another place, it switches nothing.
export const menu_link = style({
    display: "block",
    margin: "0 .4rem .6rem auto",
    padding: ".2rem .4rem",
    border: 0,
    background: "none",
    cursor: "pointer",
    fontSize: "1.2rem",
    textAlign: "end",
    color: vars.primary_300_color,
    textDecoration: "underline",
    selectors: {
        "&:hover": { color: vars.primary_200_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem", borderRadius: ".4rem" },
    },
});

export const help_and_info_button = style({
    padding: "0.6rem",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_900_color },
    },
});

export const help_svg = style({
    width: "2.4rem",
    color: vars.dark_400_color,
});

// The update button is the kit's plain Button (RightSideComponents.tsx), which draws it; this class
// names it for the mark on its icon.
export const software_update_button = style({});

export const refresh_svg = style({
    width: "1.8rem",
    transform: "rotate(-30deg)",
});

// A version is out: a dot on the icon's corner, ringed in the button's ground so it stands off the
// arrow. The ground is the kit's plain button: the raised surface, darker under the pointer and
// when pressed (Button.css.ts).
export const update_icon = style({ position: "relative", display: "flex" });
export const update_mark = style({
    position: "absolute",
    top: "-.2rem",
    right: "-.4rem",
    width: ".8rem",
    height: ".8rem",
    borderRadius: "50%",
    background: vars.primary_200_color,
    boxShadow: `0 0 0 .2rem ${vars.vox_surface}`,
    selectors: {
        [`${software_update_button}:hover &`]: { boxShadow: `0 0 0 .2rem ${vars.vox_secondary_hover}` },
        [`${software_update_button}:active &`]: { boxShadow: `0 0 0 .2rem ${vars.dark_925_color}` },
    },
});

export const software_update_label = style({
    fontSize: "1.3rem",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    // The update button keeps its arrow and the mark on it; its words stay the accessible name.
    "@container": { [NARROW]: readOnly },
});
