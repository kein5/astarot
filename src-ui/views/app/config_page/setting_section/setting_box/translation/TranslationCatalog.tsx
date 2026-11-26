import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { useTranslationCatalog } from "../../../../../../logics/translation/useTranslationCatalog";
import { ENGINE_FORM_SETTING_ID, ENTRY_NAME_LIMIT, LLAMACPP, LLAMA_DEVICES, apiRequest, engineRequest, entryState, weightLabel } from "../../../../../../logics/translation/translationCatalog";
import { useListedLocalWeights } from "../../../../../../logics/translation/useListedLocalWeights";
import { endpointNotices } from "../../../../../../logics/common/endpointPrivacy";
import { SectionLabelComponent } from "../_components";
import { CatalogFacts, CatalogLayoutSwitch, CatalogList, CatalogSection, CatalogState, useCatalogLayout } from "../advanced_settings/catalogLayout";
import type { CatalogLayout } from "../advanced_settings/catalogLayout";
import { TranslationLlamaRuntimes } from "./TranslationLlamaRuntimes";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { Fold } from "../_components/fold/Fold";
import { useHintDescriptions } from "../_components/hint/Hint";
import { Lead } from "../_components/lead/Lead";
import { FormRow } from "../_components/form_row/FormRow";
import { PathField } from "../_components/path_field/PathField";
import type { ApiForm as ApiFields, ApiItem, EngineForm as EngineFields, EngineItem, TranslationCatalog }
    from "../../../../../../logics/translation/translationCatalog";
import { Badge, Button, Card, CardFooter, CardHeader, CardTitle, InlineConfirm, InlineConfirmAction, InlineConfirmCancel, InlineConfirmContent,
    InlineConfirmDescription, InlineConfirmTrigger, Select, SelectOption, TextField } from "../../../../../kit/index.ts";

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
    const layout = useCatalogLayout();
    // Asked again when the page opens: which entries can be used follows the keys and the
    // downloads set up elsewhere since.
    useEffect(() => { send("/get/data/translation_catalog"); }, [send]);
    return (
        <section className={styles.container} aria-label={t("translation_catalog.title")}>
            {/* The cards' layout, chosen on the section's heading line, as on the model catalogs. */}
            <div className={`${styles.catalog_head} ${styles.section_head}`}>
                {/* What the catalog holds is the heading's hint (#614), a line under it elsewhere. */}
                <SectionLabelComponent label={t("translation_catalog.title")} desc={t("translation_catalog.intro")} />
                <CatalogLayoutSwitch />
            </div>
            {error && <p role="alert">{errorText(t, error)}</p>}
            {catalog?.error_code && <p role="alert">{errorText(t, catalog.error_code)}</p>}
            {catalog ? <>
                <CatalogGroup group="engine" catalog={catalog} layout={layout} />
                <CatalogGroup group="api" catalog={catalog} layout={layout} />
            </> : <p>{t("translation_catalog.loading")}</p>}
        </section>
    );
};

// i18next takes the first key it has: a code without its own text gets the general one.
const errorText = (t: TFunction, code: string) => t([`translation_catalog.errors.${code}`, "translation_catalog.errors.other"], { code });

const CatalogGroup = ({ group, catalog, layout }: { group: CatalogGroupId; catalog: TranslationCatalog; layout: CatalogLayout }) => {
    const { t } = useI18n();
    const { send } = useTranslationCatalog();
    // Which llama.cpp entries can run follows the server builds set up below.
    const askAgain = useCallback(() => send("/get/data/translation_catalog"), [send]);
    // A built-in model is listed here as in the model list above (#565): only the ones the user has,
    // can download, has selected or is downloading. The rest could only show "not downloaded".
    const listed = useListedLocalWeights();
    const entries = entriesOf(catalog, group).filter(entry =>
        entry.group !== "engine" || entry.item.origin !== "builtin" || listed.has(entry.item.weight));
    const shipped = entries.filter(entry => entry.item.origin === "builtin");
    const own = entries.filter(entry => entry.item.origin !== "builtin");
    return (
        // A part of the catalog of its own, folded as the model catalogs' parts are. What the group is:
        // its name's hint on a page that shows descriptions as hints, a line inside it elsewhere.
        <CatalogSection level={3} data-catalog-group={group} title={t(`translation_catalog.group.${group}`)}
            help={[t(`translation_catalog.group_help.${group}`)]} readout={t("translation_catalog.group_readout", { count: entries.length })}>
            {own.length > 0
                ? <CatalogList layout={layout}>{own.map(entry => <EntryCard key={entry.item.id} {...entry} layout={layout} />)}</CatalogList>
                : <p>{t("translation_catalog.none_added", { add: t(`translation_catalog.add.${group}`) })}</p>}
            <Fold summary={t("translation_catalog.shipped_title", { count: shipped.length })}>
                <CatalogList layout={layout}>{shipped.map(entry => <ShippedCard key={entry.item.id} {...entry} layout={layout} />)}</CatalogList>
            </Fold>
            {group === "engine" && (catalog.runtimes ?? []).includes("llamacpp") && <TranslationLlamaRuntimes onInstalled={askAgain} />}
            {group === "engine" ? <EngineForm runtimes={catalog.runtimes ?? []} /> : <ApiForm protocols={catalog.protocols ?? []} />}
        </CatalogSection>
    );
};

