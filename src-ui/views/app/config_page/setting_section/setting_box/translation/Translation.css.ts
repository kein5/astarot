import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

// Non-commercial license confirmation (NLLB weights). Same native <dialog>
// pattern as the model download warning in advanced_settings/ModelDownloads: shadcn/ui's
// DialogContent width (sm:max-w-lg), and 1.6rem between its parts (gap-4), the words being one.
export const license_dialog = style({
    maxWidth: "min(51.2rem, calc(100vw - 3.2rem))",
    maxHeight: "calc(100dvh - 3.2rem)",
    overflowY: "auto",
    overflowWrap: "anywhere",
    padding: "2.4rem",
    border: `.1rem solid ${vars.warning_color}`,
    borderRadius: vars.vox_radius,
    background: "var(--dark_875_color, #282a2e)",
    color: "var(--dark_200_color, #e5e7eb)",
    selectors: {
        // As the forms' dialogs (VoiceSettings.css.ts): shadcn/ui's bg-black/50.
        "&::backdrop": { background: "#00000080" },
        "&[open]": { display: "grid", gap: "1.6rem", alignContent: "start" },
    },
});
globalStyle(`${license_dialog} h3`, { fontSize: "1.6rem", fontWeight: 650, marginBottom: "1.2rem" });
globalStyle(`${license_dialog} p`, { fontSize: "1.3rem", lineHeight: 1.6, overflowWrap: "anywhere", marginBottom: "1rem" });
globalStyle(`${license_dialog} a`, { color: vars.primary_300_color });

export const license_text = style({
    minWidth: 0,
});
globalStyle(`${license_text} > :last-child`, { marginBottom: 0 });

export const license_check = style({
    display: "flex",
    alignItems: "flex-start",
    gap: "1.2rem",
    fontSize: "1.3rem",
    lineHeight: 1.5,
    cursor: "pointer",
});
globalStyle(`${license_check} input`, {
    appearance: "auto",
    WebkitAppearance: "checkbox",
    accentColor: vars.primary_400_color,
    width: "2rem",
    height: "2rem",
    marginTop: ".1rem",
    flexShrink: 0,
});
globalStyle(`${license_check} input:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".3rem" });

export const license_actions = style({
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "1rem",
});
globalStyle(`${license_actions} button`, {
    font: "inherit",
    fontSize: "1.3rem",
    fontWeight: 500,
    minHeight: "3.6rem",
    padding: ".8rem 1.4rem",
    borderRadius: ".4rem",
    border: ".1rem solid transparent",
    color: "inherit",
    background: vars.dark_800_color,
    cursor: "pointer",
});
globalStyle(`${license_actions} button:hover:enabled`, { background: vars.dark_700_color });
globalStyle(`${license_actions} button:active:enabled`, { background: vars.dark_925_color });
globalStyle(`${license_actions} button:disabled`, { opacity: .5, cursor: "not-allowed" });
globalStyle(`${license_actions} button:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" });

export const confirm_button = style({});
globalStyle(`${license_actions} ${confirm_button}`, { background: vars.primary_600_color, color: vars.vox_on_primary });
globalStyle(`${license_actions} ${confirm_button}:hover:enabled`, { background: vars.primary_550_color });
globalStyle(`${license_actions} ${confirm_button}:active:enabled`, { background: vars.primary_700_color });
