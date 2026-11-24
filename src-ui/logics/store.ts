import {
    atom,
    getDefaultStore,
    useAtomValue,
    useSetAtom
} from "jotai";
import type { Atom, PrimitiveAtom } from "jotai";
import type { ReactNode, RefObject } from "react";
import type { Window as AppWindow } from "@tauri-apps/api/window";


import {
    translator_status,
} from "@ui_configs";
import { keepNewestVrLayout } from "./common/vrPanelTooltip";

import { pendingRequestRecovery, restorePendingValue, restoreDownloadPending, staticPendingControls } from "./common/pendingRequestRecovery.ts";
import { updateMeterValue } from "./common/meterValue.ts";
import { initialLanguages } from "./common/initializationFields.ts";
import type { PendingControlSpec, PendingDownloadItem, PendingDownloadRequest, PendingRestore } from "./common/pendingRequestRecovery.ts";
import type { SidecarSessionOwner, SidecarSessionStore } from "./common/sidecarSession.ts";
import type { BackendStartupState, StartupFailure } from "./common/startupPhase.ts";
import type { SharedWindowState } from "./configs/ocrSharedWindow.ts";
import type { GpuMemory } from "./flow/gpuMemory.ts";
import type { IoFlow, Trace } from "./flow/ioFlow.ts";
import type { LanguageMutationState } from "./main/languageMutationCoordinator.ts";
import type { SwitchBlocks } from "./main/switchBlocks.ts";
import type { MessageLogRow } from "./transcription/realtimeCaptionState.ts";
import type { SpeakerNames } from "./common/speakerNames.ts";

// What the windows share outside the atoms: the backend's session, elements and callbacks.
export interface UiStore extends SidecarSessionStore {
    backend_session_owner: SidecarSessionOwner | null;
    setting_box_scroll_container: RefObject<HTMLElement | null> | null;
    scroll_log_to_bottom: (() => void) | null;
    text_area_ref: RefObject<HTMLTextAreaElement | null> | null;
    last_executed_time_startTyping: number;
    // The count of expired speech the backend last reported (useReceiveRoutes).
    expired_speech: number | null;
    // Set by each window's entry point (views/app/index.tsx, views/vr/index.tsx).
    appWindow?: AppWindow;
    is_vr_panel?: boolean;
    // Set by CompanionController: closing the main window puts it away in the tray.
    companion_hide?: () => Promise<void>;
}

export const store: UiStore = {
    backend_subprocess: null,
    backend_session: null,
    backend_session_owner: null,
    setting_box_scroll_container: null,
    scroll_log_to_bottom: null,
    text_area_ref: null,
    last_executed_time_startTyping: 0,
    expired_speech: null,
};

// The state of an atom's value: "pending" while a request it waits for is unanswered.
export type AtomStatus = "ok" | "pending" | "error";

export interface AtomState<T> {
    state: AtomStatus;
    data: T;
    // Keeps the state as it is through updates. Read by updateAtom; nothing sets it now.
    lock_state?: boolean;
}

// The new value, or a function of the atom's current state that gives it.
export type AtomUpdater<T> = (current: AtomState<T>) => T;
export type AtomPayload<T> = T | AtomUpdater<T>;

interface UpdateOptionsBase {
    remain_state?: boolean;
}

// lock_state sets the state given in set_state, even over an atom whose state is locked.
export type UpdateOptions = UpdateOptionsBase & (
    | { lock_state?: false; set_state?: AtomStatus }
    | { lock_state: true; set_state: AtomStatus }
);

export interface AtomOptions {
    // The atom starts "ok" instead of "pending".
    is_state_ok?: boolean;
    // Which requests release the atom when they fail (pendingRequestRecovery).
    pending_control?: Partial<PendingControlSpec>;
}

// The fields a store hook returns, named after the atom: currentX, updateX, pendingX, errorX.
export type StoreHookFields<T, N extends string> =
    Record<`current${N}`, AtomState<T>> &
    Record<`update${N}`, (payload: AtomPayload<T>, options?: UpdateOptions) => void> &
    Record<`pending${N}`, () => void> &
    Record<`error${N}`, () => void>;

