import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// The panel, the kit's PopoverContent (TranslatorSelector.tsx; its width and how tall it may be, as
// tall as the window below the title bar, are set there). It scrolls inside past that.
export const container = style({
    overflowY: "auto",
    overscrollBehavior: "contain",
});

// The reasons, the engines and the reason for the same language, apart from each other.
export const relative_container = style({
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
});

export const unavailable_hint = style({
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});

// The engines, the kit's ToggleGroup: it spans the panel, and its grid fills it.
export const engines = style({
    alignSelf: "stretch",
});

// Three engines a row in the 38rem popover; fewer when a narrow window shrinks it.
export const wrapper = style({
    flex: "1 1 auto",
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
    gap: ".2rem",
});

// One engine, an item of the kit's ToggleGroup, in its cell of the grid.
export const box = style({
    minWidth: 0,
});

// The engine's name, and under it whether it is the default.
export const engine = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: ".3rem",
    minWidth: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    textAlign: "center",
});

export const translator_name = style({
    lineHeight: 1.3,
});

// Inside the engine, under its name.
export const label_default = style({
    padding: "0 .4rem",
    border: `.1rem solid ${vars.dark_700_color}`,
    borderRadius: "0.2rem",
    fontSize: "1.2rem",
    fontWeight: 400,
    color: vars.vox_secondary_text,
});

// Choosing the same language for both: the reason leads the panel, above the engines.
export const is_selected_same_language_wrapper = style({
    order: -1,
});

export const is_selected_same_language_text = style({
    fontSize: "1.3rem",
    lineHeight: 1.6,
    color: vars.vox_state_warning,
    textWrap: "balance",
});
