import { style } from "@vanilla-extract/css";

// The flow view is sized for the desktop in rem; VR reads it from arm's length, so it is
// drawn larger here. The window does not scroll in VR, so the compact view keeps it short.
// It fills the window's width, as the other VR windows' bodies do. Sized by its content, it
// took only the width of the latest times: the graph's frame is a size container and asks no
// width for the graph, so the graph was cut off at the middle of the window (#1404).
export const body = style({
    flex: 1, minWidth: 0, minHeight: 0,
    height: "100%", overflow: "hidden", padding: "12px 18px",
    boxSizing: "border-box", zoom: "1.1",
});
