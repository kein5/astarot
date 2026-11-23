import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const no_padding = style({});
export const horizontal = style({});
export const vertical = style({});
export const thumbActive = style({});
export const dragging = style({});
export const valueLabelOpen = style({});

export const container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingLeft: "4rem",
    selectors: {
        [`&.${no_padding}`]: { paddingLeft: 0 },
    },
});

// shadcn/ui's Slider: a .6rem groove (h-1.5) with its filled part (Range) in the primary
// colour. The padding keeps the 3rem the pointer could already reach.
export const sliderRoot = style({
    position: "relative",
    boxSizing: "border-box",
    cursor: "pointer",
    touchAction: "none",
    selectors: {
        [`&.${horizontal}`]: { width: "100%", height: "0.6rem", padding: "1.2rem 0", margin: "0.8rem 0" },
        [`&.${vertical}`]: { height: "100%", width: "0.6rem", padding: "0 1.2rem", margin: "0 0.8rem" },
        // shadcn/ui's data-[disabled]:opacity-50; its thumb takes no hover ring then.
        "&[data-disabled]": { opacity: 0.5, cursor: "not-allowed" },
    },
});

export const rail = style({
    position: "absolute",
    backgroundColor: vars.dark_825_color,
    borderRadius: "1rem",
    selectors: {
        [`${horizontal} &`]: { top: "50%", left: 0, right: 0, height: "0.6rem", transform: "translateY(-50%)" },
        [`${vertical} &`]: { left: "50%", top: 0, bottom: 0, width: "0.6rem", transform: "translateX(-50%)" },
    },
});

// The filled part, from the start to the value (shadcn/ui's Range).
export const track = style({
    position: "absolute",
    backgroundColor: vars.primary_600_color,
    borderRadius: "1rem",
    border: "none",
    selectors: {
        [`${horizontal} &`]: { top: "50%", height: "0.6rem", transform: "translateY(-50%)" },
        [`${vertical} &`]: { left: "50%", width: "0.6rem", transform: "translateX(-50%)" },
    },
});

export const thumb = style({
    position: "absolute",
    width: "1.8rem",
    height: "1.8rem",
    boxSizing: "border-box",
    borderRadius: "50%",
    outline: 0,
    transition: "box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, left 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, bottom 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
    backgroundColor: vars.primary_600_color,
    selectors: {
        [`${sliderRoot}[data-disabled] &:hover`]: { boxShadow: "none" },
        [`${horizontal} &`]: { top: "50%", transform: "translate(-50%, -50%)" },
        [`${vertical} &`]: { left: "50%", transform: "translate(-50%, 50%)" },
        [`&:hover, &.${thumbActive}`]: { boxShadow: `0 0 0 0.8rem ${vars.primary_600_color_44}` },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".3rem" },
    },
});

globalStyle(`${dragging} *`, { transition: "none !important" });

// Where the value's bubble opens: above the thumb, or beside it.
export const location_top = style({}, "location-top");
export const location_right = style({}, "location-right");
export const location_left = style({}, "location-left");
// Looked up by the location a slider is given; another name gives no class, as before.
export const valueLabelLocation: Partial<Record<string, string>> = { top: location_top, right: location_right, left: location_left };

export const valueLabel = style({
    position: "absolute",
    backgroundColor: vars.dark_800_color,
    width: "fit-content",
    minWidth: "3.2rem",
    padding: "0.4rem 0.8rem",
    color: vars.dark_basic_text_color,
    borderRadius: "0.4rem",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    textWrap: "nowrap",
    opacity: 0,
    visibility: "hidden",
    transition: "transform 150ms ease, opacity 100ms ease, visibility 100ms ease",
    zIndex: 100,
    selectors: {
        [`&.${valueLabelOpen}`]: { opacity: 1, visibility: "visible" },
        [`&.${location_top}`]: { bottom: "110%", left: "50%", transform: "translate(-50%, 0) scale(0)", transformOrigin: "bottom center" },
        [`&.${location_top}.${valueLabelOpen}`]: { transform: "translate(-50%, 0) scale(1)" },
        [`&.${location_right}`]: { top: "50%", left: "170%", transform: "translate(0%, -50%) scale(0)", transformOrigin: "left center" },
        [`&.${location_right}.${valueLabelOpen}`]: { transform: "translate(0, -50%) scale(1)" },
        [`&.${location_left}`]: { top: "50%", right: "170%", transform: "translate(0%, -50%) scale(0)", transformOrigin: "right center" },
        [`&.${location_left}.${valueLabelOpen}`]: { transform: "translate(0, -50%) scale(1)" },
    },
});

export const valueLabelLabel = style({
    fontSize: "1.4rem",
});

// A tick across the groove, as tall as the groove.
export const mark = style({
    position: "absolute",
    width: "0.1rem",
    height: "0.6rem",
    borderRadius: "50%",
    backgroundColor: vars.dark_650_color,
    selectors: {
        [`${horizontal} &`]: { top: "50%", transform: "translate(-50%, -50%)" },
        [`${vertical} &`]: { left: "50%", transform: "translate(-50%, 50%)" },
    },
});

export const markLabel = style({
    position: "absolute",
    fontSize: "1.4rem",
    color: vars.dark_550_color,
    whiteSpace: "nowrap",
    selectors: {
        [`${horizontal} &`]: { top: "1.6rem", left: "50%", transform: "translateX(-50%)" },
        [`${vertical} &`]: { left: "1.6rem", top: "50%", transform: "translateY(-50%)" },
    },
});
