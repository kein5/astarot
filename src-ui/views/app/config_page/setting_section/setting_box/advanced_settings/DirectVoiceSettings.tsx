import { useEffect, useId, useMemo, useState } from "react";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { VoiceRouteSummary, VoiceRouteControls } from "../device/VoiceRouteSettings";
import { SectionLabelComponent } from "../_components/section_label_component/SectionLabelComponent";
import * as styles from "./VoiceSettings.css.ts";
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
import { PageLinkButton, PagePointer } from "../_components/page_pointer/PagePointer";
import { Fold } from "../_components/fold/Fold";
import { voiceErrorText } from "../../../../../../logics/voice/voiceErrorText.ts";
import { CustomModelLink } from "../_components/custom_model_link/CustomModelLink";
import { FileDropZone } from "../_components/file_drop_zone/FileDropZone";
import { PathField } from "../_components/path_field/PathField";
import type { PathPick } from "../../../../../../logics/common/pickPath";
import { extensionOf } from "../../../../../../logics/common/fileDrop";
import { conversionDelaySeconds } from "../../../../../../logics/voice/conversionLatency";
import { pathExample } from "../../../../../../logics/common/pathExample";
import { DIRECTML_RUNTIME, MAX_RVC_THREADS, RVC_WORKER_DEFAULTS, rvcDevices, rvcStartOptions } from "../../../../../../logics/voice/rvcStartOptions";
import { useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { rvcAuditionValues } from "../../../../../../logics/voice/voiceAudition";
import type { DirectVoiceSelection, DirectVoiceVariant } from "../../../../../../logics/voice/directVoiceDraft";
import type { DirectVoiceSettings as SavedDirectVoice } from "../../../../../../logics/voice/useVoice";
import { Button, Select, SelectOption, Switch, TextField } from "../../../../../kit/index.ts";

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
// What each path is: the runtimes are folders; the models and the reference voice are files of
// one kind, which the file picker shows alone (#1231).
const PATH_PICKS: Readonly<Record<"runtime" | "reference" | "rvc_runtime" | "rvc_model" | "rvc_index", PathPick>> = {
    runtime: { kind: "folder" }, reference: { kind: "file", extensions: ["wav"] },
    rvc_runtime: { kind: "folder" }, rvc_model: { kind: "file", extensions: ["pth"] }, rvc_index: { kind: "file", extensions: ["index"] },
};
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
    // Whether the row on the TTS page's monitor ends the form. The RVC page draws it in its
    // 「詳細設定」 instead, as it is changed on another page (#1230).
    monitor?: boolean;
}

