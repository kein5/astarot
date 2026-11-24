import { useEffect, useId } from "react";
import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { GenerationOptions, validGenerationOptions } from "../tts/GenerationOptions";
import { TtsEngine, TTS_ENGINES, AUDIO_QUERY_ENGINES, validCoeiroinkOptions, validAudioQueryOptions } from "../tts/TtsEngine";
import { VoiceRouteSummary } from "../device/VoiceRouteSettings";
import { SectionLabelComponent } from "../_components/section_label_component/SectionLabelComponent";
import { StatusLine } from "./StatusLine";
import { StopVoiceButton } from "./StopVoiceButton";
import * as styles from "./VoiceSettings.css.ts";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { Description } from "../_components/description/Description";
import { FormRow } from "../_components/form_row/FormRow";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import { VirtualMicEntry } from "../tts/VirtualMicEntry";
import { voiceErrorText } from "../../../../../../logics/voice/voiceErrorText.ts";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import type { VoiceModelRole, VoiceSettings as VoiceSettingsValue } from "../../../../../../logics/voice/useVoice";
import { Button, TextField } from "../../../../../kit/index.ts";

// The speech.cpp roles, each with its server and its voice.
const ROLES: readonly VoiceModelRole[] = ["japanese", "multilingual"];
const SPEECH_MODES = ["off", "original", "translated"] as const;

// Every field the page can make invalid: speech.cpp's seed and instructions, the installed
// engines' reading numbers.
const validVoiceSettings = (draft: VoiceSettingsValue) => validGenerationOptions(draft) && validCoeiroinkOptions(draft) && validAudioQueryOptions(draft);

