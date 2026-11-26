import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

export const scroll_container = style({ width: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" });

const NARROW_PADDING = { padding: ".4rem 1.6rem 3.2rem" } as const;

// The settings pages' lines are quiet (#1233): present enough to show the groups and the rows, so
// that the words and the controls carry the page. They are set here, for what the settings pages
// hold, and nowhere else: the app's border colour keeps its strength on every other screen, and
// in a part of the settings that a dialog or the main screen also shows.
// - group: the ground of a group of settings, a step above the page's.
// - frame: the line round a group, a fold, a card, a button (the app's border colour, made quieter).
// - rule: the line between two rows of a group, quieter than the frame.
// Mixed from the theme's own tokens, so every theme keeps the same steps in its own hue.
const GROUP = `color-mix(in oklab, ${vars.vox_surface} 50%, ${vars.vox_canvas})`;
const FRAME = `color-mix(in oklab, ${vars.dark_800_color} 62%, ${vars.vox_canvas})`;
const RULE = `color-mix(in oklab, ${vars.dark_800_color} 50%, ${vars.vox_canvas})`;
// A group's corners: DESIGN.md's rounded.group.
const GROUP_RADIUS = "1.2rem";

export const container = style({
    containerType: "inline-size",
    minWidth: 0,
    maxWidth: "112rem",
    margin: "0 auto 4rem",
    padding: ".8rem 3.2rem 4rem",
    // One layer for the settings' content: the groups' grounds (below) lie under every part of it,
    // and a hint over a row may reach over the next group.
    isolation: "isolate",
    vars: {
        "--settings_group": GROUP,
        "--settings_frame": FRAME,
        "--settings_rule": RULE,
        [vars.vox_border]: "var(--settings_frame)",
    },
    "@media": { "(max-width: 800px)": NARROW_PADDING },
    // The UI-size-aware breakpoint (useWindow.ts) also selects the narrow layout.
    selectors: { "html[data-narrow] &": NARROW_PADDING },
});

// The first category heading sits right under the top bar; the 40px above a
// heading only separates it from the section before it.
globalStyle([
    `${container} > :first-child > [data-section-label]:first-child`,
    `${container} > :first-child > :first-child > [data-section-label]:first-child`,
    `${container} > :first-child > :first-child > :first-child > [data-section-label]:first-child`,
].join(", "), { paddingTop: 0 });

// A group of settings (#1233): what a page's section heading heads sits on a rounded ground of its
// own, framed by the quiet line, as T3 Code's settings group theirs; the rows inside keep the
// quieter rule between them. The section is the element whose first child is the heading. It is
// one column of a grid, and the ground is drawn behind what follows the heading, from the second
// row to the section's end: an absolutely positioned box placed on the grid, so it takes no cell
// and the parts keep their own layout. The section's content keeps the inset a fold gives what it
// holds (Fold.css.ts), so a field starts and a control ends where they do in a fold, and every
// control's right edge stays on one line (DESIGN.md "Field widths"); the heading keeps the page's
// edge. A section that holds only a fold is that fold's frame already, and one that holds only
// the catalog's layout switch (its parts follow it as folds) has no group of its own.
const section = `${container} :is(div, section):has(> [data-section-label]:first-child)`
    + ":not(:has(> [data-section-label] + :is(details, [role=\"radiogroup\"]):last-child))";
const INSET = "1.6rem";
const LINE = ".1rem";
const START = `calc(${INSET} - ${LINE})`;
const END = `calc(${INSET} * 1.6 - ${LINE})`;
const STACKED = { "@container": { "(max-width: 42rem)": { paddingInline: START } }, "@media": { "(max-width: 700px)": { paddingInline: START } } };
globalStyle(section, {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    position: "relative",
    paddingInlineStart: START,
    paddingInlineEnd: END,
    borderBottom: "none",
    ...STACKED,
});
globalStyle(`${section} > [data-section-label]`, {
    marginInlineStart: `calc(-1 * ${START})`,
    marginInlineEnd: `calc(-1 * ${END})`,
    "@container": { "(max-width: 42rem)": { marginInline: `calc(-1 * ${START})` } },
    "@media": { "(max-width: 700px)": { marginInline: `calc(-1 * ${START})` } },
});
// The ground: from the row after the heading to the section's end, across its whole width. A
// section that keeps a gap between its children (the voice pages' forms) names it in
// --settings_section_gap, and the ground starts that far above its first part, under the heading.
globalStyle(`${section}::before`, {
    content: '""',
    position: "absolute",
    gridRowStart: 2,
    gridRowEnd: "auto",
    gridColumn: "auto",
    inset: "calc(-1 * var(--settings_section_gap, 0px)) 0 0 0",
    zIndex: -1,
    background: "var(--settings_group)",
    border: `${LINE} solid var(--settings_frame)`,
    borderRadius: GROUP_RADIUS,
    pointerEvents: "none",
});
// The group's frame is its last row's line: the row draws none of its own there.
globalStyle([`${section} > [data-hint-row]:last-child`, `${section} > :last-child > [data-hint-row]:last-child`].join(", "),
    { borderBottomColor: "transparent" });
// What follows a group on the page and is not the next section (a fold, a part of its own) keeps
// the space the section's heading would have given it.
globalStyle(`${section} + :not(:has(> [data-section-label]:first-child))`, { marginTop: "1.6rem" });
// A row of its own on a page, outside any section (the captions page's VR UI row after its fold),
// is a group of its own: the same ground, frame and inset.
globalStyle(`${container} > :not(:has(> [data-section-label]:first-child)) > [data-hint-row]`, {
    paddingBlock: "1.2rem",
    paddingInlineStart: START,
    paddingInlineEnd: END,
    background: "var(--settings_group)",
    border: `${LINE} solid var(--settings_frame)`,
    borderRadius: GROUP_RADIUS,
    ...STACKED,
});
