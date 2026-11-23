import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const is_break_point = style({});
export const is_disabled = style({});

export const container = style({
    display: "flex",
    flexDirection: "row",
    gap: "2.4rem",
    width: "100%",
    minWidth: 0,
    selectors: {
        [`&.${is_break_point}`]: { width: "100%", justifyContent: "space-between" },
    },
});

export const wrapper = style({
    display: "flex",
    flexDirection: "column",
    gap: "1.2rem",
    flex: "1 1 auto",
    minWidth: 0,
});

export const each_dropdown_menu_wrapper = style({
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    whiteSpace: "nowrap",
    // A choice fills the field column (#567); several stack in the wrapper above.
    width: "100%",
    minWidth: 0,
    selectors: {
        [`&.${is_disabled}`]: { pointerEvents: "none" },
    },
});

export const secondary_label = style({
    paddingLeft: "0.2rem",
    paddingRight: "0.4rem",
    fontSize: "1.4rem",
    color: vars.dark_500_color,
    whiteSpace: "nowrap",
});
