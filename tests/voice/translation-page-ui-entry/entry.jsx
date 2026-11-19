// Test assembly only: the translation page, its hooks and the response routes are production
// imports. The reads the app makes when it starts (the selected model, the models on the PC,
// the download catalog) are asked here; tests/voice/test_translation_catalog_ui.py answers them.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { store } from "@store";
import { useReceiveRoutes } from "@useReceiveRoutes";
import { useStdoutToPython } from "@useStdoutToPython";
import { Translation } from "../../../src-ui/views/app/config_page/setting_section/setting_box/translation/Translation";
import i18n from "../../../locales/config";
// ?lang=ja draws the page in Japanese; without it the browser's language decides, as before.
const lang = new URLSearchParams(location.search).get("lang");
if (lang) i18n.changeLanguage(lang);
store.backend_subprocess = { write: line => window.sidecarWrite(line) };
const STARTUP_READS = ["/get/data/selected_ctranslate2_weight_type",
    "/get/data/selectable_ctranslate2_weight_type_dict", "/get/data/model_download_catalog"];
function App() {
    const receiver = useRef(); receiver.current = useReceiveRoutes().receiveRoutes;
    const { asyncStdoutToPython } = useStdoutToPython();
    useEffect(() => {
        let active = true;
        const poll = async () => { for (const response of await window.sidecarRead()) receiver.current(response); if (active) setTimeout(poll, 20); };
        poll();
        for (const endpoint of STARTUP_READS) asyncStdoutToPython(endpoint);
        return () => { active = false; };
    }, []);
    return <main style={{ maxWidth: 900, margin: 24, color: "#e5e7eb", background: "#1b2333" }}>
        <Translation />
    </main>;
}
createRoot(document.getElementById("root")).render(<App />);
