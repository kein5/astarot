import type { SettingDefinition } from "./initializationFields.ts";

// An atom value of the store: "pending" while a request it waits for is unanswered.
export interface PendingValue<T = unknown> {
    state: string;
    data: T;
}

// One entry of a weight download list (selectable_*_type_dict).
export interface PendingDownloadItem {
    id: string;
    is_pending?: boolean;
    progress?: number | null;
}

// A download request names the weight directly or as { weight_type }.
export type PendingDownloadRequest = string | { weight_type?: string } | null | undefined;

// Recovery never invokes a success handler: pending atoms already retain the
// last confirmed data. Only a terminal failure or process exit releases them.
export const restorePendingValue = <V extends PendingValue>(value: V): V => value.state === "pending" ? { ...value, state: "ok" } : value;

// No optimistic completion: downloaded flags stay exactly as last confirmed.
export function restoreDownloadPending<V extends PendingValue<PendingDownloadItem[]>>(value: V, request: PendingDownloadRequest, all = false): V {
    const id = typeof request === "object" && request !== null ? request.weight_type : request;
    let changed = false;
    const data = value.data.map(item => {
        if ((all || (id !== undefined && item.id === id)) && (item.is_pending || item.progress != null)) {
            changed = true;
            return { ...item, is_pending: false, progress: null };
        }
        return item;
    });
    const restored = restorePendingValue(value);
    return changed ? { ...restored, data } : restored;
}

// Which requests release which atom, and the GET that reads it again.
export interface PendingControlSpec {
    endpoints: readonly string[];
    read?: string;
    // Weight downloads: failures release only the refused item.
    download?: boolean;
    // Requests that may run side by side; a failure is not tied to the latest send.
    parallel?: boolean;
}

// Releases the pending atom: (request, all, publish). Returns whether the atom changed or was published.
export type PendingRestore = (request?: unknown, all?: boolean, publish?: boolean) => boolean;

export const staticPendingControls = {
    TranslationStatus: { endpoints: ["/set/enable/translation", "/set/disable/translation"] },
    TranscriptionSendStatus: { endpoints: ["/set/enable/transcription_send", "/set/disable/transcription_send"] },
    TranscriptionReceiveStatus: { endpoints: ["/set/enable/transcription_receive", "/set/disable/transcription_receive"] },
    OcrCaptureStatus: { endpoints: ["/set/enable/ocr_capture", "/set/disable/ocr_capture"] },
    MicThresholdCheckStatus: { endpoints: ["/set/enable/check_mic_threshold", "/set/disable/check_mic_threshold"] },
    SpeakerThresholdCheckStatus: { endpoints: ["/set/enable/check_speaker_threshold", "/set/disable/check_speaker_threshold"] },
    IsLMStudioConnected: { endpoints: ["/run/lmstudio_connection", "/get/data/connected_lmstudio"], read: "/get/data/connected_lmstudio" },
    IsOllamaConnected: { endpoints: ["/run/ollama_connection", "/get/data/connected_ollama"], read: "/get/data/connected_ollama" },
    Hotkeys: { endpoints: ["/get/data/hotkeys", "/set/data/hotkeys"], read: "/get/data/hotkeys" },
    SoftwareVersion: { endpoints: ["/get/data/version"] },
} satisfies Record<string, PendingControlSpec>;

// Settings the backend has no GET for (none now: the core answers /get/data/ollama_url).
const settingsWithoutRead = new Set<string>([]);

export function settingPendingControl(setting: SettingDefinition): PendingControlSpec {
    const name = setting.base_endpoint_name;
    // Keep per-item progress/completion; failures identify just the refused item.
    if (setting.logics_template_id === "weight_download_status") {
        const read = `/get/data/selectable_${name}_type_dict`;
        return { endpoints: [`/run/download_${name}`, read], read, download: true, parallel: true };
    }
    const read = `/get/data/${name}`;
    const endpoints = [read];
    if (setting.logics_template_id === "toggle_enable_disable") {
        endpoints.push(`/set/enable/${name}`, `/set/disable/${name}`);
    } else if (!["get_only", "get_list"].includes(setting.logics_template_id)) {
        endpoints.push(`/set/data/${name}`);
        if (setting.logics_template_id === "get_set_delete") endpoints.push(`/delete/data/${name}`);
    }
    return { endpoints, read: settingsWithoutRead.has(name) ? undefined : read };
}

// Feature-specific handlers still own their errors and generations. These
// setting writes additionally need a read after an exception may partly apply.
export const featureResyncReads: Readonly<Record<string, string>> = {
    "/set/data/voice_settings": "/get/data/voice_settings",
    "/set/data/speech_server_settings": "/get/data/speech_server_settings",
    "/set/data/realtime_asr_settings": "/get/data/realtime_asr_settings",
    "/run/start_model_download": "/get/data/model_download_state",
    "/run/check_model_download": "/get/data/model_download_state",
    "/run/cancel_model_download": "/get/data/model_download_state",
    "/run/apply_model_download": "/get/data/model_download_state",
    "/run/refresh_model_download_hardware": "/get/data/model_download_hardware",
    "/run/register_user_model": "/get/data/user_models",
    "/run/remove_user_model": "/get/data/user_models",
    "/run/apply_user_model": "/get/data/user_models",
    "/run/register_translation_catalog_entry": "/get/data/translation_catalog",
    "/run/remove_translation_catalog_entry": "/get/data/translation_catalog",
    "/run/use_translation_catalog_entry": "/get/data/translation_catalog",
    "/run/register_transcription_catalog_entry": "/get/data/transcription_catalog",
    "/run/remove_transcription_catalog_entry": "/get/data/transcription_catalog",
    "/run/use_transcription_catalog_entry": "/get/data/transcription_catalog",
};

