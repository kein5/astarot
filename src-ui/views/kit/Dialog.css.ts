import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// shadcn/ui's Dialog parts on the native <dialog>, which the app's dialogs use (D-23 of the
// shadcn/ui inventory decides whether that stays). Opened with showModal(), the dialog keeps the
// focus in it, closes on Esc and draws its overlay as ::backdrop.

// DialogContent. Its width, room and gap are shadcn/ui's, read by DESIGN.md's rules; its corners,
// ground, border and lack of a shadow are the app's dialog (D-04, D-02, D-05).
export const content = style({
    boxSizing: "border-box",
    // w-full max-w-[calc(100%-2rem)] sm:max-w-lg
    width: "min(51.2rem, calc(100vw - 3.2rem))",
    maxWidth: "calc(100vw - 3.2rem)",
    maxHeight: "calc(100dvh - 3.2rem)",
    overflowY: "auto",
    overflowWrap: "anywhere",
    // p-6
    padding: "2.4rem",
    border: `.1rem solid ${vars.dark_600_color}`,
    // DESIGN.md's rounded.dialog.
    borderRadius: "1.2rem",
    background: vars.dark_875_color,
    color: vars.dark_200_color,
    selectors: {
        // grid gap-4, while open only: a closed dialog stays hidden.
        "&[open]": { display: "grid", gap: "1.6rem", alignContent: "start" },
        // bg-black/50, as the app's dialogs (#764). The one colour not taken from a token: older
        // engines do not give ::backdrop the custom properties of its dialog.
        "&::backdrop": { background: "rgb(0 0 0 / .5)" },
    },
});

// A dialog that steps back while a dialog opened from it is open over it (stepsBack; the translation
// review under its model's review and consent, #1266 T-3): hidden with its dimming, so one dialog
// is seen at a time under one dimming. It comes back when the other closes.
export const stepsBack = style({
    selectors: {
        "&:has(dialog[open])": { visibility: "hidden" },
        "&:has(dialog[open])::backdrop": { background: "transparent" },
    },
});
globalStyle(`${stepsBack}:has(dialog[open]) dialog[open]`, { visibility: "visible" });

// DialogHeader: the title and its description (flex-col gap-2). The words keep to the left at
// every width, as the app's dialogs do (shadcn/ui centres them in a narrow window, D-43).
export const header = style({ display: "grid", gap: ".8rem", minWidth: 0 });

// DialogFooter: the dialog's actions in one row that wraps, as the app's dialogs have them.
// shadcn/ui stacks them in reverse in a narrow window and puts them on the right otherwise; that
// waits for D-24.
export const footer = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".8rem" });

// DialogTitle: text-lg font-semibold, DESIGN.md's title role. Its line height is the app's (1.4),
// not leading-none, so a title that wraps stays readable (D-43).
export const title = style({
    margin: 0,
    fontSize: "1.8rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: vars.dark_basic_text_color,
});

// DialogDescription: text-sm in the muted colour, which stands for the description text.
export const description = style({
    margin: 0,
    fontSize: "1.4rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