export type StoreHook<T, N extends string> = () => StoreHookFields<T, N>;

export interface AtomWithHook<T, N extends string> {
    atomInstance: PrimitiveAtom<AtomState<T>>;
    useHook: StoreHook<T, N>;
}

// A hook as the registry keeps it, for the settings whose names are known only at run time.
export type RegisteredStoreHook = () => Readonly<Record<string, unknown>>;

// One field named at run time. TypeScript types a computed key as string, so { [key]: value }
// is not seen to have the key K; the overload says so. It holds for one name, which is how the
// store calls it: K is a template of the atom's single name, never a union of names.
function field<K extends string, V>(key: K, value: V): Record<K, V>;
function field<V>(key: string, value: V): Record<string, V> {
    return { [key]: value };
}

const isUpdater = <T>(payload: AtomPayload<T>): payload is AtomUpdater<T> => typeof payload === "function";

// The value an atom starts with, typed as everything the atom may hold later.
const initial = <T>(value: T): T => value;

const staticPendingControl = (base_name: string): Partial<PendingControlSpec> | undefined => {
    const controls: Readonly<Record<string, PendingControlSpec>> = staticPendingControls;
    return controls[base_name];
};

// A list of weight downloads (selectable_*_type_dict), as restoreDownloadPending reads it.
const isDownloadList = (value: unknown): value is PendingDownloadItem[] => Array.isArray(value)
    && value.every((item: unknown) => typeof item === "object" && item !== null && "id" in item && typeof item.id === "string");

const isDownloadRequest = (request: unknown): request is PendingDownloadRequest => request === null || request === undefined
    || typeof request === "string"
    || (typeof request === "object" && (!("weight_type" in request) || request.weight_type === undefined || typeof request.weight_type === "string"));

// Releases the pending items of a download list. Any other request names no item.
const restoreDownloadState = <T>(previous: AtomState<T>, request: unknown, all: boolean): AtomState<T> => {
    const data = previous.data;
    if (!isDownloadList(data)) return restorePendingValue(previous);
    return restoreDownloadPending({ ...previous, data }, isDownloadRequest(request) ? request : undefined, all);
};

export const dynamicStoreRegistry: Record<string, RegisteredStoreHook | Atom<unknown>> = {};

export const createAtomWithHook = <T, N extends string>(initialValue: T, base_name: N, options?: AtomOptions): AtomWithHook<T, N> => {
    const atomInstance = atom<AtomState<T>>({
        state: (options?.is_state_ok) ? "ok" : "pending",
        data: initialValue,
    });

    const restore: PendingRestore = (request, all = false, publish = false) => {
        const atoms = getDefaultStore();
        const previous = atoms.get(atomInstance);
        const next = options?.pending_control?.download ? restoreDownloadState(previous, request, all) : restorePendingValue(previous);
        if (next === previous && !publish) return false;
        // VR can be pending while the main atom is already confirmed. Publish
        // that value again so the existing mirror releases the VR control too.
        atoms.set(atomInstance, next === previous ? { ...next } : next);
        return true;
    };
    pendingRequestRecovery.register({ ...staticPendingControl(base_name), ...options?.pending_control, restore, stop: () => restore(undefined, true, true) });

    const useHook = (): StoreHookFields<T, N> => {
        const currentAtom = useAtomValue(atomInstance);
        const setAtom = useSetAtom(atomInstance);

        const pendingAtom = () => {
            setAtom((old_value) => ({
                state: "pending",
                data: old_value.data,
            }));
        };

        const updateAtom = (payload: AtomPayload<T>, options: UpdateOptions = {}): void => {
            const { remain_state = false, set_state, lock_state } = options;

            setAtom((currentValue) => {
                let new_state: AtomStatus;
                if (lock_state) {
                    new_state = set_state;
                } else {
                    if (currentValue.lock_state) {
                        new_state = currentValue.state;
                    } else {
                        new_state = set_state ?? (remain_state ? currentValue.state : "ok");
                    }
                }

                const updated_data = isUpdater(payload)
                    ? payload(currentValue)
                    : payload;

                if (base_name === "VrPanelLayout" &&
                    keepNewestVrLayout(currentValue.data, updated_data) === currentValue.data) return currentValue;

                if (base_name === "MicVolume" || base_name === "SpeakerVolume") {
                    return updateMeterValue(currentValue, updated_data, new_state);
                }

                return {
                    state: new_state,
                    data: updated_data,
                };
            });
        };

        const errorAtom = () => {
            setAtom((old_value) => ({
                state: "error",
                data: old_value.data,
            }));
        };

        return {
            ...field(`error${base_name}`, errorAtom),
            ...field(`pending${base_name}`, pendingAtom),
            ...field(`current${base_name}`, currentAtom),
            ...field(`update${base_name}`, updateAtom),
        };
    };

    try {
        const hookName = `useStore_${base_name}`;
        const atomName = `Atom_${base_name}`;
        dynamicStoreRegistry[hookName] = useHook;
        dynamicStoreRegistry[atomName] = atomInstance;
    } catch (e) {
        console.warn("dynamic registration failed for", base_name, e);
    }

    return { atomInstance, useHook };
};


