import { useEffect, useRef, useState } from "react";

// A built-in model's download state, as the settings page holds it. `progress` is a
// percentage while the download runs.
export interface LegacyDownloadOption {
    progress?: number | null;
    is_pending?: boolean;
    is_downloaded?: boolean;
}

export type LegacyDownloadPhase = "pending" | "downloading" | "finalizing" | "complete" | "stopped";

// The translate function of the page: the key and the values it fills in.
export type StatusTranslate = (key: string, values: { model: string; progress: number }) => string;

interface Announcement {
    phase: LegacyDownloadPhase | null;
    model: string;
    at: number;
    active: boolean;
}

export const legacyDownloadPhase = (option: LegacyDownloadOption): LegacyDownloadPhase =>
    typeof option.progress === "number" && Number.isFinite(option.progress)
        ? option.progress >= 100 ? "finalizing" : "downloading"
        : option.is_pending ? "pending" : option.is_downloaded ? "complete" : "stopped";

// Announce phases immediately, percentages at ten-point intervals and at most
// once a second. Keep a trailing update so the last received value is not lost.
export function useLegacyDownloadStatus(option: LegacyDownloadOption, model: string, t: StatusTranslate): string {
    const [status, setStatus] = useState("");
    const announced = useRef<Announcement>({ phase: null, model, at: 0, active: false });
    // The t the status was said with.
    const saidWith = useRef(t);
    const phase = legacyDownloadPhase(option);
    const progress = Math.floor(Math.max(0, Math.min(100, option.progress || 0)) / 10) * 10;
    useEffect(() => {
        const previous = announced.current;
        const active = phase === "pending" || phase === "downloading" || phase === "finalizing";
        if (!active && (!previous.active || previous.model !== model)) {
            // Nothing is downloading, so nothing is said again. Words said in a UI language the
            // page no longer has go, as they did when a change of language drew the page again (#904).
            if (saidWith.current !== t) { saidWith.current = t; setStatus(""); }
            return;
        }
        const publish = (): void => {
            saidWith.current = t;
            setStatus(t(`legacy_model_downloads.progress_${phase}`, { model, progress }));
            announced.current = { phase, model, at: Date.now(), active };
        };
        if (phase !== previous.phase || model !== previous.model) { publish(); return; }
        const timer = setTimeout(publish, Math.max(0, 1000 - (Date.now() - previous.at)));
        return () => clearTimeout(timer);
    }, [phase, progress, model, t]);
    return status;
}
