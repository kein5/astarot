import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import type { GlobalStyleRule } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

// The first-run setup (#557), drawn as shadcn/ui's Dialog with its parts (Header, Title,
// Description, Footer) and its findings as shadcn/ui's Item list: a mark, a name, what was found,
// and the action at the row's end (DESIGN.md "Components"). The dialog keeps the app's dialog
// frame (LegacyModelDownloadDialog.module.scss) and the forms' controls (VoiceSettings.module.scss);
// these rules lay out what is inside it. Each part is scoped under the dialog (`${dialog} &`), so
// the forms' rules for every p, heading and dialog button do not reach it.

export const dialog = style({});

// The frame gives it shadcn/ui's DialogContent width and gap, as every dialog of the app. Its own
// line height, with three classes to come after the frame's `.host dialog.dialog`.
globalStyle(`${dialog}${dialog}${dialog}`, { lineHeight: 1.5 });

// A part's rules under the dialog; `more` adds rules for selectors of the part itself ("& + &").
const within = (rules: GlobalStyleRule, more: Record<string, GlobalStyleRule> = {}) => style({
    selectors: { [`${dialog} &`]: rules, ...Object.fromEntries(Object.entries(more).map(([selector, rule]) => [`${dialog} ${selector}`, rule])) },
});
const separated = { "& + &": { borderTop: `.1rem solid ${vars.vox_border}` } };

// Header: the title and what the setup is for (DialogHeader, gap-2).
export const header = within({ display: "grid", gap: ".8rem" });
export const title = within({
    margin: 0,
    fontSize: "1.8rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: vars.dark_basic_text_color,
});
export const description = within({
    margin: 0,
    maxWidth: "none",
    fontSize: "1.4rem",
    lineHeight: 1.6,
    color: vars.vox_secondary_text,
    textWrap: "pretty",
    wordBreak: "auto-phrase",
});

