import { style } from "@vanilla-extract/css";

export const reverse = style({});

// The button keeps 1rem of the rail on each side: the room is the container's, so the button
// itself sets nothing that the kit's Button sets (its width is at most the room, Button.css.ts).
export const container = style({
    width: "100%",
    display: "flex",
    justifyContent: "center",
    paddingInline: "1rem",
});

// Drawn as a button at rest (#569): the kit's plain Button at the compact size
// (LanguageSwapButton.tsx), sized to its words and centred between the two language fields, so
// it does not read as a third field. The arrows stay beside the words when a long label takes
// two lines.

export const narrow_arrow_down_svg = style({
    width: "1.4rem",
    flexShrink: 0,
    color: "currentColor",
    selectors: {
        [`&.${reverse}`]: { transform: "rotate(180deg)" },
    },
});

// The words take the kit's compact size.
export const label = style({
    minWidth: 0,
    textAlign: "center",
});
