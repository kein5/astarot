import { Fragment, useEffect, useState } from "react";
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
import { Fold } from "../_components/fold/Fold";
import { PathField as PathEntry } from "../_components/path_field/PathField";
import { pathExample } from "../../../../../../logics/common/pathExample";
import type { SpeechProfile, SpeechServerName, SpeechServerProfileSettings, SpeechServerRow, SpeechServerSettings } from "../../../../../../logics/voice/useSpeechServers";
import { listeningApart, recognitionServerRuns, sourcesByPath } from "../../../../../../logics/transcription/listeningModel";
import { Button } from "../../../../../kit/index.ts";

// The path fields of a profile.
type PathField = "model" | "voice_file" | "vad_model" | "diarization_model";

// The file name in each path field's example.
// Every path here is a GGUF file that speech.cpp reads.
const GGUF_FILE = { kind: "file", extensions: ["gguf"] } as const;
const exampleFiles: Readonly<Record<PathField, string>> = { model: "model.gguf", voice_file: "voice.gguf", vad_model: "vad.gguf", diarization_model: "diarization.gguf" };

// Readout tone for a server state; the state text itself always says it.
// The start, as work that ends in success: it runs while the server prepares and is done once ready.
// A stop asked of a ready server is not a start, so it does not spin.
const serverProgress = (owner: SpeechServerRow | undefined, pending: unknown) => owner?.state === "ready" ? "done" :
    owner?.state === "preparing" || (pending && owner?.state !== "stopping" && owner?.state !== "failed") ? "working" : undefined;
const serverTone = (owner: SpeechServerRow | undefined, pending: unknown) => pending || owner?.state === "preparing" || owner?.state === "stopping" ? "warning" :
    owner?.error_code || owner?.state === "failed" ? "failed" : owner?.state === "ready" ? "active" : "neutral";
// A server that runs, or is on its way to or from running, keeps the settings it started with.
const RUNNING: readonly string[] = ["preparing", "ready", "stopping"];

// The saved settings the form was drafted from. A draft exists only once they have arrived;
// without them the page stops with a TypeError, as reading their fields did before.
const savedSettings = (settings: SpeechServerSettings | null): SpeechServerSettings => {
    if (!settings) throw new TypeError("The speech server settings are not loaded.");
    return settings;
};

export interface SpeechServersProps {
    profiles?: readonly SpeechProfile[];
    // The page's feature uses a bundled server here whose model is not set yet (#1230): the fold
    // starts open, so the missing model is the first thing seen.
    needed?: boolean;
    // Drawn inside another page section (the TTS settings, before their 「詳細設定」, #1230): that
    // section's frame and spacing hold it, so it has no frame of its own.
    embedded?: boolean;
}

