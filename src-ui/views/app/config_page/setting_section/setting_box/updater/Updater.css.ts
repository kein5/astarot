import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../common_css/mixins.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
    gap: "1.6rem",
    width: "100%",
});

// The general description role (DESIGN.md).
export const policy = style({
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});

export const channel = style({
    color: vars.vox_description_text,
});

// Install (the kit's primary Button) before Check (its quiet Button, an outline beside the filled
// one, Updater.tsx); they wrap under each other in a narrow window.
export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "1.2rem",
});

/* ===== Update Summary ===== */
export const summary_container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2rem",
    width: "100%",
    marginBottom: "3.2rem",
});

/* Summary loading state */
export const summary_loading_wrapper = style({
    position: "relative",
    width: "100%",
    maxWidth: "52rem",
    height: "7.2rem", /* matches up_to_date_layout min height */
    backgroundColor: vars.dark_875_color,
    border: `0.1rem solid ${vars.dark_700_color}`,
    borderRadius: "0.8rem",
});
export const summary_loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "left", positionAmount: "50%" }));

/* Up-to-date: left large checkmark + right version/desc */
export const up_to_date_layout = style({
    display: "flex",
    alignItems: "center",
    gap: "2.4rem",
    padding: "1.6rem 2.4rem",
    backgroundColor: vars.dark_875_color,
    border: `0.1rem solid ${vars.dark_700_color}`,
    borderRadius: "0.8rem",
    width: "100%",
    maxWidth: "52rem",
});
export const up_to_date_check_svg = style({
    flexShrink: 0,
    width: "4rem",
    height: "4rem",
    color: vars.primary_400_color,
});
export const up_to_date_text = style({
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    minWidth: 0,
});
export const up_to_date_version = style({
    display: "flex",
    alignItems: "baseline",
    gap: "0.6rem",
    fontSize: "1.3rem",
    fontWeight: 400,
    color: vars.dark_500_color,
});
export const up_to_date_channel = style({
    fontSize: "1.2rem",
    fontWeight: 300,
    color: vars.dark_600_color,
});
export const up_to_date_desc = style({
    fontSize: "1.6rem",
    fontWeight: 500,
    color: vars.dark_basic_text_color,
    lineHeight: 1.3,
});

/* ===== Change preview (diff table) inside summary ===== */
export const diff_table = style({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: "58rem",
    backgroundColor: vars.dark_875_color,
    border: `0.1rem solid ${vars.dark_700_color}`,
    borderRadius: vars.vox_radius,
    overflow: "hidden",
});

export const diff_header = style({
    display: "grid",
    gridTemplateColumns: "13rem 1fr 4rem 1fr",
    alignItems: "center",
    padding: "1rem 1.6rem 0.8rem 1.6rem",
    borderBottom: `0.1rem solid ${vars.dark_700_color}`,
    fontSize: "1.2rem",
    fontWeight: 400,
    color: vars.dark_400_color,
});
export const diff_header_cell_before = style({
    textAlign: "right",
});
export const diff_header_cell_after = style({
    textAlign: "left",
});

export const diff_group_changed = style({});
export const diff_group = style({
    display: "flex",
    flexDirection: "column",
    padding: "0 1.6rem",
    borderBottom: `0.1rem solid ${vars.dark_800_color}`,
    selectors: {
        "&:last-child": { borderBottom: "none" },
        [`&.${diff_group_changed}`]: { backgroundColor: "rgba(255, 255, 255, 0.015)" },
    },
});

export const diff_row = style({
    display: "grid",
    gridTemplateColumns: "13rem 1fr 4rem 1fr",
    alignItems: "center",
    height: "4.4rem",
    minHeight: "4.4rem",
});

export const diff_item_label = style({
    fontSize: "1.3rem",
    fontWeight: 300,
    color: vars.dark_500_color,
    whiteSpace: "nowrap",
});

export const diff_val_before = style({
    fontSize: "1.4rem",
    fontWeight: 400,
    color: vars.dark_400_color,
    textAlign: "right",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
});

export const diff_arrow_container = style({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});
export const diff_arrow_svg_changed = style({});
export const diff_arrow_svg_warning = style({});
export const diff_arrow_svg = style({
    width: "2rem",
    height: "2rem",
    color: vars.dark_600_color,
    flexShrink: 0,
    selectors: {
        [`&.${diff_arrow_svg_changed}`]: { color: vars.primary_300_color },
        [`&.${diff_arrow_svg_warning}`]: { color: vars.warning_color },
    },
});

export const diff_val_changed = style({});
export const diff_val_warning = style({});
export const diff_val_after = style({
    fontSize: "1.4rem",
    fontWeight: 400,
    color: vars.dark_400_color,
    textAlign: "left",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    selectors: {
        [`&.${diff_val_changed}`]: { fontWeight: 500, color: vars.primary_300_color },
        [`&.${diff_val_warning}`]: { fontWeight: 500, color: vars.warning_color },
    },
});

/* Inline row warning */
export const diff_row_warning = style({
    display: "flex",
    alignItems: "flex-start",
    gap: "0.8rem",
    padding: "0.4rem 0 1.2rem 0",
});
export const diff_warning_svg = style({
    width: "1.4rem",
    height: "1.4rem",
    color: vars.warning_color,
    flexShrink: 0,
    marginTop: "0.2rem",
});
export const diff_warning_text = style({
    fontSize: "1.2rem",
    lineHeight: 1.4,
    color: vars.warning_color,
    overflowWrap: "break-word",
});

/* ===== Subsection head with inline refresh button ===== */
export const subsection_head = style({
    display: "flex",
    alignItems: "center",
    gap: "1.2rem",
});
globalStyle(`${subsection_head} > :first-child`, { flexGrow: 1, minWidth: 0 });

export const refresh_button = style({
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.8rem 1.2rem",
    backgroundColor: "transparent",
    border: `0.1rem solid ${vars.dark_800_color}`,
    borderRadius: "0.4rem",
    color: vars.dark_500_color,
    fontSize: "1.2rem",
    fontWeight: 500,
    cursor: "pointer",
    marginBottom: "2rem", /* align with SectionLabelComponent's padding-bottom */
    selectors: {
        "&:hover:not(:disabled)": { color: vars.dark_basic_text_color, borderColor: vars.dark_600_color },
        "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
    },
});
export const refresh_svg = style({
    width: "1.4rem",
    color: "currentColor",
    flexShrink: 0,
    transform: "rotate(-30deg)",
});

/* ===== Rows (matches Templates.css.ts container) ===== */
export const rows = style({
    display: "flex",
    flexDirection: "column",
});
export const row = style({
    display: "flex",
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "2rem",
    gap: "2rem",
    borderBottom: `0.1rem solid ${vars.dark_800_color}`,
    selectors: {
        "&:last-child": { borderBottom: "none" },
    },
});
