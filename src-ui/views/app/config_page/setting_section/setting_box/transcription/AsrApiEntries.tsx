import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { useTranscriptionCatalog } from "../../../../../../logics/transcription/useTranscriptionCatalog";
import { asrApiRequest, asrEntryState } from "../../../../../../logics/transcription/transcriptionCatalog.ts";
import type { AsrApiForm, AsrApiItem } from "../../../../../../logics/transcription/transcriptionCatalog.ts";
import { ENTRY_NAME_LIMIT } from "../../../../../../logics/translation/translationCatalog.ts";
import { endpointNotices } from "../../../../../../logics/common/endpointPrivacy";
import { CatalogFacts, CatalogList, useCatalogLayout } from "../advanced_settings/catalogLayout";
import type { CatalogLayout } from "../advanced_settings/catalogLayout";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { Fold } from "../_components/fold/Fold";
import { useHintDescriptions } from "../_components/hint/Hint";
import { Lead } from "../_components/lead/Lead";
import { Button, TextField } from "../../../../../kit/index.ts";

const REGISTER = "/run/register_transcription_catalog_entry";

// i18next takes the first key it has: a code without its own text gets the general one.
const errorText = (t: TFunction, code: string) =>
    t([`config_page.transcription.api_entries.errors.${code}`, "config_page.transcription.api_entries.errors.other"], { code });

// Where an entry's key is: in the key store, held only until the app closes (the store did not
// take it, ADR-013), or nowhere.
const keyText = (item: AsrApiItem) => item.key_in_memory ? "translation_catalog.key_memory"
    : item.has_key ? "translation_catalog.key_kept" : "translation_catalog.key_none";

// The speech recognition APIs the user added (#414), in the API group under the providers the app
// ships: a card each, as the translation catalog's and the model catalog's entries are, and the
// form that adds one. Adding only records the entry; using it points the custom Whisper server at
// it. The engine selected at the top of the page stays as it is.
export const AsrApiEntries = () => {
    const { t } = useI18n();
    const { catalog, error, send } = useTranscriptionCatalog();
    const layout = useCatalogLayout();
    // Asked again when the page opens: which key the store holds may have changed since.
    useEffect(() => { send("/get/data/transcription_catalog"); }, [send]);
    const entries = catalog?.api ?? [];
    return (
        <div className={styles.container} data-asr-api-entries>
            {error && <p role="alert">{errorText(t, error)}</p>}
            {catalog?.error_code && <p role="alert">{errorText(t, catalog.error_code)}</p>}
            {entries.length > 0 && <CatalogList layout={layout}>{entries.map(item => <EntryCard key={item.id} item={item} layout={layout} />)}</CatalogList>}
            <AddForm protocols={catalog?.protocols ?? []} />
        </div>
    );
};

// An entry the user added: where it points, and Use and Remove.
const EntryCard = ({ item, layout }: { item: AsrApiItem; layout: CatalogLayout }) => {
    const { t } = useI18n();
    const { send, pending } = useTranscriptionCatalog();
    const [removing, setRemoving] = useState(false);
    const id = useId();
    const state = asrEntryState(item);
    const busy = !!pending;
    return <li className={styles.card} data-catalog-item={item.id} data-status={state} tabIndex={-1} role="group" aria-label={item.name}>
        <div className={styles.card_intro}><div className={styles.card_head}>
            <strong>{item.name}</strong>
            {layout === "list" && <span className={styles.badge} data-tone="own">{t("translation_catalog.badge.user")}</span>}
            <span className={`${styles.badge} ${styles.status}`} data-tone={state === "no_key" ? "missing" : state}>{t(`translation_catalog.state.${state}`)}</span>
        </div>
        {layout === "grid" && <div className={styles.card_badges}><span className={styles.badge} data-tone="own">{t("translation_catalog.badge.user")}</span></div>}
        </div>
        <CatalogFacts layout={layout}><dl className={`${styles.facts} ${styles.card_spec}`}>
            <div><dt>{t("translation_catalog.fact.url")}</dt><dd><code>{item.url}</code></dd></div>
            <div><dt>{t("translation_catalog.fact.model")}</dt><dd>{item.model || t("translation_catalog.model_first")}</dd></div>
            <div><dt>{t("translation_catalog.fact.key")}</dt><dd>{t(keyText(item))}</dd></div>
        </dl></CatalogFacts>
        <div className={styles.card_foot}>
            {(state === "unsupported" || state === "no_key") && <p role="alert">{t(`translation_catalog.state_help.${state}`)}</p>}
            {item.key_in_memory && <p>{t("translation_catalog.key_memory_help")}</p>}
            {removing ? <div className={styles.actions} role="group" aria-label={t("translation_catalog.remove_confirm_label", { name: item.name })}>
                    <p>{t("config_page.transcription.api_entries.remove_confirm")}</p>
                    <Button autoFocus onClick={() => setRemoving(false)}>{t("translation_catalog.back")}</Button>
                    <Button tone="danger" disabled={busy} onClick={() => {
                        setRemoving(false); send("/run/remove_transcription_catalog_entry", { id: item.id });
                    }}>{t("translation_catalog.remove_do")}</Button>
                </div>
                : <div className={styles.actions}>
                    {/* What Use changes is the button's description: the custom Whisper server, not the engine. */}
                    {state !== "in_use" && <Button tone="primary" disabled={busy || state !== "ready"} aria-describedby={`${id}-use`}
                        onClick={() => send("/run/use_transcription_catalog_entry", { id: item.id })}>{t("config_page.transcription.api_entries.use")}</Button>}
                    <Button tone="danger" disabled={busy} onClick={() => setRemoving(true)}>{t("translation_catalog.remove")}</Button>
                    <span id={`${id}-use`} hidden>{t("config_page.transcription.api_entries.use_help")}</span>
                </div>}
        </div>
    </li>;
};