// An atom with requests to release, or only something to do when the session stops.
export interface PendingControlRegistration extends Partial<PendingControlSpec> {
    restore?: PendingRestore;
    stop?: () => unknown;
}

export type RegisterPendingControl = {
    (registration: Partial<PendingControlSpec> & { restore: PendingRestore; stop?: () => unknown }): void;
    (registration: { stop: () => unknown }): void;
};

// A backend reply as the recovery reads it (docs/spec/ipc-protocol.md).
export interface BackendResponse {
    endpoint: string;
    status: number;
    result?: unknown;
}

// Sends a request to the backend; false (or a rejection) when it could not be sent.
export type BackendSend = (endpoint: string) => unknown;

export interface PendingRequestRecovery {
    register: RegisterPendingControl;
    beginSend(endpoint: string): number | undefined;
    failSend(endpoint: string, value: unknown, version: number | undefined): boolean;
    acceptResponse(endpoint: string): boolean;
    receive(response: BackendResponse, send: BackendSend): void;
    stop(): void;
}

interface PendingControl {
    read: string | undefined;
    restore: PendingRestore;
    version: number;
    parallel: boolean;
}

interface PendingRead {
    control: PendingControl;
    version: number;
    again?: () => void;
}

export function createPendingRequestRecovery(): PendingRequestRecovery {
    const controls = new Map<string, PendingControl>(), restorers = new Set<() => unknown>(), reads = new Map<string | undefined, PendingRead>();
    const register: RegisterPendingControl = ({ endpoints = [], read, restore, stop = restore, parallel = false }: PendingControlRegistration) => {
        // RegisterPendingControl requires restore or stop, and stop falls back to restore.
        if (stop) restorers.add(stop);
        // Only a registration with restore has endpoints, so a control without it is never stored.
        if (!restore) return;
        const control: PendingControl = { read, restore, version: 0, parallel };
        for (const endpoint of endpoints) controls.set(endpoint, control);
    };
    const beginSend = (endpoint: string) => {
        const control = controls.get(endpoint);
        if (control && endpoint !== control.read) control.version++;
        return control?.version;
    };
    const failSend = (endpoint: string, value: unknown, version: number | undefined) => {
        const control = controls.get(endpoint);
        if (!control || (!control.parallel && version !== undefined && control.version !== version)) return false;
        return control.restore(value, false, !endpoint.startsWith("/get/"));
    };
    const resync = (control: PendingControl, send: BackendSend) => {
        const previous = reads.get(control.read);
        if (previous) { previous.again = () => resync(control, send); return; }
        const reading: PendingRead = { control, version: control.version };
        reads.set(control.read, reading);
        const failed = () => {
            if (reads.get(control.read) !== reading) return;
            reads.delete(control.read);
            reading.again?.();
        };
        // resync runs only for a control with a read, which is what send() is given.
        const read = control.read;
        if (read === undefined) return;
        try { Promise.resolve(send(read)).then(sent => { if (sent === false) failed(); }, failed); }
        catch { failed(); }
    };
    const acceptResponse = (endpoint: string) => {
        const reading = reads.get(endpoint);
        if (!reading) return true;
        reads.delete(endpoint);
        if (reading.again) { reading.again(); return false; }
        // A recovery GET may overtake a later write. Do not clear that write's
        // pending state or replace its value with the older read's result.
        return reading.version === reading.control.version;
    };
    const receive = ({ endpoint, status, result }: BackendResponse, send: BackendSend) => {
        // 403: the backend refused a request relayed for the VR panel (models/vr_panel_policy.py).
        if (![403, 404, 423, 500].includes(status)) return;
        const control = controls.get(endpoint);
        if (!control) return;
        control.restore((result as { data?: unknown } | null | undefined)?.data, false, true);
        // Never retry a write, nor recursively retry a failed recovery GET.
        if (status === 500 && control.read && control.read !== endpoint) {
            resync(control, send);
        }
    };
    return { register, beginSend, failSend, acceptResponse, receive, stop: () => {
        reads.clear();
        restorers.forEach(restore => { restore(); });
    } };
}

export const pendingRequestRecovery = createPendingRequestRecovery();

// Both sync throws and rejected writes have the same failure path. This wrapper
// also covers encoding/VR relay failures, before a child.write promise exists.
export async function sendWithRecovery<T>(send: () => T | Promise<T>, failed: () => void): Promise<T | false> {
    try {
        const sent = await send();
        if (sent !== false) return sent;
    } catch (error) {
        console.error("Sidecar send failed", error);
    }
    failed();
    return false;
}
