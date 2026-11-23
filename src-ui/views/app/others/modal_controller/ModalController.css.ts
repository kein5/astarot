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

// Stays in view while the dialog scrolls; the shared secondary settings button.
export const close_button = style({
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "block",
    marginLeft: "auto",
    fontSize: "1.4rem",
    fontWeight: 500,
    minHeight: "3.6rem",
    padding: ".6rem 1.4rem",
    color: vars.dark_200_color,
    background: vars.dark_850_color,
    border: ".1rem solid transparent",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover": { background: vars.vox_secondary_hover },
        "&:active": { background: vars.dark_925_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
    },
});
