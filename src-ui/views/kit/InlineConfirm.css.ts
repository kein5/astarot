import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// The confirmation inside a row (InlineConfirm.tsx), as the catalogs' cards drew it in their row of
// actions: the sentence, then the way back and the removal, on one line while they fit.
export const content = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
    minWidth: 0,
});

// The sentence in the description's size and colour, as a form's notes. Japanese breaks between
// phrases, not inside a word.
export const description = style({
    margin: 0,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
    wordBreak: "auto-phrase",
    textWrap: "pretty",
});
