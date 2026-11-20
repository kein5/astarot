import { useI18n } from "@useI18n";
import { useVrchatPresence } from "./VrchatPresence";

// The empty conversation's line on turning OSC on in VRChat (#614). It is a state, not standing
// help: drawn only while the app finds no VRChat with OSC on, which is when the readout in the
// quick settings shows the same step. While that is not known (not answered yet, OSCQuery off,
// the messages going to another machine) or sending is off, nothing is drawn, so the line does
// not show up at startup only to go away once VRChat answers. While it is on screen it asks
// again every few seconds, as the readout does (useVrchatPresence), so starting VRChat or
// enabling OSC takes the line away by itself.
export const VrchatOscHint = ({ className }: { className?: string }) => {
    const { t } = useI18n();
    const { state } = useVrchatPresence();
    return state === "not_found" ? <p className={className}>{t("studio.empty_vrchat_hint")}</p> : null;
};