export const getStoreHook = (baseName: string): RegisteredStoreHook | undefined => {
    const hookName = `useStore_${baseName}`;
    const hook = dynamicStoreRegistry[hookName];
    return typeof hook === "function" ? hook : undefined;
};

// A setting whose atom is made at run time.
export interface StoreSetting {
    Base_Name: string;
    default_value?: unknown;
    options?: AtomOptions;
}

export const registerMany = (settingsArray: readonly StoreSetting[] = []) => {
    for (const s of settingsArray) {
        try {
            const hookName = `useStore_${s.Base_Name}`;
            if (dynamicStoreRegistry[hookName]) {
                continue;
            }

            createAtomWithHook(s.default_value, s.Base_Name, s.options || {});
        } catch (e) {
            console.warn("registerMany failed for", s.Base_Name, e);
        }
    }
};


// The notice the snackbar shows (SnackbarController). message is text or an element.
export interface NotificationOptions {
    category_id?: string;
    hide_duration?: number | null;
    to_hide_progress_bar?: boolean;
}

export interface NotificationStatus {
    status: string;
    is_open: boolean;
    message: ReactNode;
    key?: number;
    category_id?: string | null;
    options?: NotificationOptions;
}

// One language of /get/data/selectable_language_list (docs/spec/data-and-persistence.md).
export interface SelectableLanguage {
    language: string;
    country: string;
}

// Each hotkey's keys, null when none is set (/get/data/hotkeys).
export type Hotkeys = Record<string, string[] | null>;

// The main switches that were on when the settings opened (ConfigPageCloseTriggerController).
// translation is there only once the settings have been opened.
export interface MainFunctionsStateMemory {
    translation?: boolean;
    transcription_send: boolean;
    transcription_receive: boolean;
}

// Common
export const { atomInstance: Atom_IsBackendReady, useHook: useStore_IsBackendReady } = createAtomWithHook(false, "IsBackendReady");
export const { atomInstance: Atom_BackendStartupState, useHook: useStore_BackendStartupState } = createAtomWithHook(initial<BackendStartupState>("starting"), "BackendStartupState");
// Why the last start failed ({ kind: "spawn" | "exit", ... }, see startupPhase.ts); read only while BackendStartupState is "failed".
export const { atomInstance: Atom_BackendStartupFailure, useHook: useStore_BackendStartupFailure } = createAtomWithHook(initial<StartupFailure | null>(null), "BackendStartupFailure");
export const { atomInstance: Atom_IsVrctAvailable, useHook: useStore_IsVrctAvailable } = createAtomWithHook(true, "IsVrctAvailable");
export const { atomInstance: Atom_IsOscAvailable, useHook: useStore_IsOscAvailable } = createAtomWithHook(false, "IsOscAvailable");
// Why it is unavailable: "remote_destination" (VRChat is on another machine) or "setup_failed". null while available or unknown.
export const { atomInstance: Atom_OscUnavailableReason, useHook: useStore_OscUnavailableReason } = createAtomWithHook(initial<string | null>(null), "OscUnavailableReason");
export const { atomInstance: Atom_ComputeMode, useHook: useStore_ComputeMode } = createAtomWithHook("cpu", "ComputeMode");
export const { atomInstance: Atom_IsOpenedConfigPage, useHook: useStore_IsOpenedConfigPage } = createAtomWithHook(false, "IsOpenedConfigPage");
// Why each main switch cannot be turned on yet (main/switchBlocks.ts): {switch_id: {reason, action}}.
export const { useHook: useStore_VrCustomTranslationModelNames } = createAtomWithHook(
    initial<Partial<Record<string, string>>>({}), "VrCustomTranslationModelNames", { is_state_ok: true });
