import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    gap: "3.2rem",
});

// A contact's button: its icon over its name.
const contact = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    height: "100%",
    padding: "1rem",
    borderRadius: "0.4rem",
    gap: "1rem",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_900_color },
    },
} as const;

export const github_issues = style(contact);
export const google_forms = style(contact);

export const contact_button_icon = style({
    width: "5.2rem",
});

export const contact_button_label = style({
    fontSize: "1.4rem",
    whiteSpace: "nowrap",
});
