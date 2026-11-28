import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getDefaultStore } from "jotai";
import type { Atom, WritableAtom } from "jotai";

import { dynamicStoreRegistry, useStore_IsOpenedSettingsWindow } from "@store";
import type { AtomState, RegisteredStoreHook } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { useIsOpenedConfigPage } from "@logics_common";

import {
    UiLanguageController,
    FontFamilyController,
    ThemeController,
} from "../app/_app_controllers";

import { useVr } from "@logics_configs";
import { VrLauncher } from "./VrLauncher";
import { VrLogWindow } from "./VrLogWindow";
import { VrPopupWindow } from "./VrPopupWindow";
import { VrToolbar } from "./VrToolbar";
import { VrTooltip } from "./VrTooltip";
import { keepNewestVrLayout } from "../../logics/common/vrPanelTooltip";
import { decodeLogUpdate, decodeOrdered, isLogUpdate } from "../../logics/common/vrPanelWire";
import { trackVrPointerHover } from "./vrPanelHover";
import { sendToMain } from "../../logics/common/vrPanelSend.ts";
import type { ReceivedLog } from "../../logics/common/vrPanelWire";
import type { VrPointer } from "./vrPanelHover";
import type { VrWindows } from "./VrLauncher";
import type { VrPopup } from "./VrPopupWindow";
import type { VrPanelLayout } from "../../logics/configs/config_page_setter/settingTypes.ts";

import * as styles from "./VrApp.css.ts";

// VR UI は1枚の画面外ウィンドウ (vr_layout.json の atlas) に各ウィンドウを並べて描く。
// Python 側 (models/overlay/overlay.py) が1回だけ撮影し、領域ごとに別のオーバーレイとして表示する。
// VRでは px で固定する (デスクトップのUI倍率 UiSizeController は使わない。
// 大きさはVR内で掴んで拡大縮小できる)。
type RegionProps = {
    layout: VrPanelLayout;
    name: keyof VrPanelLayout["regions"];
    children?: ReactNode;
    hidden?: boolean;
};

// The size of each swatch of the log's background colours, in logical px
// (PANEL_BACKGROUND_SWATCH_PX in native/vr-overlay/src/layout.rs, #1247).
export const BACKGROUND_SWATCH_PX = 8;

// The log's background colours, the window's fill above the log's own, in the gap right of the
// log (at least 8 px wide at every log size). No overlay shows them; the overlay reads them to make
// the log's background, and only it, see-through by the log's opacity.
const BackgroundSwatch = ({ layout }: { layout: VrPanelLayout }) => {
    const [x, y, w] = layout.regions.panel;
    return (
        <div className={styles.background_swatch} data-vr-background-swatch aria-hidden="true"
            style={{ left: x + w, top: y, width: BACKGROUND_SWATCH_PX, height: BACKGROUND_SWATCH_PX * 2 }}>
            <div className={styles.swatch_fill} />
            <div className={styles.swatch_log} />
        </div>
    );
};

const Region = ({ layout, name, children, hidden = false }: RegionProps) => {
    const [x, y, w, h] = layout.regions[name];
    return (
        <div className={styles.region} data-vr-region={name} inert={hidden} aria-hidden={hidden || undefined}
            style={{ left: x, top: y, width: w, height: h, visibility: hidden ? "hidden" : undefined }}>
            {children}
        </div>
    );
};

export const VrApp = () => {
    const atlas = useRef<HTMLDivElement>(null);
    // 並びはログの大きさで変わる (Python が決めて知らせる。models/overlay/overlay.py computeVrLayout)
    const { currentVrPanelLayout } = useVr();
    const layout = currentVrPanelLayout.data;
    const [atlas_width, atlas_height] = layout.atlas;
    const [, , panel_width, panel_height] = layout.regions.panel;
    const { asyncStdoutToPython } = useStdoutToPython();
    // 新しい並びで描き終えたら Python に知らせる (それまで撮ったフレームは表示に使われない)。
    // 並びはログの大きさで決まるので、ログの大きさを送る (全体の大きさはログを縮めても変わらないことがある)。
    // 描画が画面に反映されるのを待つため、2フレーム後に送る
    useEffect(() => {
        let second: number | null = null;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => asyncStdoutToPython("/run/vr_panel_layout_rendered", [panel_width, panel_height]));
        });
        return () => {
            cancelAnimationFrame(first);
            if (second !== null) cancelAnimationFrame(second);
        };
    }, [panel_width, panel_height]);
    // 開いているウィンドウはこの画面の中だけで持つ (同期される atom に置くとメインの値で上書きされる)。
    // 表示・非表示の結果だけを Python に伝える。一時ウィンドウは同時に1つだけ
    // 起動時はランチャーだけを出す (ログは必要なときにランチャーから開く)
    const [windows, setWindows] = useState<VrWindows>({ log: false, popup: null });
    useEffect(() => {
        asyncStdoutToPython("/run/vr_panel_windows", { log: windows.log, popup: windows.popup !== null });
    }, [windows.log, windows.popup]);

    // VR設定ウィンドウを開いている間は、デスクトップで設定を開いたのと同じ扱いにする
    // (設定画面ならメインがメイン機能を止め、閉じたら戻す。アプリでは設定のウィンドウを開き、何も止めない。VrPanelSyncController)
    const is_settings_open = windows.popup === "settings";
    useEffect(() => {
        sendToMain("vr-panel-config-page", is_settings_open).catch(console.error);
    }, [is_settings_open]);
    // デスクトップ側で設定画面 (アプリでは設定のウィンドウ、#1236) が閉じられたら、VR設定ウィンドウも閉じる
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { currentIsOpenedSettingsWindow } = useStore_IsOpenedSettingsWindow();
    const is_desktop_settings_open = currentIsOpenedConfigPage.data === true || currentIsOpenedSettingsWindow.data === true;
    const was_config_page_open = useRef(false);
    useEffect(() => {
        if (was_config_page_open.current && !is_desktop_settings_open) {
            setWindows(w => (w.popup === "settings" ? { ...w, popup: null } : w));
        }
        was_config_page_open.current = is_desktop_settings_open;
    }, [is_desktop_settings_open]);

    const toggleLog = () => setWindows(w => ({ ...w, log: !w.log }));
    const openLog = () => setWindows(w => ({ ...w, log: true }));
    const togglePopup = (name: VrPopup) => setWindows(w => ({ ...w, popup: w.popup === name ? null : name }));
    const closePopup = () => setWindows(w => ({ ...w, popup: null }));
    // A row of the windows menu opens its window in the menu's place (#1314, V-4).
    const openPopup = (name: VrPopup) => setWindows(w => ({ ...w, popup: name }));

    return (
        <div ref={atlas} className={styles.atlas} style={{ width: atlas_width, height: atlas_height }}>
            <VrStateReceiver />
            <VrPointerHover atlasRef={atlas} />
            <UiLanguageController />
            <FontFamilyController />
            <ThemeController />

            <Region layout={layout} name="panel" hidden={!windows.log}><VrLogWindow open={windows.log} onClose={toggleLog} /></Region>
            <BackgroundSwatch layout={layout} />
            <Region layout={layout} name="launcher"><VrLauncher windows={windows} toggleLog={toggleLog} openLog={openLog} togglePopup={togglePopup} /></Region>
            <Region layout={layout} name="popup"><VrPopupWindow popup={windows.popup} onOpen={openPopup} onClose={closePopup} /></Region>
            <Region layout={layout} name="toolbar"><VrToolbar /></Region>
            <Region layout={layout} name="tooltip"><VrTooltip atlasRef={atlas} layout={layout} /></Region>
        </div>
    );
};

