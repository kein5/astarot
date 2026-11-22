import { useEffect, useRef } from "react";
import { getDefaultStore } from "jotai";
import { store, useStore_Hotkeys, Atom_IsOpenedConfigPage, Atom_IsBackendReady, Atom_IsSoftwareUpdating, Atom_Hotkeys } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { useNotificationStatus } from "@logics_common";
import { useMainFunction } from "@logics_main";
import { register, unregister, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Window as AppWindow } from "@tauri-apps/api/window";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { voiceActions } from "../../../voice/voiceActions.ts";
import type { Hotkeys } from "@store";

// What quick_chat_shortcut_platform answers (quick_chat.rs).
type ShortcutPlatform = "wayland" | "xwayland" | "native";
// A key press that the GlobalShortcuts portal forwards ("portal-shortcut", portal_shortcuts.rs).
interface PortalActivation {
    id: string;
    activation_token: string | null;
}
// The key the desktop uses for one action (Assigned in portal_shortcuts.rs). applied is false
// when the desktop kept another key, null when the desktop cannot say.
interface PortalAssigned {
    shown: string;
    applied: boolean | null;
}
type ActionRunner = (actionKey: string, activationToken?: string | null) => Promise<void>;
// The hook instance that registered the keys last; it stops counting once it unmounts.
interface HookOwner {
    mounted: boolean;
}
interface PortalListener {
    unlisten: (() => void) | null;
    ready: Promise<void> | null;
}
// A key change on its way to the backend. sent: the write has gone out.
interface PendingEdit {
    keys: string[] | null;
    sent?: boolean;
}

// Native Wayland grants no global key grab: the desktop binds the keys
// through the GlobalShortcuts portal and Rust forwards each press here.
let platformRequest: Promise<ShortcutPlatform> | null = null;
const shortcutPlatform = () => {
    platformRequest ??= invoke<ShortcutPlatform>("quick_chat_shortcut_platform").catch((error: unknown) => {
        platformRequest = null;
        throw error;
    });
    return platformRequest;
};
let portalHandler: ActionRunner | null = null;
// Rust says "portal-shortcuts-lost" when the desktop ended the session or its portal went away
// (a crash or an update): the keys stop working without a word otherwise (#397).
let portalLostHandler: (() => void) | null = null;
// Rust says "portal-shortcuts-not-restored" when a bind failed and the keys in force before it
// could not be bound again either: no hotkey works until the next bind (#561).
let portalNotRestoredHandler: (() => void) | null = null;
// One automatic bind per this long; a portal that keeps going away is left to the user.
const PORTAL_RECONNECT_DELAY_MS = 3000;
const PORTAL_RECONNECT_GAP_MS = 60000;
let lastPortalReconnect = -Infinity;
let portalReconnectTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let portalPaused = true; // Like the plugin's unregisterAll while settings are open.
// A Wayland client is never told that it is minimized, so isMinimized() stays false there.
// Remember that the hotkey minimized the window; getting the focus back means it is up again.
let minimizedByHotkey = false;
// biome-ignore lint/correctness/noUnusedVariables: read by `??=` below, so the focus listener is added once.
let focusWatch: Promise<UnlistenFn> | null = null;
let registrationGeneration = 0;
let registrationOwner: HookOwner | null = null;
let disposed = false;
// Keep native mutations ordered too: a register already in flight may finish
// after an acknowledgement starts the next reconciliation.
let nativeRegistration: Promise<unknown> = Promise.resolve();
const pendingEdits = new Map<string, PendingEdit>();
const reconcileNative = <T>(operation: () => T | PromiseLike<T>): Promise<T> => {
    const result = nativeRegistration.then(operation);
    nativeRegistration = result.catch(() => {});
    return result;
};
// Remember that a bind may have reached Rust, even if its UI owner was disposed.
let portalBound: boolean = import.meta.hot?.data.portalBound ?? false;
let portalListener: PortalListener | null = null;
const shortcutsEnabled = () => {
    const atoms = getDefaultStore();
    return atoms.get(Atom_IsBackendReady).data === true &&
        atoms.get(Atom_IsOpenedConfigPage).data === false &&
        atoms.get(Atom_IsSoftwareUpdating).data === false;
};
const pauseShortcuts = () => {
    registrationGeneration++;
    portalPaused = true;
    portalHandler = null;
    // A loss while paused needs nothing: the next bind (closing settings) opens a new session.
    portalLostHandler = null;
    portalNotRestoredHandler = null;
    clearTimeout(portalReconnectTimer);
    portalReconnectTimer = undefined;
};
const disposePortalListener = () => {
    pauseShortcuts();
    registrationOwner = null;
    const listener = portalListener;
    portalListener = null;
    listener?.unlisten?.();
};
const ensurePortalListener = () => {
    if (!portalListener) {
        const listener: PortalListener = { unlisten: null, ready: null };
        portalListener = listener;
        listener.ready = Promise.allSettled([
            listen<PortalActivation>("portal-shortcut", ({ payload }) => {
                if (portalListener === listener && !portalPaused && shortcutsEnabled() && portalHandler) {
                    portalHandler(payload.id, payload.activation_token ?? null);
                }
            }),
            listen("portal-shortcuts-lost", () => {
                if (portalListener === listener && !portalPaused && portalLostHandler) portalLostHandler();
            }),
            // It follows a failed bind, which leaves the shortcuts paused.
            listen("portal-shortcuts-not-restored", () => {
                if (portalListener === listener && portalNotRestoredHandler) portalNotRestoredHandler();
            }),
        ]).then(results => {
            const stops = results.filter(result => result.status === "fulfilled").map(result => result.value);
            const unlisten = () => stops.forEach(stop => { stop(); });
            const failed = results.find(result => result.status === "rejected");
            if (failed) {
                unlisten();
                if (portalListener === listener) portalListener = null;
                throw failed.reason;
            }
            if (portalListener !== listener) unlisten();
            else listener.unlisten = unlisten;
        });
    }
    return portalListener.ready;
};
if (import.meta.hot) import.meta.hot.dispose(data => {
    data.portalBound = portalBound;
    disposed = true;
    disposePortalListener();
});

