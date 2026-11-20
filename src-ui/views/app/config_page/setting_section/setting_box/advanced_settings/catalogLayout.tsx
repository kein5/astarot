import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useStore_CatalogLayout } from "@store";
import { Fold } from "../_components/fold/Fold";
import styles from "./VoiceSettings.module.scss";
import * as css from "./catalogLayout.css.ts";

// The two layouts of the model catalogs (the speech recognition, text to speech and voice changer
// catalogs, and the translation catalog): every model with the same words and the same actions.
// - list: one card a row, read across: what the model is and what can be done, its facts beside.
// - grid: cards side by side, read down: what the model is, its file and what can be done, its
//   facts in a fold of the few-words size, so more models are seen at once.
// One choice for every catalog (Atom_CatalogLayout), kept while the app runs. A catalog passes
// the layout down to its list and its cards' facts.
export type CatalogLayout = "list" | "grid";
const LAYOUTS: readonly CatalogLayout[] = ["grid", "list"];

// The layout chosen, for a catalog that offers the choice. One that does not (the translation
// review, which shows one model) draws a list.
export const useCatalogLayout = (): CatalogLayout => {
    const { currentCatalogLayout } = useStore_CatalogLayout();
    return currentCatalogLayout.data === "grid" ? "grid" : "list";
};

// The list of a catalog's cards.
export const CatalogList = ({ layout, children }: { layout: CatalogLayout; children: ReactNode }) =>
    <ul className={styles.catalog} role="list" data-layout={layout}>{children}</ul>;

// A card's facts (its table of languages, size, hardware and terms, or of an entry's file and
// address): beside what the model is in the list, in a fold under it in the grid. summary: the
// fold's words, when they say more than "Details" (the file a model card would get).
export const CatalogFacts = ({ layout, summary, children }: { layout: CatalogLayout; summary?: string; children: ReactNode }) => {
    const { t } = useI18n();
    return layout === "grid"
        ? <Fold size="link" className={css.facts} summary={summary ?? t("model_catalog.layout.facts")}>{children}</Fold>
        : <>{children}</>;
};

// The two layouts, as a pair of buttons on the catalog's heading line: the one in use is pressed.
// Its words say the layout; the icon only repeats them.
export const CatalogLayoutSwitch = () => {
    const { t } = useI18n();
    const { updateCatalogLayout } = useStore_CatalogLayout();
    const chosen = useCatalogLayout();
    return <div className={css.layoutSwitch} role="group" aria-label={t("model_catalog.layout.label")}>
        {LAYOUTS.map(layout => <button key={layout} type="button" className={css.option} aria-pressed={chosen === layout}
            onClick={() => { if (chosen !== layout) updateCatalogLayout(layout); }}>
            {layout === "grid"
                ? <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" />
                    <rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
                : <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="3" rx="1" />
                    <rect x="2" y="6.5" width="12" height="3" rx="1" /><rect x="2" y="10.5" width="12" height="3" rx="1" /></svg>}
            <span>{t(`model_catalog.layout.${layout}`)}</span>
        </button>)}
    </div>;
};
