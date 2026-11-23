import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// The link carries its own look, so it reads as a link on pages whose
// form styles do not reach it (the translation page) as well as inside them.
export const container = style({
    margin: ".4rem 0",
    fontSize: "1.3rem",
    lineHeight: 1.5,
});
globalStyle(`${container} a`, { color: vars.primary_300_color, textDecoration: "underline" });
globalStyle(`${container} a:hover`, { color: vars.primary_200_color });
