import { useEffect, useId, useState } from "react";
import { useI18n } from "@useI18n";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import { USER_MODEL_FILES, USER_MODEL_NAME_LIMIT, registrationRequest, userModelStatus } from "../../../../../../logics/voice/modelCatalog";
import { extensionOf } from "../../../../../../logics/common/fileDrop";
import { FileDropZone } from "../_components/file_drop_zone/FileDropZone";
import styles from "./VoiceSettings.module.scss";
import { Fold } from "../_components/fold/Fold";
import { CatalogFacts } from "./catalogLayout";
import type { CatalogLayout } from "./catalogLayout";
import { AuditionButton, AuditionNote } from "./VoiceAudition";
import type { DownloadBlock, ExpectedPaths } from "./ModelDownloads";
import type { UserModel, UserModelStatus } from "../../../../../../logics/voice/modelCatalog";
import type { RvcAuditionValues } from "../../../../../../logics/voice/voiceAudition";

const gib = (value: number) => `${(value / 1073741824).toFixed(2)} GiB`;
// A registered model's files are there, as a downloaded one's; a missing or changed one cannot play.
const auditionStatus = (status: UserModelStatus) => status === "registered" ? "downloaded" : status === "in_use" ? "in_use" : "not_downloaded";

// The cards of the models the user registered for one target (#403), in the same list as the
// catalog's cards. "Use" writes the model's paths into the settings through the same checks as
// applying a download (the saved value shown, the target stopped). Removing forgets the
// registration only; the files and the settings that name them stay.
export interface UserModelCardsProps {
    target: string;
    expected?: ExpectedPaths;
    blocked?: DownloadBlock;
    busy: boolean;
    // The layout of the catalog the cards are in.
    layout?: CatalogLayout;
    // The RVC form's pitch and index rate an audition converts with (#415); null while not valid.
    audition?: RvcAuditionValues | null;
}

export const UserModelCards = ({ target, expected, blocked, busy, layout = "list", audition }: UserModelCardsProps) => {
    const { t } = useI18n();
    const { userModels, send } = useModelDownloads();
    const [removing, setRemoving] = useState<string | null>(null);
    const rows = userModels?.models?.filter(model => model.target === target) ?? [];
    return rows.map(model => {
        const status = userModelStatus(model, expected?.[target]);
        const roles = USER_MODEL_FILES[target] ?? [];
        const savedPaths = expected?.[target];
        return <li key={model.id} data-user-model tabIndex={-1} role="group" aria-label={model.name} className={styles.card} data-status={status}>
            {/* In the grid the "your model" mark is the line under the name, so the state ends the name's line on every card. */}
            <div className={styles.card_intro}><div className={styles.card_head}>
                <strong>{model.name}</strong>
                {layout === "list" && <span className={styles.badge} data-tone="own">{t("user_models.badge")}</span>}
                <span className={`${styles.badge} ${styles.status}`} data-tone={status === "registered" ? "downloaded" : status}>{t(`user_models.status.${status}`)}</span>
            </div>
            {layout === "grid" && <div className={styles.card_badges}><span className={styles.badge} data-tone="own">{t("user_models.badge")}</span></div>}
            </div>
            {/* Laid out as a catalog card: what it is, its facts, then its notes and actions. In
                the grid its size is on the card, as a model's, and its files are in the fold. */}
            {layout === "grid" && <dl className={`${styles.facts} ${styles.card_key}`}>
                <div><dt>{t("user_models.size")}</dt><dd>{gib(model.total_bytes)}</dd></div>
            </dl>}
            <CatalogFacts layout={layout}><dl className={`${styles.facts} ${styles.card_spec}`}>
                {roles.filter(([role]) => model.paths[role]).map(([role]) => <div key={role}>
                    <dt>{t(`user_models.file.${role}`)}</dt>
                    <dd><code style={{ overflowWrap: "anywhere" }}>{model.paths[role]}</code></dd>
                </div>)}
                {layout === "list" && <div><dt>{t("user_models.size")}</dt><dd>{gib(model.total_bytes)}</dd></div>}
            </dl></CatalogFacts>
            <div className={styles.card_foot}>
                {["missing", "changed"].includes(status) && <p role="alert">{t(`user_models.status_help.${status}`)}</p>}
                {status === "registered" && blocked && <p>{t(blocked === "edited" ? "user_models.blocked_edited" : "model_downloads.blocked")}</p>}
                {removing === model.id ? <div className={styles.actions} role="group" aria-label={t("user_models.remove_confirm_label", { name: model.name })}>
                    <p>{t("user_models.remove_confirm")}</p>
                    <button type="button" autoFocus onClick={() => setRemoving(null)}>{t("model_downloads.back")}</button>
                    <button type="button" disabled={busy} onClick={() => {
                        setRemoving(null); send("/run/remove_user_model", { id: model.id });
                    }}>{t("user_models.remove_do")}</button>
                </div> : <div className={styles.actions}>
                    {status !== "in_use" && <button type="button" className="primary"
                        disabled={busy || !!blocked || status !== "registered" || !savedPaths}
                        onClick={() => send("/run/apply_user_model", { id: model.id, expected: savedPaths })}>{t("user_models.use")}</button>}
                    {/* A TTS model in use, or any RVC model whose files are there, can be heard on the monitor output (#415). */}
                    <AuditionButton target={target} status={auditionStatus(status)} entry={model.id} values={audition} />
                    <button type="button" disabled={busy} onClick={() => setRemoving(model.id)}>{t("user_models.remove")}</button>
                </div>}
                {removing !== model.id && <AuditionNote target={target} status={auditionStatus(status)} entry={model.id} values={audition} />}
            </div>
        </li>;
    });
};

