import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const flex_column = style({});

// Same 1fr / 1.6fr columns and stacking breakpoints as Templates.css.ts (#567, #1096).
const stacked = { gridTemplateColumns: "minmax(0, 1fr)", alignItems: "stretch" } as const;

export const auto_export_message_logs_container = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    width: "100%",
    minWidth: 0,
    alignItems: "center",
    padding: "2rem 0",
    columnGap: "1.6rem",
    rowGap: ".8rem",
    borderBottom: `solid 0.1rem ${vars.dark_800_color}`,
    selectors: {
        [`&.${flex_column}`]: { gridTemplateColumns: "minmax(0, 1fr)" },
    },
    "@container": { "(max-width: 41.6rem)": stacked },
    "@media": { "(max-width: 700px)": stacked },
});
globalStyle(`${auto_export_message_logs_container} > *`, { minWidth: 0, maxWidth: "100%" });

// The checkbox sits flush at the row's right end, with the folder button beside it (#1096).
export const auto_export_message_logs_switch_section_container = style({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    minWidth: 0,
    maxWidth: "100%",
    alignItems: "center",
    gap: "0.6rem",
});
