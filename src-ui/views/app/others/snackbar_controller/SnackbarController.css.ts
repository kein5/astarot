import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

export const snackbar_content = style({
    position: "relative",
    padding: "1.2rem 1.6rem",
    borderRadius: "0.8rem",
    fontSize: "1.4rem",
    boxShadow: "0 0.2rem 0.8rem rgba(0, 0, 0, 0.5)",
});

export const is_error = style({
    userSelect: "text",
    WebkitUserSelect: "text",
    cursor: "text",
});

export const megaphone_svg = style({
    color: vars.dark_200_color,
    width: "2.4rem",
});
export const error_svg = style({
    color: vars.error_bc_color,
    width: "2.4rem",
});
export const check_mark_svg = style({
    color: vars.primary_400_color,
    width: "2rem",
});
export const warning_svg = style({
    color: vars.warning_color,
    width: "2.4rem",
});

// Settings have no message box, and their first rows are controls. There the
// notices sit at the bottom of the content column instead, clear of the save
// bar above and the sidebar beside them.
export const over_settings = style({
    selectors: {
        "&.Toastify__toast-container--top-left": {
            top: "auto",
            bottom: "var(--toastify-toast-offset)",
        },
    },
});
