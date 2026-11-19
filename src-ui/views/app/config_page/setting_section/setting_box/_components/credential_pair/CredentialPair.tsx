import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useStdoutToPython } from "@useStdoutToPython";
import { useSettingsDraft } from "../../../../../../../logics/voice/useSettingsDraft";
import type { DraftState, DraftWriteValue } from "../../../../../../../logics/voice/useSettingsDraft";
import { endpointDescription } from "../../../../../../../logics/common/endpointPrivacy";
import { AuthKeyContainer, EntryWithSaveButtonContainer } from "../../_templates/Templates";

// The endpoint and its key, saved together.
interface Credential {
    url: string;
    auth_key: string;
}

type CredentialField = keyof Credential;

// The two settings of a provider (base): its URL and its key, as the category hook holds them.
export type CredentialSettings<B extends string> = Record<`current${B}URL` | `current${B}AuthKey`, { state?: string; data?: string | null }>;

export interface CredentialPairProps<B extends string> {
    settings: CredentialSettings<B>;
    base: B;
    // The endpoints' name: /set/data/<provider>_url and so on.
    provider: string;
    section: string;
}

const isCredential = (value: DraftWriteValue<Credential>): value is Credential =>
    typeof value === "object" && value !== null && typeof value.url === "string" && typeof value.auth_key === "string";

// The value of a field as the form saves it: the record the backend answered, or a copy of it.
const isAnswer = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;

export const CredentialPair = <B extends string>({ settings, base, provider, section }: CredentialPairProps<B>) => {
    const { t } = useI18n();
    const { asyncStdoutToPython } = useStdoutToPython();
    const [error, updateError] = useState<unknown>(null);
    // Explicit input may equal the saved key; equality alone cannot prove reentry.
    const enteredKey = useRef<object | null>(null);
    const url = settings[`current${base}URL`], key = settings[`current${base}AuthKey`];
    const saved = useMemo(() => ({ url: url.data ?? "", auth_key: key.data ?? "" }), [url.data, key.data]);
    const label = (field: string) => t(`config_page.${section}.${provider}_${field}.label`);
    const ready = url.state !== "pending" && key.state !== "pending";
    const requiresKey = (value: Credential) => !!saved.auth_key && value.url.trim() !== saved.url.trim() && !value.auth_key.trim();
    const canSave = (value: Credential) => ready && !requiresKey(value);
    const write = async (value: DraftWriteValue<Credential>) => {
        // The form sends its draft, the pair.
        if (!isCredential(value)) throw new TypeError("There is no pair of an endpoint and a key to save.");
        if (!canSave(value)) return false;
        const submittedKey = enteredKey.current;
        const urlChanged = value.url.trim() !== saved.url.trim(), keyChanged = value.auth_key !== saved.auth_key;
        const pairChanged = urlChanged && (keyChanged || !!value.auth_key);
        let endpoint, data;
        if (pairChanged) {
            endpoint = `/set/data/${provider}_auth_key_and_url`;
            data = value;
        } else if (urlChanged) {
            endpoint = `/set/data/${provider}_url`;
            data = value.url;
        } else {
            endpoint = `/${value.auth_key ? "set" : "delete"}/data/${provider}_auth_key`;
            data = value.auth_key || undefined;
        }
        const response = await asyncStdoutToPython(endpoint, data);
        const reply = typeof response === "object" && response !== null ? response : null;
        if (reply?.status !== 200) {
            updateError((isAnswer(reply?.result) ? reply.result.error_code : undefined) || "save_unconfirmed");
            return response;
        }
        if (enteredKey.current === submittedKey) enteredKey.current = null;
        // Object.assign copies what a spread copies, from any value.
        const canonical: Readonly<Record<string, unknown>> = pairChanged ? Object.assign({}, reply.result) : {
            ...saved, [urlChanged ? "url" : "auth_key"]: reply.result,
        };
        return { ...reply, result: { ...canonical, auth_key: canonical.auth_key ?? "" } };
    };
    const form = useSettingsDraft(saved, error, updateError, { write, canSave, label: ([field]) => label(field) });
    useEffect(() => {
        // Discard (including the leave dialog) restores this exact saved object.
        if (form.draft === saved) enteredKey.current = null;
    }, [form.draft, saved]);
    if (!form.draft) return null;
    // The draft of this render; the fields' handlers read the same one.
    const draft = form.draft;
    // There is always a draft while the fields are shown: it is the saved pair until edited.
    const edited = (name: CredentialField, value: string, restore: Partial<Credential>) => (previous: DraftState<Credential>) =>
        previous && { ...previous, [name]: value, ...restore };
    const field = (name: CredentialField) => ({
        label: label(name), variable: draft[name], state: form.saving || !ready ? "pending" : "ok",
        onChangeFunction: (value: string) => {
            if (name === "auth_key") enteredKey.current = value.trim() ? {} : null;
            const restoreKey = name === "url" && saved.auth_key && !enteredKey.current;
            form.setDraft(edited(name, value,
                restoreKey
                    ? { auth_key: value.trim() === saved.url.trim() ? saved.auth_key : "" } : {},
            ));
        },
        saveFunction: () => { if (canSave(draft) && form.dirty) return form.submit(write); },
        remove_border_bottom: true,
    });
    return <>
        <EntryWithSaveButtonContainer {...field("url")}
            desc={endpointDescription(form.draft.url, t(`config_page.${section}.${provider}_url.desc`), t)} />
        <AuthKeyContainer {...field("auth_key")}
            add_warnings={requiresKey(form.draft) ? [{ label: t("config_page.common.credential_reentry_required") }] : []}
            desc={section === "transcription" ? t(`config_page.${section}.${provider}_auth_key.desc`) : undefined} />
        {form.navigationDialog}
    </>;
};
