import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

// The bar's middle width: the stop's and the save bar's buttons take their short words.
const MIDDLE = "(max-width: 1100px)";
// ConfigPage's grid places search beside stop/mute, then save/back below. A narrow window, or the
// UI-size-aware breakpoint (useWindow.ts) on the page: these margins leave .8rem between rows
// without assuming their heights.
const NARROW = "(max-width: 800px)";
const NARROW_PAGE = "html[data-narrow]";

export const container = style({ display: "contents" });
globalStyle(`${container} > *`, { pointerEvents: "auto" });

// The kit's plain Button (4rem high, as search and stop beside it); the bar gives it only its place.
const backNarrow = { margin: "0 1.6rem 1.6rem 0" } as const;
export const back = style({
    gridArea: "back",
    justifySelf: "end",
    alignSelf: "start",
    margin: "1.6rem 1.6rem 1.6rem 0",
    selectors: { [`${NARROW_PAGE} &`]: backNarrow },
    "@media": { [NARROW]: backNarrow },
});
globalStyle(`${back} svg`, { width: "1.8rem", height: "1.8rem" });
export const back_label = style({
    selectors: { [`${NARROW_PAGE} &`]: { display: "none" } },
    "@media": { [NARROW]: { display: "none" } },
});

// Every setting saves by itself (#1111): where the save bar was, the page says its changes apply
// at once.
export const applies_now = style({
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    minHeight: "4rem",
    margin: 0,
    padding: ".4rem 1.4rem",
    overflowWrap: "anywhere",
    fontSize: "1.3rem",
    color: vars.dark_400_color,
});
const focusRing = { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" } as const;
// A queue count and the muted badge may wrap, leaving search usable.
const stopActionsNarrow = { margin: "1.6rem 1.6rem .8rem 0", maxWidth: "24rem", justifySelf: "end" } as const;
export const stop_actions = style({
    gridArea: "stop",
    alignSelf: "start",
    margin: "1.6rem .8rem 1.6rem 0",
    minWidth: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
    selectors: { [`${NARROW_PAGE} &`]: stopActionsNarrow },
    "@media": { [NARROW]: stopActionsNarrow },
});

export const is_attention = style({});
export const is_stopping = style({});
export const is_stopped = style({});
export const is_idle = style({});
export const is_pressed = style({});

const stopAnswered = keyframes({ from: { background: vars.vox_highlight_tint } });

export const stop = style({
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
    maxWidth: "100%",
    minWidth: 0,
    minHeight: "4rem",
    padding: ".8rem 1.2rem",
    borderRadius: vars.vox_radius,
    fontSize: "1.4rem",
    fontWeight: 500,
    color: vars.dark_200_color,
    background: vars.dark_900_color,
    border: `.1rem solid ${vars.dark_800_color}`,
    cursor: "pointer",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    transition: "background-color .12s ease, border-color .12s ease, color .12s ease",
    fontVariantNumeric: "tabular-nums",
    // In the SCSS order: rules of the same weight that set the same thing, the later one wins.
    selectors: {
        "&:hover": { background: vars.dark_850_color },
        "&:focus-visible": focusRing,
        // Amber only while something is being spoken or waits in the queue.
        [`&.${is_attention}`]: { color: vars.vox_state_warning, borderColor: vars.vox_state_warning },
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
            background: vars.dark_900_color,
        },
        // Muted is a reported state worth seeing from every page; the text says it too.
        [`&.${is_pressed}`]: { color: vars.vox_state_warning, borderColor: vars.vox_state_warning, background: vars.dark_900_color },
        "&:disabled": { opacity: .5, cursor: "not-allowed" },
        "&:active:not(:disabled)": { background: vars.dark_925_color },
    },
    "@media": {
        "(prefers-reduced-motion: reduce)": { selectors: { [`&.${is_stopped}`]: { animation: "none" } } },
    },
});
// The stop's words of two lengths: the long ones, and the short ones in a narrower window.
export const long = style({
    selectors: { [`${NARROW_PAGE} ${stop} &`]: { display: "none" } },
    "@media": {
        [MIDDLE]: { selectors: { [`${stop} &`]: { display: "none" } } },
        [NARROW]: { selectors: { [`${stop} &`]: { display: "none" } } },
    },
});
export const short = style({
    display: "none",
    selectors: { [`${NARROW_PAGE} ${stop} &`]: { display: "inline" } },
    "@media": {
        [MIDDLE]: { selectors: { [`${stop} &`]: { display: "inline" } } },
        [NARROW]: { selectors: { [`${stop} &`]: { display: "inline" } } },
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
const saveSlotNarrow = { margin: "0 .8rem 1.6rem 1.6rem" } as const;
export const save_slot = style({
    gridArea: "save",
    alignSelf: "start",
    margin: "1.6rem .8rem 1.6rem 0",
    minWidth: 0,
    display: "flex",
    selectors: { [`${NARROW_PAGE} &`]: saveSlotNarrow },
    "@media": { [NARROW]: saveSlotNarrow },
});
export const muted_badge = style({
    padding: ".1rem .6rem",
    borderRadius: ".4rem",
    fontSize: "1.2rem",
    color: vars.dark_1000_color,
    background: vars.vox_state_warning,
});