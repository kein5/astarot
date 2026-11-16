import { globalStyle, style } from "@vanilla-extract/css";

// The handle window is see-through: only the handle is painted. It is faint at rest so the
// captions stay the thing to read, and plain on hover. Its colours match the caption plates
// (views/caption_overlay), which do not follow the app's theme either.

globalStyle("html, body, #root", { width: "100%", height: "100%", margin: 0, overflow: "hidden", background: "transparent" });
globalStyle("body", { userSelect: "none" });

export const handle = style({
    position: "relative", display: "grid", placeItems: "center", width: "100%", height: "100%", padding: 0, margin: 0,
    border: "none", borderRadius: "6px", cursor: "pointer",
    background: "rgba(12, 16, 24, .35)", opacity: 0.45,
    transition: "opacity .15s, background-color .15s",
    selectors: {
        "&:hover, &:focus-visible": { opacity: 1, background: "rgba(12, 16, 24, .8)" },
        // Recognition is on: a small dot, readable without opening the panel.
        '&[data-listening="true"]::after': {
            content: '""', position: "absolute", top: "4px", right: "4px", width: "5px", height: "5px",
            borderRadius: "50%", background: "#5b92ff",
        },
    },
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});

export const bars = style({ display: "flex", flexDirection: "column", gap: "3px" });

export const bar = style({ display: "block", width: "12px", height: "2px", borderRadius: "1px", background: "#f5f5f7" });
