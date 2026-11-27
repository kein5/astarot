import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { GenerationOptions, currentModelOptions, validGenerationOptions } from "../tts/GenerationOptions";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { createLanguageNames } from "../../../../../../logics/common/languageNames.ts";
import { TtsEngine, validCoeiroinkOptions, validAudioQueryOptions } from "../tts/TtsEngine";
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
import { EngineCatalog } from "./EngineCatalog";
import { useCatalogLayout } from "./catalogLayout";
import type { TtsModelVoice, VoiceModelRole, VoiceSettings as VoiceSettingsValue } from "../../../../../../logics/voice/useVoice";
import { Button, Select, SelectOption, TextField } from "../../../../../kit/index.ts";

// The speech.cpp roles, each with its server and its voice.
const ROLES: readonly VoiceModelRole[] = ["japanese", "multilingual"];
const SPEECH_MODES = ["off", "original", "translated"] as const;

// Every field the page can make invalid: speech.cpp's seed and instructions, the installed
// engines' reading numbers.
const validVoiceSettings = (draft: VoiceSettingsValue) => validGenerationOptions(draft) && validCoeiroinkOptions(draft) && validAudioQueryOptions(draft);

// setup: the page's 「モデルとサーバー」, drawn after the voices it serves and before 「詳細設定」, as
// DESIGN.md orders a page (#1230).
//
// The page follows the speech recognition page's order (decided on 2026-11-27, #1266 ★17): the
// rows every reading needs first (what is read, the slot, the output), then each language's way to
// read (the engine, the server, the voice), then the speech.cpp models on this PC, then the
// external servers and the engines the user installed (their addresses and settings, and the
// engines' list), then the route and 「詳細設定」.
export const VoiceSettings = ({ setup }: { setup?: ReactNode } = {}) => {
    const { t, i18n } = useI18n();
    const hints = useHintDescriptions();
    const optionsErrorId = useId();
    const { settings, status, devices, error, send, updateError, modelOptions } = useVoice();
    // The bundled servers' runs, which the model options answer for (#1266).
    const { state: speechServers } = useSpeechServers();
    // The engines' list shares the catalogs' layout (#831).
    const layout = useCatalogLayout();
    // Saves by itself (#1111, decided 3): a choice at once, a slider when let go, typed text when
    // focus leaves the form or on Enter.
    const form = useSettingsDraft(settings, error, updateError, {
        write: value => send("/set/data/voice_settings", value), canSave: validVoiceSettings, patch: true });
    const { draft, setDraft, saving } = form;
    useEffect(() => {
        send("/get/data/voice_settings");
        send("/get/data/voice_output_devices");
    }, [send]);
    if (!draft) return <div>
        <p role="status">{error ? t("voice.error") : t("voice.loading")}</p>
        <Button onClick={() => send("/get/data/voice_settings")}>{t("voice.retry")}</Button>
    </div>;
    const field = (key: string, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
    // labelled: in a label of its own; a settings row (FormRow) labels it otherwise.
    const input = (key: string, labelled = true) => {
        const voice = key.endsWith("_voice");
        // The kit's TextField; an address is in the monospaced font (#476).
        const text = <TextField mono={!voice} aria-label={labelled ? undefined : t(`voice.${key}`)} value={voice && draft[key] === "none" ? "" : draft[key]}
            placeholder={voice ? t("voice_ui.voice_unset") : t("voice_ui.example", { value: "http://127.0.0.1:8080" })}
            onChange={e => field(key, voice && e.target.value === "" ? "none" : e.target.value)} maxLength={voice ? 128 : 512} />;
        return labelled ? <label>{t(`voice.${key}`)}{text}</label> : text;
    };
    // The voice of a language's speech.cpp model (decided on 2026-11-27, #1266): chosen from the
    // voices its server lists, once it has answered for these settings; typed as before until then.
    // A saved voice the model does not list stays chosen and says so, so nothing changes by itself.
    const names = createLanguageNames(i18n?.language);
    const voiceLabel = (voice: TtsModelVoice) => voice.name === "none" ? t("voice_ui.voice_none")
        : voice.language ? `${voice.name}（${names.fromCode(voice.language)}）` : voice.name;
    const voiceField = (role: VoiceModelRole) => {
        const key = `${role}_voice`, value = draft[key] ?? "";
        const voices = currentModelOptions({ role, saved: settings, draft, row: modelOptions[role], owner: speechServers[role] })?.voices ?? [];
        if (!voices.length) return <FormRow label={t(`voice.${key}`)} description={t("voice_ui.voice_list_hint")}>{input(key, false)}</FormRow>;
        return <FormRow label={t(`voice.${key}`)}>
            <Select aria-label={t(`voice.${key}`)} value={value} onChange={e => field(key, e.target.value)}>
                {!voices.some(voice => voice.name === value) &&
                    <SelectOption value={value}>{t("voice_ui.voice_not_listed", { name: value === "none" ? t("voice_ui.voice_none") : value })}</SelectOption>}
                {voices.map(voice => <SelectOption key={voice.name} value={voice.name}>{voiceLabel(voice)}</SelectOption>)}
            </Select>
        </FormRow>;
    };
    // The server of a language: the bundled one unless the settings name another, as the core reads
    // them (native/core/src/config/mod.rs, migrate_speech_servers).
    const serverOf = (role: VoiceModelRole) => draft[`${role}_server`] || "bundled";
    const server = (role: VoiceModelRole) => <label>{t(`speech_servers.${role}_selection`)}
        <Select aria-label={t(`speech_servers.${role}_selection`)} value={serverOf(role)} onChange={e => field(`${role}_server`, e.target.value)}>
            {["external", "bundled"].map(value => <SelectOption key={value} value={value}>{t(`speech_servers.${value}`)}</SelectOption>)}
        </Select>
    </label>;
    // speech.cpp makes the voice of this language: Japanese may come from an engine the user installed.
    const speechcpp = (role: VoiceModelRole) => role !== "japanese" || (draft.japanese_engine || "speechcpp") === "speechcpp";
    const deviceList = devices.devices || [];
    // What failed last, said under the form.
    const problem = error || status.last_error || devices.error;
    // The monitor never offers the virtual microphone's own endpoints or output.
    const monitorList = deviceList.filter(d => !d.id.startsWith("vrct.") && d.id !== (draft.routing === "managed" ? "" : draft.output_device));
    const micSpeechOn = draft.mic_mode === "original" || draft.mic_mode === "translated";
    // What the external part holds: an engine installed for Japanese, and the languages read by a
    // speech.cpp server of the user's own.
    const japaneseEngine = !speechcpp("japanese");
    const externalRoles = ROLES.filter(role => speechcpp(role) && serverOf(role) !== "bundled");
    // A reading turned on needs where it plays (the core refuses the settings without one): said
    // under the output device, not at the page's end (#1111, #1266 TT-1).
    const outputMissing = (draft.mode !== "off" || micSpeechOn) && draft.routing !== "managed" && !String(draft.output_device ?? "").trim();
    return <section className={styles.container} aria-label={t("voice.title")} data-setting-id="tts_settings">
        {/* What the page reads and how it starts: the heading's hint on a page that keeps descriptions out of sight (#614). */}
        <SectionLabelComponent label={t("config_page.tts.tts_settings.label")} desc={t("voice_ui.tts_description")} />
        <StatusLine tone={status.active ? "active" : "idle"} actions={<StopVoiceButton />}>
            {t(status.active ? "voice.playing" : "voice.idle")} · {t("voice.queued")}: {status.queued ?? 0}
        </StatusLine>
        <form {...form.groupProps} aria-busy={saving} onSubmit={e => { e.preventDefault(); form.commit(); }}>
            <fieldset className={styles.fields}>
                <label>{t("voice.mode")}<Select aria-label={t("voice.mode")} value={draft.mode} onChange={e => field("mode", e.target.value)}>
                    {SPEECH_MODES.map(mode => <SelectOption key={mode} value={mode}>{t(`voice.${mode}`)}</SelectOption>)}
                </Select></label>
                <label>{t("voice.target_slot")}<Select aria-label={t("voice.target_slot")} disabled={draft.mode !== "translated" && draft.mic_mode !== "translated"}
                    value={draft.target_slot} onChange={e => field("target_slot", e.target.value)}>
                    {["1", "2", "3"].map(slot => <SelectOption key={slot}>{slot}</SelectOption>)}
                </Select></label>
                <FormRow label={t("voice.output_device")} description={t("voice_ui.output_hint")}
                    actions={<Button onClick={() => send("/get/data/voice_output_devices")}>{t("voice.refresh")}</Button>}>
                    <Select aria-label={t("voice.output_device")} disabled={draft.routing === "managed"} value={draft.output_device}
                        onChange={e => field("output_device", e.target.value)}>
                        <SelectOption value="">{t("voice.select_output")}</SelectOption>
                        {draft.output_device && !deviceList.some(d => d.id === draft.output_device) &&
                            <SelectOption value={draft.output_device}>{t("voice.disconnected")}: {draft.output_device}</SelectOption>}
                        {deviceList.map(device => <SelectOption key={device.id} value={device.id}>{device.label}</SelectOption>)}
                    </Select>
                </FormRow>
                {/* What the core refuses the reading for, under the field it needs (#1266, TT-1). */}
                {outputMissing && <p role="alert">{t("voice_ui.output_required")}</p>}
                <VirtualMicEntry />
                {ROLES.map(role => <fieldset key={role} className={styles.group} aria-label={`${t(`speech_servers.${role}`)} · ${t("voice.title")}`}>
                    <legend>{t(`speech_servers.${role}`)}</legend>
                    {/* Japanese can also come from an engine the user installed (ADR-008); its settings are
                        with the external servers below, and replace speech.cpp's here. */}
                    {role === "japanese" && <TtsEngine part="choice" draft={draft} setDraft={setDraft} resetDraft={form.change} saved={settings} />}
                    {speechcpp(role) && <>{server(role)}{voiceField(role)}</>}
                </fieldset>)}
            </fieldset>
        </form>
        {/* A refusal is said under the form it refuses (#1111), before the parts that follow (#1266, TT-1). */}
        {!!problem && <p role="alert">{t("voice.error")}: {voiceErrorText(String(problem),
            t("config_page.tts.tts_settings.label"), t, key => i18n.exists(key))}</p>}
        {/* The models the voices above need on this PC (#1230), then the servers and engines outside
            it, then the route, which is changed on the Device page, after this page's own controls. */}
        <div className={styles.part} data-tts-part="local">
            <div data-setting-id="local_section">
                <SectionLabelComponent sub label={t("config_page.tts.local_section.label")} desc={t("config_page.tts.local_section.desc")} />
            </div>
            {setup}
        </div>
        <div className={styles.part} data-tts-part="external">
            <div data-setting-id="external_section">
                <SectionLabelComponent sub label={t("config_page.tts.external_section.label")} desc={t("config_page.tts.external_section.desc")} />
            </div>
            {(japaneseEngine || externalRoles.length > 0) && <form {...form.groupProps} aria-busy={saving} onSubmit={e => { e.preventDefault(); form.commit(); }}>
                <fieldset className={styles.fields}>
                    {/* The engine the user installed for Japanese: its address, whether it answers, its voice and reading. */}
                    {japaneseEngine && <fieldset className={styles.group} aria-label={`${t("speech_servers.japanese")} · ${t("voice_ui.engine.label")}`}>
                        <legend>{t("speech_servers.japanese")}</legend>
                        <TtsEngine part="details" draft={draft} setDraft={setDraft} resetDraft={form.change} saved={settings} />
                    </fieldset>}
                    {/* A speech.cpp server of the user's own: its address. */}
                    {externalRoles.map(role => <fieldset key={role} className={styles.group} aria-label={`${t(`speech_servers.${role}`)} · ${t("speech_servers.external")}`}>
                        <legend>{t(`speech_servers.${role}`)}</legend>
                        {input(`${role}_url`)}
                    </fieldset>)}
                </fieldset>
            </form>}
            {/* The engines a user installs, to choose above (ADR-008). */}
            <EngineCatalog layout={layout} />
        </div>
        <VoiceRouteSummary />
        <form {...form.groupProps} aria-busy={saving} onSubmit={e => { e.preventDefault(); form.commit(); }}>
            <fieldset className={styles.fields}>
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
                    <label>{t("voice.monitor")}<Select aria-label={t("voice.monitor")} value={draft.monitor || "off"} onChange={e => field("monitor", e.target.value)}>
                        <SelectOption value="off">{t("voice.monitor_off")}</SelectOption><SelectOption value="on">{t("voice.monitor_on")}</SelectOption>
                    </Select></label>
                    <label>{t("voice.monitor_device")}<Select aria-label={t("voice.monitor_device")} disabled={draft.monitor !== "on"} value={draft.monitor_device || ""}
                        onChange={e => field("monitor_device", e.target.value)}>
                        <SelectOption value="">{t("voice.monitor_default")}</SelectOption>
                        {draft.monitor_device && !monitorList.some(d => d.id === draft.monitor_device) &&
                            <SelectOption value={draft.monitor_device}>{t("voice.disconnected")}: {draft.monitor_device}</SelectOption>}
                        {monitorList.map(device => <SelectOption key={device.id} value={device.id}>{device.label}</SelectOption>)}
                    </Select></label>
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
                    <Select aria-label={t("voice.mic_mode")} value={draft.mic_mode || "off"} onChange={e => field("mic_mode", e.target.value)}>
                        {SPEECH_MODES.map(mode => <SelectOption key={mode} value={mode}>{t(`voice.${mode}`)}</SelectOption>)}
                    </Select>
                </FormRow>
                <label>{t("voice.direct_policy")}<Select aria-label={t("voice.direct_policy")} disabled={!micSpeechOn} value={draft.direct_policy || "suppress"}
                    onChange={e => field("direct_policy", e.target.value)}>
                    <SelectOption value="suppress">{t("voice.direct_suppress")}</SelectOption>
                    {/* Speech through the conversion replaces the voice; the two cannot mix (ADR-007). */}
                    <SelectOption value="mix" disabled={draft.conversion === "on"}>{t("voice.direct_mix")}</SelectOption>
                </Select></label>
                <FormRow label={t("voice.conversion")} description={t("voice.conversion_hint")}>
                    <Select aria-label={t("voice.conversion")} value={draft.conversion || "off"}
                        onChange={e => setDraft(current => ({ ...current, conversion: e.target.value,
                            // Mixing cannot go with it; suppressing the voice is the one choice left.
                            ...(e.target.value === "on" && current?.direct_policy === "mix" ? { direct_policy: "suppress" } : {}) }))}>
                        <SelectOption value="off">{t("voice.conversion_off")}</SelectOption><SelectOption value="on">{t("voice.conversion_on")}</SelectOption>
                    </Select>
                </FormRow>
                </AdvancedSection>
            </fieldset>
        </form>
        {!validGenerationOptions(draft) && <p id={optionsErrorId} role="alert">{t("voice_ui.invalid_options")}</p>}
    </section>;
};

// The TTS output device on its own, for pages other than TTS (the VRChat
// page). It edits the same voice settings and saves them by itself.
export const TtsOutputDeviceSettings = ({ title }: { title: string }) => {
    const { t } = useI18n();
    const { settings, devices, error, send, updateError } = useVoice();
    // Saves by itself (#1111): the device is a choice, saved at once.
    const form = useSettingsDraft(settings, error, updateError, {
        write: value => send("/set/data/voice_settings", value), canSave: validVoiceSettings, patch: true });
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
                    <Select aria-label={t("voice.output_device")} disabled={draft.routing === "managed"} value={draft.output_device}
                        onChange={e => setDraft(previous => ({ ...previous, output_device: e.target.value }))}>
                        <SelectOption value="">{t("voice.select_output")}</SelectOption>
                        {draft.output_device && !deviceList.some(d => d.id === draft.output_device) &&
                            <SelectOption value={draft.output_device}>{t("voice.disconnected")}: {draft.output_device}</SelectOption>}
                        {deviceList.map(device => <SelectOption key={device.id} value={device.id}>{device.label}</SelectOption>)}
                    </Select>
                </FormRow>
                <VirtualMicEntry />
            </fieldset>}
    </section>;
};
