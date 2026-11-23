import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";

export const status = style({ position: "absolute", width: ".1rem", height: ".1rem", padding: 0, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" });

export const download_container = style({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // 「取得内容を確認」: seven Japanese characters at 1.2rem + 2 * .8rem padding = 10rem.
    width: "10.4rem",
    // Every row is as tall as one with a button, whatever it shows (#474).
    minHeight: "4rem",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 0,
});

export const download_button = style({
    pointerEvents: "auto",
    fontWeight: 500,
    backgroundColor: vars.dark_800_color,
    padding: "0.8rem",
    flexShrink: 0,
    borderRadius: "0.2rem",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_750_color },
        "&:active": { backgroundColor: vars.dark_800_color },
    },
});
export const download_button_label = style({
    fontSize: "1.2rem",
    minWidth: 0,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
});

export const progress_wrapper = style({
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "3rem",
    height: "3rem",
    flexShrink: 0,
});

export const progress_label = style({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: "1.2rem",
    lineHeight: 1,
    textAlign: "center",
    userSelect: "none",
    pointerEvents: "none",
    whiteSpace: "nowrap",
});

export const default_badge = style({
    fontSize: "1.2rem",
    lineHeight: 1,
    padding: "0.2rem 0.5rem",
    borderRadius: "0.2rem",
    backgroundColor: vars.dark_875_color,
    outline: `0.1rem solid ${vars.dark_800_color}`,
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
    flexShrink: 0,
});

export const unavailable = style({
    fontSize: "1.2rem",
    color: vars.dark_400_color,
    textAlign: "center",
    overflowWrap: "anywhere",
});
