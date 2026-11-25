import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";
import { Fold } from "../_components/fold/Fold";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import * as styles from "./VoiceSettings.css.ts";
import * as css from "./catalogLayout.css.ts";
import { Badge, CardContent } from "../../../../../kit/index.ts";
import type { BadgeProps } from "../../../../../kit/index.ts";

// The two layouts of the model catalogs (the speech recognition, text to speech and voice changer
// catalogs, and the translation catalog): every model with the same words and the same actions.
// - list: one card a row, read across: what the model is and what can be done, its facts beside.
// - grid: cards side by side, read down: what the model is, its file and what can be done, its
//   facts in a fold of the few-words size, so more models are seen at once.
// One choice for every catalog, saved with the settings (CATALOG_LAYOUT, the Appearance setting
// CatalogLayout); a new install starts with the grid. A catalog passes the layout down to its list
// and its cards' facts.
export type CatalogLayout = "list" | "grid";
const LAYOUTS: readonly CatalogLayout[] = ["grid", "list"];

// The layout chosen, for a catalog that offers the choice. One that does not (the translation
// review, which shows one model) draws a list.
// Until the saved choice arrives, the setting's default (the grid).
export const useCatalogLayout = (): CatalogLayout => {
    const { currentCatalogLayout } = useAppearance();
    return currentCatalogLayout.data === "list" ? "list" : "grid";
};

// The list of a catalog's cards.
export const CatalogList = ({ layout, children }: { layout: CatalogLayout; children: ReactNode }) =>
    // biome-ignore lint/a11y/noRedundantRoles: WebKit stops reading a <ul> with list-style: none (.catalog) as a list; the role keeps it one for screen readers.
    <ul className={styles.catalog} role="list" data-layout={layout}>{children}</ul>;

// A card's facts (its table of languages, size, hardware and terms, or of an entry's file and
// address): beside what the model is in the list, as the card's content (the kit's CardContent),
// in a fold under it in the grid. summary: the fold's words, when they say more than "Details"
// (the file a model card would get).
export const CatalogFacts = ({ layout, summary, children }: { layout: CatalogLayout; summary?: string; children: ReactNode }) => {
    const { t } = useI18n();
    return layout === "grid"
        ? <Fold size="link" className={css.facts} summary={summary ?? t("model_catalog.layout.facts")}>{children}</Fold>
        : <CardContent>{children}</CardContent>;
};

// How a card's state looks at the end of its name's line (the kit's Badge, D-29). Whether the
// thing is on the PC is told by the badge's fill and mark as well as its words, in both layouts and
// every catalog. On the PC, or there and usable: a filled badge with a check (downloaded, a model
// the user registered); in use: filled in the active colour the card's frame has; checked and
// ready to apply, or an entry that can be used: the active outline, tinted. Not yet (not
// downloaded, an API without its key): an outline with an empty ring, its words quieter. Working
// or not answering: amber; a problem: red; connected: the active outline. Any other state is a
// plain outline.
type StateLook = Pick<BadgeProps, "tone" | "variant" | "mark">;
const STATE_LOOKS: ReadonlyMap<string, StateLook> = new Map([
    ["downloaded", { variant: "solid", mark: "check" }],
    ["in_use", { tone: "active", variant: "solid", mark: "check" }],
    ["ready", { tone: "active", variant: "tint", mark: "check" }],
    ["not_downloaded", { tone: "muted", mark: "ring" }],
    ["not_set", { tone: "muted", mark: "ring" }],
    ["connected", { tone: "active" }],
    ["working", { tone: "warning" }],
    ["checking", { tone: "warning" }],
    ["not_connected", { tone: "warning" }],
    ["changed", { tone: "warning" }],
    ["url_invalid", { tone: "failed" }],
    ["missing", { tone: "failed" }],
]);
export const stateLook = (state: string): StateLook => STATE_LOOKS.get(state) ?? {};

// A card's state, its words given: the badge that ends the name's line, in the same place on every card.
export const CatalogState = ({ state, children }: { state: string; children: ReactNode }) =>
    <Badge className={styles.status} {...stateLook(state)}>{children}</Badge>;

// The two layouts, as a pair of buttons on the catalog's heading line: the one in use is pressed.
// Its words say the layout; the icon only repeats them.
export const CatalogLayoutSwitch = () => {
    const { t } = useI18n();
    const { setCatalogLayout } = useAppearance();
    const chosen = useCatalogLayout();
    return <div className={css.layoutSwitch} role="group" aria-label={t("model_catalog.layout.label")}>
        {LAYOUTS.map(layout => <button key={layout} type="button" className={css.option} aria-pressed={chosen === layout}
            onClick={() => { if (chosen !== layout) setCatalogLayout(layout); }}>
            {layout === "grid"
                ? <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" />
                    <rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
                : <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="3" rx="1" />
                    <rect x="2" y="6.5" width="12" height="3" rx="1" /><rect x="2" y="10.5" width="12" height="3" rx="1" /></svg>}
            <span>{t(`model_catalog.layout.${layout}`)}</span>
        </button>)}
    </div>;
};

// One part of a catalog under its heading (a use of the models, the speech engines, a group of
// the translation catalog), folded as the setup folds are: a bar of the app's one fold with the
// part's name, its readout (how many models, how many are on the PC) and what pressing does.
// What the part is for is the name's hint on a page that keeps descriptions out of sight (#614),
// otherwise the first lines inside. It starts closed, its readout saying what it holds, and keeps
// what the user chose while it is drawn; that is not saved. A catalog that shows one model (the
// translation review) draws the part unfolded.
// level: the heading's level, which the name keeps as a heading for assistive technology.
export interface CatalogSectionProps {
    title: string;
    help: readonly string[];
    readout?: string;
    level: 3 | 4;
    // The heading's id, when the page points at it.
    id?: string;
    fold?: boolean;
    "data-catalog-group"?: string;
    children: ReactNode;
}

export const CatalogSection = ({ title, help, readout, level, id, fold = true, children, ...data }: CatalogSectionProps) => {
    const hints = useHintDescriptions();
    const [opened, setOpened] = useState(false);
    const own = useId();
    const headingId = id ?? `${own}-heading`;
    if (!fold) {
        const Heading = level === 3 ? "h3" : "h4";
        return <section className={styles.catalog_group} aria-labelledby={headingId} {...data}>
            <Heading id={headingId}>{title}</Heading>
            {help.map(text => <p key={text}>{text}</p>)}
            {children}
        </section>;
    }
    const hint = hints && help.length > 0 ? help.join("\n") : undefined;
    const descriptionId = hint ? `${own}-description` : undefined;
    // The name stays a heading, inside the bar: a summary may hold phrasing content only, so it is
    // a heading by its role.
    const heading = <span role="heading" aria-level={level} id={headingId}>{title}</span>;
    return <section className={styles.catalog_group} aria-labelledby={headingId} {...data}>
        <Fold data-catalog-fold open={opened} onToggle={event => setOpened(event.currentTarget.open)}
            summaryProps={{ "data-hint-row": hint ? true : undefined, "aria-describedby": descriptionId }}
            summary={<>
                {hint ? <span data-hint-host>{heading}<Hint text={hint} id={descriptionId} row /></span> : heading}
                {readout && <span className={css.readout}>{readout}</span>}
            </>}>
            {!hint && help.map(text => <p key={text}>{text}</p>)}
            {children}
        </Fold>
    </section>;
};
