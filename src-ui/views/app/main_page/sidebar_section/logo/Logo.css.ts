import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

export const container = style({
    height: vars.main_page_topbar_height,
    display: "flex",
    alignItems: "center",
    padding: "0 2rem",
    flexShrink: 0,
});

export const wordmark = style({
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    whiteSpace: "nowrap",
    color: vars.dark_100_color,
});

// The SVGs fill with currentColor; their aspect ratios come from docs/brand/astarot.
export const symbol = style({ height: "3.2rem", width: "auto", aspectRatio: "294 / 300", flexShrink: 0 });
export const name = style({ height: "1.6rem", width: "auto", aspectRatio: "889 / 131" });
