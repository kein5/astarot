// Shared pieces of style (#957, ADR-010): functions and objects that give the same declarations
// wherever a .css.ts file spreads them into its styles. They were the SCSS mixins of the former
// mixins.scss. They make no class of their own, except the loader's spin, which is a keyframes
// made where it is called, one for each style that uses it.
import { keyframes } from "@vanilla-extract/css";
import type { StyleRule } from "@vanilla-extract/css";

interface LoaderOptions {
    size?: string;
    lineWidth?: string;
    // The side the spinner is placed from, and how far.
    position?: "left" | "right" | "top" | "bottom";
    positionAmount?: string | number;
}

// A spinning loader: a ring of two quarter arcs, centred on its anchor point. Its rotation keeps
// the centring translate.
export const loader = ({ size = "2rem", lineWidth = "0.2rem", position = "right", positionAmount = 0 }: LoaderOptions = {}): StyleRule => {
    const halfLine = `calc(${lineWidth} / 2)`;
    const translate = `calc(-50% + ${halfLine})`;
    const spin = keyframes({
        "0%": { transform: `translate(${translate}, ${translate}) rotate(0deg)` },
        "100%": { transform: `translate(${translate}, ${translate}) rotate(360deg)` },
    });
    return {
        position: "absolute",
        top: `calc(50% - ${halfLine})`,
        [position]: positionAmount,
        transform: `translate(${translate}, ${translate})`,
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-block",
        borderTop: `${lineWidth} solid var(--dark_400_color)`,
        borderRight: `${lineWidth} solid transparent`,
        animation: `${spin} 0.6s linear infinite`,
        selectors: {
            "&::after": {
                content: "''",
                position: "absolute",
                width: size,
                height: size,
                borderRadius: "50%",
                borderBottom: `${lineWidth} solid var(--primary_400_color)`,
                borderLeft: `${lineWidth} solid transparent`,
            },
        },
    };
};

// A tooltip's bubble: shadcn/ui's TooltipContent read by DESIGN.md's
// rules, as wide as its words up to a reading measure, keeping the line breaks of its text. Its
// colours stay the light words on dark_700 until D-22 decides whether they are inverted.
export const tooltipContent: StyleRule = {
    width: "max-content",
    maxWidth: "min(36rem, 90cqi)",
    padding: ".6rem 1.2rem",
    borderRadius: "var(--vox_radius, .8rem)",
    backgroundColor: "var(--dark_700_color)",
    color: "var(--dark_basic_text_color)",
    fontSize: "1.2rem",
    // Not shadcn/ui's text-xs weight (400), line height (1.33) or text-balance: the Hint's
    // descriptions run to several lines, so they keep DESIGN.md's description line height (D-42).
    fontWeight: 500,
    lineHeight: 1.6,
    textAlign: "left",
    whiteSpace: "pre-line",
    overflowWrap: "anywhere",
};
