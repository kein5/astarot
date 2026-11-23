import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const description = style({ display: "grid", gap: ".4rem", minWidth: 0 });
// 「詳細」 is a link of the app's one fold (_components/fold/Fold.css.ts); what it opens reads as
// the description it continues.
export const more = style({ color: vars.vox_description_text });
