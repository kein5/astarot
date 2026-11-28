import { globalStyle, style } from "@vanilla-extract/css";

// Side by side where both have room for their facts and buttons (the settings content of a
// window of 1280px or so); stacked in a narrow one, the build that fits on top.
const WIDE = "(min-width: 64rem)";

// The GPU builds of ONNX Runtime for the translation are one choice (#945): the user needs the one
// their GPU runs. One frame holds the pair (a real unit, DESIGN.md "Roles"); the build that fits
// comes first at full strength, "or" sits on the hairline between them, and the other is quieter:
// its words in the description color and its name at the secondary weight. No frame inside it.
export const choice = style({
    display: "grid",
    gap: "1.2rem",
    minWidth: 0,
    padding: "1.6rem",
    border: ".1rem solid var(--vox_border, #344662)",
    borderRadius: "var(--vox_radius, .8rem)",
    "@container": { [WIDE]: { gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", columnGap: "2.4rem", alignItems: "start" } },
});
globalStyle(`${choice} > [data-fit="unneeded"], ${choice} > [data-fit="unavailable"]`, { color: "var(--vox_description_text, #a3adc0)" });
globalStyle(`${choice} > [data-fit="unneeded"] > strong, ${choice} > [data-fit="unavailable"] > strong`, {
    color: "var(--vox_secondary_text, #c2c9d6)",
    fontWeight: 500,
});

// "or" on a hairline: across between the stacked builds, down between the side-by-side ones.
export const or = style({
    display: "flex",
    alignItems: "center",
    gap: "1.2rem",
    fontSize: "1.2rem",
    color: "var(--vox_description_text, #a3adc0)",
    selectors: {
        "&::before, &::after": { content: '""', flex: 1, borderTop: ".1rem solid var(--vox_border, #344662)" },
    },
    "@container": {
        [WIDE]: {
            flexDirection: "column",
            alignSelf: "stretch",
            selectors: {
                "&::before, &::after": { borderTop: 0, borderInlineStart: ".1rem solid var(--vox_border, #344662)" },
            },
        },
    },
});
