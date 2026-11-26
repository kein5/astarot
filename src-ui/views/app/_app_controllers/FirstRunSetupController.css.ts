import { globalStyle, style } from "@vanilla-extract/css";
import type { GlobalStyleRule } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

// The first-run setup (#557): the kit's Dialog with its parts (Header, Title, Description, Footer),
// and its findings as the kit's Item list (views/kit/Item.tsx), which draws the rows itself
// (DESIGN.md "Components"). The kit draws the dialog's frame and parts, and the forms
// (VoiceSettings.css.ts) its native controls; these rules lay out what is inside it. Each part is
// scoped under the dialog (`${dialog} &`), so the forms' rules for every p and heading do not
// reach it.

export const dialog = style({});

// A part's rules under the dialog; `more` adds rules for selectors of the part itself ("& + &").
const within = (rules: GlobalStyleRule, more: Record<string, GlobalStyleRule> = {}) => style({
    selectors: { [`${dialog} &`]: rules, ...Object.fromEntries(Object.entries(more).map(([selector, rule]) => [`${dialog} ${selector}`, rule])) },
});
const separated = { "& + &": { borderTop: `.1rem solid ${vars.vox_border}` } };

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

// One frame around a list, a hairline between its rows, as the kit's outline ItemGroup draws the
// findings: the models to consent to and the steps of the run.
const list = {
    display: "grid",
    margin: 0,
    padding: 0,
    listStyle: "none",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
} as const;

// The models to consent to: the same frame, one row per model, its name over its facts.
// The model a section prepares, chosen from a list (#955): its name, and the forms' field beside it.
export const choice = within({
    display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)", alignItems: "center", gap: ".8rem 1.6rem",
    fontSize: "1.4rem", fontWeight: 500, color: vars.vox_secondary_text,
    "@media": { "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
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

// The run: one row per step, numbered in its own column, its state at the end. The state's column
// takes at most 40% of the row: a long state cannot squeeze the step's name to a column of single
// characters (#1253).
export const steps = within({ ...list, counterReset: "step" });
export const step = within({
    display: "grid",
    gridTemplateColumns: "2rem minmax(0, 1fr) fit-content(40%)",
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
    // A failure is a sentence in a notice's frame (the forms' alert): it goes under the step's
    // name, as wide as the name and the state together (#1253).
    [`${step}[data-state="failed"] &`]: { color: vars.dark_200_color, fontWeight: 500, gridColumn: "2 / -1", textAlign: "start" },
});
globalStyle(`${dialog} ${step} progress`, { gridColumn: "2 / -1", display: "block", width: "100%" });

// The recognition is ready: the words in the active state's colour.
export const finished = within({ margin: 0, maxWidth: "none", fontSize: "1.4rem", color: vars.vox_state_active });

// A row of buttons.
export const actions = within({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".8rem" });

// In the footer (the kit's DialogFooter), a line of its own under Later and Done.
export const footerLine = within({ flexBasis: "100%" });
