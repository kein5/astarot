import type { AtomState } from "@store";
import type { SteamVrAutoLaunch } from "./config_page_setter/settingTypes.ts";

// What the VR page's "Start with SteamVR" row shows (#1384). Whether there is a row at all is
// known from the start-up (SteamVrAutoLaunchSupported), so it never comes or goes while the page is
// open. SteamVR keeps the flag, so the row shows the core's last answer: the switch is on when
// SteamVR's flag is, and it can be pressed only while SteamVR answered. Until the first answer it
// waits, off and not pressable.
export interface SteamVrSwitchView {
    // False in a build SteamVR cannot start (no manifest beside the executable): no row at all.
    shown: boolean;
    variable: { state: string; data: boolean };
    available: boolean;
    // The line under the label that says why the switch cannot be pressed, as a locale key.
    note: string | null;
}

// Every line the note may show. The row keeps room for the longest of them, so the page does not
// move when SteamVR's answer comes or changes (#912).
export const STEAMVR_NOTES = [
    "config_page.vr.steamvr_auto_launch.steamvr_not_running",
    "config_page.vr.steamvr_auto_launch.steamvr_unreachable",
] as const;

export const steamVrSwitchView = (supported: boolean, current: AtomState<SteamVrAutoLaunch | null>): SteamVrSwitchView => {
    const answer = current.data;
    const variable = { state: current.state, data: answer?.enabled === true };
    if (!supported) return { shown: false, variable, available: false, note: null };
    if (answer === null || answer.available) return { shown: true, variable, available: answer !== null, note: null };
    const note = answer.reason === "steamvr_not_running" ? STEAMVR_NOTES[0]
        : answer.reason === "steamvr_unreachable" ? STEAMVR_NOTES[1] : null;
    return { shown: true, variable, available: false, note };
};
