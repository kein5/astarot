import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// A horizontal progress bar (U-05): the look the forms gave their <progress> before it moved into
// the kit, kept by the decision of 2026-11-25 (D-32). The track and the value are the same palette
// at two lightnesses (a dark track, the value in primary_500), not shadcn/ui's primary/20 track;
// .6rem high with round ends (half its height). The engines draw a native bar each their own way,
// so each part is named: WebView2 and WebKitGTK through ::-webkit-progress-*, Firefox through
// ::-moz-progress-bar. Each pseudo-element has its own rule, since an engine drops a whole rule
// whose selector names one it does not know.
export const progress = style({
    width: "100%",
    height: ".6rem",
    appearance: "none",
    WebkitAppearance: "none",
    border: 0,
    borderRadius: ".3rem",
    overflow: "hidden",
    background: vars.dark_825_color,
    selectors: {
        "&::-webkit-progress-bar": { background: vars.dark_825_color, borderRadius: ".3rem" },
        "&::-webkit-progress-value": { background: vars.primary_500_color, borderRadius: ".3rem" },
        "&::-moz-progress-bar": { background: vars.primary_500_color, borderRadius: ".3rem" },
    },
});
