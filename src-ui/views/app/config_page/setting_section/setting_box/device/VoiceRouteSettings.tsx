import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { usesOutputDevice } from "../../../../../../logics/voice/routeState";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { SectionLabelComponent } from "../_components/section_label_component/SectionLabelComponent";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { Lead } from "../_components/lead/Lead";
import { FormRow } from "../_components/form_row/FormRow";
import { PageLinkButton } from "../_components/page_pointer/PagePointer";
import { voiceErrorText } from "../../../../../../logics/voice/voiceErrorText.ts";
import type { DraftWriteValue } from "../../../../../../logics/voice/useSettingsDraft";
import type { VoiceSettings } from "../../../../../../logics/voice/useVoice";

// The route the saved settings name: "external" or "managed", as the core sends it.
const routingOf = (settings: VoiceSettings): string | undefined => typeof settings.routing === "string" ? settings.routing : undefined;

export const VoiceRouteSummary = () => {
    const { t } = useI18n();
    const { settings } = useVoice();
    // A setting row like the others (#478): the label on the left, the route in use under it,
    // and the button that opens the Device page in the control column. The button names that
    // page (#537), so the line under the label only says the route. The route is in that
    // page's 「詳細設定」, so the page opens on it (#554).
    const route = settings ? t(`voice.routing_${settings.routing}`) : t("voice.loading");
    return <FormRow group label={t("voice.routing")} description={t("voice_ui.route_current", { route })} fold={false} keepDescription>
        <PageLinkButton tab="device" action={t("voice_ui.edit_route")} target="voice_route" />
    </FormRow>;
};

export const VoiceRouteControls = () => {
    const { t, i18n } = useI18n();
    const { route, error, send } = useVoice();
    const problem = error || route.error;
    return <>
        <FormRow group label={t("voice_ui.mute_row")} description={t("voice_ui.mute_row_description", { scope: t(route.managed ? "voice.mute_scope_managed" : route.covers_direct ? "voice.mute_scope_device" : "voice.mute_scope_external") })}>
            <button type="button" onClick={() => send("/run/mute_voice")}>{t("voice.mute")}</button>
            <button type="button" disabled={!route.ready || !!route.pending || !route.requested_muted} onClick={() => send("/run/resume_voice")}>{t("voice.resume")}</button>
        </FormRow>
        <EnvReadout tone={route.error ? "failed" : route.preparing || route.pending || !route.ready || route.observed_muted == null ? "neutral" : route.observed_muted ? "warning" : "active"}>
            {/* A device route has no OS gate to read back, so it cannot say "confirmed". */}
            <p>{t(route.preparing ? "voice.preparing_microphone" : route.error ? "voice.gate_error" : route.pending ? "voice.gate_pending" : !route.ready || route.observed_muted == null ? "voice.gate_unknown" :
                `voice.gate_${route.observed_muted ? "muted" : "open"}${route.covers_direct ? "_device" : ""}`)}</p>
        </EnvReadout>
        {/* The route's own codes (managed_setup_*) first, then the voice requests' (#460). */}
        {problem && <p role="alert">{voiceErrorText(String(problem), t("voice.routing"), t, key => i18n.exists(key), ["voice_setup_errors"])}</p>}
    </>;
};

// subheading: in the Device page's 「詳細設定」, the route is a group of that fold (#554).
export const VoiceRouteSettings = ({ subheading = false }: { subheading?: boolean }) => {
    const { t } = useI18n();
    const { settings, directState, directPending, error, updateError, send } = useVoice();
    const busy = !!directPending || !!directState.requested || !!directState.pending || !!directState.stopping || !directState.observation_id;
    // With patch, a write sends the changed fields, never an empty draft.
    const write = (value: DraftWriteValue<VoiceSettings>) => send("/set/data/voice_settings", value ?? undefined);
    const form = useSettingsDraft(settings, error, updateError, { label: ([key]) => t(`voice.${key}`, { defaultValue: key }),
        write, canSave: !busy, patch: true });
    useEffect(() => { send("/get/data/voice_settings"); }, [send]);
    return <section className={styles.container} aria-label={t("voice.routing")} data-setting-id="voice_route">
        {/* What the route is shared by and when it can change: the heading's line, or its hint on a page reviewed against #614. */}
        <SectionLabelComponent sub={subheading} label={t("voice.routing")} desc={t(usesOutputDevice(directState) ? "voice_ui.route_hint_device" : "voice_ui.route_hint")} />
        {form.draft && <form onSubmit={e => { e.preventDefault(); if (!busy && form.dirty) form.submit(write); }}>
            <label>{t("voice.routing")}<select aria-label={t("voice.routing")} value={routingOf(form.draft)} disabled={busy || form.saving}
                onChange={e => form.setDraft({ ...form.draft, routing: e.target.value })}>
                <option value="external">{t("voice.routing_external")}</option>
                {!usesOutputDevice(directState) && <option value="managed">{t("voice.routing_managed")}</option>}
            </select></label>
            {/* What to do in VRChat stays in view; how the microphone is prepared is its hint (#614). */}
            {form.draft.routing === "managed" && <Lead text={t("voice.managed_lead")} details={t("voice.managed_details")} />}
        </form>}
        {form.navigationDialog}
        <VoiceRouteControls />
    </section>;
};
