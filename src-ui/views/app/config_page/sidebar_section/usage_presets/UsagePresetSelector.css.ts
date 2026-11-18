import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

// The top of the settings menu, above its groups (#554, Q-13).
export const container = style({
    display: "flex",
    flexDirection: "column",
    gap: ".4rem",
    paddingBottom: "1.2rem",
    marginBottom: ".4rem",
    borderBottom: `.1rem solid ${vars.vox_border}`,
});

// A button at rest, like the other plain buttons: the raised surface and a hairline. Two lines
// beside the icon: what the button is, then the uses picked. In the icon rail only the icon.
export const toggle = style({
    width: "100%",
    minHeight: "4.8rem",
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: ".6rem 1.2rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    color: vars.dark_basic_text_color,
    textAlign: "left",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_875_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
        "&:disabled": { cursor: "default", opacity: 0.6 },
    },
});

export const icon = style({ width: "1.8rem", flexShrink: 0, fill: vars.dark_400_color, color: vars.dark_400_color });

export const words = style({
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: "1 1 0",
    transition: "opacity 0.12s ease-out",
});

// The narrow rail has no room for the words; they come back when it expands.
export const hidden = style({ opacity: 0 });

export const title = style({ fontSize: "1.2rem", fontWeight: 600, lineHeight: 1.4, color: vars.vox_secondary_text });

// The uses picked, on one line: a long list ends in an ellipsis; the button's name has them all.
export const names = style({
    fontSize: "1.4rem",
    lineHeight: 1.4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
});

export const caret = style({
    width: "1rem",
    flexShrink: 0,
    color: vars.dark_400_color,
    transition: "transform 0.12s ease-out",
});

export const caretOpen = style({ transform: "rotate(180deg)" });

export const list = style({
    display: "flex",
    flexDirection: "column",
    gap: ".2rem",
    margin: 0,
    padding: ".4rem 0 0",
    border: 0,
    minWidth: 0,
});

export const visuallyHidden = style({
    position: "absolute",
    width: ".1rem",
    height: ".1rem",
    margin: "-.1rem",
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
});

export const help = style({
    margin: "0 .4rem .4rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
});

// One use: the native checkbox, its name, and under it what the use is for.
export const item = style({
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    gap: ".8rem",
    padding: ".6rem .4rem",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:has(input:disabled)": { cursor: "default" },
    },
});

export const checkbox = style({
    width: "1.6rem",
    height: "1.6rem",
    marginTop: ".2rem",
    accentColor: vars.primary_300_color,
    cursor: "inherit",
});

export const itemText = style({ display: "flex", flexDirection: "column", minWidth: 0 });

export const itemLabel = style({ fontSize: "1.4rem", fontWeight: 500, lineHeight: 1.4, color: vars.dark_basic_text_color });

export const itemDesc = style({ fontSize: "1.2rem", lineHeight: 1.5, color: vars.vox_description_text, overflowWrap: "anywhere" });
