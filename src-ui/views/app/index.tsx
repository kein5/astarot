import React from "react";
import ReactDOM from "react-dom/client";
import "@root/locales/config.ts";
import "./_index_css/root.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { store } from "@store";

store.appWindow = getCurrentWindow();

import { App } from "./App";
import { startWithSavedTheme } from "../../logics/theme/startWithSavedTheme.ts";

// The saved theme from the first paint (#1259): in place before the first render.
startWithSavedTheme();

const root = document.getElementById("root");
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
}