import { globalStyle, style } from "@vanilla-extract/css";
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

// Stop and mute are the kit's Button (danger) and Toggle (warning) at the regular size, 4rem high
// as search and back beside them (StopActions). The bar gives them only their place: a queue count
// and the muted badge may go under the words.
export const stop = style({ flexWrap: "wrap", minWidth: 0 });
// The stop's words of two lengths: the long ones, and the short ones in a narrower window. Their
// digits are as wide as each other, so a queue count keeps the room its words keep (#912).
export const long = style({
    fontVariantNumeric: "tabular-nums",
    selectors: { [`${NARROW_PAGE} ${stop} &`]: { display: "none" } },
    "@media": {
        [MIDDLE]: { selectors: { [`${stop} &`]: { display: "none" } } },
        [NARROW]: { selectors: { [`${stop} &`]: { display: "none" } } },
    },
});
export const short = style({
    display: "none",
    fontVariantNumeric: "tabular-nums",
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
// The settings window has no back button (#1236): the words end at the page's edge margin, as back did.
const saveSlotLastNarrow = { marginRight: "1.6rem" } as const;
export const save_slot_last = style({
    marginRight: "1.6rem",
    selectors: { [`${NARROW_PAGE} &`]: saveSlotLastNarrow },
    "@media": { [NARROW]: saveSlotLastNarrow },
});
export const muted_badge = style({
    padding: ".1rem .6rem",
    borderRadius: ".4rem",
    fontSize: "1.2rem",
    color: vars.dark_1000_color,
    background: vars.vox_state_warning,
});