// A part of the setup: its subheading, then its contents.
export const section = within({ display: "grid", gap: "1.2rem", minWidth: 0 });
export const sectionTitle = within({
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: vars.vox_secondary_text,
});
export const text = within({
    margin: 0,
    maxWidth: "none",
    fontSize: "1.3rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});

// One frame around the list, a hairline between its rows (ItemGroup with its separators). The
// rows are one unit (what was found), so the list keeps one quiet frame (DESIGN.md "Roles").
const list = {
    display: "grid",
    margin: 0,
    padding: 0,
    listStyle: "none",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
} as const;

// Whether a finding needs the user is told by where it sits and how it looks, before its words
// are read (#614): the findings that need the user come first, each a card of its own, with the
// warning's amber rule on its left and its tint, a larger mark and the name at full strength. The
// rest (ready, being checked, or neither) follow in one quiet frame, smaller and muted.
export const urgent = within({ display: "grid", gap: ".8rem", margin: 0, padding: 0, listStyle: "none" });
export const items = within(list);

// Item: the mark, the name over what was found, and its action under the words, where they
// start. What was found is a sentence or two of Japanese, so the words take the row's width and
// the actions of all rows start at the same place.
const row = {
    display: "grid",
    gridTemplateAreas: '"media content" ". actions"',
    columnGap: "1.2rem",
    rowGap: ".8rem",
    alignContent: "center",
} as const;
export const urgentItem = within({
    ...row,
    gridTemplateColumns: "2.4rem minmax(0, 1fr)",
    minHeight: "6.4rem",
    padding: "1.4rem 1.6rem 1.4rem 1.3rem",
    borderLeft: `.3rem solid ${vars.vox_state_warning}`,
    borderRadius: vars.vox_radius,
    background: vars.vox_warning_tint,
});
export const item = within({
    ...row,
    gridTemplateColumns: "1.8rem minmax(0, 1fr)",
    minHeight: "4.8rem",
    padding: ".8rem 1.6rem",
}, separated);

// The state at a glance: ready (a lilac disc with a check, as a readout's finished work), needs
// the user (an amber disc with "!"), being checked (the readout's spinning arc), or neither (a
// quiet ring). The words beside it always say the state; the mark only repeats them.
export const mark = within({
    gridArea: "media",
    alignSelf: "start",
    display: "block",
    width: "1.8rem",
    height: "1.8rem",
    // On the name's line (1.3rem at 1.5).
    marginTop: ".05rem",
    color: vars.vox_description_text,
}, {
    // On the name's line (1.5rem at 1.4).
    [`${urgentItem} &`]: { width: "2.4rem", height: "2.4rem", marginTop: "-.1rem" },
});
globalStyle(`${dialog} ${mark} svg`, { display: "block", width: "100%", height: "100%", overflow: "visible" });

const spin = keyframes({ to: { transform: "rotate(360deg)" } });
export const markShape = {
    ready: within({ fill: vars.vox_state_active }),
    attention: within({ fill: vars.vox_state_warning }),
    ring: within({ fill: "none", stroke: "currentColor", strokeWidth: 1.6 }),
    arc: within({
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        // About two thirds of the circle, as the readout's.
        strokeDasharray: "25 13",
        transformBox: "fill-box",
        transformOrigin: "center",
        animation: `${spin} 0.9s linear infinite`,
        "@media": { "(prefers-reduced-motion: reduce)": { animation: "none" } },
    }),
    // The check or the "!" on a disc: the canvas colour, as on the readout's disc.
    glyph: within({ fill: "none", stroke: vars.vox_canvas, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }),
};

export const content = within({ gridArea: "content", display: "grid", gap: ".2rem", minWidth: 0 });
export const itemTitle = within({
    fontSize: "1.3rem",
    fontWeight: 500,
    lineHeight: 1.5,
    color: vars.vox_secondary_text,
}, {
    [`${urgentItem} &`]: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.4, color: vars.dark_basic_text_color },
});
export const itemDescription = within({
    display: "grid",
    gap: ".2rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
    wordBreak: "auto-phrase",
}, {
    [`${urgentItem} &`]: { fontSize: "1.3rem", color: vars.dark_200_color },
});
export const itemActions = within({ gridArea: "actions", display: "flex", justifySelf: "start" });

// The models to consent to: the same frame, one row per model, its name over its facts.
export const models = within(list);
export const model = within({
    display: "grid",
    gap: ".4rem",
    padding: "1.2rem 1.6rem",
}, separated);
export const modelName = within({ fontSize: "1.4rem", fontWeight: 500, color: vars.dark_200_color, overflowWrap: "anywhere" });
export const modelFacts = within({
    display: "flex",
    flexWrap: "wrap",
    columnGap: "1.2rem",
    rowGap: ".2rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
// A label stays with its value; Japanese labels are not broken inside a word.
globalStyle(`${dialog} ${modelFacts} > *`, { minWidth: 0, wordBreak: "keep-all", overflowWrap: "anywhere" });
export const total = within({
    margin: 0,
    maxWidth: "none",
    fontSize: "1.3rem",
    color: vars.vox_secondary_text,
    fontVariantNumeric: "tabular-nums",
});

// The run: one row per step, numbered in its own column, its state at the end.
export const steps = within({ ...list, counterReset: "step" });
export const step = within({
    display: "grid",
    gridTemplateColumns: "2rem minmax(0, 1fr) auto",
    columnGap: "1.2rem",
    rowGap: ".6rem",
    alignItems: "baseline",
    padding: "1.2rem 1.6rem",
    fontSize: "1.3rem",
    color: vars.dark_200_color,
    counterIncrement: "step",
}, {
    ...separated,
    // The steps are done in order, so they show their numbers (#476).
    "&::before": { content: 'counter(step) "."', color: vars.vox_description_text, fontVariantNumeric: "tabular-nums" },
});
// A long step name breaks between phrases, not inside a word.
export const stepLabel = within({ minWidth: 0, overflowWrap: "anywhere", wordBreak: "auto-phrase" });
export const stepState = within({
    color: vars.vox_secondary_text,
    textAlign: "end",
    fontVariantNumeric: "tabular-nums",
}, {
    [`${step}[data-state="done"] &`]: { color: vars.vox_state_active },
    [`${step}[data-state="failed"] &`]: { color: vars.dark_200_color, fontWeight: 500 },
});
globalStyle(`${dialog} ${step} progress`, { gridColumn: "2 / -1", display: "block", width: "100%" });

// The recognition is ready: the words in the active state's colour.
export const finished = within({ margin: 0, maxWidth: "none", fontSize: "1.4rem", color: vars.vox_state_active });

// A row of buttons; the forms give every dialog button a margin, taken back here.
export const actions = within({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".8rem" });
globalStyle(`${dialog} ${actions} button, ${dialog} ${itemActions} button`, { margin: 0 });

// Footer: closing the setup, apart from the steps above it (DialogFooter).
export const footer = within({
    display: "grid",
    gap: "1.2rem",
    paddingTop: "1.6rem",
    borderTop: `.1rem solid ${vars.vox_border}`,
});
