import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import * as styles from "./VoiceSettings.css.ts";
import { ModelDownloads, HardwareReadout } from "./ModelDownloads";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { SetupSection } from "../_components/setup_section/SetupSection";
import { FormRow } from "../_components/form_row/FormRow";
import { HintCheck } from "../_components/hint/HintCheck";
import { CustomModelLink } from "../_components/custom_model_link/CustomModelLink";
import { pathExample } from "../../../../../../logics/common/pathExample";
import type { SpeechProfile, SpeechServerProfileSettings, SpeechServerRow, SpeechServerSettings } from "../../../../../../logics/voice/useSpeechServers";

// The path fields of a profile.
type PathField = "model" | "voice_file" | "vad_model" | "diarization_model";

// The file name in each path field's example.
const exampleFiles: Readonly<Record<PathField, string>> = { model: "model.gguf", voice_file: "voice.gguf", vad_model: "vad.gguf", diarization_model: "diarization.gguf" };

// Readout tone for a server state; the state text itself always says it.
// The start, as work that ends in success: it runs while the server prepares and is done once ready.
// A stop asked of a ready server is not a start, so it does not spin.
const serverProgress = (owner: SpeechServerRow | undefined, pending: unknown) => owner?.state === "ready" ? "done" :
    owner?.state === "preparing" || (pending && owner?.state !== "stopping" && owner?.state !== "failed") ? "working" : undefined;
const serverTone = (owner: SpeechServerRow | undefined, pending: unknown) => pending || owner?.state === "preparing" || owner?.state === "stopping" ? "warning" :
    owner?.error_code || owner?.state === "failed" ? "failed" : owner?.state === "ready" ? "active" : "neutral";

// The saved settings the form was drafted from. A draft exists only once they have arrived;
// without them the page stops with a TypeError, as reading their fields did before.
const savedSettings = (settings: SpeechServerSettings | null): SpeechServerSettings => {
    if (!settings) throw new TypeError("The speech server settings are not loaded.");
    return settings;
};

export interface SpeechServersProps {
    profiles?: readonly SpeechProfile[];
}