export const useHotkeys = () => {
    const owner = useRef<HookOwner>({ mounted: true }).current;
    useEffect(() => {
        owner.mounted = true;
        return () => {
            owner.mounted = false;
            if (registrationOwner === owner) disposePortalListener();
        };
    }, [owner]);
    const appWindow = store.appWindow;
    // Each window's entry point sets it before anything draws; reading it without one stops
    // with a TypeError where the window is used, as calling a method of undefined did.
    const mainWindow = (): AppWindow => {
        if (!appWindow) throw new TypeError("store.appWindow is not set");
        return appWindow;
    };
    const { t, i18n } = useI18n();

    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentHotkeys, updateHotkeys, pendingHotkeys } = useStore_Hotkeys();
    const {
        toggleTranslation,
        toggleTranscriptionSend,
        toggleTranscriptionReceive,
    } = useMainFunction();

    const getHotkeys = () => {
        pendingHotkeys();
        asyncStdoutToPython("/get/data/hotkeys");
    };
    const { showNotification_SaveSuccess, showNotification_Error, showNotification_Warning, closeNotification } = useNotificationStatus();

    // The desktop's portal ended the session that holds the keys. Say so and bind once more after
    // a moment, when a restarted portal is back; a second loss within a minute is left to the
    // user, so a portal that keeps failing does not bring up the desktop's dialog again and again.
    const portalLost = () => {
        portalLostHandler = null;
        const now = Date.now();
        if (now - lastPortalReconnect < PORTAL_RECONNECT_GAP_MS) {
            showNotification_Error(t("quick_chat.portal_lost"), { hide_duration: 10000 });
            return;
        }
        lastPortalReconnect = now;
        showNotification_Warning(t("quick_chat.portal_lost_reconnecting"), { hide_duration: 8000 });
        clearTimeout(portalReconnectTimer);
        portalReconnectTimer = setTimeout(() => {
            portalReconnectTimer = undefined;
            void registerShortcuts();
        }, PORTAL_RECONNECT_DELAY_MS);
    };

    // The bind failed and the keys in force before it could not be bound again either. The bind's
    // own failure was said already; this says what it left (#561).
    const portalNotRestored = () => {
        portalNotRestoredHandler = null;
        showNotification_Error(t("quick_chat.portal_not_restored"), { hide_duration: 10000 });
    };

    const openQuickChat = async (activationToken: string | null = null) => {
        try { await invoke("quick_chat_show", { activationToken }); }
        catch (error) {
            console.warn("Quick chat window could not be focused", error);
            showNotification_Error(t("quick_chat.open_failed"));
        }
    };

    const currentPlatform = async () => {
        try { return await shortcutPlatform(); }
        catch {
            showNotification_Error(t("quick_chat.platform_unknown"));
            return null;
        }
    };

    const runAction: ActionRunner = async (actionKey, activationToken = null) => {
        switch (actionKey) {
            case "open_quick_chat": {
                await openQuickChat(activationToken);
                break;
            }
            case "toggle_vrct_visibility": {
                const wayland = await currentPlatform() === "wayland";
                if (wayland) focusWatch ??= mainWindow().onFocusChanged?.(({ payload: focused }) => { if (focused) minimizedByHotkey = false; });
                let minimized = minimizedByHotkey;
                // A window whose state cannot be read is taken as shown: the press minimizes it.
                if (!wayland) try { minimized = await mainWindow().isMinimized(); } catch { minimized = false; }
                // Nothing above catches a failure here (the shortcut callbacks, the portal handler),
                // so it is told here (#465).
                if (minimized) {
                    minimizedByHotkey = false;
                    try {
                        // The desktop gives a portal shortcut no right to raise a window; Rust asks KWin.
                        if (wayland) await invoke("main_window_restore");
                        else {
                            await mainWindow().unminimize();
                            await mainWindow().setFocus();
                        }
                    } catch (error) {
                        console.warn("Main window could not be restored", error);
                        // Still minimized: the next press tries to restore it again.
                        minimizedByHotkey = wayland;
                        showNotification_Error(t("config_page.hotkeys.error_window_restore_failed"));
                        break;
                    }
                    store.text_area_ref?.current?.focus();
                } else {
                    try { await mainWindow().minimize(); }
                    catch (error) {
                        console.warn("Main window could not be minimized", error);
                        showNotification_Error(t("config_page.hotkeys.error_window_minimize_failed"));
                        break;
                    }
                    minimizedByHotkey = wayland;
                }
                break;
            }
            case "toggle_translation": {
                toggleTranslation();
                break;
            }
            case "toggle_transcription_send": {
                toggleTranscriptionSend();
                break;
            }
            case "toggle_transcription_receive": {
                toggleTranscriptionReceive();
                break;
            }
            // The switches and the stop actions on the main page own these; see voiceActions.js.
            case "stop_voice": {
                voiceActions.stop?.();
                break;
            }
            case "toggle_voice_mute": {
                voiceActions.toggleMute?.();
                break;
            }
            case "toggle_tts": {
                voiceActions.toggleTts?.();
                break;
            }
            case "toggle_rvc": {
                voiceActions.toggleRvc?.();
                break;
            }
            default: {
                console.warn(`No handler defined for action: ${actionKey}`);
                break;
            }
        }
    };

    const registerPortalShortcuts = async (isCurrent: () => boolean) => {
        await reconcileNative(() => unregisterAll());
        if (!isCurrent()) return;
        portalHandler = runAction;
        const shortcuts: Record<string, string[]> = {};
        for (const [actionKey, keys] of Object.entries(currentHotkeys.data ?? {})) if (keys) shortcuts[actionKey] = keys;
        if (!Object.keys(shortcuts).length && !portalBound) {
            portalPaused = false;
            return;
        }
        try {
            await ensurePortalListener();
            if (!isCurrent()) return;
            portalBound = true;
            // Rust answers a failed bind first, then tries the keys in force before it again.
            portalNotRestoredHandler = portalNotRestored;
            // The desktop may show its confirmation dialog the first time.
            const assigned = await invoke<Record<string, PortalAssigned> | null>("portal_shortcuts_bind", { shortcuts });
            if (!isCurrent()) return;
            portalPaused = false;
            if (Object.keys(shortcuts).length) portalLostHandler = portalLost;
            // The desktop may keep another key, e.g. when VRCT's is taken.
            for (const [actionKey, row] of Object.entries(assigned ?? {})) {
                if (row?.applied !== false) continue;
                showNotification_Error(t("quick_chat.portal_key_kept", {
                    action_name: getHotkeyActionLabel(actionKey, t),
                    wanted: shortcuts[actionKey].join(" + "),
                    hotkey: row.shown || "-",
                }), { hide_duration: 10000 });
            }
        } catch (code) {
            if (!isCurrent()) return;
            const key = `quick_chat.portal_errors.${code}`;
            showNotification_Error(i18n.exists(key) ? t(key) : t("quick_chat.portal_failed", { code: String(code) }),
                { hide_duration: 8000 });
        }
    };

    const setHotkeys = async (hotkeys: Hotkeys) => {
        const [targetActionKey, targetHotkey] = Object.entries(hotkeys)[0];
        if (pendingEdits.get(targetActionKey)?.sent) return false;
        const acknowledged = () => getDefaultStore().get(Atom_Hotkeys).data;
        const initial = JSON.stringify(acknowledged()[targetActionKey]);
        const session = store.backend_session;
        const edit: PendingEdit = { keys: targetHotkey };
        const isCurrent = () => !disposed && owner.mounted && pendingEdits.get(targetActionKey) === edit &&
            store.backend_session === session && JSON.stringify(acknowledged()[targetActionKey]) === initial;
        const conflict = () => {
            if (!targetHotkey) return false;
            const latest = [...Object.entries(acknowledged()), ...[...pendingEdits].map(([key, value]): [string, string[] | null] => [key, value.keys])];
            return latest.some(([key, keys]) => key !== targetActionKey && keys && parseHotkey(keys) === parseHotkey(targetHotkey));
        };
        const reportConflict = () => {
            showNotification_Error(t("config_page.hotkeys.error_in_use", {
                action_name: getHotkeyActionLabel(targetActionKey, t), hotkey: (targetHotkey ?? []).join(" + "),
            }));
            return false;
        };
        if (conflict()) return reportConflict();
        // Reserve the proposed content before the first await, across hook instances.
        pendingEdits.set(targetActionKey, edit);
        try {
            if (targetHotkey) {
                const platform = await currentPlatform();
                if (!isCurrent() || (targetActionKey === "open_quick_chat" && !platform)) return false;
                if (conflict()) return reportConflict();
                if (platform !== "wayland") {
                    try {
                        await reconcileNative(async () => {
                            if (!isCurrent()) return;
                            const shortcut = parseHotkey(targetHotkey);
                            await register(shortcut, () => {});
                            await unregister(shortcut);
                        });
                    } catch (error) {
                        if (!isCurrent()) return false;
                        console.warn("Hotkey registration test failed:", error);
                        return reportConflict();
                    }
                }
            }
            if (!isCurrent()) return false;
            if (conflict()) return reportConflict();
            pendingHotkeys();
            closeNotification();
            edit.sent = true;
            const response = await asyncStdoutToPython("/set/data/hotkeys", { [targetActionKey]: targetHotkey });
            return response !== false && (response === true || !response?.status || response.status === 200);
        } finally {
            if (pendingEdits.get(targetActionKey) === edit) pendingEdits.delete(targetActionKey);
        }
    };

    const registerShortcuts = async () => {
        pauseShortcuts();
        registrationOwner = owner;
        const generation = registrationGeneration;
        const isCurrent = () => !disposed && owner.mounted && registrationOwner === owner &&
            generation === registrationGeneration && shortcutsEnabled();
        if (!isCurrent()) return;
        const platform = await currentPlatform();
        if (!isCurrent()) return;
        if (platform === "wayland") return registerPortalShortcuts(isCurrent);
        return reconcileNative(async () => {
            if (!isCurrent()) return;
            try {
                await unregisterAll();
                if (!isCurrent()) return;

                const hotkeyEntries = Object.entries(currentHotkeys.data);
                const failedHotkeys: { actionKey: string; hotkey: string }[] = [];

                for (const [actionKey, hotkeyRaw] of hotkeyEntries) {
                    if (!hotkeyRaw) continue;

                    const shortcut = parseHotkey(hotkeyRaw);
                    try {
                        await register(shortcut, async (event) => {
                            // Moving focus during an X11 key grab can lose its release
                            // event and leave the shortcut stuck in the pressed state.
                            const trigger = actionKey === "open_quick_chat" ? "Released" : "Pressed";
                            if (event.state !== trigger || !isCurrent()) return;
                            await runAction(actionKey);
                        });
                        if (!isCurrent()) return;
                    } catch (error) {
                        if (!isCurrent()) return;
                        console.warn(`Failed to register global shortcut ${shortcut} for ${actionKey}:`, error);
                        failedHotkeys.push({
                            actionKey,
                            hotkey: hotkeyRaw.join(" + "),
                        });
                    }
                }

                if (failedHotkeys.length > 0) {
                    // 起動時 / 有効化時に他アプリで使用されていて登録できなかったホットキーを通知（設定は削除しない）
                    failedHotkeys.forEach(({ actionKey, hotkey }) => {
                        const actionLabel = getHotkeyActionLabel(actionKey, t);
                        showNotification_Error(
                            t("config_page.hotkeys.error_failed_to_register_at_launch", {
                                action_name: actionLabel,
                                hotkey,
                            }),
                            { hide_duration: 8000 }
                        );
                    });
                }
            } catch (error) {
                if (!isCurrent()) return;
                console.error("Failed to register global shortcuts:", error);
                // unregisterAll failed, so none of the hotkeys is bound: say so (#465).
                showNotification_Error(t("config_page.hotkeys.error_failed_to_register_all"), { hide_duration: 10000 });
            }
        });
    };

    const setSuccessHotkeys = (hotkeys: Hotkeys) => {
        updateHotkeys(hotkeys);
        showNotification_SaveSuccess();
    };

    return {
        currentHotkeys,
        getHotkeys,
        updateHotkeys,
        setHotkeys,
        setSuccessHotkeys,
        registerShortcuts,
        unregisterAll: async () => {
            pauseShortcuts();
            await reconcileNative(() => unregisterAll());
        },
        openQuickChat,
    };
};

