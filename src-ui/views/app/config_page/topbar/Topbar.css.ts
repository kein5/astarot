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

const backNarrow = { margin: "0 1.6rem 1.6rem 0" } as const;
export const back = style({
    gridArea: "back",
    justifySelf: "end",
    alignSelf: "start",
    margin: "1.6rem 1.6rem 1.6rem 0",
    display: "flex",
    alignItems: "center",
    gap: ".8rem",
    minHeight: "4rem",
    padding: ".8rem 1.6rem",
    borderRadius: vars.vox_radius,
    color: vars.dark_200_color,
    background: vars.dark_850_color,
    fontSize: "1.4rem",
    fontWeight: 500,
    cursor: "pointer",
    selectors: {
        "&:hover": { background: vars.dark_800_color },
        "&:active": { background: vars.dark_900_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
        [`${NARROW_PAGE} &`]: backNarrow,
    },
    "@media": { [NARROW]: backNarrow },
});
globalStyle(`${back} svg`, { width: "1.8rem", height: "1.8rem" });
export const back_label = style({
    selectors: { [`${NARROW_PAGE} &`]: { display: "none" } },
    "@media": { [NARROW]: { display: "none" } },
});

export const is_dirty = style({});
export const is_failed = style({});

// As high as search, stop and back beside it (4rem with its buttons and border), so the row under
// them does not move when a page with a form opens after one without (#912).
export const save_bar = style({
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
    minHeight: "4rem",
    padding: ".3rem .4rem .3rem 1.4rem",
    borderRadius: vars.vox_radius,
    background: vars.dark_900_color,
    border: `.1rem solid ${vars.dark_800_color}`,
    selectors: { [`&.${is_dirty}`]: { borderColor: vars.primary_500_color } },
});
// Wrap the state/count before squeezing the actions. The grid reserves the
// resulting height, including long translations and large unsaved counts.
export const summary = style({ flex: "1 1 10rem", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" });
export const state = style({
    maxWidth: "100%",
    overflowWrap: "anywhere",
    fontSize: "1.3rem",
    color: vars.dark_400_color,
    selectors: {
        [`${is_dirty} &`]: { color: vars.primary_200_color },
        [`&.${is_failed}`]: { color: vars.vox_state_failed },
    },
});
// Where the save bar would be, a page without a form says its changes apply at once:
// the bar's words, without its frame, since there is nothing to save.
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
export const count = style({
    flexShrink: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    padding: ".1rem .7rem",
    borderRadius: ".4rem",
    fontSize: "1.2rem",
    fontVariantNumeric: "tabular-nums",
    color: vars.vox_on_primary,
    background: vars.primary_600_color,
});
// The changed names never fit the bar in every language; they stay readable
// for screen readers, and the page marks the rows themselves.
export const changes = style({
    position: "absolute",
    width: ".1rem",
    height: ".1rem",
    margin: "-.1rem",
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    listStyle: "none",
});

// Discard and save: the same shape; a short word in a narrower window (data-short).
const saveButton = {
    flexShrink: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    minHeight: "3.2rem",
    padding: ".4rem 1.4rem",
    borderRadius: vars.vox_radius,
    fontSize: "1.4rem",
    fontWeight: 500,
    cursor: "pointer",
} as const;
const shortWords = { fontSize: 0 } as const;
const shortWord = { content: "attr(data-short)", fontSize: "1.4rem" } as const;
const focusRing = { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" } as const;
export const discard = style({
    ...saveButton,
    color: vars.dark_200_color,
    background: vars.dark_850_color,
    selectors: {
        "&:hover:not(:disabled)": { background: vars.dark_800_color },
        "&:disabled": { opacity: .5, cursor: "default" },
        "&:focus-visible": focusRing,
        [`${NARROW_PAGE} &`]: shortWords,
        [`${NARROW_PAGE} &::after`]: shortWord,
        "&:active:not(:disabled)": { background: vars.dark_925_color },
    },
    "@media": {
        [MIDDLE]: { ...shortWords, selectors: { "&::after": shortWord } },
        [NARROW]: { ...shortWords, selectors: { "&::after": shortWord } },
    },
});
export const save = style({
    ...saveButton,
    color: vars.vox_on_primary,
    background: vars.primary_600_color,
    selectors: {
        "&:hover:not(:disabled)": { background: vars.primary_550_color },
        "&:disabled": { opacity: .5, cursor: "default" },
        "&:focus-visible": focusRing,
        [`${NARROW_PAGE} &`]: shortWords,
        [`${NARROW_PAGE} &::after`]: shortWord,
        "&:active:not(:disabled)": { background: vars.primary_800_color },
    },
    "@media": {
        [MIDDLE]: { ...shortWords, selectors: { "&::after": shortWord } },
        [NARROW]: { ...shortWords, selectors: { "&::after": shortWord } },
    },
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
// shadcn/ui's DialogContent width (sm:max-w-lg), as the app's other dialogs.
export const leave_dialog = style({
    maxWidth: "min(51.2rem, 85vw)",
    padding: "2.4rem",
    border: `.1rem solid ${vars.dark_600_color}`,
    borderRadius: "1.2rem",
    background: vars.dark_875_color,
    color: vars.dark_200_color,
    fontSize: "1.4rem",
    selectors: {
        // As the forms' dialogs (VoiceSettings.css.ts): shadcn/ui's bg-black/50.
        "&::backdrop": { background: "#00000080" },
    },
});
export const leave_actions = style({ display: "flex", flexWrap: "wrap", gap: ".8rem", marginTop: "1.6rem" });
globalStyle(`${leave_actions} button`, {
    minHeight: "4rem",
    padding: ".8rem 1.4rem",
    borderRadius: vars.vox_radius,
    fontWeight: 500,
    color: vars.dark_200_color,
    background: vars.dark_850_color,
    cursor: "pointer",
});
globalStyle(`${leave_actions} button:hover`, { background: vars.dark_800_color });
globalStyle(`${leave_actions} button:active`, { background: vars.dark_925_color });
globalStyle(`${leave_actions} button:focus-visible`, focusRing);
