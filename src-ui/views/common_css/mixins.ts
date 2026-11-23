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

// The toggle switch's track and knob, its sizes and colours read from custom properties with
// these defaults. The modifier classes are the including
// module's own.
export const TOGGLE = {
    width: "4rem",
    height: "1.6rem",
    gutter: "0.1rem",
    backgroundOn: "var(--primary_400_color)",
    backgroundOff: "var(--dark_775_color)",
    control: "var(--dark_400_color)",
    speed: "0.15s",
    ease: "ease-out",
} as const;

interface ToggleModifiers {
    // The class the SCSS mixin was included in: every rule is that class's descendant, as the
    // mixin's nested .control was.
    parent: string;
    isPending: string;
    isHovered: string;
    isMouseDown: string;
    isActive: string;
}

export const toggleControl = ({ parent, isPending, isHovered, isMouseDown, isActive }: ToggleModifiers): StyleRule => {
    const width = `var(--toggle_width, ${TOGGLE.width})`;
    const height = `var(--toggle_height, ${TOGGLE.height})`;
    const gutter = `var(--toggle_gutter, ${TOGGLE.gutter})`;
    const self = `${parent} &`;
    return {
        selectors: {
            [self]: {
                position: "relative",
                // The track has no content, so a flex parent could otherwise squeeze it.
                flexShrink: 0,
                width,
                height,
                borderRadius: `calc(${height} / 2)`,
                backgroundColor: `var(--toggle_bg_off, ${TOGGLE.backgroundOff})`,
            },
            [`${self}:after`]: {
                content: '""',
                position: "absolute",
                top: gutter,
                left: gutter,
                width: `calc(${height} - ${gutter} * 2)`,
                height: `calc(${height} - ${gutter} * 2)`,
                borderRadius: `calc(${height} / 2)`,
                background: TOGGLE.control,
                transition: `left ${TOGGLE.speed} ${TOGGLE.ease}`,
            },
            [`${self}:hover`]: { vars: { "--toggle_bg_off": "var(--dark_725_color)", "--toggle_bg_on": "var(--primary_350_color)" } },
            [`${self}:active`]: { vars: { "--toggle_bg_off": "var(--dark_825_color)", "--toggle_bg_on": "var(--primary_700_color)" } },
            [`${self}.${isPending}:after`]: { backgroundColor: "var(--dark_600_color)" },
            [`${self}.${isHovered}`]: { backgroundColor: "var(--dark_725_color)" },
            [`${self}.${isMouseDown}`]: { backgroundColor: "var(--dark_825_color)" },
            [`${self}.${isActive}`]: { backgroundColor: `var(--toggle_bg_on, ${TOGGLE.backgroundOn})` },
            [`${self}.${isActive}.${isHovered}`]: { backgroundColor: "var(--primary_350_color)" },
            [`${self}.${isActive}.${isMouseDown}`]: { backgroundColor: "var(--primary_700_color)" },
            [`${self}.${isActive}:after`]: { left: `calc(${width} - ${height} + ${gutter})` },
        },
    };
};

// A parent that colours the toggle switch inside it while hovered or pressed.
export const toggleInteractiveParent: StyleRule = {
    selectors: {
        "&:hover": { vars: { "--toggle_bg_off": "var(--dark_725_color)", "--toggle_bg_on": "var(--primary_350_color)" } },
        "&:active": { vars: { "--toggle_bg_off": "var(--dark_825_color)", "--toggle_bg_on": "var(--primary_700_color)" } },
    },
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
