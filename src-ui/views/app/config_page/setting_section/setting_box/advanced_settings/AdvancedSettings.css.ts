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
    borderBottom: `solid 0.1rem ${vars.dark_800_color}`,
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

// Secondary action buttons matching VoiceSettings / PageLinkButton at the row's right end.
export const log_destination_button = style({
    boxSizing: "border-box",
    minHeight: "4rem",
    padding: ".9rem 1.2rem",
    fontSize: "1.4rem",
    fontWeight: 500,
    color: vars.dark_200_color,
    backgroundColor: vars.dark_850_color,
    border: ".1rem solid transparent",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover:enabled": { backgroundColor: vars.vox_secondary_hover },
        "&:active:enabled": { backgroundColor: vars.dark_925_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
        "&:disabled": { opacity: .5, cursor: "not-allowed" },
    },
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
