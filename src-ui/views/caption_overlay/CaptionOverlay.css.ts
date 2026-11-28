import { globalStyle, style } from "@vanilla-extract/css";

// The side the band sits on, and the states of a line.
export const is_top = style({});
export const is_fading = style({});
export const is_pending = style({});

// The flow strip sits beside the captions, at the band's left, on the edge the captions
// stack from; the captions keep the rest of the width, so neither covers the other.
export const with_flow = style({
    display: "flex", alignItems: "flex-end", gap: "0.6em", width: "100%", height: "100%", boxSizing: "border-box",
    selectors: {
        [`&.${is_top}`]: { alignItems: "flex-start" },
    },
});

// Lines stack from the edge the band sits on: upward from the bottom of the
// screen, downward from the top.
export const container = style({
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "0.25em",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    padding: "0.2em 0",
    selectors: {
        [`&.${is_top}`]: { justifyContent: "flex-start" },
        [`${with_flow} > &`]: { flex: 1, minWidth: 0 },
    },
});

export const line = style({
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "0.2em 0.7em",
    borderRadius: "0.3em",
    // The plate keeps the words readable over a bright scene; the outline keeps
    // them readable when the plate is made fully transparent.
    background: "rgba(8, 12, 22, var(--caption_plate, 0.6))",
    textAlign: "center",
    // One blurred shadow is too faint an outline for light-coloured words on a
    // bright scene; stacked, it closes into a dark edge.
    textShadow: "0 0 0.09em #000, 0 0 0.09em #000, 0 0 0.09em #000, 0 0 0.09em #000, 0 0.06em 0.22em rgba(0, 0, 0, 0.9)",
    opacity: 1,
    transition: "opacity 0.4s ease",
    selectors: {
        [`&.${is_fading}`]: { opacity: 0 },
    },
});

// The user's own words (the microphone, typing) are blue and the other side
// (the speakers, chat reading) is purple, the hues of the message log and of
// the VR overlay, lightened to stay readable over a game. The bar repeats it
// on the side the message log puts each on, so the two are never told apart
// by colour alone.
export const sent = style({
    vars: { "--caption_ink": "#9fd4ff", "--caption_ink_soft": "#c2e3ff", "--caption_bar": "#58b0ee" },
    borderRight: "0.2em solid var(--caption_bar)",
});
export const received = style({
    vars: { "--caption_ink": "#efb4ff", "--caption_ink_soft": "#f5ceff", "--caption_bar": "#cf86e6" },
    borderLeft: "0.2em solid var(--caption_bar)",
});
// Where the game audio's voices are told apart, each voice keeps a colour of
// its own: the first is the purple of every received line, then amber, green
// and rose, and the fifth voice starts over. Blue stays the user's own. The
// label before the words (A, B, ...) says the same without colour.
export const voice_1 = style({
    vars: { "--caption_ink": "#ffd08a", "--caption_ink_soft": "#ffe2b5", "--caption_bar": "#e6a84a" },
});
export const voice_2 = style({
    vars: { "--caption_ink": "#a6efc0", "--caption_ink_soft": "#c8f6d8", "--caption_bar": "#5fcf8c" },
});
export const voice_3 = style({
    vars: { "--caption_ink": "#ffb3c1", "--caption_ink_soft": "#ffd0d8", "--caption_bar": "#ee7f95" },
});

export const who = style({
    display: "inline-block",
    marginRight: "0.45em",
    padding: "0 0.4em",
    borderRadius: "0.3em",
    fontSize: "0.62em",
    fontWeight: 700,
    fontStyle: "normal",
    verticalAlign: "0.2em",
    // Dark letters on the voice's colour read over any scene, with or without the plate.
    color: "#0b0f18",
    background: "var(--caption_bar)",
    textShadow: "none",
});

// The words of a line: the original in the colour of its side. Still being recognized or sent: italic.
export const text = style({
    margin: 0,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    color: "var(--caption_ink)",
    selectors: {
        [`${is_pending} &`]: { fontStyle: "italic" },
    },
});
// A translation under its original is a lighter tint of the same hue; alone
// ("only the translation") it carries the full colour.
export const translation = style({
    margin: 0,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    color: "var(--caption_ink_soft)",
    selectors: {
        "&:first-child": { color: "var(--caption_ink)" },
    },
});

