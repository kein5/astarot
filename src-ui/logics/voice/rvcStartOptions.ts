// The devices the RVC worker's --device accepts.
export type RvcDevice = "auto" | "cuda" | "cpu";

export interface RvcWorkerOptions {
    rvc_device: RvcDevice;
    rvc_threads: number;
    rvc_highpass: boolean;
}

// The RVC worker's --device, --threads (0: the worker chooses) and --highpass, with the
// worker's own defaults. Settings saved before they existed start the same way as before.
export const RVC_WORKER_DEFAULTS: Readonly<RvcWorkerOptions> = { rvc_device: "auto", rvc_threads: 0, rvc_highpass: true };
export const RVC_DEVICES: readonly RvcDevice[] = ["auto", "cuda", "cpu"];
export const MAX_RVC_THREADS = 64;

// Saved or edited direct voice settings, as far as RVC reads them. The device is passed on
// as saved: the worker refuses a name it does not know.
export interface RvcSettings {
    rvc_runtime?: string;
    rvc_model?: string;
    rvc_index?: string;
    rvc_pitch?: number;
    rvc_index_rate?: number;
    rvc_device?: string | null;
    rvc_threads?: number | null;
    rvc_highpass?: boolean | null;
}

export interface RvcStartOptions {
    engine: "rvc";
    runtime: string | undefined;
    model: string | undefined;
    index: string | undefined;
    pitch: number | undefined;
    index_rate: number | undefined;
    device: string;
    threads: number;
    highpass: boolean;
}

// The /run/start_direct_voice options of a converted RVC voice, from saved or edited settings.
export const rvcStartOptions = (settings: RvcSettings): RvcStartOptions => ({
    engine: "rvc", runtime: settings.rvc_runtime, model: settings.rvc_model, index: settings.rvc_index,
    pitch: settings.rvc_pitch, index_rate: settings.rvc_index_rate,
    device: settings.rvc_device ?? RVC_WORKER_DEFAULTS.rvc_device,
    threads: settings.rvc_threads ?? RVC_WORKER_DEFAULTS.rvc_threads,
    highpass: settings.rvc_highpass ?? RVC_WORKER_DEFAULTS.rvc_highpass,
});
