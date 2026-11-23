import { style } from "@vanilla-extract/css";

export const container = style({
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "column",
    gap: "4rem",
    position: "relative",
});

export const label = style({
    position: "absolute",
    top: "60%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: "2rem",
});

export const circular_box = style({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
});

export const mark_box = style({
    position: "relative",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "100%",
    height: "100%",
    overflow: "hidden",
});

// ASTAROT's app icon, upright inside the turning progress ring.
export const mark_img = style({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "4.8rem",
});
