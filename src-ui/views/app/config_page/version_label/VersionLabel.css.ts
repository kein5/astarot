import { style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

export const is_compact = style({});
export const is_copied = style({});

export const container = style({
    width: "100%",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    padding: "0 0 0rem 1.2rem",
    color: vars.dark_500_color,
    fontSize: "1.2rem",
    height: "4.2rem", // 開閉時および全モードで高さを固定し、上のメニューを一切ずらさない
    selectors: {
        [`&.${is_compact}`]: { padding: "0 0 0rem 0", alignItems: "center" },
    },
});

export const wrapper = style({
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    width: "100%",
    selectors: {
        [`&.${is_copied}`]: { cursor: "default" },
        // The copy button is at least 24px tall; the label stays small.
        [`&:not(.${is_compact})`]: { minHeight: "2.4rem" },
        [`&.${is_compact}`]: { cursor: "default", justifyContent: "center" },
    },
});

// 閉じた時（コンパクト表示）
export const compact_content = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.15rem",
    width: "100%",
});

export const compact_version_label = style({
    fontSize: "1.2rem",
    whiteSpace: "nowrap",
});

export const compact_badge = style({
    fontSize: "1.2rem",
    whiteSpace: "nowrap",
});

// 開いた時（通常表示）
export const expanded_row = style({
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
});

export const version_text_block = style({
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "0.15rem",
    color: vars.dark_500_color,
});

export const version_label = style({
    fontSize: "1.2rem",
    whiteSpace: "nowrap",
});

const icon = { width: "1.3rem", aspectRatio: "1/1", flexShrink: 0 } as const;

export const copy_svg = style({
    ...icon,
    color: vars.dark_600_color,
    transition: "color 0.15s",
    selectors: {
        [`${wrapper}:hover &`]: { color: vars.dark_350_color },
    },
});

export const check_mark_svg = style({
    ...icon,
    color: vars.primary_300_color,
});
