import { globalStyle, style } from "@vanilla-extract/css";
import type { StyleRule } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_disabled = style({});
export const up = style({});

export const container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    padding: "0 0 2rem",
    width: "100%",
});

export const overlay_section = style({
    width: "100%",
});

// The page's own parts span it like on every other settings page: the switches in sight,
// 「詳細設定」 and the row that leads to the experimental features (#554).
globalStyle(`${container} > *`, { width: "100%" });

// Setting rows span the page like on every other settings page; the
// position and rotation controls keep their own centered width.
export const wrapper = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    gap: "4rem",
});

// The kit's ToggleGroup that picks which settings are shown (Vr.tsx): placed under what is above it.
export const controller_type_switch = style({
    marginTop: "2rem",
});

// The position and rotation row (#568): the label and its description in the label column,
// the switch and the diagram centred in the field column. The diagram's axis names and step
// buttons reach out of its square, so the row stacks where the field column could not hold
// them beside it.
// The page's column is centred (the wrapper above), so these rows ask for its whole width.
// The class is doubled, as in the SCSS, so these rules outweigh the row's own.
export const axis_row = style({});
export const sample_row = style({});
const axisRow = `.${axis_row}.${axis_row}`;
globalStyle(`${axisRow}, .${sample_row}.${sample_row}`, { width: "100%" });
globalStyle(axisRow, {
    paddingBlock: "2rem",
    borderBottom: `solid .1rem ${vars.dark_800_color}`,
    "@container": { "(max-width: 72rem)": { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" } },
});
globalStyle(`${axisRow} > :last-child`, { justifyItems: "stretch" });
globalStyle(`${axisRow} [role=group]`, { flexDirection: "column", alignItems: "center" });
globalStyle(`${axis_row} ${controller_type_switch}`, { marginTop: 0 });

export const position_rotation_controls_box = style({
    marginBlock: "8rem 7rem",
    position: "relative",
    aspectRatio: "1 / 1",
    width: "20rem",
    maxWidth: "100%",
    transform: "translate(-10%)",
});

// The sample text has its own row; the button and its hint align flush at the row's right end.
export const sample_text_button_wrapper = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: ".6rem",
});
export const sample_text_hint = style({
    margin: 0,
    fontSize: "1.2rem",
    lineHeight: 1.5,
    color: vars.dark_400_color,
    textAlign: "end",
});
export const sample_text_button_triangle_svg = style({
    width: "1.4rem",
    flex: "none",
    transform: "rotate(90deg)",
});
export const sample_text_button_square_svg = style({
    width: "1.4rem",
    flex: "none",
});

export const slider_label = style({
    fontSize: "1.4rem",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    whiteSpace: "nowrap",
});
export const x_position_label = style({ position: "absolute", bottom: "-5rem", right: "-46%", justifyContent: "end" });
export const y_position_label = style({ position: "absolute", bottom: "110%", right: "119%", justifyContent: "end" });
export const z_position_label = style({ position: "absolute", top: "14%", left: "110%" });

export const x_position_slider = style({ position: "absolute", bottom: 0, left: "27%", width: "100%", height: "0%" });
export const y_position_slider = style({ position: "absolute", bottom: "27%", left: 0, width: "0%", height: "100%" });
export const z_position_slider = style({
    position: "absolute",
    bottom: "80%",
    left: "88%",
    transform: "translate(50%,50%) rotate(45deg)",
    width: "0%",
    height: "100%",
});

// A step button of the diagram.
export const button_wrapper = style({
    width: "3.8rem",
    borderRadius: "0.4rem",
    aspectRatio: "1.2 / 1",
    backgroundColor: vars.dark_850_color,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "1.6rem",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.primary_500_color, color: vars.vox_on_primary },
        "&:active": { backgroundColor: vars.primary_600_color, color: vars.vox_on_primary },
        [`&.${is_disabled}`]: { pointerEvents: "none", backgroundColor: vars.dark_875_color, color: vars.dark_875_color },
    },
});

export const adjust_button_triangle_svg = style({
    width: "1.8rem",
    color: vars.dark_400_color,
    selectors: {
        [`${button_wrapper}.${is_disabled} &`]: { color: vars.dark_800_color },
        [`${button_wrapper}.${up} &`]: { transform: "rotate(0deg)" },
        [`${button_wrapper}:not(.${up}) &`]: { transform: "rotate(180deg)" },
    },
});

// The step buttons of one axis: placed by two sides of the diagram, turned with the axis.
const stepButtons = (vertical: "top" | "bottom", verticalValue: string, horizontal: "left" | "right", horizontalValue: string, rotate = "0deg"): StyleRule => ({
    position: "absolute",
    [vertical]: verticalValue,
    [horizontal]: horizontalValue,
    display: "flex",
    gap: "1.6rem",
    flexDirection: "column",
    transform: `translate(-50%) rotate(${rotate})`,
});
export const y_position_button_wrapper = style(stepButtons("top", "30%", "left", "-26%"));
export const x_position_button_wrapper = style(stepButtons("bottom", "-38%", "left", "46%", "90deg"));
export const z_position_button_wrapper = style(stepButtons("bottom", "26%", "right", "-4%", "45deg"));

export const x_rotation_label = style({ position: "absolute", bottom: "110%", right: "119%", justifyContent: "end" });
export const y_rotation_label = style({ position: "absolute", bottom: "-5rem", right: "-46%", justifyContent: "end" });
export const z_rotation_label = style({ position: "absolute", top: "-20%", right: "-100%" });

export const x_rotation_slider = style({ position: "absolute", bottom: "27%", left: 0, width: "0%", height: "100%" });
export const y_rotation_slider = style({ position: "absolute", bottom: 0, left: "27%", width: "100%", height: "0%" });
export const z_rotation_slider = style({
    position: "absolute",
    bottom: "80%",
    left: "100%",
    transform: "translate(50%,50%) rotate(-45deg)",
    width: "0%",
    height: "100%",
});

export const x_rotation_button_wrapper = style(stepButtons("top", "30%", "left", "-26%"));
export const y_rotation_button_wrapper = style(stepButtons("bottom", "-38%", "left", "46%", "90deg"));
export const z_rotation_button_wrapper = style(stepButtons("bottom", "50%", "right", "-60%", "-45deg"));

// Opacity, size and timing are ordinary setting rows: the name starts on the page's
// left edge like every other row, and the slider takes the rest (#437).
export const other_controls = style({
    marginTop: "6rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "2rem",
    width: "100%",
});

// The label rows' columns (1fr / 1.6fr, 1.6rem apart): the slider starts where the other
// pages' fields start, and the label says the value in use (#475).
export const other_controls_wrapper = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    gap: "1.6rem",
    alignItems: "center",
    width: "100%",
    position: "relative",
    "@media": { "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" } },
});

export const other_controls_slider_label = style({
    fontSize: "1.4rem",
    fontWeight: 500,
    overflowWrap: "anywhere",
});
export const other_controls_value = style({
    marginInlineStart: ".8rem",
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
    color: vars.vox_secondary_text,
});

export const common_container = style({
    width: "100%",
});

export const common_label = style({
    fontSize: "1.4rem",
});

// The kit's plain button, last in 「詳細設定」, centred under the overlay editor.
export const restore_default_settings_button = style({
    justifySelf: "center",
    marginTop: "6rem",
});
