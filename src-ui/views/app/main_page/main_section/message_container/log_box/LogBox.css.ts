import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, NARROW_COLUMN, SHORT_REGION, shorterThan } from "../../../layout.ts";

// A narrow or short conversation column (MainSection) tightens the empty state;
// a short one also gives the log's own padding to its lines.
const NARROW_OR_SHORT = `${MAIN_SECTION_CONTAINER} (max-width: ${NARROW_COLUMN}) or (max-height: ${SHORT_REGION})`;
const SHORT = shorterThan(MAIN_SECTION_CONTAINER);

export const container = style({
    height: "100%",
    width: "100%",
    flex: 1,
    backgroundColor: vars.vox_canvas,
    overflow: "auto",
    overflowAnchor: "none", // virtua keeps the position itself; the browser's anchoring would fight it
    borderRadius: "0.8rem",
    padding: "1.6rem",
    // This is the standard font size for message logs, and is controlled by JavaScript. All child
    // elements this are generally expressed in "em" and are affected by the font size setting here.
    fontSize: "1rem",
    selectors: {
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
    },
    "@container": { [SHORT]: { padding: ".6rem 1rem" } },
});
// The greeting stands at a fixed distance from the top of the log, set by the window's
// height, not centred in the log: at startup the list under it changes (the startup steps,
// then what the engines still need) and the input box takes its saved height, and a centred
// greeting moved with both (256, 235, 174, 195 px in 0.5.0-beta.5).
export const empty = style({
    minHeight: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "clamp(3.2rem, 22vh, 24rem) 3.2rem 3.2rem",
    textAlign: "center",
    "@container": {
        [NARROW_OR_SHORT]: { paddingInline: "1rem", paddingBottom: "1rem" },
        [SHORT]: { paddingTop: "1rem" },
    },
});
export const greeting = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    selectors: {
        // Until the saved UI size arrives (EmptyState.tsx): drawn nowhere, its room kept.
        "&[data-waiting]": { visibility: "hidden" },
    },
});
export const next = style({
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginTop: "1rem",
    "@container": { [SHORT]: { marginTop: ".4rem" } },
});
globalStyle(`${empty} h1`, {
    fontSize: "2.4rem",
    fontWeight: 650,
    color: vars.dark_200_color,
    "@container": { [NARROW_OR_SHORT]: { fontSize: "1.8rem" } },
});
globalStyle(`${empty} p`, {
    maxWidth: "42rem",
    fontSize: "1.4rem",
    lineHeight: 1.8,
    color: vars.dark_450_color,
    "@container": { [NARROW_OR_SHORT]: { fontSize: "1.3rem" } },
});

// What the selected engines still need: one line each, with the step that
// provides it. A plain list between hairlines; these are not cards.
export const setup = style({
    width: "100%",
    maxWidth: "46rem",
    marginTop: "1.4rem",
    listStyle: "none",
    textAlign: "left",
    borderTop: `.1rem solid ${vars.vox_border}`,
});
globalStyle(`${setup} li`, {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: ".8rem 1.6rem",
    padding: "1rem .4rem",
    borderBottom: `.1rem solid ${vars.vox_border}`,
    fontSize: "1.4rem",
    lineHeight: 1.6,
    color: vars.dark_300_color,
});
globalStyle(`${setup} li > span:first-child`, { flex: "1 1 22rem", minWidth: 0 });
globalStyle(`${setup} button`, {
    flexShrink: 0,
    minHeight: "3.6rem",
    padding: ".6rem 1.4rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    fontSize: "1.4rem",
    fontWeight: 500,
    color: vars.dark_200_color,
    background: vars.vox_surface,
    cursor: "pointer",
});
globalStyle(`${setup} button:hover`, { background: vars.dark_800_color });
globalStyle(`${setup} button:active`, { background: vars.dark_900_color });
globalStyle(`${setup} button:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" });
// The setup's line while the setup is still suggested (#935): the setup no longer opens by
// itself, so its line leads the first screen. A lilac frame and tint, and the lilac filled button.
globalStyle(`${setup} li[data-lead]`, {
    marginBlock: ".6rem",
    padding: "1.2rem 1.4rem",
    border: `.1rem solid ${vars.primary_600_color}`,
    borderRadius: vars.vox_radius,
    background: vars.vox_highlight_tint,
    color: vars.dark_200_color,
});
globalStyle(`${setup} li[data-lead] button`, {
    borderColor: vars.primary_600_color,
    background: vars.primary_600_color,
    color: vars.vox_on_primary,
    fontWeight: 600,
});
globalStyle(`${setup} li[data-lead] button:hover`, { background: vars.primary_550_color });
globalStyle(`${setup} li[data-lead] button:active`, { background: vars.primary_800_color });
// A step's count or a download's share, beside its line.
export const progress = style({});
globalStyle(`${setup} [role=status], ${setup} ${progress}`, {
    flexShrink: 0,
    fontSize: "1.3rem",
    fontVariantNumeric: "tabular-nums",
    color: vars.primary_300_color,
});
// The line shown while no VRChat with OSC on is found; quieter than the list above it.
export const hint = style({
    selectors: {
        [`${empty} &`]: {
            maxWidth: "46rem",
            marginTop: ".6rem",
            fontSize: "1.2rem",
            lineHeight: 1.6,
            color: vars.vox_description_text,
        },
    },
});
