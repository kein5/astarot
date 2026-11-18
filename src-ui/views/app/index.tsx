import React from "react";
import ReactDOM from "react-dom/client";
import "@root/locales/config.js";
import "./_index_css/root.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { store } from "@store";

store.appWindow = getCurrentWindow();

import { App } from "./App";

const root = document.getElementById("root");
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
}