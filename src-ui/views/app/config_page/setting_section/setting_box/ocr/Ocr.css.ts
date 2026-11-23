import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

// An environment readout (EnvReadout) with the re-check action beside it.
export const readiness = style({
    justifyContent: "space-between",
    margin: "1.6rem 0",
});
globalStyle(`${readiness} button`, {
    flexShrink: 0,
    minHeight: "3.6rem",
    padding: ".6rem 1.2rem",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    background: "var(--dark_850_color, #25364f)",
    border: ".1rem solid transparent",
    borderRadius: "var(--vox_radius, .8rem)",
});
globalStyle(`${readiness} button:hover`, { background: vars.vox_secondary_hover });

export const models = style({
    paddingTop: 0,
});

// The catalogs' layout buttons at the head of the models' part, at its end, as on the catalogs'
// heading lines.
export const layout = style({
    display: "flex",
    justifyContent: "flex-end",
});

export const detector = style({
    display: "flex",
    flexDirection: "column",
    paddingBottom: "1.6rem",
    borderBottom: ".1rem solid var(--dark_800_color, #34363b)",
    selectors: {
        // The download section below the status draws its own divider; one is enough.
        "&:has(> section)": { paddingBottom: 0, borderBottom: 0 },
    },
});
// The download's bar a step below the status line it answers.
globalStyle(`${detector} > ${models}`, { paddingTop: ".8rem" });

export const detectorStatus = style({
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: "var(--dark_400_color, #9ca3af)",
    selectors: {
        '&[data-state="on"]': { color: vars.primary_300_color },
    },
});

export const region = style({
    display: "flex",
    flexDirection: "column",
    gap: ".4rem",
    padding: "1.6rem 0",
    borderBottom: ".1rem solid var(--dark_800_color, #34363b)",
});

export const regionHeader = style({
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "2.4rem",
    flexWrap: "wrap",
});

// A region's name and its hint mark on one line (#614).
export const regionTitle = style({
    display: "flex",
    alignItems: "center",
});

export const regionLabel = style({
    fontSize: "1.4rem",
    color: "var(--dark_200_color, #e5e7eb)",
});

export const regionDesc = style({
    marginTop: ".4rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: "var(--dark_400_color, #9ca3af)",
});

export const preview = style({
    position: "relative",
    flexShrink: 0,
    width: "16rem",
    aspectRatio: "16 / 9",
    background: "var(--dark_900_color, #1d1f22)",
    border: ".1rem solid var(--dark_650_color, #5e6570)",
    borderRadius: ".4rem",
    overflow: "hidden",
});

export const previewArea = style({
    position: "absolute",
    boxSizing: "border-box",
    background: "color-mix(in srgb, var(--primary_400_color, #4d8ef7) 30%, transparent)",
    border: ".2rem solid var(--primary_400_color, #4d8ef7)",
});

export const resetButton = style({
    alignSelf: "flex-start",
    marginTop: ".8rem",
    minHeight: "3.6rem",
    padding: ".6rem 1.2rem",
    color: "inherit",
    font: "inherit",
    fontWeight: 500,
    cursor: "pointer",
    background: "var(--dark_850_color, #25364f)",
    border: ".1rem solid transparent",
    borderRadius: "var(--vox_radius, .8rem)",
    selectors: {
        "&:hover:enabled": { background: vars.vox_secondary_hover },
        "&:disabled": { opacity: .5, cursor: "not-allowed" },
    },
});

// Sharing a window (Linux, Wayland): the status line, then the buttons, which wrap in a narrow window.
export const sharedStatus = style({
    margin: "1.2rem 0 0",
});

export const sharedActions = style({
    display: "flex",
    flexWrap: "wrap",
    gap: ".8rem",
});
globalStyle(`${sharedActions} ${resetButton}[aria-disabled="true"]`, { opacity: .5, cursor: "not-allowed" });
globalStyle(`${sharedActions} ${resetButton}[aria-disabled="true"]:hover`, { background: "var(--dark_850_color, #25364f)" });

globalStyle(`${resetButton}:focus-visible`, {
    outline: ".2rem solid var(--vox_focus, #a9ccff)",
    outlineOffset: ".2rem",
});
