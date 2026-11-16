import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// What the title bar's close button does: put the window away in the tray (true), quit (false),
// or not known yet (null). Closing hides only when the tray icon can be seen
// (companion_hide_main, src-tauri/src/companion.rs); on a desktop without a tray it quits.
export type CloseHides = boolean | null;

// The close button's name, so a screen reader says what pressing it will do.
export const closeButtonLabelKey = (hides: CloseHides) =>
    hides === true ? "studio.close_to_tray" : hides === false ? "studio.close" : "studio.close_window";

type Ask = () => Promise<unknown>;
const askCore: Ask = () => invoke<boolean>("companion_close_hides");

// Asks when the window opens and each time it gets the focus back: a tray host can start or stop
// while the app runs (a panel extension turned on after login, for example).
export const useCloseHides = (ask: Ask = askCore): CloseHides => {
    const [hides, setHides] = useState<CloseHides>(null);
    useEffect(() => {
        let current = true, asked = 0;
        const check = () => {
            const mine = ++asked;
            Promise.resolve().then(ask).then(
                answer => { if (current && mine === asked) setHides(answer === true); },
                // When the core cannot be asked, the close quits too (CompanionController).
                () => { if (current && mine === asked) setHides(false); });
        };
        check();
        if (typeof window === "undefined") return () => { current = false; };
        window.addEventListener("focus", check);
        return () => {
            current = false;
            window.removeEventListener("focus", check);
        };
    }, [ask]);
    return hides;
};
