import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { useTranslationCatalog } from "../../../../../../logics/translation/useTranslationCatalog";
import { ENTRY_NAME_LIMIT, apiRequest, engineRequest, entryState } from "../../../../../../logics/translation/translationCatalog";
import { endpointDescription } from "../../../../../../logics/common/endpointPrivacy";
import { SectionLabelComponent } from "../_components";
import styles from "../advanced_settings/VoiceSettings.module.scss";
import type { ApiForm as ApiFields, ApiItem, EngineForm as EngineFields, EngineItem, TranslationCatalog }
    from "../../../../../../logics/translation/translationCatalog";

// The two groups of the catalog, and an entry with the group it is in.
type CatalogGroupId = "engine" | "api";
type CatalogEntry = { group: "engine"; item: EngineItem } | { group: "api"; item: ApiItem };

// The entries of one group, each with its group, so the cards know which fields it has.
const entriesOf = (catalog: TranslationCatalog, group: CatalogGroupId): CatalogEntry[] => group === "engine"
    ? (catalog.engine ?? []).map(item => ({ group, item }))
    : (catalog.api ?? []).map(item => ({ group, item }));

// The translation catalog (#413): what translates, in two groups. The entries the app ships
// are folded away under each group; the entries the user added are cards with their actions.
// Adding an entry only records it: nothing is downloaded, copied or switched by adding.
export const TranslationCatalogSection = () => {
    const { t } = useI18n();
    const { catalog, error, send } = useTranslationCatalog();
    // Asked again when the page opens: which entries can be used follows the keys and the
    // downloads set up elsewhere since.
    useEffect(() => { send("/get/data/translation_catalog"); }, [send]);
    return (
        <section className={styles.container} aria-label={t("translation_catalog.title")}>
            <SectionLabelComponent label={t("translation_catalog.title")} />
            <p>{t("translation_catalog.intro")}</p>
            {error && <p role="alert">{errorText(t, error)}</p>}
            {catalog?.error_code && <p role="alert">{errorText(t, catalog.error_code)}</p>}
            {catalog ? <>
                <CatalogGroup group="engine" catalog={catalog} />
                <CatalogGroup group="api" catalog={catalog} />
            </> : <p>{t("translation_catalog.loading")}</p>}
        </section>
    );
};

// i18next takes the first key it has: a code without its own text gets the general one.
const errorText = (t: TFunction, code: string) => t([`translation_catalog.errors.${code}`, "translation_catalog.errors.other"], { code });

const CatalogGroup = ({ group, catalog }: { group: CatalogGroupId; catalog: TranslationCatalog }) => {
    const { t } = useI18n();
    const entries = entriesOf(catalog, group);
    const shipped = entries.filter(entry => entry.item.origin === "builtin");
    const own = entries.filter(entry => entry.item.origin !== "builtin");
    return (
        <div className={styles.catalog_group} data-catalog-group={group}>
            <h3>{t(`translation_catalog.group.${group}`)}</h3>
            <p>{t(`translation_catalog.group_help.${group}`)}</p>
            {own.length > 0
                ? <ul className={styles.catalog}>{own.map(entry => <EntryCard key={entry.item.id} {...entry} />)}</ul>
                : <p>{t("translation_catalog.none_added")}</p>}
            <details className={styles.more}>
                <summary>{t("translation_catalog.shipped_title", { count: shipped.length })}</summary>
                <ul className={styles.catalog}>{shipped.map(entry => <ShippedCard key={entry.item.id} {...entry} />)}</ul>
            </details>
            {group === "engine" ? <EngineForm runtimes={catalog.runtimes ?? []} /> : <ApiForm protocols={catalog.protocols ?? []} />}
        </div>
    );
};

// An entry the app ships: its name and whether it can be used now. Its settings stay in the
// sections above.
const ShippedCard = ({ group, item }: CatalogEntry) => {
    const { t } = useI18n();
    const state = item.in_use ? "in_use" : item.available ? "ready" : group === "engine" ? "not_downloaded" : "not_set";
    return <li className={styles.card} data-catalog-item={item.id}>
        <div className={styles.card_head}>
            <strong>{item.name}</strong>
            <span className={styles.badge}>{t("translation_catalog.badge.builtin")}</span>
            {group === "api" && item.kind && <span className={styles.badge}>{t(`translation_catalog.kind.${item.kind}`)}</span>}
            {"non_commercial" in item && item.non_commercial && <span className={styles.badge} data-tone="changed">{t("translation_catalog.badge.non_commercial")}</span>}
            <span className={styles.badge} data-tone={state === "in_use" || state === "ready" ? state : undefined}>{t(`translation_catalog.state.${state}`)}</span>
        </div>
    </li>;
};

// The states of an entry that cannot be used as it is, drawn as a problem.
const PROBLEMS = ["unavailable", "no_key"];

