import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

export const container = style({
    width: "100%",
    backgroundColor: vars.vox_rail,
    flexShrink: 0,
    display: "flex",
});

export const wrapper = style({
    flexShrink: 0,
    display: "flex",
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    height: vars.title_bar_height,
    marginTop: 0,
});

export const title_wrapper = style({
    paddingLeft: "1.6rem",
    fontSize: "1.2rem",
    letterSpacing: ".02em",
    color: vars.dark_450_color,
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

export const title_svg = style({
    color: vars.dark_800_color,
    width: "4rem",
    height: "100%",
});

export const window_control_wrapper = style({
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

// The three window buttons: minimize and maximize darken under the pointer, close turns red.
const windowButton = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    width: "4.4rem",
    marginBottom: 0,
    cursor: "pointer",
} as const;

export const minimize_button = style({
    ...windowButton,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_950_color },
    },
});

export const maximize_button = style({
    ...windowButton,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_950_color },
    },
});

export const close_button = style({
    ...windowButton,
    selectors: {
        "&:hover": { backgroundColor: vars.error_bc_color },
        "&:active": { backgroundColor: vars.error_bc_active_color },
    },
});

// A button's icon, lighter while the pointer is over the button.
const buttonIcon = {
    color: vars.dark_450_color,
    height: "100%",
    selectors: {
        [`${minimize_button}:hover &, ${maximize_button}:hover &, ${close_button}:hover &`]: { color: vars.dark_100_color },
    },
};

export const x_mark_svg = style({
    ...buttonIcon,
    width: "1.8rem",
});

export const square_svg = style({
    ...buttonIcon,
    width: "1.2rem",
});

export const line_svg = style({
    ...buttonIcon,
    paddingTop: "0.1rem",
    width: "1.8rem",
});
