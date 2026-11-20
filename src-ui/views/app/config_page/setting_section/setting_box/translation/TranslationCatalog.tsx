import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { useTranslationCatalog } from "../../../../../../logics/translation/useTranslationCatalog";
import { ENGINE_FORM_SETTING_ID, ENTRY_NAME_LIMIT, LLAMACPP, LLAMA_DEVICES, apiRequest, engineRequest, entryState } from "../../../../../../logics/translation/translationCatalog";
import { endpointDescription } from "../../../../../../logics/common/endpointPrivacy";
import { SectionLabelComponent } from "../_components";
import { useHintDescriptions } from "../_components/hint/Hint";
import { catalogHeading } from "../advanced_settings/catalogHeading";
import { TranslationLlamaRuntimes } from "./TranslationLlamaRuntimes";
import styles from "../advanced_settings/VoiceSettings.module.scss";
import { Fold } from "../_components/fold/Fold";
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
// Its cards are laid out as the model catalog's (DESIGN.md "Components", #614): the name with the
// state at the end of its line, the facts in one table, then the notes and the actions; the entry
// in use carries the active frame.
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
    const hints = useHintDescriptions();
    const { send } = useTranslationCatalog();
    // Which llama.cpp entries can run follows the server builds set up below.
    const askAgain = useCallback(() => send("/get/data/translation_catalog"), [send]);
    const entries = entriesOf(catalog, group);
    const shipped = entries.filter(entry => entry.item.origin === "builtin");
    const own = entries.filter(entry => entry.item.origin !== "builtin");
    return (
        <div className={styles.catalog_group} data-catalog-group={group}>
            {/* What the group is: its heading's hint on a page that shows descriptions as hints, a line under it elsewhere. */}
            {catalogHeading(hints, "h3", t(`translation_catalog.group.${group}`), [t(`translation_catalog.group_help.${group}`)])}
            {own.length > 0
                ? <ul className={styles.catalog}>{own.map(entry => <EntryCard key={entry.item.id} {...entry} />)}</ul>
                : <p>{t("translation_catalog.none_added")}</p>}
            <Fold summary={t("translation_catalog.shipped_title", { count: shipped.length })}>
                <ul className={styles.catalog}>{shipped.map(entry => <ShippedCard key={entry.item.id} {...entry} />)}</ul>
            </Fold>
            {group === "engine" && (catalog.runtimes ?? []).includes("llamacpp") && <TranslationLlamaRuntimes onInstalled={askAgain} />}
            {group === "engine" ? <EngineForm runtimes={catalog.runtimes ?? []} /> : <ApiForm protocols={catalog.protocols ?? []} />}
        </div>
    );
};

// An entry the app ships: its name and whether it can be used now. Its settings stay in the
// sections above. The state ends the name's line, where every card of the catalog has it.
const ShippedCard = ({ group, item }: CatalogEntry) => {
    const { t } = useI18n();
    const state = item.in_use ? "in_use" : item.available ? "ready" : group === "engine" ? "not_downloaded" : "not_set";
    return <li className={styles.card} data-catalog-item={item.id} data-status={state}>
        <div className={styles.card_head}>
            <strong>{item.name}</strong>
            <span className={styles.badge}>{t("translation_catalog.badge.builtin")}</span>
            {group === "api" && item.kind && <span className={styles.badge}>{t(`translation_catalog.kind.${item.kind}`)}</span>}
            {"non_commercial" in item && item.non_commercial && <span className={styles.badge} data-tone="changed">{t("translation_catalog.badge.non_commercial")}</span>}
            <span className={`${styles.badge} ${styles.status}`} data-tone={state === "in_use" || state === "ready" ? state : undefined}>{t(`translation_catalog.state.${state}`)}</span>
        </div>
    </li>;
};

// The states of an entry that cannot be used as it is, drawn as a problem.
const PROBLEMS = ["unavailable", "no_server", "no_key"];

// A state's help, worded for a translation LLM's file where that differs from a folder's.
const stateHelp = (item: EngineItem | ApiItem, state: string) => state === "unavailable" && "runtime" in item && item.runtime === LLAMACPP
    ? "translation_catalog.state_help.unavailable_llamacpp" : `translation_catalog.state_help.${state}`;

// Where an API entry's key is: in the key store, held only until the app closes (the store did
// not take it, ADR-013), or nowhere.
const keyText = (item: ApiItem) => item.key_in_memory ? "translation_catalog.key_memory"
    : item.has_key ? "translation_catalog.key_kept" : "translation_catalog.key_none";

