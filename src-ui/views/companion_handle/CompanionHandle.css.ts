import { globalStyle, keyframes, style } from "@vanilla-extract/css";

// The hexagram's window is see-through: only the magic circle and a docked label are painted. Its
// colours are the ASTAROT palette (docs/brand/astarot): the deep purple as the plate, the light
// lilac as the rings, Off-White for the triangles and the icons of features that are off, Lilac
// for the triangles and the icons of features that are on (#536). Like the caption plates, it does
// not follow the app's theme: it sits over a game, not over the app.

const PLATE = "rgba(38, 22, 51, 0.72)";
const LINE = "#E3DDE9";
const ON = "#A47AF5";
// The brand's Off-White: the triangles and the icons of features that are off. A feature that is
// on turns its triangle Lilac (ON): every edge of the outline, as wide as when it is off, and a
// faint tint of it over the plate, which keeps the Lilac icon at 4.2:1 (5.4:1 against the plate
// alone) (#536).
const OFF_WHITE = "#FAFAFC";
const ON_TINT = "rgba(164, 122, 245, 0.16)";
// Feedback (#536): a triangle under the pointer, and pressed, is lit with its own colour, Off-White
// or Lilac, more than it is at rest; a switch that turns on flashes Lilac, one that turns off
// flashes Off-White, fading to the colour it rests at.
const OFF_HOVER = "rgba(250, 250, 252, 0.2)";
const OFF_PRESSED = "rgba(250, 250, 252, 0.32)";
const ON_HOVER = "rgba(164, 122, 245, 0.34)";
const ON_PRESSED = "rgba(164, 122, 245, 0.48)";
const flashOn = keyframes({ from: { fill: "rgba(164, 122, 245, 0.62)" }, to: { fill: ON_TINT } });
const flashOff = keyframes({ from: { fill: "rgba(250, 250, 252, 0.42)" }, to: { fill: "rgba(250, 250, 252, 0)" } });
// The icon of a switch that changed grows and settles back.
const pop = keyframes({ from: { scale: "1.45" }, to: { scale: "1" } });

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
    fill: "transparent", stroke: OFF_WHITE, strokeWidth: 2.4, strokeLinejoin: "round", cursor: "pointer",
    transition: "fill .15s, stroke .15s, stroke-width .15s, opacity .15s",
    selectors: {
        // On: a faint Lilac tint, so the Lilac icon stays readable (#536); it was a full lilac fill
        // before the icons. Its Lilac outline is `outline`, drawn over the rest of the star. This
        // one stays, unseen, so that the pointer finds the triangle as it does when it is off.
        '&[data-on="true"]': { fill: ON_TINT, stroke: "transparent" },
        "&:hover": { fill: OFF_HOVER },
        '&[data-on="true"]:hover': { fill: ON_HOVER },
        '&[data-pending="true"]': { opacity: 0.5 },
        // Its main switch is greyed out: a broken outline, not a filled one (#562).
        '&[data-blocked="true"]': { strokeDasharray: "4 4", opacity: 0.6 },
        // Docked out: lit and a little wider, on or off; white when it is off, Lilac when it is on
        // (the outline of one that is on is `outline`), so that a switch turning shows there too.
        '&[data-docked="true"]': { strokeWidth: 3.2 },
        '&[data-docked="true"]:not([data-on="true"])': { stroke: "#ffffff", fill: "rgba(227, 221, 233, 0.22)" },
        '&[data-docked="true"][data-on="true"]': { fill: ON_HOVER },
        // Pressed (it docks its label at once), docked out or not.
        '&:active:not([data-on="true"])': { fill: OFF_PRESSED },
        '&[data-on="true"]:active': { fill: ON_PRESSED },
        '&[data-flash="on"]': { animation: `${flashOn} .6s ease-out` },
        '&[data-flash="off"]': { animation: `${flashOff} .6s ease-out` },
        // Turned beyond the edge: half off the screen, not one to aim at.
        '&[data-shown="false"]': { opacity: 0.35, pointerEvents: "none" },
    },
    ...quick,
});

// The outline of a triangle whose switch is on (#536). It is drawn after the hexagon in the middle
// and all the triangles, whose outlines share its lines, so that every edge of it is Lilac. It
// takes no pointer: the triangle under it does. A switch that is off draws none here.
export const outline = style({
    fill: "none", stroke: "transparent", strokeWidth: 2.4, strokeLinejoin: "round", pointerEvents: "none",
    transition: "stroke .15s, stroke-width .15s, opacity .15s",
    selectors: {
        '&[data-on="true"]': { stroke: ON },
        '&[data-on="true"][data-docked="true"]': { strokeWidth: 3.2 },
        '&[data-pending="true"]': { opacity: 0.5 },
        '&[data-blocked="true"]': { strokeDasharray: "4 4", opacity: 0.6 },
        '&[data-shown="false"]': { opacity: 0.35 },
    },
    ...quick,
});

// The icon stays upright while the hexagram turns: it turns back as fast as the star turns. It
// takes no pointer, so the triangle under it is what the pointer rests on. The main window's icons
// are drawn three ways (a plain fill, a fill of currentColor, a stroke of currentColor), so the
// colour is both the fill and the color.
export const icon = style({
    fill: OFF_WHITE, color: OFF_WHITE, pointerEvents: "none",
    transition: "transform .2s cubic-bezier(.2, .7, .3, 1), scale .15s, fill .15s, color .15s, opacity .15s",
    selectors: {
        '&[data-on="true"]': { fill: ON, color: ON },
        // Its triangle under the pointer: a little larger.
        [`${point}:hover + g &`]: { scale: "1.2" },
        '&[data-flash="on"], &[data-flash="off"]': { animation: `${pop} .35s ease-out` },
        '&[data-pending="true"]': { opacity: 0.5 },
        '&[data-blocked="true"]': { opacity: 0.6 },
        '&[data-shown="false"]': { opacity: 0.35 },
    },
    ...quick,
});

export const core = style({
    fill: "rgba(227, 221, 233, 0.08)", stroke: LINE, strokeWidth: 1.6, cursor: "pointer", transition: "fill .15s",
    selectors: { "&:hover": { fill: "rgba(227, 221, 233, 0.24)" }, "&:active": { fill: "rgba(227, 221, 233, 0.34)" } },
    ...quick,
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
    transition: "scale .08s, background .15s",
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
        // Pressed: it gives under the pointer.
        "&:active:not(:disabled)": { scale: "0.95", background: "rgba(38, 22, 51, 0.96)" },
        "&:disabled": { opacity: 0.6, cursor: "default" },
        '&[data-blocked="true"]': { opacity: 0.75 },
    },
    ...quick,
});

export const dockLabel = style({ fontWeight: 600 });

export const dockState = style({
    fontSize: "12px", opacity: 0.85,
    selectors: {
        [`${dock}[aria-pressed="true"] &`]: { color: ON, opacity: 1 },
        // A request that could not be sent: said in full, not faint.
        '&[data-failed="true"]': { color: OFF_WHITE, opacity: 1 },
    },
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
