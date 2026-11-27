import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { tooltipContent } from "../../../../../../common_css/mixins.ts";

const appear = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

// The question mark after a label: quiet, in the description color, the size of a small mark.
export const hint = style({
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    marginLeft: ".6rem",
    verticalAlign: "middle",
});

export const mark = style({
    display: "block",
    width: "1.4rem",
    height: "1.4rem",
    fill: vars.vox_description_text,
    cursor: "help",
});

export const focus_mark = style({
    display: "inline-flex",
    borderRadius: "50%",
    selectors: {
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
    },
});

// Where a row's field goes under its label (narrow content or window), a bubble under the
// label would cover the field being used: it opens above the label instead.
const above = { top: "auto", bottom: "calc(100% + .6rem)" } as const;

// The bubble, the app's one tooltip look (tooltipContent, shared with common_components/tooltip):
// anchored to the label line that holds it ([data-hint-host] is positioned), under it. The look
// makes it as wide as its words up to a reading measure, not as narrow as its host: an option's
// label is a few characters wide, and its bubble would be a column of single words.
export const tip = style({
    display: "none",
    position: "absolute",
    zIndex: 1500,
    top: "calc(100% + .6rem)",
    left: 0,
    ...tooltipContent,
    pointerEvents: "none",
    animation: `${appear} var(--vox_motion_fast, 120ms) var(--vox_ease, ease-out)`,
    "@media": {
        "(prefers-reduced-motion: reduce)": { animation: "none" },
        "(max-width: 800px)": above,
    },
    "@container": { "(max-width: 41.6rem)": above },
});
// A row's label hint: opened by keyboard focus anywhere in the row.
export const tip_row = style({});

// A row whose field says what is wrong with it under the field (aria-invalid, FieldProblem) opens
// its hints above the label: under it, a bubble would cover the problem being fixed while the
// field keeps the focus (#1111, #1266 T-2).
globalStyle(`[data-hint-row]:has([aria-invalid="true"]) ${tip}`, above);

globalStyle("[data-hint-host]", { position: "relative" });

// The pointer on the label (or the option) opens its bubble; so does keyboard focus on what
// the host holds, such as an option's radio. Keyboard focus in a row opens the hint of the row's
// label, not those of its options; a row that takes focus itself, such as a fold's summary, opens
// its title's hint the same way. One rule, as in the SCSS.
globalStyle([
    `[data-hint-host]:hover ${tip}`,
    `[data-hint-host]:has(:focus-visible) ${tip}`,
    `[data-hint-row]:has(:focus-visible) ${tip_row}`,
    `[data-hint-row]:focus-visible ${tip_row}`,
].join(", "), { display: "block" });