// The character a key gives with Shift on a US layout, and the key itself. Recordings before
// 2026-11-07 (digits) and 2026-11-18 (symbols) stored what Shift typed ("Ctrl+Shift+?"), which the
// registrar does not read (#563); with Shift held, it is read as the key ("/"), as recorded now.
const SHIFTED_KEYS: Readonly<Record<string, string>> = {
    "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/",
};

// 修飾キーのパースを行う関数
const parseHotkey = (hotkeyString: string[]) => {
    const keyMap: Readonly<Record<string, string>> = {
        Ctrl: "Control",
        Alt: "Alt",
        Shift: "Shift",
        Meta: "Super",
        // Older recordings stored Space as " ", which leaves an empty token.
        " ": "Space",
    };
    const shifted = hotkeyString.includes("Shift");

    return hotkeyString
        .map((key) => keyMap[key] || (shifted && Object.hasOwn(SHIFTED_KEYS, key) ? SHIFTED_KEYS[key] : key))
        .join("+");
};

// アクション名（多言語対応）を取得する関数
const getHotkeyActionLabel = (actionKey: string, t: TFunction) => {
    switch (actionKey) {
        case "open_quick_chat":
            return t("quick_chat.label");
        case "toggle_vrct_visibility":
            return t("config_page.hotkeys.toggle_vrct_visibility.label");
        case "toggle_translation":
            return t("config_page.hotkeys.toggle_translation.label", {
                translation: t("main_page.translation"),
            });
        case "toggle_transcription_send":
            return t("config_page.hotkeys.toggle_transcription_send.label", {
                transcription_send: t("main_page.transcription_send"),
            });
        case "toggle_transcription_receive":
            return t("config_page.hotkeys.toggle_transcription_receive.label", {
                transcription_receive: t("main_page.transcription_receive"),
            });
        case "stop_voice":
            return t("config_page.hotkeys.stop_voice.label");
        case "toggle_voice_mute":
            return t("config_page.hotkeys.toggle_voice_mute.label");
        case "toggle_tts":
            return t("config_page.hotkeys.toggle_voice_switch.label", { name: t("main_page.tts") });
        case "toggle_rvc":
            return t("config_page.hotkeys.toggle_voice_switch.label", { name: t("main_page.rvc") });
        default:
            return actionKey;
    }
};
