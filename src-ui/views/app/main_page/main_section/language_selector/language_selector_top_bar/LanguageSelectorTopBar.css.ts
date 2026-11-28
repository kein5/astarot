import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, SHORT_REGION } from "../../../layout.ts";

export const container = style({
    flexShrink: 0,
    height: vars.main_page_topbar_height,
    // The title stays clear of the back button on the left.
    paddingInline: "11rem",
    backgroundColor: vars.dark_850_color,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
});

export const title = style({
    minWidth: 0,
    fontSize: "2rem",
    lineHeight: 1.2,
    textAlign: "center",
    overflowWrap: "anywhere",
    color: vars.dark_400_color,
    "@container": {
        [`${MAIN_SECTION_CONTAINER} (max-width: 48rem) or (max-height: ${SHORT_REGION})`]: { fontSize: "1.6rem" },
    },
});

// The kit's plain Button, 4rem high, at the bar's start and level with the title; the bar gives
// it only its place.
export const go_back_button_wrapper = style({
    position: "absolute",
    left: "1.6rem",
});
