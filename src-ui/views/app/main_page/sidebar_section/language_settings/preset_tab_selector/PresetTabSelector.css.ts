import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_selected = style({});

// Three presets as a small segmented control beside the 「言語設定」 heading.
export const container = style({
    display: "flex",
    gap: ".2rem",
    padding: ".2rem",
    borderRadius: ".8rem",
    backgroundColor: vars.dark_925_color,
});

export const tab_container = style({
    height: "2.8rem",
    minWidth: "2.8rem",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: vars.vox_radius,
    color: vars.dark_600_color,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_825_color },
        "&:active": { backgroundColor: vars.dark_875_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
        [`&.${is_selected}`]: {
            backgroundColor: vars.dark_750_color,
            color: vars.dark_100_color,
            cursor: "default",
            pointerEvents: "none",
        },
        '&[aria-disabled="true"]': { opacity: 0.55, cursor: "wait" },
    },
});

export const tab_number = style({
    fontSize: "1.4rem",
    fontVariantNumeric: "tabular-nums",
});