export const SpeechServers = ({ profiles = ["japanese", "multilingual", "asr"], needed = false, embedded = false }: SpeechServersProps) => {
    const { t } = useI18n();
    const { settings, state, devices, builds, pending, error, send, updateError } = useSpeechServers();
    // Saves by itself (#1111, decided 3): a choice at once, a path when focus leaves the form or on Enter.
    const form = useSettingsDraft(settings, error, updateError, {
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
    const stateText = (name: SpeechServerName) => t(`speech_servers.state_${pending[name] ? "pending" : state[name]?.state ?? "unknown"}`);
    // The servers a settings row runs (#1396, decided on 2026-11-28). The asr row runs Mic input's
    // server, and Listening's own while Listening has a model of its own in the saved settings
    // (#1242). Listening's server that still runs or is asked for is shown after its model was
    // taken away.
    const wanted = (name: SpeechProfile): SpeechServerName[] =>
        name === "asr" && listeningApart(settings?.profiles?.asr) ? ["asr", "asr_listening"] : [name];
    const active = (server: SpeechServerName) => !!pending[server] || RUNNING.includes(state[server]?.state ?? "");
    const shown = (name: SpeechProfile): SpeechServerName[] => {
        const servers = wanted(name);
        return name === "asr" && !servers.includes("asr_listening") && active("asr_listening") ? [...servers, "asr_listening"] : servers;
    };
    // With two servers in a row, each state says whose server it is: Mic input's or Listening's.
    const serverState = (name: SpeechProfile, server: SpeechServerName) =>
        shown(name).length > 1 ? t(`speech_servers.state_of_${server}`, { state: stateText(server) }) : stateText(server);
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
    // Held open while a server reports an error to fix in here; open at first while the page's
    // feature still needs a model set here (needed).
    const attention = profiles.some(name => shown(name).some(server => !!state[server]?.error_code || !!state[server]?.low_latency?.error_code));
    // Every server of a row is in its line (#1396): Listening's own server is not hidden behind Mic input's state.
    const summary = profiles.map(name => `${t(`speech_servers.${name}`)}: ${t(configured(name) ? "speech_servers.model_set" : "speech_servers.model_unset")} · ${
        shown(name).map(server => serverState(name, server)).join(" · ")}`).join(" / ");
    return <section className={embedded ? undefined : styles.container} aria-label={t("speech_servers.title")}>
        <SetupSection title={t("speech_servers.setup_title")} desc={t("speech_servers.help")} status={summary} attention={attention} needed={needed}>
        {tts && <HardwareReadout reserve={reserve} setReserve={setReserve} />}
        {draft && <form {...form.groupProps} aria-busy={saving} onSubmit={event => { event.preventDefault(); form.commit(); }}>
            {profiles.map(name => {
                const row = draft.profiles[name], owner = state[name], saved = savedSettings(settings).profiles;
                const servers = shown(name), recognizes = name === "asr";
                // A server that runs or prepares keeps its settings; Listening's own runs the asr row's
                // too. A save that waits does not turn the fields off, so focus stays where it was; a
                // download waits for it (busy).
                const locked = !owner || servers.some(active);
                const busy = saving || locked;
                // The kit's TextField, a path in the monospaced font (#476), beside the button that
                // picks a GGUF file (#1231).
                const pathField = (key: PathField) => <PathEntry value={row[key] ?? ""} disabled={locked} maxLength={4096}
                    pick={GGUF_FILE} label={t(`speech_servers.${key}`)}
                    placeholder={t("voice_ui.example", { value: pathExample(exampleFiles[key]) })}
                    onChange={value => field(name, key, value)} />;
                const input = (key: PathField) => <FormRow key={key} label={t(`speech_servers.${key}`)}>{pathField(key)}</FormRow>;
                // What the device choices run on: which GPUs, then what "CPU" is on this platform
                // (a CPU build of its own on Linux, the one Vulkan build on Windows).
                const deviceHelp = [devices.length > 0 && t("speech_servers.device_help"),
                    (builds.cpu_build === "separate" || builds.cpu_build === "shared") && t(`speech_servers.cpu_build_${builds.cpu_build}`)]
                    .filter(Boolean).join("\n");
                // One server is a group with its subheading, not a frame inside the fold (#473). The
                // default models' download comes first; the paths of a model of one's own follow in
                // a closed fold with the guide to them (decided on 2026-11-27, #1266).
                return <fieldset key={name} className={styles.group}>
                    <legend>{t(`speech_servers.${name}`)}</legend>
                    {/* Other unsaved edits survive an apply; only an edited model path conflicts. */}
                    {/* The asr profile also takes a VAD file and a diarization file; "expected" names the field each target replaces. */}
                    <ModelDownloads targets={name === "asr" ? ["asr", "vad", "diarization"] : [name]} deviceMode={saved[name].device}
                        reserve={name === "asr" ? undefined : reserve}
                        blocked={busy ? "busy" : row.model !== saved[name].model ||
                            (name === "asr" && (row.vad_model !== saved.asr.vad_model ||
                                row.diarization_model !== saved.asr.diarization_model)) ? "edited" : false}
                        expected={name === "asr" ? { asr: { model: saved.asr.model }, vad: { model: saved.asr.vad_model },
                                diarization: { model: saved.asr.diarization_model } }
                            : { [name]: { model: saved[name].model } }}
                        // A recognition model is chosen for each input (#1308 ★1): above the catalog
                        // (SourceModels), and from its card, which downloads it, says which inputs use
                        // it and chooses it for an input with the fields' check and apply.
                        chooseIn={name === "asr" ? ["asr"] : undefined} usedBy={name === "asr" ? sourcesByPath(saved.asr) : undefined}
                        inputs={name === "asr" ? { paths: { mic: saved.asr.model, speaker: saved.asr.listening_model ?? "" },
                            running: recognitionServerRuns(state) } : undefined} />
                    <Fold size="link" className={styles.more} summary={t("speech_servers.own_model")} data-own-model={name}>
                        {/* How to use a model file of your own instead of the default one. */}
                        <CustomModelLink section={tts ? "tts" : "asr"} />
                        {input("model")}{input(name === "asr" ? "vad_model" : "voice_file")}
                        {/* Optional: with it the server also tells who speaks in the Listening captions. */}
                        {name === "asr" && <FormRow label={t("speech_servers.diarization_model")} description={t("speech_servers.diarization_help")}>
                            {pathField("diarization_model")}
                        </FormRow>}
                    </Fold>
                    <FormRow label={t("speech_servers.device")} description={deviceHelp || undefined}>
                        <select aria-label={t("speech_servers.device")} value={row.device} disabled={locked}
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
                        checked={!!row.low_latency} disabled={locked} onChange={event => field(name, "low_latency", event.target.checked)} />}
                    {/* The server's buttons sit in the control column, under its fields (#473). The speech
                        recognition servers have none: the main switches start and stop them (#1396, decided on
                        2026-11-28), and a server that hangs is started again by turning its switch off and on. */}
                    {!recognizes && <div className={`${styles.actions} ${styles.control_column}`}><Button tone="primary" disabled={dirty || saving || busy ||
                        !row.model.trim() || owner?.error_code === "speech_server_cleanup_unconfirmed"}
                        onClick={() => send("/run/start_speech_server", { profile: name, generation: owner?.generation })}>{t("speech_servers.start")}</Button>
                    {/* Nothing to stop while the server is stopped (#473). A start still on its way can be stopped. */}
                    <Button tone="quiet" disabled={!pending[name] && (!owner || ["stopped", "stopping"].includes(owner.state))}
                        onClick={() => send("/run/stop_speech_server", { profile: name })}>{t("speech_servers.stop")}</Button></div>}
                    {/* One readout for each server of the row, each with its own state and, under it, its
                        own failure (#1396). */}
                    {servers.map(server => {
                        const run = state[server];
                        return <Fragment key={server}>
                            <EnvReadout tone={serverTone(run, pending[server])} progress={serverProgress(run, pending[server])}>
                                <p>{serverState(name, server)}</p>
                                {run?.low_latency && <p>{t(`speech_servers.low_latency_${run.low_latency.state}`)}</p>}
                                {/* Runs other than asked: "auto" on the CPU build after the Vulkan build did not start. */}
                                {run?.notice && <p>{t(`speech_servers.notices.${run.notice}`, { defaultValue: "" })}</p>}
                            </EnvReadout>
                            {!!run?.low_latency?.error_code && <p role="alert">{t("speech_servers.low_latency_failed")}</p>}
                            {/* The message says what to do; the code stays for reports. */}
                            {/* In the screen's words, never the raw code (#1266); a code without words says itself.
                                A speech recognition server's failure is said in its switch's words, which turn the
                                switch on again, since nothing here starts it (#1396). */}
                            {run?.error_code && <p role="alert">{t([...(recognizes ? [`realtime_toggle.${run.error_code}`] : []),
                                `speech_servers.errors.${run.error_code}`], { defaultValue: "" }) || run.error_code}</p>}
                        </Fragment>;
                    })}
                </fieldset>;
            })}
        </form>}
        <div className={`${styles.actions} ${styles.control_column}`}>
            <Button disabled={dirty || saving} onClick={() => { send("/get/data/speech_server_settings"); send("/get/data/speech_server_state"); }}>{t("speech_servers.reload")}</Button>
        </div>
        </SetupSection>
        {error && <p role="alert">{t([`speech_servers.errors.${error}`, `voice_ui.errors.${error}`], { defaultValue: error })}</p>}
    </section>;
};
