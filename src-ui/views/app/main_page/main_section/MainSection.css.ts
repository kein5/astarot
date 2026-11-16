import { style } from "@vanilla-extract/css";
import { MAIN_SECTION_CONTAINER } from "../layout.ts";

// The conversation column. A size container: the top bar, the composer and the panels
// that open in it fit themselves to this column, not to the window, so a wide rail beside
// it or a large UI size is accounted for (container units and rem in the queries follow
// the UI size). The SCSS modules inside query it as `main_section`.
export const container = style({
    containerName: MAIN_SECTION_CONTAINER,
    containerType: "size",
    position: "relative",
    flex: "1 1 0",
    minWidth: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
});