// The main window works it out once (SwitchBlocksController) and the VR panel reads the same value.
export const { atomInstance: Atom_SwitchBlocks, useHook: useStore_SwitchBlocks } = createAtomWithHook(initial<SwitchBlocks>({}), "SwitchBlocks", { is_state_ok: true });
export const { atomInstance: Atom_MainFunctionsStateMemory, useHook: useStore_MainFunctionsStateMemory } = createAtomWithHook(initial<MainFunctionsStateMemory>({
    transcription_send: false,
    transcription_receive: false,
}), "MainFunctionsStateMemory");
export const { atomInstance: Atom_OpenedQuickSetting, useHook: useStore_OpenedQuickSetting } = createAtomWithHook("", "OpenedQuickSetting");
export const { atomInstance: Atom_LatestSoftwareVersionInfo, useHook: useStore_LatestSoftwareVersionInfo } = createAtomWithHook({
    is_update_available: false,
    new_version: "0.0.0",
}, "LatestSoftwareVersionInfo");
export const { atomInstance: Atom_InitProgress, useHook: useStore_InitProgress } = createAtomWithHook(0, "InitProgress");
export const { atomInstance: Atom_IsBreakPoint, useHook: useStore_IsBreakPoint } = createAtomWithHook(false, "IsBreakPoint");
export const { atomInstance: Atom_IsSoftwareUpdating, useHook: useStore_IsSoftwareUpdating } = createAtomWithHook(false, "IsSoftwareUpdating");
export const { atomInstance: Atom_NotificationStatus, useHook: useStore_NotificationStatus } = createAtomWithHook(initial<NotificationStatus>({
    status: "",
    is_open: false,
    key: 0,
    message: "",
}), "NotificationStatus");
export const { atomInstance: Atom_IsLMStudioConnected, useHook: useStore_IsLMStudioConnected } = createAtomWithHook(false, "IsLMStudioConnected");
export const { atomInstance: Atom_IsOllamaConnected, useHook: useStore_IsOllamaConnected } = createAtomWithHook(false, "IsOllamaConnected");

// Main Page
// Common
export const { atomInstance: Atom_IsMainPageCompactMode, useHook: useStore_IsMainPageCompactMode } = createAtomWithHook(false, "IsMainPageCompactMode");

// Sidebar Section
export const { atomInstance: Atom_TranslationStatus, useHook: useStore_TranslationStatus } = createAtomWithHook(false, "TranslationStatus", {is_state_ok: true});
export const { atomInstance: Atom_TranscriptionSendStatus, useHook: useStore_TranscriptionSendStatus } = createAtomWithHook(false, "TranscriptionSendStatus", {is_state_ok: true});
export const { atomInstance: Atom_TranscriptionReceiveStatus, useHook: useStore_TranscriptionReceiveStatus } = createAtomWithHook(false, "TranscriptionReceiveStatus", {is_state_ok: true});
export const { atomInstance: Atom_OcrCaptureStatus, useHook: useStore_OcrCaptureStatus } = createAtomWithHook(false, "OcrCaptureStatus", {is_state_ok: true});
export const { atomInstance: Atom_ForegroundStatus, useHook: useStore_ForegroundStatus } = createAtomWithHook(false, "ForegroundStatus", {is_state_ok: true});
// Linux (Wayland): the window the user shares with chat reading. See logics/configs/ocrSharedWindow.ts.
export const { atomInstance: Atom_OcrSharedWindow, useHook: useStore_OcrSharedWindow } = createAtomWithHook(
    initial<SharedWindowState>({ supported: null, active: false, busy: false, error: null, restoring: false }), "OcrSharedWindow", {is_state_ok: true});

