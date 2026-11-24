import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const is_disabled = style({});
export const open_below = style({});
export const open_above = style({});
export const align_start = style({});
export const align_end = style({});

export const container = style({
    display: "flex",
    width: "100%",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "1rem",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
});

export const swatch_button = style({
    width: "3.6rem",
    height: "3.6rem",
    padding: "0.4rem",
    backgroundColor: vars.dark_925_color,
    border: `0.1rem solid ${vars.dark_800_color}`,
    borderRadius: "0.4rem",
    flexShrink: 0,
    selectors: {
        "&:hover": { borderColor: vars.dark_700_color },
        "&:active": { borderColor: vars.dark_650_color },
        [`&.${is_disabled}`]: { pointerEvents: "none", opacity: 0.6 },
    },
});

export const swatch = style({
    display: "block",
    width: "100%",
    height: "100%",
    borderRadius: "0.2rem",
    border: `0.1rem solid ${vars.dark_700_color}`,
});

export const swatch_wrapper = style({
    position: "relative",
    flexShrink: 0,
});

export const popover_paper = style({
    position: "absolute",
    zIndex: 1000,
    padding: "1.2rem",
    backgroundColor: vars.dark_950_color,
    border: `0.1rem solid ${vars.dark_800_color}`,
    borderRadius: "0.8rem",
    boxShadow: vars.vox_shadow_overlay,
    selectors: {
        [`&.${open_below}`]: { top: "calc(100% + 0.4rem)", bottom: "auto" },
        [`&.${open_above}`]: { bottom: "calc(100% + 0.4rem)", top: "auto" },
        [`&.${align_start}`]: { left: 0, right: "auto" },
        [`&.${align_end}`]: { right: 0, left: "auto" },
    },
});

// The colour picker (react-colorful) fills the popover, with larger handles.
export const popover_content = style({
    width: "20rem",
    height: "20rem",
});
globalStyle(`${popover_content} .react-colorful`, { width: "100%", height: "100%" });
globalStyle(`${popover_content} .react-colorful__saturation`, { borderBottomWidth: "1.2rem", borderRadius: "0.8rem 0.8rem 0 0" });
globalStyle(`${popover_content} .react-colorful__hue, ${popover_content} .react-colorful__alpha`, { height: "2.4rem" });
globalStyle(`${popover_content} .react-colorful__last-control`, { borderRadius: "0 0 0.8rem 0.8rem" });
globalStyle(`${popover_content} .react-colorful__pointer`, { width: "2.8rem", height: "2.8rem", borderWidth: "0.2rem" });