// Where an API entry's key is: in the key store, held only until the app closes (the store did
// not take it, ADR-013), or nowhere.
const keyText = (item: ApiItem) => item.key_in_memory ? "translation_catalog.key_memory"
    : item.has_key ? "translation_catalog.key_kept" : "translation_catalog.key_none";

// An entry the user added (or a model folder): what it points at, and Use and Remove.
const EntryCard = ({ group, item }: CatalogEntry) => {
    const { t } = useI18n();
    const { send, pending } = useTranslationCatalog();
    const [removing, setRemoving] = useState(false);
    const state = entryState(item);
    const folderModel = item.origin === "folder";
    const busy = !!pending;
    return <li className={styles.card} data-catalog-item={item.id} tabIndex={-1} role="group" aria-label={item.name}>
        <div className={styles.card_head}>
            <strong>{item.name}</strong>
            <span className={styles.badge} data-tone="own">{t(`translation_catalog.badge.${folderModel ? "folder" : "user"}`)}</span>
            <span className={styles.badge} data-tone={PROBLEMS.includes(state) ? "missing" : state}>{t(`translation_catalog.state.${state}`)}</span>
        </div>
        <dl className={styles.facts}>
            {group === "engine" ? <>
                <div><dt>{t("translation_catalog.fact.runtime")}</dt><dd>{t(`translation_catalog.runtime.${item.runtime}`, { defaultValue: item.runtime })}</dd></div>
                {item.folder && <div><dt>{t("translation_catalog.fact.folder")}</dt><dd><code>{item.folder}</code></dd></div>}
                {!folderModel && <div><dt>{t("translation_catalog.fact.languages")}</dt>
                    <dd>{item.languages?.length ? item.languages.join(", ") : t("translation_catalog.languages_all")}</dd></div>}
            </> : <>
                <div><dt>{t("translation_catalog.fact.url")}</dt><dd><code>{item.url}</code></dd></div>
                <div><dt>{t("translation_catalog.fact.model")}</dt><dd>{item.model || t("translation_catalog.model_first")}</dd></div>
                <div><dt>{t("translation_catalog.fact.key")}</dt><dd>{t(keyText(item))}</dd></div>
            </>}
        </dl>
        {["missing", "unsupported", ...PROBLEMS].includes(state) && <p role="alert">{t(`translation_catalog.state_help.${state}`)}</p>}
        {group === "api" && item.key_in_memory && <p>{t("translation_catalog.key_memory_help")}</p>}
        {folderModel ? <p>{t("translation_catalog.folder_help")}</p>
            : removing ? <div className={styles.actions} role="group" aria-label={t("translation_catalog.remove_confirm_label", { name: item.name })}>
                <p>{t(`translation_catalog.remove_confirm.${group}`)}</p>
                <button type="button" autoFocus onClick={() => setRemoving(false)}>{t("translation_catalog.back")}</button>
                <button type="button" disabled={busy} onClick={() => {
                    setRemoving(false); send("/run/remove_translation_catalog_entry", { id: item.id });
                }}>{t("translation_catalog.remove_do")}</button>
            </div>
            : <div className={styles.actions}>
                {state !== "in_use" && <button type="button" className="primary" disabled={busy || state !== "ready"}
                    onClick={() => send("/run/use_translation_catalog_entry", { id: item.id })}>{t(`translation_catalog.use.${group}`)}</button>}
                <button type="button" disabled={busy || (group === "engine" && state === "in_use")}
                    onClick={() => setRemoving(true)}>{t("translation_catalog.remove")}</button>
                {group === "engine" && state === "in_use" && <p>{t("translation_catalog.remove_in_use")}</p>}
            </div>}
    </li>;
};

const REGISTER = "/run/register_translation_catalog_entry";

// Clears a form once the answer to its own request came back without a refusal.
const useClearOnSuccess = (group: CatalogGroupId, clear: () => void) => {
    const { pending, error } = useTranslationCatalog();
    const sent = useRef(false);
    useEffect(() => {
        if (pending?.endpoint === REGISTER && pending.group === group) { sent.current = true; return; }
        if (sent.current && !pending) {
            sent.current = false;
            if (!error) clear();
        }
    }, [pending, error, group, clear]);
};

// Not <form>s: Enter in a field adds, as a form would, without nesting forms in the page.
const onEnter = (submit: () => void, busy: boolean) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && "tagName" in event.target && event.target.tagName === "INPUT") { event.preventDefault(); if (!busy) submit(); }
};

