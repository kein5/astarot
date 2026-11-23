import { style } from "@vanilla-extract/css";

// The flow view is sized for the desktop in rem; VR reads it from arm's length, so it is
// drawn larger here. The window does not scroll in VR, so the compact view keeps it short.
export const body = style({
    height: "100%", overflow: "hidden", padding: "12px 18px",
    boxSizing: "border-box", zoom: "1.1",
});
