import { keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, NARROW_COLUMN, shorterThan } from "../../layout.ts";

// This bar has no room for the long words. A narrow conversation column draws the
// shortest ones; the accessible name and the tooltip stay the full words. The
// column's width decides, not the window's: beside the 240px rail an 801px window
// leaves less room than an 800px one beside the icon rail. 64rem holds the English
// short words with the quick settings and the inputs and outputs buttons.
const NARROW = `${MAIN_SECTION_CONTAINER} (max-width: ${NARROW_COLUMN})`;
// A short window: the bar is lower (--main_page_topbar_height, MainPage) and so are its buttons.
const SHORT = shorterThan(MAIN_SECTION_CONTAINER);

export const container = style({
    minHeight: vars.main_page_topbar_height,
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    columnGap: "1.2rem",
    flexShrink: 0,
    margin: "0 2rem",
    borderBottom: `.1rem solid ${vars.vox_border}`,
    // The side margins the buttons on the right used to run into before they took a line of their own.
    "@container": { [NARROW]: { margin: "0 .8rem", columnGap: ".8rem" } },
});
// Stop and mute never go under the buttons on the right (PRODUCT.md: always within
// reach), and nothing runs past the column (#562). When the column cannot hold the bar
// on one line (a large UI size in a narrow window), the buttons on the right take a
// second line of the bar's height, at its end (RightSideComponents.css.ts); in a
// narrower column still, mute goes under stop. On one line the bar is as before.
// A line is the bar's height; the bar's own border is under the last one.
export const leading = style({
    display: "flex",
    alignItems: "center",
    gap: ".8rem",
    flex: "0 1 auto",
    minWidth: 0,
    minHeight: `calc(${vars.main_page_topbar_height} - .1rem)`,
    "@container": { [NARROW]: { columnGap: ".6rem" } },
});

// Stop and mute (others/stop_actions). Quiet until there is something to stop.
export const stop_actions = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".6rem .8rem",
    minWidth: 0,
    paddingBlock: ".4rem",
    "@container": { [NARROW]: { columnGap: ".6rem" } },
});

export const is_attention = style({});
export const is_pressed = style({});
export const is_stopping = style({});
export const is_stopped = style({});
export const is_idle = style({});

const stopAnswered = keyframes({ from: { background: vars.vox_highlight_tint } });

export const stop = style({
    // Never narrower than its words: the bar switches to shorter words instead.
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: ".6rem",
    minHeight: "3.6rem",
    padding: ".4rem 1.2rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    fontSize: "1.3rem",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    color: vars.dark_200_color,
    background: vars.vox_surface,
    cursor: "pointer",
    transition: "background-color .12s ease, border-color .12s ease, color .12s ease",
    selectors: {
        "&:hover:not(:disabled)": { background: vars.dark_850_color },
        "&:active:not(:disabled)": { background: vars.dark_925_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
        // Amber while something is spoken or queued, and while muted; the words say which.
        [`&.${is_attention}, &.${is_pressed}`]: { color: vars.vox_state_warning, borderColor: vars.vox_state_warning },
        "&:disabled": { opacity: .5, cursor: "not-allowed" },
        // The stop answers its press (#937), as the hexagram's switches do (#911): sunk while the core is
        // asked, then a short lilac flash with "stopped". Not offered, it reads as disabled and keeps its
        // tooltip (aria-disabled, not disabled).
        [`&.${is_stopping}, &.${is_stopping}:hover:not(:disabled)`]: { background: vars.dark_925_color, cursor: "progress" },
        [`&.${is_stopped}, &.${is_stopped}:hover:not(:disabled)`]: {
            color: vars.primary_200_color,
            borderColor: vars.primary_600_color,
            animation: `${stopAnswered} .8s ease-out`,
        },
        [`&.${is_idle}, &.${is_idle}:hover:not(:disabled), &.${is_idle}:active:not(:disabled)`]: {
            opacity: .5,
            cursor: "not-allowed",
            background: vars.vox_surface,
        },
    },
    "@media": {
        "(prefers-reduced-motion: reduce)": { selectors: { [`&.${is_stopped}`]: { animation: "none" } } },
    },
    "@container": {
        [NARROW]: { padding: ".4rem .9rem" },
        [SHORT]: { minHeight: "3.2rem", paddingBlock: ".2rem" },
    },
});
// Read, not seen: what the stop's press did.
export const stop_status = style({
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
});
export const muted_badge = style({
    padding: ".1rem .6rem",
    borderRadius: ".4rem",
    fontSize: "1.2rem",
    color: vars.dark_1000_color,
    background: vars.vox_state_warning,
    // The pressed colour and the word already say "muted".
    "@container": { [NARROW]: { display: "none" } },
});
// The words of three lengths: this bar draws the short ones, and the tiny ones in a narrow column.
// The long ones are for bars with more room.
export const long = style({ display: "none" });
export const tiny = style({
    display: "none",
    "@container": { [NARROW]: { display: "inline" } },
});
export const short = style({
    "@container": { [NARROW]: { display: "none" } },
});
