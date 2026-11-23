import { keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

const rotate = keyframes({
    "100%": { transform: "rotate(360deg)" },
});

const dash = keyframes({
    "0%": { strokeDasharray: "0.1rem, 20.0rem", strokeDashoffset: "0" },
    "50%": { strokeDasharray: "10.0rem, 20.0rem", strokeDashoffset: "-1.5rem" },
    "100%": { strokeDasharray: "10.0rem, 20.0rem", strokeDashoffset: "-12.5rem" },
});

export const determinate = style({});

export const root = style({
    display: "inline-block",
    color: vars.primary_300_color,
    animation: `${rotate} 1.4s linear infinite`,
    selectors: {
        [`&.${determinate}`]: {
            animation: "none",
            transform: "rotate(-90deg)",
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        },
    },
});

export const svg = style({
    display: "block",
});

export const circle = style({
    stroke: "currentColor",
    strokeDasharray: "80, 200",
    strokeDashoffset: "0",
    selectors: {
        [`${root}:not(.${determinate}) &`]: {
            animation: `${dash} 1.4s ease-in-out infinite`,
        },
    },
});

export const circleDeterminate = style({
    transition: "stroke-dashoffset 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
});
