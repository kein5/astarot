// VRオーバーレイに映すための画面 (Tauriの "vr_panel" ウィンドウ)。
// sidecarは起動しない。状態はメインウィンドウから同期され (VrPanelSyncController)、
// バックエンドへの送信はメインウィンドウ経由で行う (useStdoutToPython)。
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "@root/locales/config.js";
import "../app/_index_css/root.css";

import { store } from "@store";

store.is_vr_panel = true;

import { VrApp } from "./VrApp";

const root = document.getElementById("root");
if (root) {
    ReactDOM.createRoot(root).render(
        <StrictMode>
            <VrApp />
        </StrictMode>,
    );
}
