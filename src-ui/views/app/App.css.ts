import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

export const container = style({
    width: "100%",
    height: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    backgroundColor: vars.dark_888_color,
    alignItems: "center",
});

export const pages_wrapper = style({
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
});
