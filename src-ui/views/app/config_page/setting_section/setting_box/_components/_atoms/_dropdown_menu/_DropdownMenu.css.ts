import { keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../../../common_css/mixins.ts";

export const is_pending = style({});
export const is_disabled = style({});
export const is_opened = style({});
export const is_active = style({});
export const is_selected = style({});
export const open_below = style({});
export const open_above = style({});

const dropdownOpen = keyframes({ from: { opacity: 0, transform: "translateY(-0.6rem) scaleY(0.94)" } });
const dropdownOpenAbove = keyframes({ from: { opacity: 0, transform: "translateY(0.6rem) scaleY(0.94)" } });
const dropdownRow = keyframes({ from: { opacity: 0, transform: "translateY(-0.4rem)" } });

export const container = style({
    position: "relative",
    width: "100%",
});

// The same field as the forms' selects (VoiceSettings.css.ts, DESIGN.md "input"):
// a raised surface with a hairline, so an empty choice (no device found) still shows a field (#436).
export const dropdown_toggle_button = style({
    position: "relative",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    backgroundColor: "var(--vox_surface, #18253b)",
    border: "0.1rem solid var(--vox_field_border, #5e6570)",
    width: "100%",
    minWidth: "min(20rem, 100%)",
    minHeight: "4rem",
    padding: "0.9rem 1.2rem",
    cursor: "pointer",
    borderRadius: "var(--vox_radius, 0.8rem)",
    selectors: {
        "&:hover": { borderColor: vars.dark_500_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        "&:focus-visible": { outline: `0.2rem solid ${vars.primary_200_color}`, outlineOffset: "0.2rem" },
        [`&.${is_pending}`]: { pointerEvents: "none" },
        [`&.${is_disabled}`]: { pointerEvents: "none", borderColor: vars.dark_800_color },
    },
});

export const dropdown_selected_text = style({
    fontSize: "1.4rem",
    paddingRight: "3.6rem", // room for arrow + breathing space
    overflow: "visible",
    whiteSpace: "normal", // allow wrapping
    wordBreak: "break-word",
    selectors: {
        [`${dropdown_toggle_button}.${is_disabled} &`]: { color: vars.dark_550_color },
    },
});

export const dropdown_content_wrapper = style({
    display: "none",
    position: "absolute",
    right: 0,
    minWidth: "100%",
    zIndex: 1,
    selectors: {
        [`&.${open_below}`]: { top: "calc(100% + 0.4rem)", bottom: "auto", transformOrigin: "top" },
        [`&.${open_above}`]: { bottom: "calc(100% + 0.4rem)", top: "auto", transformOrigin: "bottom" },
        // The menu drops from the field and settles; its rows follow one after another.
        [`&.${is_opened}`]: {
            display: "block",
            animation: `${dropdownOpen} ${vars.vox_motion} ${vars.vox_ease_settle}`,
        },
        [`&.${is_opened}.${open_above}`]: { animationName: dropdownOpenAbove },
        [`&.${is_disabled}`]: { pointerEvents: "none" },
    },
});

// The open list matches the forms' select list: one surface, rows with a small radius.
export const dropdown_content = style({
    backgroundColor: "var(--vox_surface, #18253b)",
    border: `0.1rem solid ${vars.dark_600_color}`,
    borderRadius: "var(--vox_radius, 0.8rem)",
    boxShadow: vars.vox_shadow_overlay,
    padding: "0.4rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.1rem",
    whiteSpace: "nowrap",
    maxHeight: "20rem",
    overflowY: "auto",
});

// The rows of an open list come in one after another: the second 15ms after the first, up to the eighth.
const rowDelays = Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map(row =>
    [`${dropdown_content_wrapper}.${is_opened} &:nth-child(${row})`, { animationDelay: `${(row - 1) * 15}ms` }]));

export const value_button = style({
    backgroundColor: "transparent",
    borderRadius: "0.4rem",
    padding: "0.8rem 1.2rem",
    cursor: "pointer",
    selectors: {
        [`${dropdown_content_wrapper}.${is_opened} &`]: { animation: `${dropdownRow} ${vars.vox_motion} ${vars.vox_ease} both` },
        ...rowDelays,
        // The keyboard-highlighted option looks like the hovered one.
        [`&:hover, &.${is_active}`]: { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        [`&.${is_selected}`]: { backgroundColor: vars.dark_900_color },
        [`&.${is_selected}:hover`]: { backgroundColor: vars.dark_750_color },
    },
});

export const value_text = style({
    fontSize: "1.4rem",
    selectors: {
        [`${dropdown_content_wrapper}.${is_disabled} &`]: { color: vars.dark_550_color },
        [`${value_button}.${is_selected} &`]: { color: vars.primary_200_color, fontWeight: "bold" },
    },
});

export const loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "right", positionAmount: 0 }));

export const arrow_left_svg = style({
    position: "absolute",
    top: "50%",
    right: 0,
    transform: "translate(-50%, -50%) rotate(-90deg)",
    transition: `transform ${vars.vox_motion} ${vars.vox_ease_settle}`,
    width: "1.4rem",
    selectors: {
        [`${dropdown_toggle_button}.${is_disabled} &`]: { color: vars.dark_550_color },
        [`&.${is_opened}`]: { transform: "translate(-50%, -50%) rotate(90deg)" },
    },
});
