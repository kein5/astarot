import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "stretch",
    width: "100%",
    gap: "1rem",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
});

export const entry_section_wrapper = style({
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "1rem",
    position: "relative",
    minWidth: 0,
    maxWidth: "100%",
});

export const entry_edit_cover = style({
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Laid over the key's field, so it takes the field's corners.
    borderRadius: vars.vox_radius,
    backgroundColor: vars.dark_1000_color_66,
    backdropFilter: "blur(4rem)",
    border: `solid 0.1rem ${vars.dark_700_color}`,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_1000_color_aa },
        "&:active": { backdropFilter: "blur(1.4rem)" },
    },
});

export const edit_button = style({
    padding: "0.8rem 1.2rem",
    height: "100%",
    width: "100%",
    fontSize: "1.4rem",
    textAlign: "center",
});
