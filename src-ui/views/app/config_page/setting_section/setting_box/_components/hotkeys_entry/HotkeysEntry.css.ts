import { style } from "@vanilla-extract/css";
import { loader as spinner } from "../../../../../../common_css/mixins.ts";

// While a key is being saved, the clear button takes no pointer; the kit's Button draws it dimmed.
export const is_pending = style({ pointerEvents: "none" });

export const container = style({
    display: "flex",
    width: "100%",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "1rem",
    position: "relative",
});

// The clear button is the kit's danger icon Button (HotkeysEntry.tsx); the mark takes its red.
export const delete_svg = style({ width: "2.2rem" });

export const loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "left", positionAmount: "-2.2rem" }));
