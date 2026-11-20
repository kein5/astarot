import { createContext, useContext } from "react";
import type { ComponentType } from "react";

// Set by MainPage: the line the first screen shows under its list while no VRChat with OSC on
// is found (VrchatOscHint). Passed down as a part, like the startup list (startupContext), so
// the VR panel, which shares the log, neither reads VRChat's presence nor asks for it.
export type FirstScreenHint = ComponentType<{ className?: string }>;

export const VrchatHintContext = createContext<FirstScreenHint | null>(null);

export const useVrchatHint = () => useContext(VrchatHintContext);
