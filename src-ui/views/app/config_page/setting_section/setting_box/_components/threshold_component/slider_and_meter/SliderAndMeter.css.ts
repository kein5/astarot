import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    flex: 1,
    position: "relative", // for dev
});

export const meter_container = style({
    position: "relative",
    width: "100%",
    height: "0.8rem",
    background: vars.dark_800_color,
    borderRadius: "0.4rem",
});

export const volume_meter = style({
    height: "100%",
    borderRadius: "inherit",
    transition: "width 0.1s ease, background-color 0.1s ease",
});

export const threshold_slider = style({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "all",
    selectors: {
        "&::-webkit-slider-runnable-track": { width: "100%", background: "transparent", cursor: "pointer" },
        "&::-webkit-slider-thumb": {
            WebkitAppearance: "none",
            width: "0.4rem",
            height: "4rem",
            background: vars.primary_600_color,
            borderRadius: "0.2rem",
            cursor: "pointer",
        },
        "&:hover::-webkit-slider-thumb": { background: vars.primary_500_color },
        "&:focus": { outline: "none" },
        // Keyboard focus marks the thumb itself: an outline round the whole input
        // would read as part of the meter.
        "&:focus-visible::-webkit-slider-thumb": {
            background: vars.primary_200_color,
            boxShadow: `0 0 0 .2rem ${vars.dark_1000_color}, 0 0 0 .4rem ${vars.primary_200_color}`,
        },
    },
});
