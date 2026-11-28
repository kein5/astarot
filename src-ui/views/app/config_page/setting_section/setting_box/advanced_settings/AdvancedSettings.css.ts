import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

export const obs_url_description = style({
    margin: ".4rem 0 1.2rem",
    color: vars.vox_description_text,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    overflowWrap: "anywhere",
});

// What a usage event holds: aligned with the setting's own text, not the page edge.
export const telemetry_contents = style({
    margin: "0 0 1.2rem",
    padding: 0,
});

// Same 1fr / 1.6fr columns and stacking breakpoints as Templates.css.ts (#567, #1096, #1115).
const stacked = { gridTemplateColumns: "minmax(0, 1fr)", alignItems: "stretch" } as const;

export const log_destination_row = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    width: "100%",
    minWidth: 0,
    alignItems: "start",
    padding: "2rem 0",
    columnGap: "1.6rem",
    rowGap: ".8rem",
    borderBottom: `solid 0.1rem var(--settings_rule, ${vars.vox_border})`,
    "@container": { "(max-width: 41.6rem)": stacked },
    "@media": { "(max-width: 700px)": stacked },
});
globalStyle(`${log_destination_row} > *`, { minWidth: 0, maxWidth: "100%" });

export const log_destination_control = style({
    display: "grid",
    gap: ".8rem",
    width: "100%",
    minWidth: 0,
});

// Highlight the field border alongside the inline error text when validation fails (#1111, #1115).
globalStyle(`${log_destination_control}[data-invalid="true"] :has(> [data-slot="input"])`, {
    borderColor: vars.vox_state_failed,
});

export const log_destination_actions = style({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: ".8rem",
    minWidth: 0,
});

export const log_destination_error = style({
    margin: 0,
    padding: ".8rem 1.2rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.dark_200_color,
    backgroundColor: vars.vox_surface,
    border: `.1rem solid ${vars.vox_state_failed}`,
    borderRadius: vars.vox_radius,
    overflowWrap: "anywhere",
});

// The TLS certificate and key, saved as a pair (#1111): a group for focus only, laid out as its rows.
export const field_group = style({ display: "contents" });
