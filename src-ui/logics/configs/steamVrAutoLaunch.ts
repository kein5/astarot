import type { AtomState } from "@store";
import type { SteamVrAutoLaunch, SteamVrAutoLaunchReason } from "./config_page_setter/settingTypes.ts";

// What the VR page's "Start with SteamVR" row shows (#1384). SteamVR keeps the flag, so the row
// shows the core's last answer: the switch is on when SteamVR's flag is, and it can be pressed
// only while SteamVR answered. Until the first answer it waits, off and not pressable.
export interface SteamVrSwitchView {
    // False in a build SteamVR cannot start (no manifest beside the executable): no row at all.
    shown: boolean;
    variable: { state: string; data: boolean };
    available: boolean;
    // The line under the label that says why the switch cannot be pressed, as a locale key.
    note: string | null;
}

const NOTES: Readonly<Record<Exclude<SteamVrAutoLaunchReason, "unsupported">, string>> = {
    steamvr_not_running: "config_page.vr.steamvr_auto_launch.steamvr_not_running",
    steamvr_unreachable: "config_page.vr.steamvr_auto_launch.steamvr_unreachable",
};

export const steamVrSwitchView = (current: AtomState<SteamVrAutoLaunch | null>): SteamVrSwitchView => {
    const answer = current.data;
    const variable = { state: current.state, data: answer?.enabled === true };
    if (answer === null || answer.available) return { shown: true, variable, available: answer !== null, note: null };
    if (answer.reason === "unsupported") return { shown: false, variable, available: false, note: null };
    return { shown: true, variable, available: false, note: NOTES[answer.reason] };
};
