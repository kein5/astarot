import { globalStyle, keyframes, style } from "@vanilla-extract/css";

// The hexagram's window is see-through: only the magic circle and a docked label are painted. Its
// colours are the ASTAROT palette (docs/brand/astarot): the deep purple as the plate, the light
// lilac as the lines, the violet for a feature that is on. Like the caption plates, it does not
// follow the app's theme: it sits over a game, not over the app.

const PLATE = "rgba(38, 22, 51, 0.72)";
const LINE = "#E3DDE9";
const ON = "#A47AF5";

globalStyle("html, body, #root", { width: "100%", height: "100%", margin: 0, overflow: "hidden", background: "transparent" });
globalStyle("body", { userSelect: "none", fontFamily: '"Yu Gothic UI", "Noto Sans", system-ui, sans-serif' });

const quick = { "@media": { "(prefers-reduced-motion: reduce)": { transition: "none", animation: "none" } } };

export const root = style({ position: "relative", width: "100%", height: "100%" });

export const canvas = style({ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" });

// It comes out over its edge: from beyond the edge to its place.
const arriveFrom = (x: number, y: number) => keyframes({
    from: { transform: `translate(${x}px, ${y}px)`, opacity: 0 },
    to: { transform: "translate(0, 0)", opacity: 1 },
});
const fromRight = arriveFrom(36, 0), fromLeft = arriveFrom(-36, 0), fromTop = arriveFrom(0, -36), fromBottom = arriveFrom(0, 36);

export const arrive = style({
    animation: `${fromRight} .18s cubic-bezier(.2, .7, .3, 1)`,
    selectors: {
        [`${root}[data-edge="left"] &`]: { animationName: fromLeft },
        [`${root}[data-edge="top"] &`]: { animationName: fromTop },
        [`${root}[data-edge="bottom"] &`]: { animationName: fromBottom },
    },
    ...quick,
});

// The wheel turns it a point at a time.
export const star = style({ transition: "transform .2s cubic-bezier(.2, .7, .3, 1)", ...quick });
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
        // Turned beyond the edge: half off the screen, not one to aim at.
        '&[data-shown="false"]': { opacity: 0.35, pointerEvents: "none" },
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

// The common settings of the hexagram's middle: a small card instead of a pill, opening the same
// way as a docked label (towards the middle of the screen).
export const menu = style({
    position: "absolute", display: "flex", flexDirection: "column", gap: "6px", width: "max-content", maxWidth: "240px",
    padding: "10px 12px", fontSize: "13px", lineHeight: 1.3,
    color: LINE, background: PLATE, border: `1px solid ${LINE}`, borderRadius: "12px",
    animation: `${dockOut} .16s ease-out`,
    selectors: {
        '&[data-side="top"]': { transform: "translate(-50%, -100%)" },
        '&[data-side="bottom"]': { transform: "translate(-50%, 0)" },
        '&[data-side="right"]': { transform: "translate(0, -50%)" },
        '&[data-side="left"]': { transform: "translate(-100%, -50%)" },
    },
    ...quick,
});

export const menuTitle = style({ margin: 0, fontSize: "12px", fontWeight: 600, opacity: 0.8 });

export const menuRow = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" });

export const menuLabel = style({ whiteSpace: "nowrap" });

export const edges = style({ display: "inline-flex", gap: "4px" });

const control = {
    font: "inherit", color: LINE, cursor: "pointer", background: "transparent",
    border: `1px solid rgba(227, 221, 233, 0.45)`,
} as const;

export const edge = style({
    ...control, minWidth: "28px", padding: "2px 6px", borderRadius: "6px",
    selectors: {
        '&[aria-pressed="true"]': { borderColor: ON, background: "rgba(164, 122, 245, 0.28)", cursor: "default" },
        '&:hover:not([aria-pressed="true"])': { background: "rgba(227, 221, 233, 0.14)" },
    },
});

export const menuItem = style({
    ...control, display: "block", width: "100%", padding: "5px 10px", textAlign: "start", borderRadius: "8px",
    selectors: { "&:hover": { background: "rgba(227, 221, 233, 0.14)" } },
});
