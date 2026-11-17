import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { store } from "@store";
import { useReceiveRoutes } from "@useReceiveRoutes";
import { TranslationCatalogSection } from "../../../src-ui/views/app/config_page/setting_section/setting_box/translation/TranslationCatalog";
import "../../../locales/config";
store.backend_subprocess = { write: line => window.sidecarWrite(line) };
function App() {
    const receiver = useRef(); receiver.current = useReceiveRoutes().receiveRoutes;
    useEffect(() => {
        let active = true;
        const poll = async () => { for (const response of await window.sidecarRead()) receiver.current(response); if (active) setTimeout(poll, 20); };
        poll(); return () => { active = false; };
    }, []);
    const width = Number(new URLSearchParams(location.search).get("width")) || 900;
    return <main style={{ maxWidth: width, margin: 24, color: "#e5e7eb", background: "#1b2333" }}>
        <TranslationCatalogSection />
    </main>;
}
createRoot(document.getElementById("root")).render(<App />);
