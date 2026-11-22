import { useEffect, useId, useMemo, useState } from "react";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { VoiceRouteSummary, VoiceRouteControls } from "../device/VoiceRouteSettings";
import { SectionLabelComponent } from "../_components/section_label_component/SectionLabelComponent";
import styles from "./VoiceSettings.module.scss";
import { useI18n } from "@useI18n";
import { useVoice, sourceKey as key } from "../../../../../../logics/voice/useVoice";
import { directRouteReady, usesOutputDevice } from "../../../../../../logics/voice/routeState";
import { directRvcSelection, directSavedDraft, directSelectionPending, directShowsConversion } from "../../../../../../logics/voice/directVoiceDraft";
import { ModelDownloads } from "./ModelDownloads";
import { VcRuntimeSetup } from "./VcRuntimeSetup";
import { StatusLine } from "./StatusLine";
import { SetupSection } from "../_components/setup_section/SetupSection";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { Description } from "../_components/description/Description";
import { Lead } from "../_components/lead/Lead";
import { FormRow } from "../_components/form_row/FormRow";
import { voiceErrorText } from "../../../../../../logics/voice/voiceErrorText.ts";
import { CustomModelLink } from "../_components/custom_model_link/CustomModelLink";
import { FileDropZone } from "../_components/file_drop_zone/FileDropZone";
import { extensionOf } from "../../../../../../logics/common/fileDrop";
import { conversionDelaySeconds } from "../../../../../../logics/voice/conversionLatency";
import { pathExample } from "../../../../../../logics/common/pathExample";
import { DIRECTML_RUNTIME, MAX_RVC_THREADS, RVC_WORKER_DEFAULTS, rvcDevices, rvcStartOptions } from "../../../../../../logics/voice/rvcStartOptions";
import { useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { rvcAuditionValues } from "../../../../../../logics/voice/voiceAudition";
import type { DirectVoiceSelection, DirectVoiceVariant } from "../../../../../../logics/voice/directVoiceDraft";
import type { DirectVoiceSettings as SavedDirectVoice } from "../../../../../../logics/voice/useVoice";

// The direct voice form: the mode, Seed-VC's and RVC's paths and RVC's numbers.
interface DirectVoiceDraft extends DirectVoiceSelection {
    mode: string;
    runtime: string;
    reference: string;
    engine: string;
    rvc_runtime: string;
    rvc_model: string;
    rvc_index: string;
    rvc_pitch: number;
    rvc_index_rate: number;
    rvc_device: string;
    rvc_threads: number;
    rvc_highpass: boolean;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
// The saved settings the backend answers a write with ({settings}). Like the atoms' values they are
// declared, not checked. An answer that is not an object stops with a TypeError, as reading its
// settings did before.
const answeredSettings = (value: unknown): Partial<DirectVoiceDraft> | undefined => {
    if (!isRecord(value)) throw new TypeError("The answer to the direct voice settings is not an object.");
    return isRecord(value.settings) ? value.settings : undefined;
};
// The saved form. A draft exists only once it has arrived; without it the page stops with a
// TypeError, as reading its paths did before.
const savedForm = (saved: DirectVoiceDraft | null): DirectVoiceDraft => {
    if (!saved) throw new TypeError("The direct voice settings are not loaded.");
    return saved;
};

// RVC is the only conversion engine: Seed-VC ended with the Python backend (#391).
const defaults = { mode: "passthrough", runtime: "", reference: "", engine: "rvc",
    rvc_runtime: "", rvc_model: "", rvc_index: "", rvc_pitch: 0, rvc_index_rate: 0, ...RVC_WORKER_DEFAULTS } satisfies DirectVoiceDraft;
// The example in each path field (voice_ui.example), written the way this OS writes paths.
const exampleFiles = { runtime: "seed-vc-runtime", reference: "reference.wav",
    rvc_runtime: "rvc-runtime", rvc_model: "voice.pth", rvc_index: "voice.index" };
// The example a cleared number field shows: an octave up, and most of the index.
const exampleNumbers = { rvc_pitch: 12, rvc_index_rate: 0.75 };

// subheading: the form sits in a fold of its page (the RVC page's 「詳細設定」), so its title is
// a subheading there rather than the page's category heading (DESIGN.md "Roles in settings").
export interface DirectVoiceSettingsProps {
    variant?: DirectVoiceVariant;
    subheading?: boolean;
}

export const DirectVoiceSettings = ({ variant = "all", subheading = false }: DirectVoiceSettingsProps) => {
    const { t, i18n } = useI18n();
    // A code's sentence with the code kept for reports, as on the main screen (#460).
    // Both forms are on the RVC page: the conversion, and input forwarding in its 「詳細設定」 (#554, Q-07).
    const errorText = (code: string, first?: string[]) => voiceErrorText(code, t("config_page.side_menu_labels.rvc"),
        t, key => i18n.exists(key), first);
    const { settings, route, error, directState, directOwner, directPending, directSources, directError, updateDirectError, send, setDirectDraftBlocked,
        selectedSource: selected, setSelectedSource: setSelected } = useVoice();
    // The DirectML runtime is offered on Windows only; the runtime setup below loads the catalog.
    const { catalog: runtimeCatalog } = useVcRuntimes();
    const directmlOffered = !!runtimeCatalog?.runtimes?.some(row => row.id === DIRECTML_RUNTIME);
    const saved = useMemo<DirectVoiceDraft | null>(() => directSavedDraft(defaults, directState.settings, variant), [directState.settings, variant]);
    const busy = !!directPending || !!directState.requested || !!directState.pending || !!directState.stopping;
    const validThreads = (draft: DirectVoiceDraft) => Number.isInteger(draft.rvc_threads) && draft.rvc_threads >= 0 && draft.rvc_threads <= MAX_RVC_THREADS;
    const validNumbers = (draft: DirectVoiceDraft) => Number.isInteger(draft.rvc_pitch) && Math.abs(draft.rvc_pitch) <= 24 &&
        Number.isFinite(draft.rvc_index_rate) && draft.rvc_index_rate >= 0 && draft.rvc_index_rate <= 1 && validThreads(draft);
    // The RVC page edits converted RVC. Until it is selected the page offers a button for
    // it; the save bar only saves the edits, with the mode as saved (#436).
    const needsSelection = (draft: DirectVoiceDraft) => directSelectionPending(draft, directState.settings, variant);
    const label = ([name]: string[]) => t(name === "mode" ? "voice.direct_mode" : name === "engine" ? "voice.vc_engine" : `voice.vc_${name}`, { defaultValue: name });
    const form = useSettingsDraft(saved, directError, updateDirectError, { label,
        savedFromResponse: value => ({ ...defaults, ...answeredSettings(value) }),
        write: value => send("/set/data/direct_voice_settings", value), canSave: draft => !busy && validNumbers(draft) });
    const { draft, setDraft, saving, dirty } = form;
    const [selecting, setSelecting] = useState(false);
    const selectRvc = async () => {
        if (selecting || !directState.settings) return;
        setSelecting(true);
        try { await send("/set/data/direct_voice_settings", directRvcSelection(defaults, directState.settings)); }
        finally { setSelecting(false); }
    };
    const reasonId = useId();
    const numbersErrorId = useId();
    useEffect(() => {
        setDirectDraftBlocked(dirty || saving);
        return () => setDirectDraftBlocked(false);
    }, [dirty, saving, setDirectDraftBlocked]);
    useEffect(() => {
        send("/get/data/voice_settings");
        send("/get/data/direct_voice_sources");
        send("/get/data/direct_voice_state");
    }, [send]);
    if (!draft) return <p role="status">{t("voice.input_unknown")}</p>;
    const isRvc = directOwner === "rvc";
    const ownsInput = !!directOwner && (variant === "all" || (variant === "rvc" ? isRvc : !isRvc));
    const sources = directSources.sources || [];
    const source = sources.find(item => key(item.id) === selected);
    const managed = settings?.routing === "managed";
    const deviceRoute = usesOutputDevice(directState);
    const routeReady = directRouteReady(settings, directState);
    const unavailable = directSources.error || directError || directState.error;
    // Input forwarding only forwards; the conversion is the RVC page's.
    const converted = directShowsConversion(draft, variant);
    const rvc = variant === "rvc" || draft.engine === "rvc";
    const complete = !converted || (rvc ? (draft.rvc_runtime.trim() && /\.pth$/i.test(draft.rvc_model) &&
        (!draft.rvc_index || /\.index$/i.test(draft.rvc_index)) &&
        (!draft.rvc_index_rate || draft.rvc_index) && validNumbers(draft)) : (draft.runtime.trim() && draft.reference.trim()));
    const options = rvc ? rvcStartOptions(draft) : { runtime: draft.runtime, reference: draft.reference };
    let status = "voice.input_stopped";
    if (!directState.observation_id) status = "voice.input_unknown";
    else if (directState.error) status = "voice.input_failed";
    else if (directPending || directState.pending || directState.stopping) status = "voice.input_pending";
    else if (directState.active) status = directState.mode !== "converted" ? "voice.input_active" :
        directState.conversion_state === "idle" ? "voice.vc_idle" :
            directState.conversion_verified ? "voice.vc_active" : "voice.vc_ready";
    // The first thing start waits for, as a voice_ui key, or null when it can start.
    const startBlocked = !routeReady ? (deviceRoute ? "start_needs_output" : "start_needs_mic") : !source ? "start_needs_input" : !complete ? "start_needs_setup" :
        needsSelection(draft) ? "start_needs_rvc" : dirty || saving ? "start_needs_save" : !route.ready || route.pending || !directState.observation_id ? "start_waiting_route" :
        directSources.error ? "start_input_unavailable" : busy ? "start_running" : null;
    const savedPaths: SavedDirectVoice = directState.settings || {};
    const setupStatus = [
        ...(converted ? [t(rvc ? (savedPaths.rvc_runtime ? "voice_ui.runtime_set" : "voice_ui.runtime_unset") : (savedPaths.runtime ? "voice_ui.runtime_set" : "voice_ui.runtime_unset")),
            t((rvc ? /\.pth$/i.test(savedPaths.rvc_model || "") : !!savedPaths.reference) ? "speech_servers.model_set" : "speech_servers.model_unset")] : []),
        t(deviceRoute ? (routeReady ? "voice_ui.output_ready" : "voice_ui.output_unready") : managed ? "voice_ui.mic_ready" : "voice_ui.mic_unready"),
    ].join(" · ");
    const delay = isRvc && directState.mode === "converted" ? conversionDelaySeconds(directState) : null;
    const tone = status === "voice.input_failed" ? "failed" : status === "voice.input_pending" ? "pending" :
        ["voice.input_active", "voice.vc_idle", "voice.vc_active", "voice.vc_ready"].includes(status) ? "active" : "idle";
    // What the form is for, what to expect of the conversion before Start (on the GPU and, without
    // one, on the CPU) and what this input does not do: the heading's hint on a page that keeps
    // descriptions out of sight (#614), a paragraph under it elsewhere.
    const intro = [t(variant === "rvc" ? "voice.vc_rvc_hint" : "voice.input_description"),
        (variant === "rvc" || (converted && rvc)) && t("voice_ui.rvc_latency_hint"), t("voice.input_scope")].filter(Boolean).join("\n");
    return <section className={styles.container} aria-label={variant === "rvc" ? t("config_page.rvc.rvc_settings.label") : t("voice.input_title")} data-setting-id={variant === "rvc" ? "rvc_settings" : "direct_voice_settings"}>
        <SectionLabelComponent sub={subheading} label={variant === "rvc" ? t("config_page.rvc.rvc_settings.label") : t("voice.input_title")} desc={intro} />
        <StatusLine tone={tone}>{t(status)}</StatusLine>
        {/* Where RVC converts and how far behind the voice it is, once it runs. */}
        {delay && <p>{t(delay.device === "cpu" ? "voice_ui.rvc_running_cpu" : "voice_ui.rvc_running_gpu", { seconds: delay.seconds })}</p>}
        <VoiceRouteSummary />
        {/* Selecting RVC is its own action: opening the page or saving other fields never switches the mode. */}
        {/* A row like the others (#478): the note on the left, its button in the control column. The
            note says what the input uses now, so it stays in sight (#614). */}
        {variant === "rvc" && needsSelection(draft) && <FormRow group label={t("voice_ui.select_rvc_label")} description={t("voice_ui.select_rvc_pending")} fold={false} keepDescription>
            <button type="button" disabled={busy || saving || selecting} onClick={selectRvc}>{t("voice_ui.select_rvc")}</button>
        </FormRow>}
        {/* A Seed-VC conversion saved by an earlier version was moved to RVC at this start. */}
        {variant !== "legacy" && directState.notice === "seed_vc_moved_to_rvc" && <p role="status">{t("voice_ui.seed_vc_moved_to_rvc")}</p>}
        {busy && !ownsInput && <p role="alert">{t("voice_ui.input_conflict")}</p>}
        <fieldset className={styles.fields} disabled={saving}>
        {variant === "all" && <label>{t("voice.direct_mode")}
            <select aria-label={t("voice.direct_mode")} value={draft.mode} disabled={busy} onChange={e => setDraft({ ...draft, mode: e.target.value })}>
                <option value="passthrough">{t("voice.direct_passthrough")}</option>
                <option value="converted">{t("voice.direct_converted")}</option>
            </select>
        </label>}
        {converted && rvc && ([["rvc_pitch", -24, 24, 1], ["rvc_index_rate", 0, 1, 0.05]] as const).map(([name, min, max, step]) =>
            <label key={name}>{t(`voice.vc_${name}`)}
                <input type="number" min={min} max={max} step={step} disabled={busy}
                    placeholder={t("voice_ui.example", { value: exampleNumbers[name] })}
                    aria-describedby={!validNumbers(draft) ? numbersErrorId : undefined}
                    aria-invalid={name === "rvc_pitch" ? !Number.isInteger(draft[name]) || Math.abs(draft[name]) > 24 :
                        !Number.isFinite(draft[name]) || draft[name] < 0 || draft[name] > 1}
                    value={Number.isFinite(draft[name]) ? draft[name] : ""}
                    onChange={e => setDraft({ ...draft, [name]: e.target.valueAsNumber })} />
            </label>)}
        {converted && rvc && !validNumbers(draft) && <p id={numbersErrorId} role="alert">{t("voice_ui.invalid_rvc_numbers")}</p>}
        {converted && rvc && draft.rvc_index_rate > 0 && !draft.rvc_index && <p role="alert">{t("voice_ui.rvc_index_required")}</p>}
        {/* Where and how the worker converts; read at Start. */}
        {converted && rvc && <SetupSection title={t("voice_ui.rvc_worker_title")} desc={t("voice_ui.rvc_worker_hint")}
            status={t("voice_ui.rvc_worker_status", { device: t(`voice.vc_rvc_device_${draft.rvc_device}`, { defaultValue: draft.rvc_device }),
                threads: draft.rvc_threads ? draft.rvc_threads : t("voice_ui.rvc_threads_auto"),
                highpass: t(draft.rvc_highpass ? "voice_ui.rvc_highpass_on" : "voice_ui.rvc_highpass_off") })}>
            <label>{t("voice.vc_rvc_device")}
                <select aria-label={t("voice.vc_rvc_device")} value={draft.rvc_device} disabled={busy}
                    onChange={e => setDraft({ ...draft, rvc_device: e.target.value })}>
                    {rvcDevices(directmlOffered, draft.rvc_device).map(device => <option key={device} value={device}>{t(`voice.vc_rvc_device_${device}`)}</option>)}
                </select>
            </label>
            <label>{t("voice.vc_rvc_threads")}
                <input type="number" min={0} max={MAX_RVC_THREADS} step={1} disabled={busy}
                    placeholder={t("voice_ui.example", { value: 4 })}
                    aria-invalid={!validThreads(draft)} aria-describedby={!validNumbers(draft) ? numbersErrorId : undefined}
                    value={Number.isFinite(draft.rvc_threads) ? draft.rvc_threads : ""}
                    onChange={e => setDraft({ ...draft, rvc_threads: e.target.valueAsNumber })} />
            </label>
            <label className={styles.checkLabel}>
                <input type="checkbox" className={styles.fieldCheck} checked={!!draft.rvc_highpass} disabled={busy}
                    onChange={e => setDraft({ ...draft, rvc_highpass: e.target.checked })} />
                {t("voice.vc_rvc_highpass")}
            </label>
        </SetupSection>}
        </fieldset>
        <FormRow label={t("voice.input_source")} description={t(deviceRoute ? "voice.input_selection_hint_device" : "voice.input_selection_hint")}
            actions={<button type="button" onClick={() => send("/get/data/direct_voice_sources")}>{t("voice.refresh_inputs")}</button>}>
            <select aria-label={t("voice.input_source")} value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
                <option value="">{t("voice.select_input")}</option>
                {selected && !source && <option value={selected}>{t("voice.disconnected")}</option>}
                {sources.map(item => <option key={key(item.id)} value={key(item.id)}>{item.label}</option>)}
            </select>
        </FormRow>
        {(managed || deviceRoute) && <VoiceRouteControls />}
        {/* In the control column, under the input it starts (#473, #478). */}
        <div className={`${styles.actions} ${styles.control_column}`}>
            <button type="button" className="primary" disabled={!!startBlocked} aria-describedby={startBlocked ? reasonId : undefined}
                onClick={() => source && send("/run/start_direct_voice", converted ? {
                    source: source.id, mode: "converted", options,
                } : { source: source.id })}>{t("voice.input_start")}</button>
            <button type="button" className={styles.quiet} disabled={!ownsInput || !busy} onClick={() => send("/run/stop_direct_voice")}>{t("voice.input_stop")}</button>
        </div>
        {/* A disabled start says what it waits for. */}
        {startBlocked && !busy && <p id={reasonId}>{t(`voice_ui.${startBlocked}`)}</p>}
        <SetupSection title={t(variant === "rvc" ? "voice_ui.setup_rvc" : "voice_ui.setup_input")} status={setupStatus} attention={!!error}>
            {converted && <fieldset className={styles.fields} disabled={saving}>
                {/* The RVC page already opens with the RVC hint. */}
                {variant !== "rvc" && <Description text={t(rvc ? "voice.vc_rvc_hint" : "voice.vc_hint")} />}
                {/* Dropped files fill the model and index fields like typing them; saving stays with the save bar. */}
                {rvc && <FileDropZone accept={[".pth", ".index"]} disabled={busy || saving} hint={t("voice_ui.rvc_drop_hint")}
                    onFiles={paths => {
                        const model = paths.find(path => extensionOf(path) === ".pth");
                        const index = paths.find(path => extensionOf(path) === ".index");
                        setDraft(current => current && ({ ...current, ...(model && { rvc_model: model }), ...(index && { rvc_index: index }) }));
                    }} />}
                {(rvc ? (["rvc_runtime", "rvc_model", "rvc_index"] as const) : (["runtime", "reference"] as const)).map(name => <label key={name}>{t(`voice.vc_${name}`)}
                    <input type="text" value={draft[name]} disabled={busy} maxLength={4096}
                        placeholder={t("voice_ui.example", { value: pathExample(exampleFiles[name]) })}
                        onChange={e => setDraft({ ...draft, [name]: e.target.value })} />
                </label>)}
                {/* How to use a model or reference voice of your own. */}
                <CustomModelLink section={rvc ? "rvc" : "seed-vc"} />
            </fieldset>}
            {converted && <VcRuntimeSetup engine={rvc ? "rvc" : "seed-vc"} current={rvc ? draft.rvc_runtime : draft.runtime} disabled={busy || saving}
                onUse={path => setDraft({ ...draft, [rvc ? "rvc_runtime" : "runtime"]: path })} />}
            {/* DirectML (Windows) needs its own runtime, shared with the translation; the worker finds it at Start. */}
            {/* What DirectML offers stays in one sentence; what it needs is that sentence's hint (#614). */}
            {converted && rvc && directmlOffered && <>
                <Lead text={t("voice_ui.rvc_directml_lead")} details={t("voice_ui.rvc_directml_details")} />
                <VcRuntimeSetup engine={DIRECTML_RUNTIME} disabled={busy || saving} />
            </>}
            {/* Other unsaved edits survive an apply; only edited model or index paths conflict. A
                card's audition records the user's voice from the input chosen above and converts it
                with the pitch and index rate on the form, saved or not (#415). */}
            {rvc && <ModelDownloads targets={["rvc"]} blocked={busy || saving ? "busy" :
                draft.rvc_model !== savedForm(saved).rvc_model || draft.rvc_index !== savedForm(saved).rvc_index ? "edited" : false}
                expected={{ rvc: { model: directState.settings?.rvc_model || "", index: directState.settings?.rvc_index || "" } }}
                audition={{ values: rvcAuditionValues(draft.rvc_pitch, draft.rvc_index_rate), input: source?.id ?? null }} />}
            {deviceRoute && !routeReady && <Description text={t("voice.input_requires_output")} />}
            {/* The route is unknown until the first state arrives, and Windows has no microphone to prepare. */}
            {directState.observation_id && !managed && !deviceRoute && <><Description text={t("voice.input_requires_managed")} />
                <div className={`${styles.actions} ${styles.control_column}`}>
                    <button type="button" disabled={!settings || busy || saving}
                        onClick={() => send("/set/data/voice_settings", { ...settings, routing: "managed" })}>{t("voice.prepare_microphone")}</button>
                </div>
                {error && <p role="alert">{errorText(error, ["voice_setup_errors"])}</p>}
            </>}
        </SetupSection>
        {/* The unsaved-changes dialog stays outside the fold so it shows while folded. */}
        {form.navigationDialog}
        {/* The TTS monitor setting also covers converted voice; it is fixed at Start. */}
        <p>{t(!converted ? "voice.vc_monitor_passthrough" : settings?.monitor === "on" ? "voice.vc_monitor_on" : "voice.vc_monitor_off")}</p>
        {!!directState.monitor_error && <EnvReadout tone="failed"><p>{t(`voice.monitor_errors.${directState.monitor_error}`, { defaultValue: t("voice.monitor_error") })}</p></EnvReadout>}
        {/* An unconfirmed save is not a reason the input cannot be forwarded: its sentence stands alone (#460). */}
        {!!unavailable && <p role="alert">{String(unavailable).startsWith("save_") ? "" : `${t("voice.input_error")}: `}{errorText(String(unavailable))}</p>}
    </section>;
};
