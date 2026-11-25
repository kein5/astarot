import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

export const container = style({
    position: "fixed",
    inset: `${vars.title_bar_height} 0 0`,
    width: "100%",
    height: `calc(100% - ${vars.title_bar_height})`,
    maxWidth: "none",
    maxHeight: "none",
    margin: 0,
    padding: 0,
    border: 0,
    color: vars.dark_200_color,
    background: "transparent",
    justifyContent: "center",
    alignItems: "center",
    selectors: {
        "&[open]": { display: "flex" },
        "&::backdrop": {
            backgroundColor: vars.dark_550_color_22,
            backdropFilter: "blur(0.2rem)",
        },
    },
});

export const bg_onclick_close_area = style({
    position: "absolute",
    width: "100%",
    height: "100%",
});

export const wrapper = style({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    overflowY: "auto",
    backgroundColor: vars.dark_900_color,
    width: "80%",
    height: "96%",
    padding: "2rem",
    borderRadius: vars.vox_radius,
});

// The close button's place: at the panel's top right, staying in view while the panel scrolls. The
// row is as wide as the button, so it covers nothing beside it.
export const close_row = style({
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    width: "fit-content",
    marginLeft: "auto",
});
