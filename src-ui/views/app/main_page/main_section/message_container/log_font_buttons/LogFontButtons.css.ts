import { style } from "@vanilla-extract/css";

// At the composer's foot, as the send button is, so a tall composer keeps them where typing ends.
export const group = style({
    display: "flex",
    flexShrink: 0,
    alignSelf: "flex-end",
    gap: ".4rem",
});

// The kit's compact button, narrowed to its two characters; both are as wide, A＋ being the wider.
export const button = style({
    width: "4rem",
    paddingInline: 0,
    fontSize: "1.4rem",
});