export const SpeechServers = ({ profiles = ["japanese", "multilingual", "asr"] }: SpeechServersProps) => {
    const { t } = useI18n();
    const { settings, state, devices, builds, pending, error, send, updateError } = useSpeechServers();
    // Paths are ["profiles", name, key]; a page shows only its own profiles.
    const label = ([, name, key]: string[]) => `${t(`speech_servers.${name}`)}: ${t(`speech_servers.${key}`, { defaultValue: key })}`;
    const form = useSettingsDraft(settings, error, updateError, { label,
        write: value => send("/set/data/speech_server_settings", value) });
    const { draft, setDraft, saving, dirty } = form;
    const pendingKey = JSON.stringify(pending);
    // TTS engines on one page share one GPU/memory reading and headroom choice.
    const [reserve, setReserve] = useState('vr');
    const tts = profiles.some(name => ["japanese", "multilingual"].includes(name));
    useEffect(() => {
        send("/get/data/speech_server_settings");
        send("/get/data/speech_server_state");
        send("/get/data/speech_server_devices");
    }, [send]);
    useEffect(() => {
        if (!Object.keys(pending).length) return;
        const timer = setTimeout(() => { updateError("speech_server_request_unconfirmed"); }, 5000);
        return () => clearTimeout(timer);
    }, [saving, pendingKey, updateError]);
    const field = (name: SpeechProfile, key: keyof SpeechServerProfileSettings, value: string | boolean) => setDraft(previous => previous && ({ ...previous,
        profiles: { ...previous.profiles, [name]: { ...previous.profiles[name], [key]: value } } }));
    const stateText = (name: SpeechProfile) => t(`speech_servers.state_${pending[name] ? "pending" : state[name]?.state ?? "unknown"}`);
    // Only the CPU and separate GPUs are choices; "auto" and "gpu" never pick an integrated GPU either.
    const separate = devices.filter(row => row.kind === "gpu");
    // "GPU" means a separate GPU, so it is offered only when one is listed, or when the list
    // could not be read here. A saved value is always kept in the list.
    const choices = (current: string) => ["auto", "cpu",
        ...(separate.length || builds.gpu_build !== "ready" || current === "gpu" ? ["gpu"] : [])];
    // A saved GPU stays selectable after it is unplugged, so saving never changes it silently.
    // An integrated GPU saved by an older version stays shown too, but cannot be picked again.
    const namedDevices = (current: string): (readonly [string, string, boolean])[] => {
        const rows = separate.map(row => [row.name, t("speech_servers.device_named", { label: row.label, name: row.name }), false] as const);
        if (["auto", "cpu", "gpu", ...separate.map(row => row.name)].includes(current)) return rows;
        const integrated = devices.find(row => row.name === current);
        return [...rows, integrated ? [current, t("speech_servers.device_integrated", { label: integrated.label, name: current }), true]
            : [current, t("speech_servers.device_missing", { name: current }), false]];
    };
    const configured = (name: SpeechProfile) => {
        const saved = settings?.profiles?.[name];
        return !!saved?.model?.trim() && (name !== "asr" || !!saved?.vad_model?.trim());
    };
    // Open by itself only when a server reports an error to fix in here.
    const attention = profiles.some(name => !!state[name]?.error_code || !!state[name]?.low_latency?.error_code);
    const summary = profiles.map(name => `${t(`speech_servers.${name}`)}: ${t(configured(name) ? "speech_servers.model_set" : "speech_servers.model_unset")} · ${stateText(name)}`).join(" / ");
    return <section className={styles.container} aria-label={t("speech_servers.title")}>
        <SetupSection title={t("speech_servers.setup_title")} desc={t("speech_servers.help")} status={summary} attention={attention}>
        {/* How to use a model file of your own instead of the default one. */}
        <CustomModelLink section={tts ? "tts" : "asr"} />
        {tts && <HardwareReadout reserve={reserve} setReserve={setReserve} />}
        {draft && <form onSubmit={event => {
            event.preventDefault(); if (dirty) form.submit(value => send("/set/data/speech_server_settings", value));
        }}>
            {profiles.map(name => {
                const row = draft.profiles[name], owner = state[name], saved = savedSettings(settings).profiles;
                const busy = saving || !!pending[name] || !owner || ["preparing", "ready", "stopping"].includes(owner.state);
                const pathField = (key: PathField) => <input value={row[key] ?? ""} disabled={busy} maxLength={4096} spellCheck={false}
                    placeholder={t("voice_ui.example", { value: pathExample(exampleFiles[key]) })}
                    onChange={event => field(name, key, event.target.value)} />;
                const input = (key: PathField) => <label key={key}>{t(`speech_servers.${key}`)}{pathField(key)}</label>;
                // What the device choices run on: which GPUs, then what "CPU" is on this platform
                // (a CPU build of its own on Linux, the one Vulkan build on Windows).
                const deviceHelp = [devices.length > 0 && t("speech_servers.device_help"),
                    (builds.cpu_build === "separate" || builds.cpu_build === "shared") && t(`speech_servers.cpu_build_${builds.cpu_build}`)]
                    .filter(Boolean).join("\n");
                // One server is a group with its subheading, not a frame inside the fold (#473).
                return <fieldset key={name} className={styles.group}>
                    <legend>{t(`speech_servers.${name}`)}</legend>
                    {input("model")}{input(name === "asr" ? "vad_model" : "voice_file")}
                    {/* Optional: with it the server also tells who speaks in the game audio captions. */}
                    {name === "asr" && <FormRow label={t("speech_servers.diarization_model")} description={t("speech_servers.diarization_help")}>
                        {pathField("diarization_model")}
                    </FormRow>}
                    {/* Other unsaved edits survive an apply; only an edited model path conflicts. */}
                    {/* The asr profile also takes a VAD file and a diarization file; "expected" names the field each target replaces. */}
                    <ModelDownloads targets={name === "asr" ? ["asr", "vad", "diarization"] : [name]} deviceMode={saved[name].device}
                        reserve={name === "asr" ? undefined : reserve} engines={name === "japanese"}
                        blocked={busy ? "busy" : row.model !== saved[name].model ||
                            (name === "asr" && (row.vad_model !== saved.asr.vad_model ||
                                row.diarization_model !== saved.asr.diarization_model)) ? "edited" : false}
                        expected={name === "asr" ? { asr: { model: saved.asr.model }, vad: { model: saved.asr.vad_model },
                                diarization: { model: saved.asr.diarization_model } }
                            : { [name]: { model: saved[name].model } }} />
                    <FormRow label={t("speech_servers.device")} description={deviceHelp || undefined}>
                        <select aria-label={t("speech_servers.device")} value={row.device} disabled={busy}
                            onChange={event => field(name, "device", event.target.value)}>
                            {choices(row.device).map(device => <option key={device} value={device}>{t(`speech_servers.${device}`)}</option>)}
                            {namedDevices(row.device).map(([value, text, kept]) => <option key={value} value={value} disabled={kept}>{text}</option>)}
                        </select>
                    </FormRow>
                    {/* The Vulkan build is bundled but does not start here (Linux without libvulkan.so.1).
                        The GPU choices stay selectable, so a saved one never changes silently. */}
                    {builds.gpu_build === "unavailable" && <EnvReadout tone="warning"><p>{t("speech_servers.gpu_build_unavailable")}</p></EnvReadout>}
                    {/* A checkbox in a form carries its name beside it, as on the other voice pages (#473). */}
                    {name === "japanese" && <HintCheck className={styles.checkLabel} label={t("speech_servers.low_latency")}
                        description={t("speech_servers.low_latency_help")} boxClassName={styles.fieldCheck}
                        checked={!!row.low_latency} disabled={busy} onChange={event => field(name, "low_latency", event.target.checked)} />}
                    {/* The server's buttons sit in the control column, under its fields (#473). */}
                    <div className={`${styles.actions} ${styles.control_column}`}><button type="button" className="primary" disabled={dirty || saving || busy || !row.model.trim() ||
                        (name === "asr" && !row.vad_model.trim()) || owner?.error_code === "speech_server_cleanup_unconfirmed"}
                        onClick={() => send("/run/start_speech_server", { profile: name, generation: owner?.generation })}>{t("speech_servers.start")}</button>
                    {/* Nothing to stop while the server is stopped (#473). A start still on its way can be stopped. */}
                    <button type="button" className={styles.quiet} disabled={!pending[name] && (!owner || ["stopped", "stopping"].includes(owner.state))}
                        onClick={() => send("/run/stop_speech_server", { profile: name })}>{t("speech_servers.stop")}</button></div>
                    <EnvReadout tone={serverTone(owner, pending[name])} progress={serverProgress(owner, pending[name])}>
                        <p>{stateText(name)}</p>
                        {owner?.low_latency && <p>{t(`speech_servers.low_latency_${owner.low_latency.state}`)}</p>}
                        {/* Runs other than asked: "auto" on the CPU build after the Vulkan build did not start. */}
                        {owner?.notice && <p>{t(`speech_servers.notices.${owner.notice}`, { defaultValue: "" })}</p>}
                    </EnvReadout>
                    {!!owner?.low_latency?.error_code && <p role="alert">{t("speech_servers.low_latency_failed")}</p>}
                    {/* The message says what to do; the code stays for reports. */}
                    {owner?.error_code && <p role="alert">{t(`speech_servers.errors.${owner.error_code}`, { defaultValue: "" })} <code className={styles.error_code}>{owner.error_code}</code></p>}
                </fieldset>;
            })}
        </form>}
        <div className={`${styles.actions} ${styles.control_column}`}>
            <button type="button" disabled={dirty || saving} onClick={() => { send("/get/data/speech_server_settings"); send("/get/data/speech_server_state"); }}>{t("speech_servers.reload")}</button>
        </div>
        </SetupSection>
        {/* The unsaved-changes dialog stays outside the fold so it shows while folded. */}
        {form.navigationDialog}
        {error && <p role="alert">{t([`speech_servers.errors.${error}`, `voice_ui.errors.${error}`], { defaultValue: error })}</p>}
    </section>;
};