export const flow = style({
    flex: "0 0 auto", width: "min(18em, 44%)", maxHeight: "100%", overflow: "hidden", padding: "0.2em 0",
    display: "flex", flexDirection: "column", gap: "0.15em",
    fontSize: "1em", lineHeight: 1.35, fontVariantNumeric: "tabular-nums",
});
globalStyle(`${flow} > *`, { fontSize: "0.5em" });
export const flow_item = style({
    padding: "0.4em 0.6em", borderRadius: "0.3em", color: "#e6eefc",
    background: "rgba(8, 12, 22, max(0.55, var(--caption_plate, 0.6)))",
    textShadow: "0 0 0.12em #000, 0 0 0.12em #000",
});
export const flow_voice = style({ borderLeft: "0.25em solid #58b0ee" });
export const flow_chat = style({ borderLeft: "0.25em solid #a58cf0" });
export const flow_text = style({
    margin: "0 0 0.35em", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflowWrap: "anywhere",
});
// The path: input → steps → outputs; outputs stack, each with its own arrow from the last step.
export const flow_path = style({ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: "0.25em" });
export const flow_step = style({ display: "flex", alignItems: "center" });
export const flow_outputs = style({ display: "flex", flexDirection: "column", gap: "0.25em", paddingLeft: "0.4em", borderLeft: "0.12em solid #7f93b3" });
export const flow_chip = style({
    display: "inline-flex", gap: "0.4em", alignItems: "baseline", whiteSpace: "nowrap", padding: "0.15em 0.5em",
    border: "0.1em solid #3d4e6b", borderRadius: "0.35em", background: "rgba(24, 37, 59, 0.92)", fontVariantNumeric: "tabular-nums",
});
globalStyle(`${flow_chip} b`, { fontWeight: 600, color: "#a9ccff" });
export const flow_input = style({
    fontWeight: 700,
    selectors: {
        [`${flow_voice} &`]: { borderColor: "#58b0ee" },
        [`${flow_chat} &`]: { borderColor: "#a58cf0" },
    },
});
export const flow_out_chatbox = style({ borderColor: "#4fb8a8" });
export const flow_out_speech = style({ borderColor: "#e0a656" });
export const flow_out_conversion = style({ borderColor: "#f08cc2" });
// After the outputs' colours, which it overrides.
export const flow_off = style({ borderStyle: "dashed", borderColor: "#6b7a93", background: "transparent", color: "#a8b4c8" });
globalStyle(`${flow_off} b`, { color: "#a8b4c8", fontWeight: 400 });
export const flow_arrow = style({
    position: "relative", width: "1.1em", height: "0.12em", margin: "0 0.15em", background: "#7f93b3", flexShrink: 0,
    selectors: {
        "&::after": {
            content: '""', position: "absolute", right: "-0.1em", top: "-0.22em",
            borderLeft: "0.35em solid #7f93b3", borderTop: "0.28em solid transparent", borderBottom: "0.28em solid transparent",
        },
    },
});
export const flow_note = style({ margin: 0, padding: "0.2em 0.6em", borderRadius: "0.3em", background: "rgba(8, 12, 22, 0.6)", color: "#dce7fb", alignSelf: "flex-start" });

// Ctrl held over the window: the area a drag moves, and the text size beside it. It never takes
// the mouse; the native side does the drag. A fixed size in px, so a large caption size does not
// make the frame cover the captions.
export const adjust = style({
    position: "fixed",
    inset: 0,
    boxSizing: "border-box",
    border: "2px dashed #58b0ee",
    borderRadius: "6px",
    background: "rgba(88, 176, 238, 0.12)",
    pointerEvents: "none",
});
export const adjust_size = style({
    position: "absolute",
    top: "6px",
    right: "6px",
    padding: "2px 8px",
    borderRadius: "4px",
    background: "rgba(8, 12, 22, 0.85)",
    color: "#c2e3ff",
    fontSize: "14px",
    lineHeight: 1.4,
    fontVariantNumeric: "tabular-nums",
});
