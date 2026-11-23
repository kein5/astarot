import { style } from "@vanilla-extract/css";

// What the monitor plays for this voice, beside the button that opens its setting (#614): on the
// button's middle line, as a value read with it, not on the top edge of the row's group.
export const monitorState = style({ alignSelf: "center" });
