import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// The tray companion's control panel: a small popover, so every size is in rem of the UI scale.

export const panel = style({
    display: "flex", flexDirection: "column", gap: "1.2rem", height: "100%", boxSizing: "border-box",
    padding: "1.4rem 1.6rem", fontSize: "1.4rem",
    background: fallbackVar(vars.vox_canvas, "#0f1622"),
    color: fallbackVar(vars.dark_basic_text_color, "#edf3ff"),
    border: `.1rem solid ${fallbackVar(vars.dark_750_color, "#5a6e8a")}`,
    borderRadius: "10px",
});

export const header = style({
    display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: ".4rem 1rem",
});

export const title = style({ margin: 0, fontSize: "1.5rem", fontWeight: 600 });

export const state = style({
    display: "inline-flex", alignItems: "center", gap: ".6rem", margin: 0, fontSize: "1.3rem",
    color: fallbackVar(vars.dark_400_color, "#bccde2"),
    selectors: { '&[data-state="listening"]': { color: fallbackVar(vars.dark_basic_text_color, "#edf3ff") } },
});

export const dot = style({
    width: ".8rem", height: ".8rem", borderRadius: "50%", flexShrink: 0,
    background: fallbackVar(vars.dark_600_color, "#798ca8"),
});

globalStyle(`${state}[data-state="listening"] ${dot}`, { background: fallbackVar(vars.primary_400_color, "#5b92ff") });

// The main screen's six switches (#1235). The window is sized to hold them; should a font need more
// room, the list scrolls and the buttons below stay in sight.
export const switches = style({ display: "flex", flexDirection: "column", gap: ".6rem", flexShrink: 1, minHeight: 0, overflowY: "auto" });

// A row is the label of the kit's switch at its end: pressing anywhere on it presses the switch.
// Its words dim as the switch does; the kit's switch dims itself while it cannot be used.
export const switchRow = style({
    display: "flex", alignItems: "center", gap: "1rem", width: "100%", minHeight: "4.4rem", padding: ".6rem 1.2rem",
    boxSizing: "border-box", cursor: "pointer",
    background: fallbackVar(vars.dark_900_color, "#1a2333"),
    border: `.1rem solid ${fallbackVar(vars.dark_800_color, "#3a4a63")}`,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    selectors: {
        '&:hover:not([data-disabled="true"])': { background: fallbackVar(vars.dark_850_color, "#222d40") },
        '&[data-disabled="true"]': { cursor: "default" },
    },
});

export const switchLabel = style({ flex: 1, minWidth: 0, overflowWrap: "anywhere" });

export const switchValue = style({
    fontSize: "1.2rem", whiteSpace: "nowrap", color: fallbackVar(vars.dark_400_color, "#bccde2"),
});

globalStyle(`${switchRow}[data-checked="true"] ${switchValue}`, { color: fallbackVar(vars.dark_basic_text_color, "#edf3ff") });
// Its main switch is greyed out: drawn as such, still pressable to hear why (#562). The switch
// itself is not disabled then, so the row dims it too; a disabled switch dims itself.
globalStyle(`${switchRow}[data-disabled="true"] > span, ${switchRow}[data-blocked="true"] > span`, { opacity: 0.55 });
globalStyle(`${switchRow}[data-blocked="true"][data-disabled="false"] > [data-slot="switch"]`, { opacity: 0.55 });
globalStyle(`${switchRow}[data-busy="true"] > span`, { opacity: 0.75 });

export const footer = style({
    display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".6rem", marginTop: "auto",
});
