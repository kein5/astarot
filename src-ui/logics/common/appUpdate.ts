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

    // `silent`: the check at start. A failure there shows nothing; the page says it when asked.
    // `channel`: the update channel of the settings (#466); without one, the running build's.
    const check = async ({ silent = false, channel = null }: { silent?: boolean; channel?: string | null } = {}) => {
        const info = await loadInfo();
        if (!info || !CHECKING_MODES.has(info.mode) || BUSY.has(get().status)) return get();
        const before = get();
        patch({ status: "checking", error: null });
        try {
            const result = await invoke<AppUpdateCheckResult | null>("app_update_check", { channel });
            patch(result?.available
                ? { status: "available", version: result.version, release_url: result.release_url }
                : { status: "up_to_date", version: null, release_url: null });
        } catch (error) {
            const code = errorCode(error, "update_check_failed");
            log("app_update_check failed", code);
            patch(silent
                ? { status: before.status === "available" ? "available" : "idle", error: null }
                : { status: "error", error: code });
        }
        return get();
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

    return { loadInfo, check, install };
};

// Whole percent of a download, or null while its size is unknown.
export const downloadPercent = (progress: AppUpdateProgress | null | undefined) => {
    if (!progress?.total) return null;
    return Math.min(100, Math.floor(progress.downloaded * 100 / progress.total));
};
