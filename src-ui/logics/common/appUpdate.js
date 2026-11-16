// In-app updates (issue #330). The Tauri side (src-tauri/src/app_update.rs) decides what this
// copy may do and talks to GitHub; this module keeps the state the update page and the top bar
// show, and makes sure a failure leaves the app usable and says why.
//
// info.mode: "install" checks and installs here, "manual" checks and links to the release page,
// "package_manager" never checks (deb/rpm), "disabled" never checks (development builds).
//
// status: idle → checking → up_to_date | available | error; available → downloading → installing.
// Installing ends the app (Windows starts the installer, Linux restarts), so there is no "done".

export const INITIAL_APP_UPDATE = Object.freeze({
    info: null,
    status: "idle",
    version: null,
    release_url: null,
    error: null,
    progress: null,
});

const BUSY = new Set(["checking", "downloading", "installing"]);
export const CHECKING_MODES = new Set(["install", "manual"]);

// The commands reject with a short code (update_check_failed, update_metadata_missing, ...).
export const errorCode = (error, fallback) =>
    typeof error === "string" && /^update_[a-z_]+$/.test(error) ? error : fallback;

export const createAppUpdate = ({ invoke, createChannel, get, set, log = () => {} }) => {
    const patch = change => set({ ...get(), ...change });
    let infoRequest = null;

    const loadInfo = () => {
        infoRequest ??= invoke("app_update_info").then(info => {
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
    const check = async ({ silent = false } = {}) => {
        const info = await loadInfo();
        if (!info || !CHECKING_MODES.has(info.mode) || BUSY.has(get().status)) return get();
        const before = get();
        patch({ status: "checking", error: null });
        try {
            const result = await invoke("app_update_check");
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
export const downloadPercent = progress => {
    if (!progress || !progress.total) return null;
    return Math.min(100, Math.floor(progress.downloaded * 100 / progress.total));
};
