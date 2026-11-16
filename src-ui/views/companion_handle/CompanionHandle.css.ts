import { globalStyle, keyframes, style } from "@vanilla-extract/css";

// The handle window is see-through: only the magic circle and a docked label are painted. Its
// colours are the ASTAROT palette (docs/brand/astarot): the deep purple as the plate, the light
// lilac as the lines, the violet for a feature that is on. Like the caption plates, it does not
// follow the app's theme: it sits over a game, not over the app.

const PLATE = "rgba(38, 22, 51, 0.72)";
const LINE = "#E3DDE9";
const ON = "#A47AF5";

globalStyle("html, body, #root", { width: "100%", height: "100%", margin: 0, overflow: "hidden", background: "transparent" });
globalStyle("body", { userSelect: "none", fontFamily: '"Yu Gothic UI", "Noto Sans", system-ui, sans-serif' });

const quick = { "@media": { "(prefers-reduced-motion: reduce)": { transition: "none", animation: "none" } } };

export const root = style({
    position: "relative", width: "100%", height: "100%",
    // Faint at rest so the captions stay the thing to read; plain while the pointer is on it.
    opacity: 0.55, transition: "opacity .15s",
    selectors: { '&[data-open="true"]': { opacity: 1 } },
    ...quick,
});

export const canvas = style({ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" });

export const star = style({ transition: "transform .18s cubic-bezier(.2, .7, .3, 1)", ...quick });

export const plate = style({ fill: PLATE });

export const ring = style({ fill: "none", stroke: LINE, strokeWidth: 1.6, opacity: 0.7 });

export const point = style({
    fill: "transparent", stroke: LINE, strokeWidth: 2.4, strokeLinejoin: "round", cursor: "pointer",
    transition: "fill .15s, opacity .15s",
    selectors: {
        '&[data-on="true"]': { fill: ON, stroke: ON },
        '&[data-pending="true"]': { opacity: 0.5 },
        '&[data-docked="true"]': { stroke: "#ffffff", strokeWidth: 3.2 },
        '&[data-docked="true"]:not([data-on="true"])': { fill: "rgba(227, 221, 233, 0.22)" },
    },
    ...quick,
});

export const core = style({
    fill: "rgba(227, 221, 233, 0.08)", stroke: LINE, strokeWidth: 1.6, cursor: "pointer",
    selectors: { "&:hover": { fill: "rgba(227, 221, 233, 0.24)" } },
});

// Where the docked label starts its slide, as an offset towards the star. The page sets these two
// custom properties on the label (CompanionHandle.tsx).
export const FROM_X = "--dock-from-x";
export const FROM_Y = "--dock-from-y";

const dockOut = keyframes({
    from: { opacity: 0, translate: `var(${FROM_X}, 0) var(${FROM_Y}, 0)` },
    to: { opacity: 1, translate: "0 0" },
});

export const dock = style({
    position: "absolute", display: "flex", alignItems: "baseline", gap: "8px", whiteSpace: "nowrap",
    padding: "6px 12px", margin: 0, font: "inherit", fontSize: "14px", lineHeight: 1.3, cursor: "pointer",
    color: LINE, background: PLATE, border: `1px solid ${LINE}`, borderRadius: "999px",
    animation: `${dockOut} .16s ease-out`,
    selectors: {
        '&[data-side="top"]': { transform: "translate(-50%, -100%)" },
        '&[data-side="bottom"]': { transform: "translate(-50%, 0)" },
        '&[data-side="right"]': { transform: "translate(0, -50%)" },
        '&[data-side="left"]': { transform: "translate(-100%, -50%)" },
        '&[aria-pressed="true"]': { borderColor: ON, boxShadow: `inset 0 0 0 1px ${ON}` },
        "&:hover:not(:disabled)": { background: "rgba(38, 22, 51, 0.9)" },
        "&:disabled": { opacity: 0.6, cursor: "default" },
    },
    ...quick,
});

export const dockLabel = style({ fontWeight: 600 });

export const dockState = style({
    fontSize: "12px", opacity: 0.85,
    selectors: { [`${dock}[aria-pressed="true"] &`]: { color: ON, opacity: 1 } },
});
