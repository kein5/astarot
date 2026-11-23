import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const flex_column = style({});

export const auto_export_message_logs_container = style({
    display: "flex",
    flexWrap: "wrap",
    width: "100%",
    minWidth: 0,
    justifyContent: "space-between",
    alignItems: "center",
    padding: "2rem 0",
    gap: "2rem",
    borderBottom: `solid 0.1rem ${vars.dark_800_color}`,
    selectors: {
        [`&.${flex_column}`]: { flexDirection: "column" },
    },
});
globalStyle(`${auto_export_message_logs_container} > *`, { maxWidth: "100%" });

// The folder button sits next to the checkbox it belongs to.
export const auto_export_message_logs_switch_section_container = style({
    display: "flex",
    flexWrap: "wrap",
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "100%",
    alignItems: "center",
    gap: "1.2rem",
});
