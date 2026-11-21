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

globalStyle(`${panel} :focus-visible`, {
    outline: `.2rem solid ${fallbackVar(vars.primary_200_color, "#a9ccff")}`, outlineOffset: ".2rem",
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

export const switches = style({ display: "flex", flexDirection: "column", gap: ".6rem" });

export const switchRow = style({
    display: "flex", alignItems: "center", gap: "1rem", width: "100%", minHeight: "4.4rem", padding: ".6rem 1.2rem",
    font: "inherit", color: "inherit", textAlign: "start", cursor: "pointer",
    background: fallbackVar(vars.dark_900_color, "#1a2333"),
    border: `.1rem solid ${fallbackVar(vars.dark_800_color, "#3a4a63")}`,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    selectors: {
        "&:hover:not(:disabled)": { background: fallbackVar(vars.dark_850_color, "#222d40") },
        "&:disabled": { opacity: 0.55, cursor: "default" },
        // Its main switch is greyed out: drawn as such, still pressable to hear why (#562).
        '&[data-blocked="true"]': { opacity: 0.55 },
        '&[aria-busy="true"]': { opacity: 0.75 },
    },
});

export const switchLabel = style({ flex: 1, minWidth: 0, overflowWrap: "anywhere" });

export const switchValue = style({
    fontSize: "1.2rem", whiteSpace: "nowrap", color: fallbackVar(vars.dark_400_color, "#bccde2"),
});

export const track = style({
    position: "relative", flexShrink: 0, width: "3.6rem", height: "2rem", borderRadius: "1rem",
    background: fallbackVar(vars.dark_750_color, "#5a6e8a"), transition: "background-color .15s",
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});

export const thumb = style({
    position: "absolute", top: ".2rem", left: ".2rem", width: "1.6rem", height: "1.6rem", borderRadius: "50%",
    background: fallbackVar(vars.dark_200_color, "#edf3ff"), transition: "transform .15s",
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});

const on = `${switchRow}[aria-checked="true"]`;
globalStyle(`${on} ${track}`, { background: fallbackVar(vars.primary_600_color, "#2865dc") });
globalStyle(`${on} ${thumb}`, { transform: "translateX(1.6rem)" });
globalStyle(`${on} ${switchValue}`, { color: fallbackVar(vars.dark_basic_text_color, "#edf3ff") });

export const footer = style({
    display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".6rem", marginTop: "auto",
});

export const linkButton = style({
    font: "inherit", fontSize: "1.3rem", minHeight: "3.2rem", padding: ".4rem .8rem", cursor: "pointer",
    color: fallbackVar(vars.primary_200_color, "#a9ccff"), background: "none", border: "none",
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    selectors: { "&:hover": { background: fallbackVar(vars.dark_900_color, "#1a2333") } },
});