// The form that registers a model file of one's own for a target. It only records where the
// file is: nothing is copied, downloaded or switched by registering.
export interface UserModelRegistrationProps {
    target: string;
    busy: boolean;
}

// The name sent, and the registrations that already had it.
interface SentRegistration {
    name: string;
    before: string[];
}

// The tag of the element a key went to ("" for a target that is not an element).
const tagOf = (target: EventTarget): string => "tagName" in target && typeof target.tagName === "string" ? target.tagName : "";

export const UserModelRegistration = ({ target, busy }: UserModelRegistrationProps) => {
    const { t } = useI18n();
    const { send, userModels } = useModelDownloads();
    const id = useId();
    const kinds = USER_MODEL_FILES[target] ?? [];
    const [name, setName] = useState(""), [paths, setPaths] = useState<Readonly<Record<string, string>>>({});
    const [problem, setProblem] = useState<string | null>(null);
    // The name sent, and the registrations that already had it: a refused duplicate
    // (user_model_exists) must not read as the model just registered.
    const [sentFor, setSentFor] = useState<SentRegistration | null>(null);
    const sameName = (model: UserModel, sent: string) => model.target === target && model.name === sent;
    // Clear the form once the list holds a new model with the name just sent.
    const registered = !!sentFor && !!userModels?.models?.some(model => sameName(model, sentFor.name) && !sentFor.before.includes(model.id));
    useEffect(() => {
        if (!registered) return;
        setSentFor(null); setName(""); setPaths({}); setProblem(null);
    }, [registered]);
    const submit = () => {
        const checked = registrationRequest(target, name, paths);
        if ("problem" in checked) { setProblem(checked.problem); return; }
        const sent = checked.request.name;
        setProblem(null);
        setSentFor({ name: sent, before: (userModels?.models ?? []).filter(model => sameName(model, sent)).map(model => model.id) });
        send("/run/register_user_model", checked.request);
    };
    return <Fold data-user-model-register summary={t("user_models.register_title")}>
        {/* Not a <form>: the catalog sits inside the speech server settings form, and a nested
            form would submit (save) that one too. Enter in a field registers, as a form would. */}
        <div role="group" aria-label={t("user_models.register_label", { group: t(`model_catalog.group.${target}`) })}
            onKeyDown={event => {
                if (event.key === "Enter" && tagOf(event.target) === "INPUT") { event.preventDefault(); if (!busy) submit(); }
            }}>
            <p>{t("user_models.register_help")}</p>
            <p>{t("user_models.terms_help")}</p>
            <label>{t("user_models.name")}
                <input type="text" value={name} maxLength={USER_MODEL_NAME_LIMIT} disabled={busy} spellCheck={false}
                    placeholder={t("user_models.name_placeholder")} onChange={event => setName(event.target.value)} />
            </label>
            <FileDropZone accept={kinds.map(([, suffix]) => suffix)} disabled={busy}
                hint={t("user_models.drop_hint")}
                onFiles={dropped => setPaths(current => ({
                    ...current,
                    ...Object.fromEntries(kinds.flatMap(([role, suffix]) => {
                        const path = dropped.find(item => extensionOf(item) === suffix);
                        return path ? [[role, path]] : [];
                    })),
                }))} />
            {kinds.map(([role, suffix]) => <label key={role}>{t(`user_models.file_field.${role}`, { kind: suffix })}
                <input type="text" value={paths[role] ?? ""} maxLength={4096} disabled={busy} spellCheck={false}
                    aria-describedby={problem ? `${id}-problem` : undefined}
                    onChange={event => setPaths(current => ({ ...current, [role]: event.target.value }))} />
            </label>)}
            {problem && <p id={`${id}-problem`} role="alert">{t(`user_models.problem.${problem}`, { kind: kinds.find(([role]) => problem.startsWith(role))?.[1] ?? "" })}</p>}
            <div className={`${styles.actions} ${styles.control_column}`}>
                <button type="button" disabled={busy} onClick={submit}>{t("user_models.register")}</button>
            </div>
        </div>
    </Fold>;
};
