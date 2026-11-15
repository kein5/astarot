import { useSwitchBlocksSource } from "../../../logics/main/useSwitchBlocks";

// Works out, once for every window, which main switches cannot be turned on yet and why
// (useSwitchBlocks.js). The main window's switches and the VR panel's launcher read the result.
export const SwitchBlocksController = () => {
    useSwitchBlocksSource();
    return null;
};
