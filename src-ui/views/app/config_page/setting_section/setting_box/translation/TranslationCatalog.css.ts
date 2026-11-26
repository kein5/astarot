import { style } from "@vanilla-extract/css";

// A built-in model's card is pressed anywhere to choose the model, or to review its download
// (#1228). The card's one control is its visible button, whose hit area covers the card: the
// card itself is not a second control, so the keyboard and the screen reader meet one button.
export const pressable = style({ position: "relative" });
export const press = style({
    selectors: {
        "&::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit", cursor: "pointer" },
        "&:disabled::after": { cursor: "default" },
    },
});
