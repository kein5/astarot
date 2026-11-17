// The RVC worker's --device, --threads (0: the worker chooses) and --highpass, with the
// worker's own defaults. Settings saved before they existed start the same way as before.
export const RVC_WORKER_DEFAULTS = { rvc_device: "auto", rvc_threads: 0, rvc_highpass: true };
export const RVC_DEVICES = ["auto", "cuda", "cpu"];
export const MAX_RVC_THREADS = 64;

// The /run/start_direct_voice options of a converted RVC voice, from saved or edited settings.
export const rvcStartOptions = settings => ({
    engine: "rvc", runtime: settings.rvc_runtime, model: settings.rvc_model, index: settings.rvc_index,
    pitch: settings.rvc_pitch, index_rate: settings.rvc_index_rate,
    device: settings.rvc_device ?? RVC_WORKER_DEFAULTS.rvc_device,
    threads: settings.rvc_threads ?? RVC_WORKER_DEFAULTS.rvc_threads,
    highpass: settings.rvc_highpass ?? RVC_WORKER_DEFAULTS.rvc_highpass,
});
