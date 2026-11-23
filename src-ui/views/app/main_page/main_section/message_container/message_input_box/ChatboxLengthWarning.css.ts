import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const warning = style({
    flexShrink: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "0.2rem 1rem",
    marginBottom: "0.6rem",
    padding: "0.6rem 1.2rem",
    fontSize: "1.3rem",
    lineHeight: 1.5,
    color: vars.vox_state_warning,
    backgroundColor: vars.vox_warning_tint,
    borderRadius: "0.8rem",
});

export const count = style({
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
});