export const VoiceSettings = () => {
    const { t, i18n } = useI18n();
    const hints = useHintDescriptions();
    const optionsErrorId = useId();
    const { settings, status, devices, error, send, updateError } = useVoice();
    const label = ([key]: string[]) => {
        if (key === "japanese_engine") return t("voice_ui.engine.label");
        if (Object.values(TTS_ENGINES).some(engine => engine.url === key)) return t("voice_ui.engine.url");
        if (key.startsWith("engine_voice_")) return t("voice_ui.engine.voice");
        if (key.startsWith("coeiroink_")) return `COEIROINK: ${t(`voice_ui.engine.coeiroink.${key}`)}`;
        const reader = AUDIO_QUERY_ENGINES.find(engine => key.startsWith(`${engine}_`));
        if (reader) return `${TTS_ENGINES[reader].name}: ${t(`voice_ui.engine.audio_query.${key.slice(reader.length + 1)}`)}`;
        const role = ["japanese", "multilingual"].find(name => key.startsWith(`${name}_`));
        if (key === `${role}_server`) return t(`speech_servers.${role}_selection`);
        if (key === `${role}_seed`) return `${t(`speech_servers.${role}`)}: ${t("voice_ui.seed_mode")}`;
        if (key === `${role}_instructions`) return `${t(`speech_servers.${role}`)}: ${t("voice_ui.instruction")}`;
        return t(`voice.${key}`, { defaultValue: key });
    };
    // Saves by itself (#1111, decided 3): a choice at once, a slider when let go, typed text when
    // focus leaves the form or on Enter.
    const form = useSettingsDraft(settings, error, updateError, { label,
        write: value => send("/set/data/voice_settings", value), canSave: validVoiceSettings, patch: true, autoSave: true });
    const { setDraft, saving } = form;
    // The saved settings until the form's draft is made from them, a render later: the page does
    // not flash its loading line when they are already known (#912).
    const draft = form.draft ?? settings;
    useEffect(() => {
        send("/get/data/voice_settings");
        send("/get/data/voice_output_devices");
    }, [send]);
    if (!draft) return <div>
        <p role="status">{error ? t("voice.error") : t("voice.loading")}</p>
        <Button onClick={() => send("/get/data/voice_settings")}>{t("voice.retry")}</Button>
    </div>;
    const field = (key: string, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
    const input = (key: string) => {
        const voice = key.endsWith("_voice");
        return <label>{t(`voice.${key}`)}
            {/* The kit's TextField; an address is in the monospaced font (#476). */}
            <TextField mono={!voice} value={voice && draft[key] === "none" ? "" : draft[key]}
                placeholder={voice ? t("voice_ui.voice_unset") : t("voice_ui.example", { value: "http://127.0.0.1:8080" })}
                onChange={e => field(key, voice && e.target.value === "" ? "none" : e.target.value)} maxLength={voice ? 128 : 512} />
        </label>;
    };
    // The server of a language: the bundled one unless the settings name another, as the core reads
    // them (native/core/src/config/mod.rs, migrate_speech_servers).
    const serverOf = (role: VoiceModelRole) => draft[`${role}_server`] || "bundled";
    const server = (role: VoiceModelRole) => <label>{t(`speech_servers.${role}_selection`)}
        <select aria-label={t(`speech_servers.${role}_selection`)} value={serverOf(role)} onChange={e => field(`${role}_server`, e.target.value)}>
            {["external", "bundled"].map(value => <option key={value} value={value}>{t(`speech_servers.${value}`)}</option>)}
        </select>
    </label>;
    // speech.cpp makes the voice of this language: Japanese may come from an engine the user installed.
    const speechcpp = (role: VoiceModelRole) => role !== "japanese" || (draft.japanese_engine || "speechcpp") === "speechcpp";
    const deviceList = devices.devices || [];
    // What failed last, said under the form.
    const problem = error || status.last_error || devices.error;
    // The monitor never offers the virtual microphone's own endpoints or output.
    const monitorList = deviceList.filter(d => !d.id.startsWith("vrct.") && d.id !== (draft.routing === "managed" ? "" : draft.output_device));
    const micSpeechOn = draft.mic_mode === "original" || draft.mic_mode === "translated";
    return <section className={styles.container} aria-label={t("voice.title")} data-setting-id="tts_settings">
        {/* What the page reads and how it starts: the heading's hint on a page that keeps descriptions out of sight (#614). */}
        <SectionLabelComponent label={t("config_page.tts.tts_settings.label")} desc={t("voice_ui.tts_description")} />
        <StatusLine tone={status.active ? "active" : "idle"} actions={<StopVoiceButton />}>
            {t(status.active ? "voice.playing" : "voice.idle")} · {t("voice.queued")}: {status.queued ?? 0}
        </StatusLine>
        <VoiceRouteSummary />
        <form {...form.groupProps} aria-busy={saving} onSubmit={e => { e.preventDefault(); form.commit(); }}>
            <fieldset className={styles.fields}>
                <label>{t("voice.mode")}<select aria-label={t("voice.mode")} value={draft.mode} onChange={e => field("mode", e.target.value)}>
                    {SPEECH_MODES.map(mode => <option key={mode} value={mode}>{t(`voice.${mode}`)}</option>)}
                </select></label>
                <label>{t("voice.target_slot")}<select aria-label={t("voice.target_slot")} disabled={draft.mode !== "translated" && draft.mic_mode !== "translated"}
                    value={draft.target_slot} onChange={e => field("target_slot", e.target.value)}>
                    {["1", "2", "3"].map(slot => <option key={slot}>{slot}</option>)}
                </select></label>
                <FormRow label={t("voice.output_device")} description={t("voice_ui.output_hint")}
                    actions={<Button onClick={() => send("/get/data/voice_output_devices")}>{t("voice.refresh")}</Button>}>
                    <select aria-label={t("voice.output_device")} disabled={draft.routing === "managed"} value={draft.output_device}
                        onChange={e => field("output_device", e.target.value)}>
                        <option value="">{t("voice.select_output")}</option>
                        {draft.output_device && !deviceList.some(d => d.id === draft.output_device) &&
                            <option value={draft.output_device}>{t("voice.disconnected")}: {draft.output_device}</option>}
                        {deviceList.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
                    </select>
                </FormRow>
                <VirtualMicEntry />
                {ROLES.map(role => <fieldset key={role} className={styles.group} aria-label={`${t(`speech_servers.${role}`)} · ${t("voice.title")}`}>
                    <legend>{t(`speech_servers.${role}`)}</legend>
                    {/* Japanese can also come from an engine the user installed (ADR-008); its fields replace speech.cpp's. */}
                    {role === "japanese" && <TtsEngine draft={draft} setDraft={setDraft} resetDraft={form.change} saved={settings} />}
                    {speechcpp(role) && <>{server(role)}{serverOf(role) !== "bundled" && input(`${role}_url`)}{input(`${role}_voice`)}</>}
                </fieldset>)}
                {/* Set once to taste (#554): the monitor, how speech.cpp generates, reading the
                    microphone's captions aloud and the conversion. The line shows the first two. */}
                <AdvancedSection status={t("config_page.advanced_status.tts", {
                    monitor: t(draft.monitor === "on" ? "config_page.advanced_status.on" : "config_page.advanced_status.off"),
                    mic: t(micSpeechOn ? "config_page.advanced_status.on" : "config_page.advanced_status.off") })}>
                <fieldset className={styles.group} aria-label={t("voice_ui.monitor_heading")} data-setting-id="tts_monitor">
                    {/* What the monitor plays: the legend's hint, whose mark takes focus as a heading's does (#614). */}
                    <legend><span className={styles.hinted} data-hint-host={hints || undefined}><span>{t("voice_ui.monitor_heading")}</span>
                        {hints && <Hint text={t("voice.monitor_hint")} focusable />}</span></legend>
                    {!hints && <Description text={t("voice.monitor_hint")} />}
                    <label>{t("voice.monitor")}<select aria-label={t("voice.monitor")} value={draft.monitor || "off"} onChange={e => field("monitor", e.target.value)}>
                        <option value="off">{t("voice.monitor_off")}</option><option value="on">{t("voice.monitor_on")}</option>
                    </select></label>
                    <label>{t("voice.monitor_device")}<select aria-label={t("voice.monitor_device")} disabled={draft.monitor !== "on"} value={draft.monitor_device || ""}
                        onChange={e => field("monitor_device", e.target.value)}>
                        <option value="">{t("voice.monitor_default")}</option>
                        {draft.monitor_device && !monitorList.some(d => d.id === draft.monitor_device) &&
                            <option value={draft.monitor_device}>{t("voice.disconnected")}: {draft.monitor_device}</option>}
                        {monitorList.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
                    </select></label>
                    <label>{t("voice.monitor_volume")}: {draft.monitor_volume ?? "100"}%<input type="range" min="0" max="100" step="5" aria-label={t("voice.monitor_volume")}
                        style={{ "--range-fill": `${draft.monitor_volume ?? "100"}%` }}
                        disabled={draft.monitor !== "on"} value={draft.monitor_volume ?? "100"} onChange={e => field("monitor_volume", String(e.target.value))} /></label>
                    {!!status.monitor_error && <EnvReadout tone="failed"><p>{t(`voice.monitor_errors.${status.monitor_error}`, { defaultValue: t("voice.monitor_error") })}</p></EnvReadout>}
                </fieldset>
                {ROLES.filter(speechcpp).map(role => <fieldset key={role} className={styles.group}
                    aria-label={`${t(`speech_servers.${role}`)} · ${t("voice_ui.generation_heading")}`}>
                    <legend>{t(`speech_servers.${role}`)} · {t("voice_ui.generation_heading")}</legend>
                    <GenerationOptions errorId={optionsErrorId} role={role} draft={draft} field={field} />
                </fieldset>)}
                <FormRow label={t("voice.mic_mode")} description={t("voice.mic_hint")}>
                    <select aria-label={t("voice.mic_mode")} value={draft.mic_mode || "off"} onChange={e => field("mic_mode", e.target.value)}>
                        {SPEECH_MODES.map(mode => <option key={mode} value={mode}>{t(`voice.${mode}`)}</option>)}
                    </select>
                </FormRow>
                <label>{t("voice.direct_policy")}<select aria-label={t("voice.direct_policy")} disabled={!micSpeechOn} value={draft.direct_policy || "suppress"}
                    onChange={e => field("direct_policy", e.target.value)}>
                    <option value="suppress">{t("voice.direct_suppress")}</option>
                    {/* Speech through the conversion replaces the voice; the two cannot mix (ADR-007). */}
                    <option value="mix" disabled={draft.conversion === "on"}>{t("voice.direct_mix")}</option>
                </select></label>
                <FormRow label={t("voice.conversion")} description={t("voice.conversion_hint")}>
                    <select aria-label={t("voice.conversion")} value={draft.conversion || "off"}
                        onChange={e => setDraft(current => ({ ...current, conversion: e.target.value,
                            // Mixing cannot go with it; suppressing the voice is the one choice left.
                            ...(e.target.value === "on" && current?.direct_policy === "mix" ? { direct_policy: "suppress" } : {}) }))}>
                        <option value="off">{t("voice.conversion_off")}</option><option value="on">{t("voice.conversion_on")}</option>
                    </select>
                </FormRow>
                </AdvancedSection>
            </fieldset>
        </form>
        {!validGenerationOptions(draft) && <p id={optionsErrorId} role="alert">{t("voice_ui.invalid_options")}</p>}
        {form.navigationDialog}
        {/* The sentence says what to do; the code stays for reports. */}
        {!!problem && <p role="alert">{t("voice.error")}: {voiceErrorText(String(problem),
            t("config_page.tts.tts_settings.label"), t, key => i18n.exists(key))}</p>}
    </section>;
};

// The TTS output device on its own, for pages other than TTS (the VRChat
// page). It edits the same voice settings and saves them by itself.
export const TtsOutputDeviceSettings = ({ title }: { title: string }) => {
    const { t } = useI18n();
    const { settings, devices, error, send, updateError } = useVoice();
    // Saves by itself (#1111): the device is a choice, saved at once.
    const form = useSettingsDraft(settings, error, updateError, { label: ([key]) => t(`voice.${key}`, { defaultValue: key }),
        write: value => send("/set/data/voice_settings", value), canSave: validVoiceSettings, patch: true, autoSave: true });
    const { draft, setDraft, saving } = form;
    useEffect(() => {
        send("/get/data/voice_settings");
        send("/get/data/voice_output_devices");
    }, [send]);
    const deviceList = devices.devices || [];
    return <section className={styles.container} aria-label={title} data-setting-id="tts_output_device">
        <SectionLabelComponent label={title} />
        {!draft ? <p role="status">{error ? t("voice.error") : t("voice.loading")}</p> :
            <fieldset className={styles.fields} aria-busy={saving} {...form.groupProps}>
                <FormRow label={t("voice.output_device")} description={t("voice_ui.output_hint")}
                    actions={<Button onClick={() => send("/get/data/voice_output_devices")}>{t("voice.refresh")}</Button>}>
                    <select aria-label={t("voice.output_device")} disabled={draft.routing === "managed"} value={draft.output_device}
                        onChange={e => setDraft(previous => ({ ...previous, output_device: e.target.value }))}>
                        <option value="">{t("voice.select_output")}</option>
                        {draft.output_device && !deviceList.some(d => d.id === draft.output_device) &&
                            <option value={draft.output_device}>{t("voice.disconnected")}: {draft.output_device}</option>}
                        {deviceList.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
                    </select>
                </FormRow>
                <VirtualMicEntry />
            </fieldset>}
        {form.navigationDialog}
    </section>;
};
