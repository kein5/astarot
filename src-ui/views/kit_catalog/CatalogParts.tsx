import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./Catalog.css.ts";

// The app's own words for a key of locales/, in the language chosen in the toolbar, so that the
// catalog shows the parts with the text they carry in the app (long Japanese included).
export const T = ({ k }: { k: string }) => {
    const { t } = useI18n();
    return <>{t(k)}</>;
};

// One example with its caption: the variant or the state of the part it shows, named as in the code.
export const Example = ({ name, children }: { name: string; children: ReactNode }) => (
    <div className={styles.example}>
        <p className={styles.caption}>{name}</p>
        {children}
    </div>
);
