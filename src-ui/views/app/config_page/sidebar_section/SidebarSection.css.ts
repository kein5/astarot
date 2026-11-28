import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

export const is_small = style({});
export const is_expanded = style({});
export const is_compact = style({});
export const is_selected = style({});
export const hide = style({});
export const mui_icon = style({});
export const about_vrct_icon = style({});
export const updater_icon = style({});
export const ocr_icon = style({});

export const container = style({
    gridArea: "sidebar",
    minHeight: 0,
    width: vars.config_page_sidebar_width,
    flexShrink: 0,
    padding: 0,
    position: "relative",
    // Over the settings' content, which is a layer of its own (SettingSection.css.ts): the
    // expanded rail lies over the page.
    zIndex: 1,
    transition: "width 0.12s ease-out",
    height: "100%",
    // The rail expands for hover or focus (DESIGN.md). One state drives the
    // width and the labels: :focus-within misses focus while the window itself
    // is not focused (settings opened from the VR panel or a shortcut).
    // The expanded rail lies over the page instead of pushing it aside, so the
    // settings and top bar do not reflow while the pointer crosses the rail.
    selectors: {
        [`&.${is_small}`]: { width: "5.6rem" },
    },
});

export const scroll_container = style({
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100%",
    width: "100%",
    backgroundColor: vars.vox_rail,
    // The page grid reserves the header's actual height above the rail.
    paddingTop: 0,
    paddingBottom: "0.8rem",
    overflow: "hidden",
    selectors: {
        [`${container}.${is_small} &`]: {
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 5,
            width: "5.6rem",
            transition: "width 0.12s ease-out, box-shadow 0.12s ease-out",
        },
        [`${container}.${is_small}.${is_expanded} &`]: {
            width: vars.config_page_sidebar_width,
            boxShadow: ".4rem 0 1.6rem rgba(0, 0, 0, .35)",
        },
    },
});

export const scroll_content = style({
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    flex: 1,
    // The scrollbar is always there (below): it takes its width from the right padding, so the
    // tabs keep the room they had beside the thin scrollbar before (#1266 ★7).
    padding: "0 .5rem 0 1rem",
    // Scrolled always, as the main rail (main_page/sidebar_section): the track is quiet and the
    // thumb stands out from it, so a menu that goes on below the window says so (decided on
    // 2026-11-27, #1266 ★7). Without overflow there is no thumb to see.
    overflowY: "scroll",
    selectors: {
        "&::-webkit-scrollbar": { width: "0.8rem" },
        // The icon rail has 56px; its scrollbar takes less of them.
        [`${container}.${is_small} &::-webkit-scrollbar`]: { width: ".6rem" },
        "&::-webkit-scrollbar-track": { backgroundColor: "transparent" },
        "&::-webkit-scrollbar-thumb": {
            backgroundColor: vars.dark_750_color,
            border: `.2rem solid ${vars.vox_rail}`,
            borderRadius: "0.4rem",
        },
        "&:hover::-webkit-scrollbar-thumb": { backgroundColor: vars.dark_650_color },
    },
});

export const tabs_wrapper = style({
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "1.2rem",
});

export const tab_group = style({
    display: "flex",
    flexDirection: "column",
    gap: ".4rem",
});

// A group's heading: quieter than the tabs under it, one line like them. In the icon rail the
// words have no room; a hairline in the same place stands for the heading, so the tabs do not
// move when the rail expands over the page.
export const group_label = style({
    position: "relative",
    display: "flex",
    alignItems: "center",
    minHeight: "2.4rem",
    padding: "0 1.2rem",
    fontSize: "1.2rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: vars.vox_secondary_text,
    whiteSpace: "nowrap",
    selectors: {
        "&::before": {
            content: '""',
            position: "absolute",
            left: "1.2rem",
            right: "1.2rem",
            top: "50%",
            height: ".1rem",
            backgroundColor: vars.vox_border,
            opacity: 0,
            transition: "opacity 0.12s ease-out",
        },
        [`&.${is_compact}::before`]: { opacity: 1 },
    },
});

export const group_label_text = style({
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    transition: "opacity 0.12s ease-out",
    selectors: {
        [`${group_label}.${is_compact} &`]: { opacity: 0 },
    },
});

export const tab_container = style({
    position: "relative",
    width: "100%",
    display: "flex",
    justifyContent: "left",
    alignItems: "center",
    minHeight: "4rem",
    padding: ".8rem 1.2rem",
    borderRadius: vars.vox_radius,
    textAlign: "left",
    cursor: "pointer",
    gap: "1rem",
    overflow: "hidden",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.vox_rail },
        'html[data-last-input="pointer"] &:focus-visible': { outline: "none" },
        [`&.${is_selected}`]: {
            backgroundColor: vars.primary_900_color,
            color: vars.primary_200_color,
            cursor: "default",
        },
    },
});

export const tab_icon_wrapper = style({
    width: "2.4rem",
    aspectRatio: "1/1",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
});

export const tab_icon = style({
    width: "1.6rem",
    aspectRatio: "1/1",
    fill: vars.dark_400_color,
    selectors: {
        [`${tab_container}.${is_selected} &`]: { fill: vars.primary_200_color },
        [`&.${mui_icon}`]: { width: "1.8rem", fill: vars.dark_400_color, aspectRatio: "1/1" },
        [`&.${about_vrct_icon}`]: { width: "1.6rem", marginTop: "0.2rem" },
        [`&.${updater_icon}`]: { transform: "rotate(-30deg)" },
        [`&.${ocr_icon}`]: { fill: vars.dark_500_color },
    },
});

export const switch_indicator = style({
    display: "none",
    selectors: {
        [`&.${is_selected}`]: {
            display: "block",
            position: "absolute",
            top: "50%",
            left: ".2rem",
            transform: "translate(-50%, -50%)",
            width: ".1rem",
            height: "2rem",
            borderRadius: "0.1rem",
            backgroundColor: vars.primary_300_color,
        },
    },
});

// One line: every tab is the same height, also in the narrow rail where the text is hidden.
// The names fit the 20.8rem rail (13rem beside the icon) also in a font whose kana are full
// width; a longer one would end in an ellipsis rather than be cut off unseen.
export const tab_text = style({
    fontSize: "1.4rem",
    position: "relative",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: 1.4,
    opacity: 1,
    transition: "opacity 0.12s ease-out",
    color: vars.dark_basic_text_color,
    selectors: {
        [`${tab_container}.${is_selected} &`]: { color: vars.primary_200_color },
        [`&.${hide}`]: { opacity: 0 },
    },
});
