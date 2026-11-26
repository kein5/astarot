import { style } from "@vanilla-extract/css";

// The readout that says the engine is not connected (#1236): under the title bar, across the window,
// with the settings pages' edge margin.
export const disconnected = style({
    alignSelf: "stretch",
    flexShrink: 0,
    margin: "1.2rem 1.6rem 0",
});
