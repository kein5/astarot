import { createGlobalThemeContract } from "@vanilla-extract/css";

// The design tokens for vanilla-extract styles (ADR-010). The values stay where they are, in
// views/app/_index_css/variables.css, which the SCSS modules read too; this contract only gives
// the same custom properties typed names, so `vars.dark_850_color` is `var(--dark_850_color)`.
// It emits no CSS. views/theme/vars.test.js checks that every name here is defined there.
const NAMES = [
    "primary_100_color", "primary_150_color", "primary_200_color", "primary_250_color", "primary_300_color",
    "primary_350_color", "primary_400_color", "primary_450_color", "primary_500_color", "primary_550_color",
    "primary_600_color", "primary_650_color", "primary_700_color", "primary_750_color", "primary_800_color",
    "primary_900_color", "primary_600_color_44",
    "sent_400_color", "received_300_color",
    "error_bc_color", "error_bc_active_color", "success_bc_color", "warning_color", "warning_bc_color",
    "dark_basic_text_color", "dark_50_color", "dark_100_color", "dark_200_color", "dark_300_color", "dark_350_color",
    "dark_400_color", "dark_450_color", "dark_500_color", "dark_550_color", "dark_600_color", "dark_650_color",
    "dark_700_color", "dark_725_color", "dark_750_color", "dark_775_color", "dark_800_color", "dark_825_color",
    "dark_850_color", "dark_863_color", "dark_875_color", "dark_888_color", "dark_900_color", "dark_925_color",
    "dark_950_color", "dark_975_color", "dark_1000_color",
    "dark_550_color_22", "dark_825_color_cc", "dark_1000_color_66", "dark_1000_color_aa", "dark_1000_color_dd",
    "title_bar_height", "main_page_topbar_height", "config_page_sidebar_width", "config_page_content_padding_top",
    "vox_canvas", "vox_rail", "vox_surface", "vox_border", "vox_field_border", "vox_radius",
    "vox_secondary_text", "vox_description_text", "vox_state_active", "vox_state_warning", "vox_state_failed",
    "vox_secondary_hover", "vox_readout_rule", "vox_shadow_overlay", "vox_on_primary", "vox_focus",
    "vox_ease", "vox_ease_settle", "vox_motion_fast", "vox_motion",
    "vox_highlight_tint", "vox_warning_tint", "vox_chatbox_preview", "vox_skeleton",
    "font_family",
] as const;

export type TokenName = (typeof NAMES)[number];

export const vars = createGlobalThemeContract(
    Object.fromEntries(NAMES.map(name => [name, name])) as Record<TokenName, TokenName>,
);
