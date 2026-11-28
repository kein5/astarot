import { keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

// The keyboard focus of the screen's buttons (which also break their words anywhere).
const focusRing = {
    outline: `.2rem solid ${vars.primary_200_color}`,
    outlineOffset: ".2rem",
};

export const container = style({
    width: "100%",
    height: "100%",
    position: "relative",
});

export const drag_able_area = style({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: vars.title_bar_height,
    backgroundColor: vars.dark_800_color,
});

export const wrapper = style({
    width: "100%",
    height: "100vh",
    display: "flex",
    justifyContent: "safe center",
    alignItems: "center",
    flexDirection: "column",
    padding: "2rem",
    overflowY: "auto",
});

export const error_message = style({
    fontSize: "2rem",
    textAlign: "center",
    userSelect: "text",
    marginBottom: "3.2rem",
});

export const error_detail_container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "end",
    gap: "1rem",
    minWidth: 0,
    maxWidth: "100%",
});

export const error_stack_container = style({
    maxHeight: "10rem",
    width: "100%",
    overflowY: "scroll",
    padding: "1rem",
    backgroundColor: vars.dark_950_color,
    borderRadius: "0.4rem",
});

export const error_stack = style({
    fontSize: "1.2rem",
    userSelect: "text",
    overflowWrap: "anywhere",
});

export const copy_error_message_button = style({
    padding: "0.8rem 1rem",
    fontSize: "1.4rem",
    fontWeight: 500,
    display: "flex",
    gap: "1rem",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "0.4rem",
    maxWidth: "100%",
    backgroundColor: vars.dark_825_color,
    overflowWrap: "anywhere",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_850_color },
        "&:focus-visible": focusRing,
    },
});

export const copy_svg = style({
    width: "1.4rem",
    color: vars.dark_500_color,
});

export const check_mark_svg = style({
    width: "1.4rem",
    color: vars.primary_300_color,
});

export const action_buttons_container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    width: "100%",
    maxWidth: "48rem",
    margin: "1.6rem 0 2.4rem",
});

const updatePulse = keyframes({
    "0%": { boxShadow: `0 0 0 0 color-mix(in srgb, ${vars.primary_500_color} 60%, transparent)` },
    "70%": { boxShadow: `0 0 0 0.8rem color-mix(in srgb, ${vars.primary_500_color} 0%, transparent)` },
    "100%": { boxShadow: `0 0 0 0 color-mix(in srgb, ${vars.primary_500_color} 0%, transparent)` },
});

export const update_button = style({
    width: "100%",
    padding: "1rem 1.6rem",
    fontSize: "1.5rem",
    fontWeight: 500,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: vars.vox_radius,
    backgroundColor: vars.primary_500_color,
    color: vars.vox_on_primary,
    boxShadow: `0 0 0 0 ${vars.primary_500_color}`,
    animation: `${updatePulse} 2s ease-out infinite`,
    transition: "opacity 0.2s, background-color 0.2s",
    overflowWrap: "anywhere",
    selectors: {
        "&:hover:not(:disabled)": { backgroundColor: vars.primary_400_color },
        "&:active:not(:disabled)": { backgroundColor: vars.primary_600_color, animation: "none" },
        "&:disabled": { opacity: .5, cursor: "not-allowed", animation: "none" },
        "&:focus-visible": focusRing,
    },
});

export const status_link_button = style({
    width: "100%",
    padding: "0.8rem 1.6rem",
    fontSize: "1.4rem",
    fontWeight: 500,
    display: "flex",
    gap: "0.8rem",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: vars.vox_radius,
    backgroundColor: vars.dark_825_color,
    color: vars.dark_300_color,
    transition: "background-color 0.15s, color 0.15s",
    overflowWrap: "anywhere",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color, color: vars.dark_100_color },
        "&:active": { backgroundColor: vars.dark_850_color },
        "&:focus-visible": focusRing,
    },
});

export const external_link_svg = style({
    width: "1.3rem",
    flexShrink: 0,
    color: vars.dark_500_color,
});
