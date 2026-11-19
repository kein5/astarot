import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getDefaultStore } from "jotai";
import type { Atom } from "jotai";

import { dynamicStoreRegistry } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { useIsOpenedConfigPage, useNotificationStatus } from "@logics_common";
import { useI18n } from "@useI18n";
import { useVr } from "@logics_configs";
import { SETTINGS_ARRAY } from "../../../logics/configs/config_page_setter/ui_config_setter";
import { encodeLogUpdate, encodeOrdered, isRelayAllowed, vrPanelStateNames } from "../../../logics/common/vrPanelWire";
import type { LogUpdateValue, SentLog } from "../../../logics/common/vrPanelWire";
import { isLanguageMutation, rejectLanguageMutation } from "../../../logics/main/languageMutations";
import { failureRun, windowFailureKey } from "../../../logics/common/windowFailures.ts";
import type { FailureRun } from "../../../logics/common/windowFailures.ts";
import type { LanguageMutationRequest } from "../../../logics/main/languageMutationCoordinator.ts";

// VRパネル (vr_panel ウィンドウ) にこのウィンドウの状態を写す。
// - VRパネルが読むatomの値だけを一方向に同期する (vrPanelWire.vrPanelStateNames。SEC-03)。
//   VRパネルが開いたチャンネルへ送り、ほかのウィンドウには届かない (src-tauri/src/vr_panel_state.rs)
// - VRパネルからのバックエンド送信を代わりに行う。設定画面を開いている間は
//   メイン機能を一時停止しているため (ConfigPageCloseTriggerController)、拒否する
// - VRのVR設定ウィンドウを開いている間は、デスクトップで設定画面を開いたのと同じ扱いにする
//   (メイン機能を止め、閉じたら戻す)。このときだけ設定画面中でもVRからの送信を通す
//   (VR側は設定ウィンドウ以外を操作できないようにしている)
const jotai = getDefaultStore();

const WINDOW_REQUEST_PATHS = [
    "/run/vr_panel_windows",
    "/run/vr_panel_recall_log",
    "/set/data/overlay_vr_panel_anchor",
    "/set/enable/overlay_vr_panel_locked",
    "/set/disable/overlay_vr_panel_locked",
    "/set/data/overlay_vr_panel_opacity",
    "/set/data/overlay_vr_panel_font_size",
    "/run/vr_panel_layout_rendered",
    "/run/vr_panel_tooltip",
];

// A backend request that the VR panel asks this window to send (useStdoutToPython in the VR
// panel's window). The path is checked against the relay list before anything is sent; the
// value and the language request are declared as the panel sends them.
interface VrPanelStdoutRequest {
    path: unknown;
    value?: unknown;
    languageRequest?: LanguageMutationRequest;
}

// An atom of the registry with its name without "Atom_".
type NamedAtom = readonly [string, Atom<unknown>];

let allowedNames: Set<string> | null = null;
// The registry also holds the store hooks, which are functions; its "Atom_" entries are atoms.
const atomEntries = (): NamedAtom[] => {
    const allowed = allowedNames ??= vrPanelStateNames(SETTINGS_ARRAY);
    return Object.entries(dynamicStoreRegistry)
        .flatMap(([key, atom]): NamedAtom[] => key.startsWith("Atom_") && typeof atom !== "function"
            ? [[key.slice("Atom_".length), atom]] : [])
        .filter(([name]) => allowed.has(name));
};

// The conversation log's atom holds { state, data: rows }.
const isLogState = (value: unknown): value is LogUpdateValue<unknown> =>
    typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data);

// VRパネルへ最後に送った会話ログ。会話ログだけは、これとの差分を送る (vrPanelWire.encodeLogUpdate)
let sentLog: SentLog<unknown> | null = null;

// 変化したatomは値を丸ごと送る。full は会話ログも全件を送る (VRパネルが起動したときなど)
const emitState = (entries: readonly NamedAtom[], full = false) => {
    const payload: Record<string, unknown> = {};
    for (const [name, atom] of entries) {
        const value = jotai.get(atom);
        if (name === "MessageLogs" && isLogState(value)) {
            const update = encodeLogUpdate(sentLog, value, full);
            sentLog = update.sent;
            payload[name] = update.message;
            continue;
        }
        try {
            JSON.stringify(value);
            payload[name] = encodeOrdered(value); // emit でキーが辞書順になるので、並びを保つ形で送る
        } catch {
            // DOM参照など、ウィンドウをまたいで送れない値は同期しない
        }
    }
    invoke("vr_panel_state_push", { payload }).then(delivered => {
        // No panel received it: the next log update goes in full, not as a difference.
        if (delivered === false) sentLog = null;
    }).catch(console.error);
};

