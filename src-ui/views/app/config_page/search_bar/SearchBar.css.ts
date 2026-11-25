import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";
import { colourTransition, focusRing } from "../../../kit/shared.css.ts";

export const is_small = style({});
export const is_active = style({});

export const search_wrapper = style({
    gridArea: "search",
    position: "relative",
    alignSelf: "start",
    minWidth: 0,
    height: "4rem",
    margin: "1.6rem",
    // Above the rail, which lies over the page while expanded (SidebarSection).
    zIndex: 6,
    selectors: {
        [`&.${is_small}`]: { marginBottom: ".8rem" },
        // The UI-size-aware breakpoint (useWindow.ts) also selects the narrow layout.
        "html[data-narrow] &": { marginBottom: ".8rem" },
    },
    "@media": { "(max-width: 800px)": { marginBottom: ".8rem" } },
});

// shadcn/ui's InputGroup: the field around the input, its icon and its clear button, in the
// same fill and border as the other fields (the kit's TextField, _Entry, the forms' inputs). The
// search stays hand-built (U-02, D-36) and the details inside it stay as they are (D-40: the
// magnifier, the .8rem side and the 1.3rem words); its frame is the kit's field: the border under
// the pointer, and with the focus in the input the Lilac border and the kit's focus ring.
export const search_input_container = style({
    width: "100%",
    height: "100%",
    backgroundColor: vars.vox_surface,
    border: `0.1rem solid ${vars.vox_field_border}`,
    borderRadius: vars.vox_radius,
    display: "flex",
    alignItems: "center",
    padding: "0 0.8rem",
    gap: "0.7rem",
    boxSizing: "border-box",
    transition: colourTransition,
    selectors: {
        // Lighter on hover, as the kit's field is; the border it starts from is already 3.5:1.
        "&:hover": { borderColor: vars.dark_550_color },
        "&:has(> input:focus-visible)": { ...focusRing, borderColor: vars.primary_600_color },
    },
});

// InputGroupAddon: the icon before the input and the clear button after it.
export const search_addon = style({
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
});

export const search_icon = style({
    width: "1.5rem",
    height: "1.5rem",
    color: vars.dark_550_color,
    flexShrink: 0,
});

export const search_input = style({
    flex: 1,
    // The full height of the box, so a click above or below the text reaches it.
    alignSelf: "stretch",
    border: "none",
    background: "transparent",
    outline: "none",
    fontSize: "1.3rem",
    color: vars.dark_basic_text_color,
    fontFamily: "inherit",
    minWidth: 0,
    padding: 0,
    selectors: {
        "&::placeholder": { color: vars.vox_description_text },
    },
});

export const clear_button = style({
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "0.2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ".4rem",
    flexShrink: 0,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_750_color },
    },
});

export const clear_icon = style({
    width: "1.2rem",
    height: "1.2rem",
    color: vars.dark_600_color,
    transition: "color 0.15s ease",
    selectors: {
        [`${clear_button}:hover &`]: { color: vars.dark_300_color },
    },
});

// ドロップダウン結果リスト
// The list opens on the surface, as shadcn/ui's popover lists do and as the field's own
// dropdowns (_DropdownMenu, the forms' selects) already do, with the kit's border and corners.
export const dropdown_results = style({
    position: "absolute",
    top: "calc(100% + 0.6rem)",
    left: 0,
    width: "max(100%, 34rem)",
    maxWidth: "min(44rem, calc(100vw - 3.2rem))",
    maxHeight: "38rem",
    overflowY: "auto",
    backgroundColor: vars.vox_surface,
    border: `0.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    boxShadow: vars.vox_shadow_overlay,
    padding: "0.4rem",
    boxSizing: "border-box",
});

// A result: the row under the pointer, or the one the arrow keys chose, takes the kit's fill for
// it (shadcn/ui's accent).
export const result_item = style({
    padding: "0.7rem 0.9rem",
    borderRadius: ".4rem",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    transition: colourTransition,
    selectors: {
        [`&:hover, &.${is_active}`]: { backgroundColor: vars.vox_secondary_hover },
    },
});

export const item_header = style({
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    overflow: "hidden",
});

export const tab_badge = style({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "1.2rem",
    padding: "0.2rem 0.4rem",
    borderRadius: ".4rem",
    backgroundColor: vars.dark_825_color,
    color: vars.primary_300_color,
    border: `0.1rem solid ${vars.dark_700_color}`,
    flexShrink: 0,
});

export const badge_tab_icon = style({
    width: "1.3rem",
    height: "1.3rem",
    color: vars.primary_300_color,
    flexShrink: 0,
});

export const item_label = style({
    fontSize: "1.3rem",
    fontWeight: 500,
    color: vars.dark_basic_text_color,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
});

export const prereq_badge = style({
    fontSize: "1.2rem",
    padding: "0.1rem 0.4rem",
    borderRadius: ".4rem",
    backgroundColor: vars.vox_warning_tint,
    border: `0.1rem solid ${vars.warning_color}`,
    color: vars.warning_color,
    flexShrink: 0,
});

export const item_desc = style({
    fontSize: "1.2rem",
    color: vars.dark_550_color,
    lineHeight: 1.35,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
});

// 検索文字列一致部分のハイライト
export const match_highlight = style({
    backgroundColor: vars.primary_600_color_44,
    color: vars.primary_150_color,
    fontWeight: 700,
    borderRadius: "0.2rem",
    padding: "0 0.15rem",
});
