import { fallbackVar, style } from "@vanilla-extract/css";
import { vars } from "../../views/theme/vars.css.ts";

// A notice that offers one way forward: its text, then a button under it.
// The first style moved from SCSS Modules to vanilla-extract (ADR-010); the rules are unchanged.
export const notice = style({ display: "grid", gap: ".6rem", justifyItems: "start" });

export const action = style({
    boxSizing: "border-box", minHeight: "3.2rem", padding: ".6rem 1.2rem", maxWidth: "100%", whiteSpace: "normal",
    font: "inherit", fontSize: "1.3rem", fontWeight: 500, color: "inherit", cursor: "pointer",
    background: fallbackVar(vars.dark_850_color, "#25364f"),
    border: `.1rem solid ${fallbackVar(vars.dark_775_color, "#3b4b63")}`,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    userSelect: "none", WebkitUserSelect: "none",
    selectors: {
        "&:hover": { background: fallbackVar(vars.vox_secondary_hover, "#2f4362") },
        "&:active": { background: fallbackVar(vars.dark_925_color, "#141c2a") },
        "&:focus-visible": { outline: `.2rem solid ${fallbackVar(vars.primary_200_color, "#80cbc4")}`, outlineOffset: ".2rem" },
    },
});