const EngineForm = ({ runtimes }: { runtimes: readonly string[] }) => {
    const { t } = useI18n();
    const { send, pending } = useTranslationCatalog();
    const id = useId();
    const empty: EngineFields = { name: "", folder: "", runtime: runtimes[0] ?? "onnx", languages: "" };
    const [form, setForm] = useState(empty);
    const [problem, setProblem] = useState<string | null>(null);
    const busy = !!pending;
    useClearOnSuccess("engine", () => { setForm(empty); setProblem(null); });
    const set = (key: keyof EngineFields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(current => ({ ...current, [key]: event.target.value }));
    const submit = () => {
        const checked = engineRequest(form);
        if ("problem" in checked) { setProblem(checked.problem); return; }
        setProblem(null);
        send(REGISTER, checked.request);
    };
    return <details className={styles.more} data-catalog-add="engine">
        <summary>{t("translation_catalog.add.engine")}</summary>
        <div role="group" aria-label={t("translation_catalog.add.engine")} onKeyDown={onEnter(submit, busy)}>
            <p>{t("translation_catalog.add_help.engine")}</p>
            <p>{t("translation_catalog.terms_help")}</p>
            {runtimes.length === 0 && <p role="alert">{t("translation_catalog.no_runtime")}</p>}
            <label>{t("translation_catalog.field.name")}
                <input type="text" value={form.name} maxLength={ENTRY_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.engine_name")} onChange={set("name")} />
            </label>
            <label>{t("translation_catalog.field.folder")}
                <input type="text" value={form.folder} maxLength={4096} disabled={busy} spellCheck={false}
                    aria-describedby={problem ? `${id}-problem` : undefined} onChange={set("folder")} />
            </label>
            <label>{t("translation_catalog.field.runtime")}
                <select value={form.runtime} disabled={busy || runtimes.length < 2} onChange={set("runtime")}>
                    {(runtimes.length ? runtimes : ["onnx"]).map(runtime =>
                        <option key={runtime} value={runtime}>{t(`translation_catalog.runtime.${runtime}`, { defaultValue: runtime })}</option>)}
                </select>
            </label>
            <label>{t("translation_catalog.field.languages")}
                <input type="text" value={form.languages} maxLength={4096} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.languages")} onChange={set("languages")} />
            </label>
            {problem && <p id={`${id}-problem`} role="alert">{t(`translation_catalog.problem.${problem}`)}</p>}
            <div className={`${styles.actions} ${styles.control_column}`}>
                <button type="button" disabled={busy || runtimes.length === 0} onClick={submit}>{t("translation_catalog.add_do")}</button>
            </div>
        </div>
    </details>;
};

const ApiForm = ({ protocols }: { protocols: readonly string[] }) => {
    const { t } = useI18n();
    const { send, pending } = useTranslationCatalog();
    const id = useId();
    const empty: ApiFields = { name: "", url: "", model: "", auth_key: "", protocol: protocols[0] ?? "openai_compatible" };
    const [form, setForm] = useState(empty);
    const [problem, setProblem] = useState<string | null>(null);
    const busy = !!pending;
    useClearOnSuccess("api", () => { setForm(empty); setProblem(null); });
    const set = (key: keyof ApiFields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(current => ({ ...current, [key]: event.target.value }));
    const submit = () => {
        const checked = apiRequest(form);
        if ("problem" in checked) { setProblem(checked.problem); return; }
        setProblem(null);
        send(REGISTER, checked.request);
    };
    return <details className={styles.more} data-catalog-add="api">
        <summary>{t("translation_catalog.add.api")}</summary>
        <div role="group" aria-label={t("translation_catalog.add.api")} onKeyDown={onEnter(submit, busy)}>
            <p>{t("translation_catalog.add_help.api")}</p>
            <p>{t("config_page.translation.llm_privacy_desc")}</p>
            <label>{t("translation_catalog.field.name")}
                <input type="text" value={form.name} maxLength={ENTRY_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.api_name")} onChange={set("name")} />
            </label>
            <label>{t("translation_catalog.field.protocol")}
                <select value={form.protocol} disabled={busy || protocols.length < 2} onChange={set("protocol")}>
                    {(protocols.length ? protocols : ["openai_compatible"]).map(protocol =>
                        <option key={protocol} value={protocol}>{t(`translation_catalog.protocol.${protocol}`, { defaultValue: protocol })}</option>)}
                </select>
            </label>
            <label>{t("translation_catalog.field.url")}
                <input type="url" value={form.url} maxLength={2048} disabled={busy} spellCheck={false}
                    placeholder="http://192.168.1.10:8000/v1" aria-describedby={`${id}-url`} onChange={set("url")} />
            </label>
            <p id={`${id}-url`}>{endpointDescription(form.url, t("translation_catalog.url_help"), t)}</p>
            <label>{t("translation_catalog.field.model")}
                <input type="text" value={form.model} maxLength={200} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.model")} onChange={set("model")} />
            </label>
            <label>{t("translation_catalog.field.key")}
                <input type="password" value={form.auth_key} disabled={busy} autoComplete="off" spellCheck={false}
                    aria-describedby={problem ? `${id}-problem` : undefined} onChange={set("auth_key")} />
            </label>
            {problem && <p id={`${id}-problem`} role="alert">{t(`translation_catalog.problem.${problem}`)}</p>}
            <div className={`${styles.actions} ${styles.control_column}`}>
                <button type="button" disabled={busy} onClick={submit}>{t("translation_catalog.add_do")}</button>
            </div>
        </div>
    </details>;
};