export const { atomInstance: Atom_SelectedPresetTabNumber, useHook: useStore_SelectedPresetTabNumber } = createAtomWithHook("1", "SelectedPresetTabNumber");
// The language write in flight and the VR panel's last result (main/languageMutations.ts).
export const { atomInstance: Atom_LanguageMutation, useHook: useStore_LanguageMutation } = createAtomWithHook(
    initial<LanguageMutationState & { isResyncing: boolean }>({ inFlight: null, lastVrResult: null, isResyncing: false }), "LanguageMutation", { is_state_ok: true }
);
export const { atomInstance: Atom_SelectedYourLanguages, useHook: useStore_SelectedYourLanguages } = createAtomWithHook(initialLanguages(), "SelectedYourLanguages");
export const { atomInstance: Atom_SelectedTargetLanguages, useHook: useStore_SelectedTargetLanguages } = createAtomWithHook(initialLanguages(true), "SelectedTargetLanguages");

export const { atomInstance: Atom_TranslationEngines, useHook: useStore_TranslationEngines } = createAtomWithHook(translator_status, "TranslationEngines");
// The translator chosen for each preset tab ("1" to "3").
export const { atomInstance: Atom_SelectedTranslationEngines, useHook: useStore_SelectedTranslationEngines } = createAtomWithHook(initial<Record<string, string>>({1:"", 2:"", 3:""}), "SelectedTranslationEngines");
export const { atomInstance: Atom_IsOpenedTranslatorSelector, useHook: useStore_IsOpenedTranslatorSelector } = createAtomWithHook(false, "IsOpenedTranslatorSelector");

// Language Selector
export const { atomInstance: Atom_IsOpenedLanguageSelector, useHook: useStore_IsOpenedLanguageSelector } = createAtomWithHook(
    { your_language: false, target_language: false, target_key: "1" },
    "IsOpenedLanguageSelector"
);
export const { atomInstance: Atom_SelectableLanguageList, useHook: useStore_SelectableLanguageList } = createAtomWithHook(initial<SelectableLanguage[]>([]), "SelectableLanguageList");

// Message Container
export const { atomInstance: Atom_MessageLogs, useHook: useStore_MessageLogs } = createAtomWithHook(initial<MessageLogRow[]>([]), "MessageLogs");
// The names the user gave the voices of the latest realtime sessions (#447); not saved.
export const { atomInstance: Atom_SpeakerNames, useHook: useStore_SpeakerNames } = createAtomWithHook(initial<SpeakerNames>({}), "SpeakerNames", { is_state_ok: true });
// export const { atomInstance: Atom_MessageLogs, useHook: useStore_MessageLogs } = createAtomWithHook(generateTestConversationData(20), "MessageLogs"); // For testing
// The core's default (MESSAGE_BOX_RATIO, docs/spec/reference/config-keys.md), so a new settings folder draws the
// composer at the height the core then confirms: nothing moves at start (#912).
export const { atomInstance: Atom_MessageInputBoxRatio, useHook: useStore_MessageInputBoxRatio } = createAtomWithHook(10, "MessageInputBoxRatio");
export const { atomInstance: Atom_MessageInputValue, useHook: useStore_MessageInputValue } = createAtomWithHook("", "MessageInputValue");



// Config Page
// Common
export const { atomInstance: Atom_SoftwareVersion, useHook: useStore_SoftwareVersion } = createAtomWithHook("-", "SoftwareVersion");
// Settings open on the first page of their menu (logics/configs/settingsMenu.ts, FIRST_SETTINGS_TAB).
export const { atomInstance: Atom_SelectedConfigTabId, useHook: useStore_SelectedConfigTabId } = createAtomWithHook("translation", "SelectedConfigTabId");
export const { atomInstance: Atom_SettingBoxScrollPosition, useHook: useStore_SettingBoxScrollPosition } = createAtomWithHook(0, "SettingBoxScrollPosition");
export const { atomInstance: Atom_IsOpenedDropdownMenu, useHook: useStore_IsOpenedDropdownMenu } = createAtomWithHook("", "IsOpenedDropdownMenu");

