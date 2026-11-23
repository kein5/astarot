import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

// A plain notice card over the locked page, in the page's own surface and
// border; the failed state is carried by the left rule, not by a red fill.
export const dialog = style({
    position: "absolute",
    inset: 0,
    zIndex: 10,
    boxSizing: "border-box",
    width: "min(48rem, calc(100% - 3.2rem))",
    maxHeight: "calc(100% - 3.2rem)",
    height: "fit-content",
    margin: "auto",
    padding: "2rem 2.2rem",
    overflowY: "auto",
    overflowWrap: "anywhere",
    border: `.1rem solid ${vars.vox_border}`,
    borderLeft: `.3rem solid ${vars.vox_state_failed}`,
    borderRadius: vars.vox_radius,
    background: vars.vox_surface,
    boxShadow: vars.vox_shadow_overlay,
    color: vars.dark_200_color,
    fontSize: "1.4rem",
    lineHeight: 1.7,
});

globalStyle(`${dialog} p + p`, { marginTop: ".8rem" });

export const title = style({
    marginBottom: "1rem",
    fontSize: "1.8rem",
    fontWeight: 650,
    lineHeight: 1.5,
    color: vars.dark_100_color,
});

export const detail = style({
    fontSize: "1.3rem",
    color: vars.vox_description_text,
});

export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    gap: ".8rem",
    marginTop: "1.8rem",
});

globalStyle(`${actions} button`, {
    minHeight: "4rem",
    padding: ".8rem 1.4rem",
    borderRadius: vars.vox_radius,
    fontSize: "1.4rem",
    fontWeight: 500,
    cursor: "pointer",
});
globalStyle(`${actions} button:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" });

export const retry = style({
    background: vars.primary_600_color,
    color: vars.vox_on_primary,
    selectors: {
        "&:hover": { background: vars.primary_550_color },
    },
});

// An outline beside Retry: with no fill, its border is its only edge, so it is the field
// border (DESIGN.md "Colors"), not the hairline between regions.
export const quit = style({
    border: `.1rem solid ${vars.vox_field_border}`,
    background: "transparent",
    color: vars.dark_200_color,
    selectors: {
        "&:hover": { background: vars.vox_secondary_hover },
    },
});
