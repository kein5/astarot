import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { useRealtimeASR } from "../../../../../../logics/transcription/useRealtimeASR";
import type { RealtimeAsrSettings } from "../../../../../../logics/transcription/useRealtimeASR";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import type { DraftWriteValue } from "../../../../../../logics/voice/useSettingsDraft";
import { saveSaidInline } from "../../../../../../logics/configs/fieldErrors.ts";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { FormRow } from "../_components/form_row/FormRow";
import { FieldProblem } from "../_components/field_problem/FieldProblem";

// Which server the local speech recognition (speech.cpp) uses, first in its part of the page,
// right under the engine choice (decided on 2026-11-27, #1266): the bundled server, or a server of
// one's own at its address. It was in 「詳細設定」 → 「リアルタイム字幕」, where a user who took a
// model from this page did not find it. The main switches always start the bundled servers they
// need (#1396, decided on 2026-11-28), so there is no choice about that here.
//
// It edits the realtime captions' settings (REALTIME_ASR_SETTINGS) as the captions' form in
// 「詳細設定」 does, each with a draft of its own: a save of one is the other's newer saved value,
// onto which its unsaved edits move (draftRebase.ts). Saves by itself (#1111): a choice at once,
// the address when focus leaves the form or on Enter.
export const AsrServer = () => {
    const { t } = useI18n();
    const { settings, error, send, updateError } = useRealtimeASR();
    const [problem, setProblem] = useState<string[] | null>(null);
    const write = (value: DraftWriteValue<RealtimeAsrSettings>) => saveSaidInline("/set/data/realtime_asr_settings",
        () => send("/set/data/realtime_asr_settings", value), setProblem);
    const form = useSettingsDraft(settings, error, updateError, { write });
    const { draft, change: setDraft, saving } = form;
    useEffect(() => { send("/get/data/realtime_asr_settings"); }, [send]);
    if (!draft) return null;
    const bundled = draft.server === "bundled";
    // A group of its own on the page's ground (SettingSection.css.ts), as a section's rows are.
    return <section data-setting-id="asr_server" data-settings-group className={styles.container} aria-label={t("speech_servers.asr_selection")}>
        <form aria-busy={saving} ref={form.group} onBlur={form.leave} onKeyDown={form.escape}
            onSubmit={event => { event.preventDefault(); form.commit(); }}>
            <FormRow label={t("speech_servers.asr_selection")} description={t("realtime.server_help")}>
                <select aria-label={t("speech_servers.asr_selection")} value={draft.server || "external"}
                    onChange={event => setDraft({ ...draft, server: event.target.value })}>
                    {["bundled", "external"].map(value => <option key={value} value={value}>{t(`speech_servers.${value}`)}</option>)}
                </select>
            </FormRow>
            {/* The address is typed: it saves when focus leaves the form, or on Enter. */}
            {!bundled && <FormRow label={t("realtime.url")}>
                <input readOnly={saving} aria-label={t("realtime.url")} value={draft.base_url}
                    onChange={event => form.setDraft({ ...draft, base_url: event.target.value })}
                    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); form.commit(); } }} />
            </FormRow>}
            {problem && <FieldProblem id="asr_server_problem" text={t(problem)} />}
        </form>
    </section>;
};
