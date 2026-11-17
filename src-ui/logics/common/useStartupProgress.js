import { useStore_InitProgress } from "@store";
import { useTranslation } from "@logics_configs";
import { startupDownloads } from "./startupPhase.ts";

// The engine reports four startup steps (/run/initialization_progress).
export const STARTUP_STEPS = 4;

// How far the engine's start has come: its step (0 until the first report)
// and the models it is fetching before it is ready.
export const useStartupProgress = () => {
    const { currentInitProgress } = useStore_InitProgress();
    const { currentCTranslate2WeightTypeStatus } = useTranslation();
    const reported = Number(currentInitProgress.data);
    return {
        step: Number.isFinite(reported) ? Math.max(0, Math.min(STARTUP_STEPS, Math.floor(reported))) : 0,
        downloads: startupDownloads({ translationWeights: currentCTranslate2WeightTypeStatus.data }),
    };
};