export const DirectVoiceSettings = ({ variant = "all", subheading = false, monitor = true }: DirectVoiceSettingsProps) => {
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
    // it; a save of the edits keeps the mode as saved (#436).
    const needsSelection = (draft: DirectVoiceDraft) => directSelectionPending(draft, directState.settings, variant);
    const form = useSettingsDraft(saved, directError, updateDirectError, {
        savedFromResponse: value => ({ ...defaults, ...answeredSettings(value) }),
        // Saves by itself (#1111, decided 3): a choice at once, numbers and paths when focus leaves
        // their group or on Enter, a dropped file or a runtime put to use at once.
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
    const highpassId = useId();
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
    // What the form cannot run without and is not set yet (#1230): the runtime and the model (RVC)
    // or the reference (Seed-VC) as saved, and the route its voice goes out on. Its setup starts open then.
    // Input forwarding is optional, in the RVC page's 「詳細設定」: its setup opens only for an error.
    const setupNeeded = variant !== "legacy" && ((converted && (rvc ? !savedPaths.rvc_runtime || !/\.pth$/i.test(savedPaths.rvc_model || "")
        : !savedPaths.runtime || !savedPaths.reference)) || (!!directState.observation_id && !(deviceRoute ? routeReady : managed)));
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
    // The pass-through under the voice changer's "More settings" (variant legacy) is named apart from
    // the voice changer's own input, which has the same controls (#1266, decided on 2026-11-27).
    const passThrough = variant === "legacy";
    const words = {
        title: passThrough ? "voice.passthrough_title" : "voice.input_title",
        source: passThrough ? "voice.passthrough_source" : "voice.input_source",
        start: passThrough ? "voice.passthrough_start" : "voice.input_start",
        stop: passThrough ? "voice.passthrough_stop" : "voice.input_stop",
    };
    // Its states and its setup by the same name.
    const PASS_THROUGH_STATES: Readonly<Record<string, string>> = { "voice.input_stopped": "voice.passthrough_stopped",
        "voice.input_active": "voice.passthrough_active", "voice.input_failed": "voice.passthrough_failed" };
    const shownStatus = passThrough ? PASS_THROUGH_STATES[status] ?? status : status;
    const intro = [t(variant === "rvc" ? "voice.vc_rvc_hint" : "voice.input_description"),
        (variant === "rvc" || (converted && rvc)) && t("voice_ui.rvc_latency_hint"), t("voice.input_scope")].filter(Boolean).join("\n");
    return <section className={styles.container} aria-label={variant === "rvc" ? t("config_page.rvc.rvc_settings.label") : t(words.title)} data-setting-id={variant === "rvc" ? "rvc_settings" : "direct_voice_settings"}>
        <SectionLabelComponent sub={subheading} label={variant === "rvc" ? t("config_page.rvc.rvc_settings.label") : t(words.title)} desc={intro} />
        <StatusLine tone={tone}>{t(shownStatus)}</StatusLine>
        {/* Where RVC converts and how far behind the voice it is, once it runs. */}
        {delay && <p>{t(delay.device === "cpu" ? "voice_ui.rvc_running_cpu" : "voice_ui.rvc_running_gpu", { seconds: delay.seconds })}</p>}
        {/* Selecting RVC is its own action: opening the page or saving other fields never switches the mode. */}
        {/* A row like the others (#478): the label on the left, its button in the control column.
            What the button switches is the label's hint (#614, #1013). */}
        {variant === "rvc" && needsSelection(draft) && <FormRow group label={t("voice_ui.select_rvc_label")} description={t("voice_ui.select_rvc_pending")}>
            <Button disabled={busy || saving || selecting} onClick={selectRvc}>{t("voice_ui.select_rvc")}</Button>
        </FormRow>}
        {/* A Seed-VC conversion saved by an earlier version was moved to RVC at this start. */}
        {variant !== "legacy" && directState.notice === "seed_vc_moved_to_rvc" && <p role="status">{t("voice_ui.seed_vc_moved_to_rvc")}</p>}
        {busy && !ownsInput && <p role="alert">{t("voice_ui.input_conflict")}</p>}
        {/* What the conversion cannot run without comes first, open while it is missing (#1230). */}
        {/* The setup in the order a first start takes it (decided on 2026-11-27, #1266 ★5): the runtime
            the conversion needs, the default voices, then what speeds it up on other GPUs, and last the
            files of one's own, folded with their paths, as on the speech recognition and text to speech
            pages (#1272). */}
        <SetupSection title={t(variant === "rvc" ? "voice_ui.setup_rvc" : passThrough ? "voice_ui.setup_passthrough" : "voice_ui.setup_input")} status={setupStatus} attention={!!error}
            needed={setupNeeded}>
            {/* The RVC page already opens with the RVC hint. */}
            {converted && variant !== "rvc" && <Description text={t(rvc ? "voice.vc_rvc_hint" : "voice.vc_hint")} />}
            {converted && <VcRuntimeSetup engine={rvc ? "rvc" : "seed-vc"} current={rvc ? draft.rvc_runtime : draft.runtime} disabled={busy || saving}
                onUse={path => form.change({ ...draft, [rvc ? "rvc_runtime" : "runtime"]: path })} />}
            {/* Other unsaved edits survive an apply; only edited model or index paths conflict. A
                card's audition records the user's voice from the input chosen on the page and converts it
                with the pitch and index rate on the form, saved or not (#415). */}
            {rvc && <ModelDownloads targets={["rvc"]} blocked={busy || saving ? "busy" :
                draft.rvc_model !== savedForm(saved).rvc_model || draft.rvc_index !== savedForm(saved).rvc_index ? "edited" : false}
                expected={{ rvc: { model: directState.settings?.rvc_model || "", index: directState.settings?.rvc_index || "" } }}
                audition={{ values: rvcAuditionValues(draft.rvc_pitch, draft.rvc_index_rate), input: source?.id ?? null }} />}
            {/* DirectML (Windows) needs its own runtime, shared with the translation; the worker finds it at Start.
                It speeds up the runtime above on other GPUs: offered once that runtime is set (#1266 R-6).
                What DirectML offers stays in one sentence; what it needs is that sentence's hint (#614). */}
            {converted && rvc && directmlOffered && !!savedPaths.rvc_runtime && <>
                <Lead text={t("voice_ui.rvc_directml_lead")} details={t("voice_ui.rvc_directml_details")} />
                <VcRuntimeSetup engine={DIRECTML_RUNTIME} disabled={busy || saving} />
            </>}
            {converted && <Fold size="link" className={styles.more} summary={t("speech_servers.own_model")} data-own-model={rvc ? "rvc" : "seed-vc"}>
                <fieldset className={styles.fields} aria-busy={saving} {...form.groupProps}>
                    {/* How to use a model or reference voice of your own. */}
                    <CustomModelLink section={rvc ? "rvc" : "seed-vc"} />
                    {/* Dropped files fill the model and index fields and save at once. */}
                    {rvc && <FileDropZone accept={[".pth", ".index"]} disabled={busy || saving} hint={t("voice_ui.rvc_drop_hint")}
                        onFiles={paths => {
                            const model = paths.find(path => extensionOf(path) === ".pth");
                            const index = paths.find(path => extensionOf(path) === ".index");
                            form.change(current => current && ({ ...current, ...(model && { rvc_model: model }), ...(index && { rvc_index: index }) }));
                        }} />}
                    {/* Each path is typed, pasted or picked (#1231): a picked one fills the field as typing does. */}
                    {(rvc ? (["rvc_runtime", "rvc_model", "rvc_index"] as const) : (["runtime", "reference"] as const)).map(name =>
                        <FormRow key={name} label={t(`voice.vc_${name}`)}>
                            <PathField value={draft[name]} disabled={busy} maxLength={4096} pick={PATH_PICKS[name]} label={t(`voice.vc_${name}`)}
                                placeholder={t("voice_ui.example", { value: pathExample(exampleFiles[name]) })}
                                onChange={value => setDraft({ ...draft, [name]: value })} />
                        </FormRow>)}
                </fieldset>
            </Fold>}
            {deviceRoute && !routeReady && <Description text={t("voice.input_requires_output")} />}
            {/* The route is unknown until the first state arrives, and Windows has no microphone to prepare. */}
            {directState.observation_id && !managed && !deviceRoute && <><Description text={t("voice.input_requires_managed")} />
                <div className={`${styles.actions} ${styles.control_column}`}>
                    <Button disabled={!settings || busy || saving}
                        onClick={() => send("/set/data/voice_settings", { ...settings, routing: "managed" })}>{t("voice.prepare_microphone")}</Button>
                </div>
                {error && <p role="alert">{errorText(error, ["voice_setup_errors"])}</p>}
            </>}
        </SetupSection>
        <fieldset className={styles.fields} aria-busy={saving} {...form.groupProps}>
        {variant === "all" && <label>{t("voice.direct_mode")}
            <Select aria-label={t("voice.direct_mode")} value={draft.mode} disabled={busy} onChange={e => setDraft({ ...draft, mode: e.target.value })}>
                <SelectOption value="passthrough">{t("voice.direct_passthrough")}</SelectOption>
                <SelectOption value="converted">{t("voice.direct_converted")}</SelectOption>
            </Select>
        </label>}
        {converted && rvc && ([["rvc_pitch", -24, 24, 1], ["rvc_index_rate", 0, 1, 0.05]] as const).map(([name, min, max, step]) =>
            <label key={name}>{t(`voice.vc_${name}`)}
                <TextField type="number" min={min} max={max} step={step} disabled={busy} className={styles.short_field}
                    placeholder={t("voice_ui.example", { value: exampleNumbers[name] })}
                    aria-describedby={!validNumbers(draft) ? numbersErrorId : undefined}
                    invalid={name === "rvc_pitch" ? !Number.isInteger(draft[name]) || Math.abs(draft[name]) > 24 :
                        !Number.isFinite(draft[name]) || draft[name] < 0 || draft[name] > 1}
                    value={Number.isFinite(draft[name]) ? draft[name] : ""}
                    onChange={e => setDraft({ ...draft, [name]: e.target.valueAsNumber })} />
            </label>)}
        {converted && rvc && !validNumbers(draft) && <p id={numbersErrorId} role="alert">{t("voice_ui.invalid_rvc_numbers")}</p>}
        {converted && rvc && draft.rvc_index_rate > 0 && !draft.rvc_index && <p role="alert">{t("voice_ui.rvc_index_required")}</p>}
        </fieldset>
        <FormRow label={t(words.source)} description={t(deviceRoute ? "voice.input_selection_hint_device" : "voice.input_selection_hint")}
            actions={<Button onClick={() => send("/get/data/direct_voice_sources")}>{t("voice.refresh_inputs")}</Button>}>
            <Select aria-label={t(words.source)} value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
                <SelectOption value="">{t("voice.select_input")}</SelectOption>
                {selected && !source && <SelectOption value={selected}>{t("voice.disconnected")}</SelectOption>}
                {sources.map(item => <SelectOption key={key(item.id)} value={key(item.id)}>{item.label}</SelectOption>)}
            </Select>
        </FormRow>
        {(managed || deviceRoute) && <VoiceRouteControls />}
        {/* In the control column, under the input it starts (#473, #478). */}
        <div className={`${styles.actions} ${styles.control_column}`}>
            <Button tone="primary" disabled={!!startBlocked} aria-describedby={startBlocked ? reasonId : undefined}
                onClick={() => source && send("/run/start_direct_voice", converted ? {
                    source: source.id, mode: "converted", options,
                } : { source: source.id })}>{t(words.start)}</Button>
            <Button tone="quiet" disabled={!ownsInput || !busy} onClick={() => send("/run/stop_direct_voice")}>{t(words.stop)}</Button>
        </div>
        {/* A disabled start says what it waits for, under the button in the control column (#1096). */}
        {startBlocked && !busy && <p id={reasonId} className={styles.control_column}>{t(`voice_ui.${startBlocked}`)}</p>}
        {/* How the worker converts, tuned rarely: after the controls that start it (#1230). */}
        {converted && rvc && <fieldset className={styles.fields} aria-busy={saving} {...form.groupProps}>
        {/* Where and how the worker converts; read at Start. */}
        {converted && rvc && <SetupSection title={t("voice_ui.rvc_worker_title")} desc={t("voice_ui.rvc_worker_hint")}
            status={t("voice_ui.rvc_worker_status", { device: t(`voice.vc_rvc_device_${draft.rvc_device}`, { defaultValue: draft.rvc_device }),
                threads: draft.rvc_threads ? draft.rvc_threads : t("voice_ui.rvc_threads_auto"),
                highpass: t(draft.rvc_highpass ? "voice_ui.rvc_highpass_on" : "voice_ui.rvc_highpass_off") })}>
            <label>{t("voice.vc_rvc_device")}
                <Select aria-label={t("voice.vc_rvc_device")} value={draft.rvc_device} disabled={busy}
                    onChange={e => setDraft({ ...draft, rvc_device: e.target.value })}>
                    {rvcDevices(directmlOffered, draft.rvc_device).map(device => <SelectOption key={device} value={device}>{t(`voice.vc_rvc_device_${device}`)}</SelectOption>)}
                </Select>
            </label>
            <label>{t("voice.vc_rvc_threads")}
                <TextField type="number" min={0} max={MAX_RVC_THREADS} step={1} disabled={busy} className={styles.short_field}
                    placeholder={t("voice_ui.example", { value: 4 })}
                    invalid={!validThreads(draft)} aria-describedby={!validNumbers(draft) ? numbersErrorId : undefined}
                    value={Number.isFinite(draft.rvc_threads) ? draft.rvc_threads : ""}
                    onChange={e => setDraft({ ...draft, rvc_threads: e.target.valueAsNumber })} />
            </label>
            {/* On or off: the kit's switch with its name beside it (K-02, decided on 2026-11-25); it saves at once. */}
            <label className={styles.checkLabel} htmlFor={highpassId}>
                <Switch id={highpassId} checked={!!draft.rvc_highpass} disabled={busy}
                    onCheckedChange={on => form.change({ ...draft, rvc_highpass: on })} />
                {t("voice.vc_rvc_highpass")}
            </label>
            {/* The length of each converted block is set on the advanced settings page: a row leads
                there (DESIGN.md "Roles in settings", #1266 R-5). */}
            <PagePointer label={t("config_page.advanced_settings.rvc_block_ms.label")} description={t("voice_ui.rvc_block_ms_pointer")}
                tab="advanced_settings" action={t("voice_ui.rvc_block_ms_action")} target="rvc_block_ms" />
        </SetupSection>}
        </fieldset>}
        {/* The route and the monitor are changed on other pages: after this page's own controls (#1230). */}
        <VoiceRouteSummary />
        {monitor && <VcMonitorRow converted={converted} />}
        {/* An unconfirmed save is not a reason the input cannot be forwarded: its sentence stands alone (#460). */}
        {!!unavailable && <p role="alert">{String(unavailable).startsWith("save_") ? "" : `${t("voice.input_error")}: `}{errorText(String(unavailable))}</p>}
    </section>;
};

// What the TTS page's monitor does for this voice. The setting has one place, the TTS page: a row
// says what it does here under its label (as VoiceRouteSummary does), and its button starts in the
// control column (#614, #1096). The monitor covers converted voice and is fixed at Start.
export const VcMonitorRow = ({ converted }: { converted: boolean }) => {
    const { t } = useI18n();
    const { settings, directState } = useVoice();
    return <>
        <FormRow group label={t("voice_ui.monitor_heading")}
            status={<span data-vc-monitor>{t(!converted ? "voice.vc_monitor_not_converted" : settings?.monitor === "on" ? "voice.monitor_on" : "voice.monitor_off")}</span>}
            description={t("voice.vc_monitor_help")} fold={false}>
            <PageLinkButton tab="tts" action={t("voice.vc_monitor_action")} target="tts_monitor" />
        </FormRow>
        {!!directState.monitor_error && <EnvReadout tone="failed"><p>{t(`voice.monitor_errors.${directState.monitor_error}`, { defaultValue: t("voice.monitor_error") })}</p></EnvReadout>}
    </>;
};
