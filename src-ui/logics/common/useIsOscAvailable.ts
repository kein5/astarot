import { useStore_IsOscAvailable, useStore_OscUnavailableReason } from "@store";

// The reason a control that needs OSC reception is unavailable, as a locale key.
// With VRChat on another machine there is nothing to fix in the OSC settings;
// with OSCQuery turned off (#559) only its switch brings it back.
export const oscUnavailableLabelKey = (reason: string | null) => {
    if (reason === "remote_destination") return "config_page.common.warning_labels.unable_to_use_osc_query_remote";
    if (reason === "turned_off") return "config_page.common.warning_labels.unable_to_use_osc_query_off";
    return "config_page.common.warning_labels.unable_to_use_osc_query";
};

export const useIsOscAvailable = () => {
    const { currentIsOscAvailable, updateIsOscAvailable } = useStore_IsOscAvailable();
    const { currentOscUnavailableReason, updateOscUnavailableReason } = useStore_OscUnavailableReason();

    return {
        currentIsOscAvailable,
        updateIsOscAvailable,
        currentOscUnavailableReason,
        updateOscUnavailableReason,
        oscUnavailableLabelKey: oscUnavailableLabelKey(currentOscUnavailableReason.data),
    };
};
