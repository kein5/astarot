import { style } from "@vanilla-extract/css";

export const marquee = style({
    overflow: "hidden",
    width: "100%",
});

export const content = style({
    display: "inline-block",
    whiteSpace: "nowrap",
    willChange: "transform",
    paddingRight: "0.5rem",
});