export const VrPanelSyncController = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentIsOpenedConfigPage, setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { currentIsEnabledOverlayVrPanel } = useVr();
    const { t } = useI18n();
    const { showNotification_Error } = useNotificationStatus();
    const openFailures = useRef<FailureRun | null>(null);
    // Made once; every render reads the same run of failures.
    const openFailure = openFailures.current ??= failureRun();

    // VR画面のウィンドウは VR UI が ON の間だけ作る (OFF の間も動かしておくと、使わない人にも負荷がかかる)。
    // 作られた VR画面は vr-panel-ready を送ってくるので、状態はそのときに送る
    const is_vr_panel_enabled = currentIsEnabledOverlayVrPanel.data === true;
    useEffect(() => {
        invoke("set_vr_panel_window", { open: is_vr_panel_enabled }).then(() => openFailure.succeeded(), error => {
            console.error("VR panel window could not be changed", error);
            // Turning the panel off needs no notice; a panel that cannot be opened does (#397).
            if (is_vr_panel_enabled) openFailure.failed(() => showNotification_Error(
                t(windowFailureKey("vr_panel", "open", error)), { category_id: "vr_panel_open_failed" }));
        });
    }, [is_vr_panel_enabled]);
    const isOpenedConfigPageRef = useRef(currentIsOpenedConfigPage.data);
    isOpenedConfigPageRef.current = currentIsOpenedConfigPage.data;
    // VRのVR設定ウィンドウを開いているか (開いている間はVRからの送信を通す)
    const isVrSettingsOpenRef = useRef(false);
    // 設定画面を開いたのがVRか (VR設定ウィンドウを閉じたとき、設定画面も閉じてよいか)
    const isOpenedByVrRef = useRef(false);

    // デスクトップ側で設定画面が閉じられたら、VRの扱いも終わる (VR側は設定ウィンドウを閉じる)
    useEffect(() => {
        if (currentIsOpenedConfigPage.data !== true) {
            isVrSettingsOpenRef.current = false;
            isOpenedByVrRef.current = false;
        }
    }, [currentIsOpenedConfigPage.data]);

    // VR UI がOFFの間は、全atomの同期も VR画面からの要求の受付もしない (VR画面のウィンドウが無いのに、
    // 状態が変わるたびに直列化して送ることになるため)。ONになったら全状態を送る
    useEffect(() => {
        if (!is_vr_panel_enabled) return undefined;
        let disposed = false;
        const entries = atomEntries();
        const unsubscribes = entries.map(([name, atom]) =>
            jotai.sub(atom, () => emitState([[name, atom]]))
        );
        const unlistenReady = listen("vr-panel-ready", () => {
            if (!disposed) emitState(atomEntries(), true);
        });
        const unlistenStdout = listen<VrPanelStdoutRequest>("vr-panel-stdout", ({ payload }) => {
            if (disposed) return;
            const { path, value, languageRequest } = payload;
            if (!isRelayAllowed(path)) {
                console.warn("[vr-panel] blocked request from the VR panel:", path);
                rejectLanguageMutation(languageRequest, "blocked");
                return;
            }
            // ウィンドウの開閉・呼び戻しと、ログの操作バー (固定先・ロック・不透明度) はメイン機能と関係ないので、
            // 設定画面を開いている間も通す
            const is_window_request = WINDOW_REQUEST_PATHS.includes(path);
            const is_allowed = is_window_request || isVrSettingsOpenRef.current === true;
            if (isOpenedConfigPageRef.current === true && !is_allowed) {
                rejectLanguageMutation(languageRequest, "config-open");
                // VRパネル側で pending にした表示を元に戻すため、状態を送り直す
                emitState(atomEntries());
                return;
            }
            asyncStdoutToPython(path, value, languageRequest, "vr_panel").then(sent => {
                if (sent === false && isLanguageMutation(path)) emitState(atomEntries());
            }).catch(console.error);
        });
        const unlistenConfigPage = listen("vr-panel-config-page", ({ payload: is_opened }) => {
            if (disposed) return;
            if (is_opened === true) {
                isVrSettingsOpenRef.current = true;
                // デスクトップが先に開いていたら、VR側を閉じてもデスクトップの設定画面は閉じない
                if (isOpenedConfigPageRef.current !== true) isOpenedByVrRef.current = true;
                setIsOpenedConfigPage(true);
                return;
            }
            isVrSettingsOpenRef.current = false;
            // VRが開いたときだけ閉じる (VRの起動時などに届く false でデスクトップの設定画面を閉じない)
            if (isOpenedByVrRef.current === true) {
                isOpenedByVrRef.current = false;
                setIsOpenedConfigPage(false);
            }
        });
        // VRパネルが先に起動していた場合に備えて、こちらからも一度送る
        emitState(entries, true);

        return () => {
            disposed = true;
            isVrSettingsOpenRef.current = false;
            isOpenedByVrRef.current = false;
            unsubscribes.forEach(unsubscribe => unsubscribe());
            unlistenReady.then(f => f());
            unlistenStdout.then(f => f());
            unlistenConfigPage.then(f => f());
        };
    }, [is_vr_panel_enabled]);

    return null;
};