// An entry the app ships: its name and whether it can be used now. Its settings stay in the
// sections above. The state ends the name's line, where every card of the catalog has it; in the
// grid the entry's kind is the line under it, so every card's state is in the same place.
const ShippedCard = ({ group, item, layout }: CatalogEntry & { layout: CatalogLayout }) => {
    const { t } = useI18n();
    const state = item.in_use ? "in_use" : item.available ? "ready" : group === "engine" ? "not_downloaded" : "not_set";
    // A license that bars commercial use is a caution: amber.
    const kind = <>
        <Badge>{t("translation_catalog.badge.builtin")}</Badge>
        {group === "api" && item.kind && <Badge>{t(`translation_catalog.kind.${item.kind}`)}</Badge>}
        {"non_commercial" in item && item.non_commercial && <Badge tone="warning">{t("translation_catalog.badge.non_commercial")}</Badge>}
    </>;
    return <Card as="li" data-catalog-item={item.id} active={state === "in_use"} data-status={state}>
        <div className={styles.card_head}>
            {/* A built-in model by the download catalog's name of it (#565), not by the weight's id. */}
            <CardTitle>{group === "engine" ? weightLabel(item.weight, null) : item.name}</CardTitle>
            {layout === "list" && kind}
            <CatalogState state={state}>{t(`translation_catalog.state.${state}`)}</CatalogState>
        </div>
        {layout === "grid" && <div className={styles.card_badges}>{kind}</div>}
    </Card>;
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
const EntryCard = ({ group, item, layout }: CatalogEntry & { layout: CatalogLayout }) => {
    const { t } = useI18n();
    const { send, pending } = useTranslationCatalog();
    const [removing, setRemoving] = useState(false);
    const state = entryState(item);
    const busy = !!pending;
    // Laid out as a card of the model catalog: what it is and its state, its facts, then its
    // notes and actions.
    return <Card as="li" data-catalog-item={item.id} active={state === "in_use"} data-status={state} tabIndex={-1} role="group" aria-label={item.name}>
        {/* In the grid the "added by you" mark is the line under the name, as on the shipped cards. */}
        <CardHeader><div className={styles.card_head}>
            <CardTitle>{item.name}</CardTitle>
            {layout === "list" && <Badge tone="strong" variant="dashed">{t("translation_catalog.badge.user")}</Badge>}
            <CatalogState state={PROBLEMS.includes(state) ? "missing" : state}>{t(`translation_catalog.state.${state}`)}</CatalogState>
        </div>
        {layout === "grid" && <div className={styles.card_badges}><Badge tone="strong" variant="dashed">{t("translation_catalog.badge.user")}</Badge></div>}
        </CardHeader>
        <CatalogFacts layout={layout}><dl className={styles.facts}>
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
        </dl></CatalogFacts>
        <CardFooter>
            {["missing", "unsupported", ...PROBLEMS].includes(state) && <p role="alert">{t(stateHelp(item, state))}</p>}
            {group === "api" && item.key_in_memory && <p>{t("translation_catalog.key_memory_help")}</p>}
            {/* Removing asks first, in the card (the kit's InlineConfirm, H-07). */}
            <InlineConfirm>
                {removing ? <InlineConfirmContent aria-label={t("translation_catalog.remove_confirm_label", { name: item.name })}>
                        <InlineConfirmDescription>{t(`translation_catalog.remove_confirm.${group}`)}</InlineConfirmDescription>
                        <InlineConfirmCancel onClick={() => setRemoving(false)}>{t("translation_catalog.back")}</InlineConfirmCancel>
                        <InlineConfirmAction disabled={busy} onClick={() => {
                            setRemoving(false); send("/run/remove_translation_catalog_entry", { id: item.id });
                        }}>{t("translation_catalog.remove_do")}</InlineConfirmAction>
                    </InlineConfirmContent>
                    : <div className={styles.actions}>
                        {state !== "in_use" && <Button tone="primary" disabled={busy || state !== "ready"}
                            onClick={() => send("/run/use_translation_catalog_entry", { id: item.id })}>{t(`translation_catalog.use.${group}`)}</Button>}
                        {/* The kit's danger Button: it removes something. */}
                        <InlineConfirmTrigger tone="danger" disabled={busy || (group === "engine" && state === "in_use")}
                            onClick={() => setRemoving(true)}>{t("translation_catalog.remove")}</InlineConfirmTrigger>
                        {group === "engine" && state === "in_use" && <p>{t("translation_catalog.remove_in_use")}</p>}
                    </div>}
            </InlineConfirm>
        </CardFooter>
    </Card>;
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

// What the engine form's path is: the model's folder (ONNX), or its GGUF file (llama.cpp).
const MODEL_FOLDER = { kind: "folder" } as const;
const GGUF_FILE = { kind: "file", extensions: ["gguf"] } as const;

const EngineForm = ({ runtimes }: { runtimes: readonly string[] }) => {
    const { t } = useI18n();
    const { send, pending } = useTranslationCatalog();
    const id = useId();
    const empty: EngineFields = { name: "", folder: "", runtime: runtimes[0] ?? "onnx", languages: "", device: "auto" };
    const [form, setForm] = useState(empty);
    const [problem, setProblem] = useState<string | null>(null);
    const busy = !!pending;
    const hints = useHintDescriptions();
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
    // What to fill in and the user's responsibility for provenance/terms sit in the fold's hint (#614, #1112).
    const help = t(llamacpp ? "translation_catalog.add_help.engine_llamacpp" : "translation_catalog.add_help.engine");
    const terms = t("translation_catalog.terms_help");
    return <Fold data-catalog-add="engine" summary={t("translation_catalog.add.engine")} hint={hints ? `${help}\n${terms}` : undefined}>
        {/* The note about the translation-models folder leads here (revealSetting). */}
        <div role="group" aria-label={t("translation_catalog.add.engine")} onKeyDown={onEnter(submit, busy)} data-setting-id={ENGINE_FORM_SETTING_ID}>
            {!hints && <>
                <p>{help}</p>
                <p>{terms}</p>
            </>}
            {runtimes.length === 0 && <p role="alert">{t("translation_catalog.no_runtime")}</p>}
            <label>{t("translation_catalog.field.name")}
                <TextField value={form.name} maxLength={ENTRY_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.engine_name")} onChange={set("name")} />
            </label>
            {/* The engine first: it says whether a folder or a file is asked for. */}
            <label>{t("translation_catalog.field.runtime")}
                <Select value={form.runtime} disabled={busy || runtimes.length < 2} onChange={set("runtime")}>
                    {(runtimes.length ? runtimes : ["onnx"]).map(runtime =>
                        <SelectOption key={runtime} value={runtime}>{t(`translation_catalog.runtime.${runtime}`, { defaultValue: runtime })}</SelectOption>)}
                </Select>
            </label>
            {/* A path, in the kit's monospaced font (#476), typed, pasted or picked (#1231): the model's
                folder, or its GGUF file for the llama.cpp engine. */}
            <FormRow label={t(llamacpp ? "translation_catalog.field.file" : "translation_catalog.field.folder")}>
                <PathField value={form.folder} maxLength={4096} disabled={busy} pick={llamacpp ? GGUF_FILE : MODEL_FOLDER}
                    label={t(llamacpp ? "translation_catalog.field.file" : "translation_catalog.field.folder")}
                    aria-describedby={problem ? `${id}-problem` : undefined}
                    onChange={value => setForm(current => ({ ...current, folder: value }))} />
            </FormRow>
            {llamacpp && <label>{t("translation_catalog.field.device")}
                <Select value={form.device} disabled={busy} onChange={set("device")}>
                    {LLAMA_DEVICES.map(device => <SelectOption key={device} value={device}>{t(`translation_catalog.device.${device}`)}</SelectOption>)}
                </Select>
            </label>}
            <label>{t("translation_catalog.field.languages")}
                <TextField value={form.languages} maxLength={4096} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.languages")} onChange={set("languages")} />
            </label>
            <div className={`${styles.actions} ${styles.control_column}`}>
                <Button disabled={busy || runtimes.length === 0} onClick={submit}>{t("translation_catalog.add_do")}</Button>
            </div>
            {/* The problem is said under the button, in a line kept for it, so nothing moves when it appears (#912). */}
            <div className={styles.problem_slot}>
                {problem && <p id={`${id}-problem`} role="alert">{t(`translation_catalog.problem.${problem}`)}</p>}
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
    // What to fill in is the title's hint (#614). What is sent is one sentence in view, read before
    // adding, with its details as that sentence's hint, as everywhere else that says what leaves the PC.
    const hints = useHintDescriptions();
    const urlWarning = endpointNotices(form.url, null, t).warning;
    return <Fold data-catalog-add="api" summary={t("translation_catalog.add.api")} hint={hints ? t("translation_catalog.add_help.api") : undefined}>
        <div role="group" aria-label={t("translation_catalog.add.api")} onKeyDown={onEnter(submit, busy)}>
            {!hints && <p>{t("translation_catalog.add_help.api")}</p>}
            <Lead text={t("config_page.translation.llm_privacy_lead")} details={t("config_page.translation.llm_privacy_desc")} />
            <label>{t("translation_catalog.field.name")}
                <TextField value={form.name} maxLength={ENTRY_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.api_name")} onChange={set("name")} />
            </label>
            <label>{t("translation_catalog.field.protocol")}
                <Select value={form.protocol} disabled={busy || protocols.length < 2} onChange={set("protocol")}>
                    {(protocols.length ? protocols : ["openai_compatible"]).map(protocol =>
                        <SelectOption key={protocol} value={protocol}>{t(`translation_catalog.protocol.${protocol}`, { defaultValue: protocol })}</SelectOption>)}
                </Select>
            </label>
            <label>{t("translation_catalog.field.url")}
                {/* An address, in the kit's monospaced font (#476). */}
                <TextField mono type="url" value={form.url} maxLength={2048} disabled={busy} spellCheck={false}
                    placeholder="http://192.168.1.10:8000/v1" aria-describedby={[`${id}-url`, urlWarning ? `${id}-url-warning` : null].filter(Boolean).join(" ")} onChange={set("url")} />
            </label>
            {/* What leaves the PC is one sentence in view; what the address may be and that it is checked
                are its hint (#614, the lead's form). The warning about plain HTTP on the LAN stays in view
                while it applies. */}
            <Lead id={`${id}-url`} text={t("translation_catalog.url_lead")} details={t("translation_catalog.url_details")} />
            {urlWarning && <p id={`${id}-url-warning`} role="note">{urlWarning}</p>}
            <label>{t("translation_catalog.field.model")}
                <TextField value={form.model} maxLength={200} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.model")} onChange={set("model")} />
            </label>
            <label>{t("translation_catalog.field.key")}
                {/* A key, in the kit's monospaced font (#476); still a password field that is never filled in by the browser. */}
                <TextField mono type="password" value={form.auth_key} disabled={busy} autoComplete="off" spellCheck={false}
                    aria-describedby={problem ? `${id}-problem` : undefined} onChange={set("auth_key")} />
            </label>
            <div className={`${styles.actions} ${styles.control_column}`}>
                <Button disabled={busy} onClick={submit}>{t("translation_catalog.add_do")}</Button>
            </div>
            {/* The problem is said under the button, in a line kept for it, so nothing moves when it appears (#912). */}
            <div className={styles.problem_slot}>
                {problem && <p id={`${id}-problem`} role="alert">{t(`translation_catalog.problem.${problem}`)}</p>}
            </div>
        </div>
    </Fold>;
};
