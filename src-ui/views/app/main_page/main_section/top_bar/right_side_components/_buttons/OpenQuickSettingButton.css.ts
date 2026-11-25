import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

const PENDING_LABEL_COLOR = vars.dark_500_color;

// A pending toggle takes no pointer, so it shows no hover either; the kit draws everything else.
export const is_pending = style({ pointerEvents: "none" });
export const is_disabled = style({});
export const is_enabled = style({});
export const is_available = style({});

// One line of the quick settings panel: the kit's Toggle (OpenQuickSettingButton), as wide as the
// panel (a grid stretches it), and the note under it.
export const row = style({ display: "grid" });

// Inside the toggle: the name at the start and the state at the end of its line.
export const words = style({
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1.6rem",
    textAlign: "start",
});

export const button_label = style({
    selectors: {
        [`&.${is_pending}`]: { color: PENDING_LABEL_COLOR, opacity: 0.25 },
    },
});

export const button_indicator_label = style({
    flexShrink: 0,
    fontSize: "1.2rem",
    selectors: {
        [`&.${is_pending}`]: { color: PENDING_LABEL_COLOR, opacity: 0.25 },
        [`&.${is_disabled}`]: { color: vars.vox_secondary_text },
        [`&.${is_enabled}`]: { color: vars.primary_300_color },
        [`&.${is_enabled}:not(.${is_available})`]: { color: vars.warning_color },
    },
});

export const warning_svg = style({
    marginLeft: "0.4rem",
    paddingBottom: "0.1rem",
    width: "1.1rem",
    color: vars.warning_color,
});

// Why a row cannot be used, under it.
export const note = style({
    padding: ".4rem 1.2rem .8rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
