import { atom, useAtom } from "jotai";
import { useVr } from "@logics_configs";
import { overlayToggle } from "./overlayQuickToggle.ts";
import type { OverlayPair } from "./overlayQuickToggle.ts";

// Which overlays the quick toggle turned off, for its next press; for this run only (the
// overlays' own settings are saved by the core).
const keptAtom = atom<OverlayPair | null>(null);

// The quick settings' subtitle overlay (#939): on when either overlay in VR is on; a press
// switches them in place (overlayQuickToggle.ts). Pending while either is being switched.
export const useOverlayQuickToggle = () => {
    const { currentIsEnabledOverlaySmallLog: small, currentIsEnabledOverlayLargeLog: large,
        toggleIsEnabledOverlaySmallLog, toggleIsEnabledOverlayLargeLog } = useVr();
    const [kept, setKept] = useAtom(keptAtom);
    const now = { small: small.data === true, large: large.data === true };
    const pending = small.state === "pending" || large.state === "pending";
    const toggle = () => {
        if (pending) return;
        const { flip, keep } = overlayToggle(now, kept);
        setKept(keep);
        if (flip.includes("small")) toggleIsEnabledOverlaySmallLog();
        if (flip.includes("large")) toggleIsEnabledOverlayLargeLog();
    };
    return { on: now.small || now.large, pending, toggle };
};
