import { createContext, useContext } from "react";
import type { ReactElement } from "react";

// Set by MainPage while the engine starts: what the first screen shows in place
// of its setup list (StartupProgress). Passed down rather than read from the
// startup atoms, so the VR panel, which shares the log, does not read them.
export const StartupContext = createContext<ReactElement | null>(null);

export const useStartupPlaceholder = () => useContext(StartupContext);

// True while the main page is locked for the engine's start.
export const useIsStartingUp = () => useContext(StartupContext) !== null;