// Device
// The meters: the backend's level, or "0" when a check stops (useVolume).
export const { atomInstance: Atom_MicVolume, useHook: useStore_MicVolume } = createAtomWithHook(initial<number | string>(0), "MicVolume");
export const { atomInstance: Atom_SpeakerVolume, useHook: useStore_SpeakerVolume } = createAtomWithHook(initial<number | string>(0), "SpeakerVolume");

export const { atomInstance: Atom_MicThresholdCheckStatus, useHook: useStore_MicThresholdCheckStatus } = createAtomWithHook(false, "MicThresholdCheckStatus", {is_state_ok: true});
// VR UI のログウィンドウが視線から外れているか (ランチャーのボタンを「呼び戻す」にする)
export const { atomInstance: Atom_VrPanelLogOutOfView, useHook: useStore_VrPanelLogOutOfView } = createAtomWithHook(false, "VrPanelLogOutOfView", {is_state_ok: true});
// VR UI のランチャーの起動演出 ("idle" 通常 / "pending" 最初に出すのを待つ / "playing" 演出中)。atom なので VR ウィンドウへも同期される
export const { atomInstance: Atom_VrPanelLauncherIntro, useHook: useStore_VrPanelLauncherIntro } = createAtomWithHook(initial<"idle" | "pending" | "playing">("idle"), "VrPanelLauncherIntro", {is_state_ok: true});
export const { atomInstance: Atom_SpeakerThresholdCheckStatus, useHook: useStore_SpeakerThresholdCheckStatus } = createAtomWithHook(false, "SpeakerThresholdCheckStatus", {is_state_ok: true});

// The fonts the system has, each under its own name (arrayToObject).
export const { atomInstance: Atom_SelectableFontFamilyList, useHook: useStore_SelectableFontFamilyList } = createAtomWithHook(initial<Record<string, string>>({}), "SelectableFontFamilyList");


export const { atomInstance: Atom_IsOpenedMicWordFilterList, useHook: useStore_IsOpenedMicWordFilterList } = createAtomWithHook(false, "IsOpenedMicWordFilterList");

export const { atomInstance: Atom_MessageFormat_ExampleViewFilter, useHook: useStore_MessageFormat_ExampleViewFilter } = createAtomWithHook({
    send: "Simplified",
    received: "Simplified",
}, "MessageFormat_ExampleViewFilter");


// Hotkeys
export const { atomInstance: Atom_Hotkeys, useHook: useStore_Hotkeys } = createAtomWithHook(initial<Hotkeys>({
    open_quick_chat: null,
    toggle_vrct_visibility: null,
    toggle_translation: null,
    toggle_transcription_send: null,
    toggle_transcription_receive: null,
    stop_voice: null,
    toggle_voice_mute: null,
    toggle_tts: null,
    toggle_rvc: null,
}), "Hotkeys");

// The flow panel (logics/flow): where the user's voice and chat go now, and the stage times (ms)
// of the user's own recent messages. Registered, so the VR window mirrors them.
export const { atomInstance: Atom_IoFlow, useHook: useStore_IoFlow } = createAtomWithHook(initial<IoFlow | null>(null), "IoFlow");
export const { atomInstance: Atom_IoTraces, useHook: useStore_IoTraces } = createAtomWithHook(initial<Trace[]>([]), "IoTraces", { is_state_ok: true });
export const { atomInstance: Atom_IsOpenedIoFlowPanel, useHook: useStore_IsOpenedIoFlowPanel } = createAtomWithHook(false, "IsOpenedIoFlowPanel", { is_state_ok: true });
// The GPUs' memory (VRAM) the panel reads every 2 s while it is open (#448). Not mirrored to VR.
export const { atomInstance: Atom_GpuMemory, useHook: useStore_GpuMemory } = createAtomWithHook(initial<GpuMemory | null>(null), "GpuMemory");
