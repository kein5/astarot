import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, SHORT_REGION } from "../../../layout.ts";

export const container = style({
    flexShrink: 0,
    height: vars.main_page_topbar_height,
    // The title stays clear of the back button on the left.
    paddingInline: "9rem",
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

export const go_back_button_wrapper = style({
    position: "absolute",
    border: 0,
    color: "inherit",
    font: "inherit",
    fontWeight: 500,
    left: 0,
    backgroundColor: vars.dark_800_color,
    padding: "0 2rem 0 1.6rem",
    height: "100%",
    minWidth: "8rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_750_color },
        "&:active": { backgroundColor: vars.dark_875_color },
    },
});

export const go_back_button_label = style({
    fontSize: "1.4rem",
    color: vars.dark_400_color,
});