// WebView2 はOSの本物のカーソル位置でホバーを判定するため、VRのポインタでは :hover が付かない。
// Python から届くポインタ位置 (この画面の論理px) にある要素へ data-vr-hover を付けて代わりにする。
const VrPointerHover = ({ atlasRef }: { atlasRef: RefObject<HTMLDivElement | null> }) => {
    useEffect(() => {
        // The atlas is drawn before its effects run.
        if (atlasRef.current === null) throw new TypeError("The VR panel's atlas is not drawn");
        const hover = trackVrPointerHover(atlasRef.current);
        // A position or null (useVrPanelPointer), as the main window forwards it: declared, not checked.
        const unlisten = listen<VrPointer | null>("vr-panel-pointer", ({ payload }) => hover.setPointer(payload));
        return () => {
            hover.dispose();
            unlisten.then(f => f());
        };
    }, [atlasRef]);
    return null;
};

// The atom of a name in this window's store, which the main window mirrors here
// (VrPanelSyncController, vrPanelWire.ts). The registry keeps every atom as Atom<unknown> and the
// channel carries no types: what arrives for a name is the value the main window's atom of that
// name holds, so this window's atom takes it as it is. This guard is the one place that says so.
// It checks only that the registry has an atom there, as the receiver always did.
type MirroredAtom = WritableAtom<AtomState<unknown>, [(previous: AtomState<unknown>) => unknown], void>;
const isMirroredAtom = (target: RegisteredStoreHook | Atom<unknown> | undefined): target is MirroredAtom =>
    Boolean(target) && typeof target !== "function";

// The data of an atom's value, read as `value.data` reads it.
const dataOf = (value: unknown): unknown => typeof value === "object" && value !== null && "data" in value ? value.data : undefined;

// メインウィンドウから送られてくるatomの値を、このウィンドウのatomへそのまま反映する。
// 会話ログは差分で届くので、前に受け取ったログに当てる。差分の元を受け取っていなければ、全件を頼み直す。
// 状態はこのウィンドウが開いたチャンネルだけで届く (SEC-03。src-tauri/src/vr_panel_state.rs)。
// イベントにすると、イベントを聞けるほかのウィンドウにも会話ログが届いてしまう
const VrStateReceiver = () => {
    useEffect(() => {
        const jotai = getDefaultStore();
        let receivedLog: ReceivedLog | null = null;
        let isAwaitingFullLog = true; // 起動時の vr-panel-ready で全件が届く
        let active = true;
        // The atoms' names and their encoded values, as VrPanelSyncController pushes them: declared, not checked.
        const channel = new Channel<Readonly<Record<string, unknown>>>();
        channel.onmessage = (payload) => {
            if (!active) return;
            for (const [name, encoded] of Object.entries(payload)) {
                let value: unknown;
                if (isLogUpdate(encoded)) {
                    const log = decodeLogUpdate(receivedLog, encoded);
                    if (!log) {
                        if (!isAwaitingFullLog) sendToMain("vr-panel-ready").catch(console.error);
                        isAwaitingFullLog = true;
                        continue;
                    }
                    receivedLog = log;
                    isAwaitingFullLog = false;
                    value = { state: log.state, data: log.rows };
                } else {
                    value = decodeOrdered(encoded);
                }
                const atom = dynamicStoreRegistry[`Atom_${name}`];
                if (isMirroredAtom(atom)) jotai.set(atom, previous => name === "VrPanelLayout" &&
                    keepNewestVrLayout(previous.data, dataOf(value)) === previous.data ? previous : value);
            }
        };
        // 受信の準備ができてから全状態を要求する (メインが先に起動していた場合)
        invoke("vr_panel_state_subscribe", { channel })
            .then(() => { if (active) return sendToMain("vr-panel-ready"); })
            .catch(console.error);
        return () => { active = false; };
    }, []);
    return null;
};
