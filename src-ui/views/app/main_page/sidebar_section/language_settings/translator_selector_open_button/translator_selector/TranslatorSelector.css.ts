import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const is_selected = style({});
export const is_available = style({});

// Opens as a floating popover beside the rail, out of the rail's flow, so neither the
// rail's switches and language fields nor the conversation column moves (#1095).
export const container = style({
    position: "fixed",
    zIndex: 50,
    width: "min(38rem, calc(100vw - 1.6rem))",
    overflowY: "auto",
    overscrollBehavior: "contain",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    boxShadow: vars.vox_shadow_overlay,
    outline: "none",
});

export const relative_container = style({
    display: "flex",
    flexDirection: "column",
});

export const unavailable_hint = style({
    padding: "1rem 1rem 0",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});

// Three engines a row in the 38rem popover; fewer when a narrow window shrinks it.
export const wrapper = style({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
    gap: ".8rem",
    padding: "1rem",
});

export const column_wrapper = style({
    display: "contents",
});

export const box = style({
    minHeight: "4.8rem",
    padding: ".6rem .4rem",
    backgroundColor: vars.dark_875_color,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: ".3rem",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    textAlign: "center",
    borderRadius: ".4rem",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_825_color },
        "&:active": {
            backgroundColor: vars.dark_900_color,
            outline: `0.1rem solid ${vars.primary_300_color}`,
        },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".1rem" },
        [`&.${is_selected}`]: {
            outline: `0.2rem solid ${vars.primary_300_color}`,
            outlineOffset: "-.2rem",
        },
        [`&:not(.${is_available})`]: {
            pointerEvents: "none",
            backgroundColor: vars.dark_950_color,
        },
        // Busy dimming; an unavailable engine already has its own look above.
        [`&.${is_available}[aria-disabled="true"]`]: { opacity: 0.55, cursor: "wait" },
    },
});

export const translator_name = style({
    fontSize: "1.3rem",
    lineHeight: 1.3,
    selectors: {
        [`${box}:not(.${is_available}) &`]: { color: vars.dark_600_color },
    },
});

// Inside the box, under the name: it no longer hangs over the box's corner.
export const label_default = style({
    padding: "0 .4rem",
    border: `.1rem solid ${vars.dark_700_color}`,
    borderRadius: "0.2rem",
    fontSize: "1.2rem",
    color: vars.vox_secondary_text,
    pointerEvents: "none",
    selectors: {
        [`&.${is_selected}`]: { borderColor: vars.primary_300_color },
    },
});

// Choosing the same language for both: the reason leads the panel, above the engines.
export const is_selected_same_language_wrapper = style({
    order: -1,
    padding: "1rem 1rem 0",
});

export const is_selected_same_language_text = style({
    fontSize: "1.3rem",
    lineHeight: 1.6,
    color: vars.vox_state_warning,
    textWrap: "balance",
});
