import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_break_point = style({});

export const container = style({
    display: "flex",
    flexDirection: "column",
});

export const mic_container = style({
    display: "flex",
    flexDirection: "column",
});

export const speaker_container = style({
    display: "flex",
    flexDirection: "column",
});

// The same label and field columns as the other setting rows (#567); one column under 16rem
// label + 24rem field + 1.6rem gap, or in a narrow window.
const stacked = { gridTemplateColumns: "minmax(0, 1fr)" } as const;
export const device_container = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    columnGap: "1.6rem",
    rowGap: "2rem",
    width: "100%",
    alignItems: "center",
    padding: "2rem 0",
    marginBottom: "0rem",
    borderBottom: `solid 0.1rem ${vars.dark_800_color}`,
    selectors: {
        [`&.${is_break_point}`]: { gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" },
    },
    "@container": { "(max-width: 41.6rem)": stacked },
    "@media": { "(max-width: 700px)": stacked },
});

export const threshold_container = style({
    padding: "2rem 0",
    display: "flex",
    width: "100%",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "stretch",
    gap: "2rem",
});

export const threshold_switch_section = style({
    display: "flex",
    width: "100%",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "1.2rem",
    flexShrink: 0,
});

export const threshold_section = style({
    width: "100%",
});

export const device_label = style({
    fontSize: "1.8rem",
});

// 自動選択 over the list, both aligned flush at the row's right end (#1096).
export const device_contents = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    width: "100%",
    minWidth: 0,
    gap: "1.2rem",
});

// 自動選択 at the start of the field column, its switch where the lists start: the space around
// the switch, its target, reaches into the gap between the columns instead.
export const auto_select = style({
    display: "flex",
    marginInlineStart: "-0.8rem",
});

export const device_auto_select_wrapper = style({
    display: "flex",
    flexDirection: "column",
    gap: "1.2rem",
    justifyContent: "center",
    alignItems: "center",
});