// An entry the user added: what it points at, and Use and Remove.
const EntryCard = ({ group, item }: CatalogEntry) => {
    const { t } = useI18n();
    const { send, pending } = useTranslationCatalog();
    const [removing, setRemoving] = useState(false);
    const state = entryState(item);
    const busy = !!pending;
    // Laid out as a card of the model catalog: what it is and its state, its facts, then its
    // notes and actions.
    return <li className={styles.card} data-catalog-item={item.id} data-status={state} tabIndex={-1} role="group" aria-label={item.name}>
        <div className={styles.card_intro}><div className={styles.card_head}>
            <strong>{item.name}</strong>
            <span className={styles.badge} data-tone="own">{t("translation_catalog.badge.user")}</span>
            <span className={`${styles.badge} ${styles.status}`} data-tone={PROBLEMS.includes(state) ? "missing" : state}>{t(`translation_catalog.state.${state}`)}</span>
        </div></div>
        <dl className={`${styles.facts} ${styles.card_spec}`}>
            {group === "engine" ? <>
                <div><dt>{t("translation_catalog.fact.runtime")}</dt><dd>{t(`translation_catalog.runtime.${item.runtime}`, { defaultValue: item.runtime })}</dd></div>
                {item.file && <div><dt>{t("translation_catalog.fact.file")}</dt><dd><code>{item.file}</code></dd></div>}
                {item.folder && <div><dt>{t("translation_catalog.fact.folder")}</dt><dd><code>{item.folder}</code></dd></div>}
                {item.runtime === LLAMACPP && item.device && <div><dt>{t("translation_catalog.fact.device")}</dt>
                    <dd>{t(`translation_catalog.device.${item.device}`, { defaultValue: item.device })}</dd></div>}
                <div><dt>{t("translation_catalog.fact.languages")}</dt>
                    <dd>{item.languages?.length ? item.languages.join(", ") : t("translation_catalog.languages_all")}</dd></div>
            </> : <>
                <div><dt>{t("translation_catalog.fact.url")}</dt><dd><code>{item.url}</code></dd></div>
                <div><dt>{t("translation_catalog.fact.model")}</dt><dd>{item.model || t("translation_catalog.model_first")}</dd></div>
                <div><dt>{t("translation_catalog.fact.key")}</dt><dd>{t(keyText(item))}</dd></div>
            </>}
        </dl>
        <div className={styles.card_foot}>
            {["missing", "unsupported", ...PROBLEMS].includes(state) && <p role="alert">{t(stateHelp(item, state))}</p>}
            {group === "api" && item.key_in_memory && <p>{t("translation_catalog.key_memory_help")}</p>}
            {removing ? <div className={styles.actions} role="group" aria-label={t("translation_catalog.remove_confirm_label", { name: item.name })}>
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
        </div>
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
    const empty: EngineFields = { name: "", folder: "", runtime: runtimes[0] ?? "onnx", languages: "", device: "auto" };
    const [form, setForm] = useState(empty);
    const [problem, setProblem] = useState<string | null>(null);
    const busy = !!pending;
    // A translation LLM is one GGUF file and names its device (ADR-015).
    const llamacpp = form.runtime === LLAMACPP;
    useClearOnSuccess("engine", () => { setForm(empty); setProblem(null); });
    const set = (key: keyof EngineFields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(current => ({ ...current, [key]: event.target.value }));
    const submit = () => {
        const checked = engineRequest(form);
        if ("problem" in checked) { setProblem(checked.problem); return; }
        setProblem(null);
        send(REGISTER, checked.request);
    };
    return <Fold data-catalog-add="engine" summary={t("translation_catalog.add.engine")}>
        {/* The note about the translation-models folder leads here (revealSetting). */}
        <div role="group" aria-label={t("translation_catalog.add.engine")} onKeyDown={onEnter(submit, busy)} data-setting-id={ENGINE_FORM_SETTING_ID}>
            <p>{t(llamacpp ? "translation_catalog.add_help.engine_llamacpp" : "translation_catalog.add_help.engine")}</p>
            <p>{t("translation_catalog.terms_help")}</p>
            {runtimes.length === 0 && <p role="alert">{t("translation_catalog.no_runtime")}</p>}
            <label>{t("translation_catalog.field.name")}
                <input type="text" value={form.name} maxLength={ENTRY_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.engine_name")} onChange={set("name")} />
            </label>
            {/* The engine first: it says whether a folder or a file is asked for. */}
            <label>{t("translation_catalog.field.runtime")}
                <select value={form.runtime} disabled={busy || runtimes.length < 2} onChange={set("runtime")}>
                    {(runtimes.length ? runtimes : ["onnx"]).map(runtime =>
                        <option key={runtime} value={runtime}>{t(`translation_catalog.runtime.${runtime}`, { defaultValue: runtime })}</option>)}
                </select>
            </label>
            <label>{t(llamacpp ? "translation_catalog.field.file" : "translation_catalog.field.folder")}
                <input type="text" value={form.folder} maxLength={4096} disabled={busy} spellCheck={false}
                    aria-describedby={problem ? `${id}-problem` : undefined} onChange={set("folder")} />
            </label>
            {llamacpp && <label>{t("translation_catalog.field.device")}
                <select value={form.device} disabled={busy} onChange={set("device")}>
                    {LLAMA_DEVICES.map(device => <option key={device} value={device}>{t(`translation_catalog.device.${device}`)}</option>)}
                </select>
            </label>}
            <label>{t("translation_catalog.field.languages")}
                <input type="text" value={form.languages} maxLength={4096} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.languages")} onChange={set("languages")} />
            </label>
            {problem && <p id={`${id}-problem`} role="alert">{t(`translation_catalog.problem.${problem}`)}</p>}
            <div className={`${styles.actions} ${styles.control_column}`}>
                <button type="button" disabled={busy || runtimes.length === 0} onClick={submit}>{t("translation_catalog.add_do")}</button>
            </div>
        </div>
    </Fold>;
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
    return <Fold data-catalog-add="api" summary={t("translation_catalog.add.api")}>
        <div role="group" aria-label={t("translation_catalog.add.api")} onKeyDown={onEnter(submit, busy)}>
            <p>{t("translation_catalog.add_help.api")}</p>
            {/* Read before an API is added: the whole text, in view. */}
            <p>{t("config_page.translation.llm_privacy_lead")}</p>
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
    </Fold>;
};
