import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

// The virtual microphone guide (#321): one section per step, a test button beside its
// level meter, and the outcome under them.
// The steps are parts of the dialog, spaced by its gap (1.6rem) alone.
export const step = style({
    margin: 0,
});

globalStyle(`${step} h4`, { margin: "0 0 .8rem", fontSize: "1.4rem" });
globalStyle(`${step} p`, { margin: "0 0 .8rem" });
globalStyle(`${step} ol, ${step} ul`, { margin: "0 0 .8rem", paddingLeft: "2.2rem" });
globalStyle(`${step} > :last-child`, { marginBottom: 0 });
// The global reset drops list markers; steps done in order show their numbers (#476).
globalStyle(`${step} ol`, { listStyle: "decimal" });
globalStyle(`${step} ul`, { listStyle: "disc" });
globalStyle(`${step} li`, { marginBottom: ".4rem" });

export const note = style({
    fontSize: "1.2rem",
    color: fallbackVar(vars.vox_secondary_text, "#adbed6"),
});

export const searching = style({
    fontSize: "1.3rem",
});

export const choice = style({
    display: "flex",
    flexWrap: "wrap",
    gap: ".8rem",
    alignItems: "center",
    marginBottom: ".8rem",
});

globalStyle(`${choice} select`, { minWidth: 0, maxWidth: "100%" });

export const meter_row = style({
    display: "flex",
    flexWrap: "wrap",
    gap: "1.2rem",
    alignItems: "center",
    margin: ".4rem 0 .8rem",
});

globalStyle(`${meter_row} button`, { margin: 0 });

// Drawn with a transform, not the meter element: WebView2 and WebKitGTK style <meter> apart.
export const meter = style({
    flex: "1 1 12rem",
    minWidth: "8rem",
    height: "1rem",
    borderRadius: ".4rem",
    overflow: "hidden",
    background: vars.dark_825_color,
    outline: `.1rem solid ${fallbackVar(vars.dark_600_color, "#555d69")}`,
});

export const meter_fill = style({
    height: "100%",
    background: vars.primary_500_color,
    transformOrigin: "left center",
    transition: `transform ${vars.vox_motion_fast} linear`,
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});

export const heard = style({
    color: fallbackVar(vars.vox_state_active, "#80acff"),
});

export const failed = style({
    color: vars.dark_200_color,
});

globalStyle(`${failed} p`, { margin: "0 0 .4rem" });
globalStyle(`${failed} ul`, { margin: 0 });
