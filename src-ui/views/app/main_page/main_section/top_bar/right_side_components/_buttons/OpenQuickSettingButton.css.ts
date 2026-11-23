import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../../common_css/mixins.ts";

const PENDING_LABEL_COLOR = vars.dark_500_color;

export const container = style({
    height: "100%",
});

export const is_pending = style({});
export const is_disabled = style({});
export const is_enabled = style({});
export const is_available = style({});

// One line of the quick settings menu: the name on the left, the state on the right. After the
// container, as in the SCSS, so its height wins on the same element.
export const row = style({
    height: "auto",
});

export const button_wrapper = style({
    position: "relative",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: "0.2rem",
    padding: "0 0.8rem",
    borderRadius: "0.2rem",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        [`&.${is_pending}`]: { pointerEvents: "none" },
        [`${row} &`]: {
            width: "100%",
            height: "auto",
            minHeight: "4rem",
            flexDirection: "row",
            justifyContent: "space-between",
            gap: "1.6rem",
            padding: ".6rem 1.2rem",
            borderRadius: vars.vox_radius,
            textAlign: "left",
        },
        [`${row} &:disabled`]: { cursor: "not-allowed", opacity: .6 },
        [`${row} &:focus-visible`]: { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
    },
});

export const button_label = style({
    fontSize: "1.2rem",
    whiteSpace: "nowrap",
    selectors: {
        [`&.${is_pending}`]: { color: PENDING_LABEL_COLOR, opacity: 0.25 },
        [`${row} &`]: { fontSize: "1.3rem", whiteSpace: "normal" },
    },
});

export const button_indicator_label = style({
    fontSize: "1.2rem",
    selectors: {
        [`&.${is_pending}`]: { color: PENDING_LABEL_COLOR, opacity: 0.25 },
        [`&.${is_disabled}`]: { color: vars.vox_secondary_text },
        [`&.${is_enabled}`]: { color: vars.primary_300_color },
        [`&.${is_enabled}:not(.${is_available})`]: { color: vars.warning_color },
        [`${row} &`]: { flexShrink: 0 },
    },
});

export const loader = style([
    spinner({ size: "1.8rem", lineWidth: "0.2rem", position: "left", positionAmount: "50%" }),
    { selectors: { [`${row} &`]: { display: "none" } } },
]);

export const warning_svg = style({
    marginLeft: "0.4rem",
    paddingBottom: "0.1rem",
    width: "1.1rem",
    color: vars.warning_color,
});

// Why a row cannot be used, under it.
export const note = style({
    padding: "0 1.2rem .8rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
