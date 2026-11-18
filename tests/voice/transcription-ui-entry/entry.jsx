// The production speech recognition settings page with its hooks and response routes; only
// the desktop transport is replaced by the test's peer.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { store } from "@store";
import { useReceiveRoutes } from "@useReceiveRoutes";
import { Transcription } from "../../../src-ui/views/app/config_page/setting_section/setting_box/transcription/Transcription";
import "../../../src-ui/views/app/_index_css/root.css";
import i18n from "../../../locales/config";

const query = new URLSearchParams(location.search);
i18n.changeLanguage(query.get("lang") || "en");
store.backend_subprocess = { write: line => window.sidecarWrite(line) };
function App() {
    const receiver = useRef(); receiver.current = useReceiveRoutes().receiveRoutes;
    useEffect(() => {
        let active = true;
        const poll = async () => { for (const response of await window.sidecarRead()) receiver.current(response); if (active) setTimeout(poll, 20); };
        poll(); return () => { active = false; };
    }, []);
    const width = Number(query.get("width")) || 900;
    return <main style={{ maxWidth: width, margin: "0 auto", padding: "0 16px", background: "var(--vox_canvas, #261633)" }}>
        <Transcription />
    </main>;
}
createRoot(document.getElementById("root")).render(<App />);