// Clears the form once the answer to its own request came back without a refusal.
const useClearOnSuccess = (clear: () => void) => {
    const { pending, error } = useTranscriptionCatalog();
    const sent = useRef(false);
    useEffect(() => {
        if (pending?.endpoint === REGISTER) { sent.current = true; return; }
        if (sent.current && !pending) {
            sent.current = false;
            if (!error) clear();
        }
    }, [pending, error, clear]);
};

// Not a <form>: Enter in a field adds, as a form would, without nesting forms in the page.
const onEnter = (submit: () => void, busy: boolean) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && "tagName" in event.target && event.target.tagName === "INPUT") { event.preventDefault(); if (!busy) submit(); }
};

const AddForm = ({ protocols }: { protocols: readonly string[] }) => {
    const { t } = useI18n();
    const { send, pending } = useTranscriptionCatalog();
    const id = useId();
    const empty: AsrApiForm = { name: "", url: "", model: "", auth_key: "", protocol: protocols[0] ?? "openai_compatible" };
    const [form, setForm] = useState(empty);
    const [problem, setProblem] = useState<string | null>(null);
    const busy = !!pending;
    useClearOnSuccess(() => { setForm(empty); setProblem(null); });
    const set = (key: keyof AsrApiForm) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(current => ({ ...current, [key]: event.target.value }));
    const submit = () => {
        const checked = asrApiRequest(form);
        if ("problem" in checked) { setProblem(checked.problem); return; }
        setProblem(null);
        send(REGISTER, checked.request);
    };
    // What to fill in is the title's hint (#614). What is sent once the entry is used is one
    // sentence in view, read before adding, with its details as that sentence's hint.
    const hints = useHintDescriptions();
    const urlWarning = endpointNotices(form.url, null, t).warning;
    const title = t("config_page.transcription.api_entries.add");
    return <Fold data-catalog-add="asr_api" summary={title} hint={hints ? t("config_page.transcription.api_entries.add_help") : undefined}>
        <div role="group" aria-label={title} onKeyDown={onEnter(submit, busy)}>
            {!hints && <p>{t("config_page.transcription.api_entries.add_help")}</p>}
            <label>{t("translation_catalog.field.name")}
                <TextField value={form.name} maxLength={ENTRY_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("config_page.transcription.api_entries.placeholder_name")} onChange={set("name")} />
            </label>
            <label>{t("translation_catalog.field.protocol")}
                <select value={form.protocol} disabled={busy || protocols.length < 2} onChange={set("protocol")}>
                    {(protocols.length ? protocols : ["openai_compatible"]).map(protocol =>
                        <option key={protocol} value={protocol}>{t(`config_page.transcription.api_entries.protocol.${protocol}`, { defaultValue: protocol })}</option>)}
                </select>
            </label>
            <label>{t("translation_catalog.field.url")}
                <TextField mono type="url" value={form.url} maxLength={2048} disabled={busy} spellCheck={false}
                    placeholder="http://192.168.1.10:8000/v1" aria-describedby={[`${id}-url`, urlWarning ? `${id}-url-warning` : null].filter(Boolean).join(" ")} onChange={set("url")} />
            </label>
            <Lead id={`${id}-url`} text={t("config_page.transcription.api_entries.url_lead")} details={t("translation_catalog.url_details")} />
            {urlWarning && <p id={`${id}-url-warning`} role="note">{urlWarning}</p>}
            <label>{t("translation_catalog.field.model")}
                <TextField value={form.model} maxLength={200} disabled={busy} spellCheck={false}
                    placeholder={t("translation_catalog.placeholder.model")} onChange={set("model")} />
            </label>
            <label>{t("translation_catalog.field.key")}
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
