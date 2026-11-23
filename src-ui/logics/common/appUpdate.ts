// In-app updates (issue #330). The Tauri side (src-tauri/src/app_update.rs) decides what this
// copy may do and talks to GitHub; this module keeps the state the update page and the top bar
// show, and makes sure a failure leaves the app usable and says why.
//
// info.mode: "install" checks and installs here, "manual" checks and links to the release page,
// "package_manager" never checks (deb/rpm), "disabled" never checks (development builds).
//
// status: idle → checking → up_to_date | available | error; available → downloading → installing.
// Installing ends the app (Windows starts the installer, Linux restarts), so there is no "done".

export type AppUpdateMode = "install" | "manual" | "package_manager" | "disabled";

export type AppUpdateStatus = "idle" | "checking" | "up_to_date" | "available" | "error" | "downloading" | "installing";

// app_update_info (UpdateInfo in app_update.rs).
export interface AppUpdateInfo {
    kind: string;
    mode: AppUpdateMode;
    channel: string;
    current_version: string;
    package_manager: string | null;
}

// app_update_check (CheckResult in app_update.rs).
export interface AppUpdateCheckResult {
    available: boolean;
    version: string | null;
    release_url: string | null;
}

// A message of app_update_install's progress channel (InstallProgress in app_update.rs).
export type AppUpdateInstallProgress =
    | { phase: "download"; downloaded: number; total: number | null }
    | { phase: "install" };

export interface AppUpdateProgress {
    downloaded: number;
    total: number | null;
}

export interface AppUpdateState {
    info: AppUpdateInfo | null;
    status: AppUpdateStatus;
    version: string | null;
    release_url: string | null;
    // An update_* error code.
    error: string | null;
    progress: AppUpdateProgress | null;
}

export const INITIAL_APP_UPDATE = Object.freeze<AppUpdateState>({
    info: null,
    status: "idle",
    version: null,
    release_url: null,
    error: null,
    progress: null,
});

const BUSY = new Set<AppUpdateStatus>(["checking", "downloading", "installing"]);
// While an update is downloaded or installed, the channel is not checked again.
const INSTALLING = new Set<AppUpdateStatus>(["downloading", "installing"]);
export const CHECKING_MODES = new Set<AppUpdateMode>(["install", "manual"]);

// The commands reject with a short code (update_check_failed, update_metadata_missing, ...).
export const errorCode = (error: unknown, fallback: string) =>
    typeof error === "string" && /^update_[a-z_]+$/.test(error) ? error : fallback;

export interface AppUpdateOptions {
    // Tauri's invoke.
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    // A Tauri Channel that hands its messages to onmessage.
    createChannel: (onmessage: (message: AppUpdateInstallProgress) => void) => unknown;
    get: () => Readonly<AppUpdateState>;
    set: (state: AppUpdateState) => void;
    log?: (what: string, detail: unknown) => void;
}

export const createAppUpdate = ({ invoke, createChannel, get, set, log = () => {} }: AppUpdateOptions) => {
    const patch = (change: Partial<AppUpdateState>) => set({ ...get(), ...change });
    let infoRequest: Promise<AppUpdateInfo | null> | null = null;

    const loadInfo = () => {
        infoRequest ??= invoke<AppUpdateInfo>("app_update_info").then(info => {
            patch({ info });
            return info;
        }, error => {
            infoRequest = null;
            log("app_update_info failed", error);
            return null;
        });
        return infoRequest;
    };

    // The checks run one after another, as the Tauri side runs them (a second check while one runs
    // is refused there, update_busy). Each check takes the next number, and only the newest one's
    // answer is shown: a check of the channel set before never overwrites what the channel set
    // now shows, and what is shown is what the Tauri side keeps for the install (its last check).
    let newest = 0;
    let switches = 0;
    let queue: Promise<unknown> = Promise.resolve();
    const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
        const run = queue.then(work, work);
        queue = run.catch(() => {});
        return run;
    };

    // `silent`: the check at start. A failure there shows nothing; the page says it when asked.
    // `channel`: the update channel of the settings (#466); without one, the running build's.
    // `before`: the status before the check, kept by a silent failure when it offered an update.
    const runCheck = async ({ silent = false, channel = null }: { silent?: boolean; channel?: string | null }, before: AppUpdateStatus) => {
        const mine = ++newest;
        patch({ status: "checking", error: null });
        try {
            const result = await invoke<AppUpdateCheckResult | null>("app_update_check", { channel });
            if (mine !== newest) return get();
            patch(result?.available
                ? { status: "available", version: result.version, release_url: result.release_url }
                : { status: "up_to_date", version: null, release_url: null });
        } catch (error) {
            const code = errorCode(error, "update_check_failed");
            log("app_update_check failed", code);
            if (mine !== newest) return get();
            patch(silent
                ? { status: before === "available" ? "available" : "idle", error: null }
                : { status: "error", error: code });
        }
        return get();
    };

    // A check asked for while one runs, downloads or installs is not made again.
    const check = async (options: { silent?: boolean; channel?: string | null } = {}) => {
        const info = await loadInfo();
        if (!info || !CHECKING_MODES.has(info.mode) || BUSY.has(get().status)) return get();
        const before = get().status;
        patch({ status: "checking", error: null });
        return inTurn(() => runCheck(options, before));
    };

    // Resolves only when the update could not be applied; the app is then still the old one.
    const install = async () => {
        const state = get();
        if (state.status !== "available" || state.info?.mode !== "install") return null;
        patch({ status: "downloading", progress: { downloaded: 0, total: null }, error: null });
        const channel = createChannel(message => {
            if (message?.phase === "download") {
                patch({ progress: { downloaded: message.downloaded, total: message.total ?? null } });
            } else if (message?.phase === "install") {
                patch({ status: "installing" });
            }
        });
        try {
            await invoke("app_update_install", { onProgress: channel });
            return null;
        } catch (error) {
            const code = errorCode(error, "update_install_failed");
            log("app_update_install failed", code);
            // Back to the offer, so the user can try again or keep working.
            patch({ status: "available", progress: null, error: code });
            return code;
        }
    };

    // The update channel was set again (#466): what the other channel found goes at once, and the
    // new one is checked when the check under way, if any, has ended; that check's answer is the
    // other channel's and is not shown. Set again before that, only the last channel is checked.
    // A download or an install under way is left to finish.
    const switchChannel = async (channel: string | null) => {
        if (INSTALLING.has(get().status)) return get();
        const turn = ++switches;
        newest += 1;
        const info = await loadInfo();
        if (turn !== switches || INSTALLING.has(get().status)) return get();
        if (!info || !CHECKING_MODES.has(info.mode)) {
            patch({ status: "idle", version: null, release_url: null, error: null });
            return get();
        }
        patch({ status: "checking", version: null, release_url: null, error: null });
        return inTurn(async () => turn === switches ? runCheck({ silent: true, channel }, "idle") : get());
    };

    return { loadInfo, check, install, switchChannel };
};

// Whole percent of a download, or null while its size is unknown.
export const downloadPercent = (progress: AppUpdateProgress | null | undefined) => {
    if (!progress?.total) return null;
    return Math.min(100, Math.floor(progress.downloaded * 100 / progress.total));
};
