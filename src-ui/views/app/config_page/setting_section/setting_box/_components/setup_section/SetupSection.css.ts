import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// A setup fold and 「詳細設定」 are bars of the app's one fold (_components/fold/Fold.css.ts); these
// are their words and their place on the page.
export const setup = style({ margin: ".8rem 0" });
export const title = style({ fontSize: "1.5rem", fontWeight: 600, color: vars.dark_200_color });
export const status = style({ fontSize: "1.3rem", fontWeight: 500, fontVariantNumeric: "tabular-nums", color: vars.vox_secondary_text });
