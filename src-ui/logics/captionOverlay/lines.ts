// Which rows of the message log become captions over the desktop, and for how long.
// Pure: the main window's controller and the overlay page both use it.
import { speakerLabels } from "../common/speakerLabels.ts";

// A message of a log row: the original or one translation.
export interface CaptionMessage {
    message?: string | null;
}

// A row of the message log, as far as it is read here.
export interface CaptionSourceRow {
    id?: unknown;
    category?: unknown;
    status?: unknown;
    speakers?: unknown;
    messages?: {
        original?: CaptionMessage | null;
        translations?: readonly (CaptionMessage | null | undefined)[] | null;
    } | null;
}

export interface CaptionOptions {
    onlyTranslated?: boolean;
    max?: number;
}

export interface CaptionLine {
    id: string;
    kind: "sent" | "received";
    text: string;
    translations: string[];
    pending: boolean;
    speakers?: string[];
}

// When a line stops being shown; `key` tells whether its words changed.
export interface CaptionStamp {
    key: string;
    until: number;
}

// More lines than this would cover the game.
export const MAX_CAPTION_LINES = 4;
// The native side refuses longer text (src-tauri/src/caption_overlay.rs).
const MAX_TEXT = 2000;
const MAX_TRANSLATIONS = 3;
// A line fades for this long before it goes.
export const FADE_MS = 400;

const clip = (text: string): string => [...text].slice(0, MAX_TEXT).join("");

// The last rows that carry words: sent (typed, or the user's own speech) and
// received (heard, or read from the screen). System rows are not captions.
// A realtime row keeps its id while it is being recognized, so its line is
// rewritten in place.
export const captionLines = (rows: readonly (CaptionSourceRow | null | undefined)[],
    { onlyTranslated = false, max = MAX_CAPTION_LINES }: CaptionOptions = {}): CaptionLine[] => {
    const lines: CaptionLine[] = [];
    for (let index = rows.length - 1; index >= 0 && lines.length < max; index--) {
        const row = rows[index];
        if (row?.category !== "sent" && row?.category !== "received") continue;
        const translations = (row.messages?.translations ?? [])
            .map(item => item?.message ?? "").filter(Boolean).slice(0, MAX_TRANSLATIONS).map(clip);
        // "Only the translation" still shows the original while no translation exists.
        const text = onlyTranslated && translations.length ? "" : clip(row.messages?.original?.message ?? "");
        if (!text && !translations.length) continue;
        // Where the game audio's voices were told apart, the line says who spoke (A, B, ...).
        const speakers: string[] = row.category === "received" ? speakerLabels(row.speakers) : [];
        lines.unshift({ id: String(row.id), kind: row.category, text, translations, pending: row.status === "pending",
            ...(speakers.length ? { speakers } : {}) });
    }
    return lines;
};

const signature = (line: CaptionLine): string => JSON.stringify([line.text, line.translations, line.pending]);

// When each line stops being shown. A line that is new or whose words changed
// gets the full duration again; an unchanged one keeps its time. The rows that
// were already in the log when the overlay was turned on are history, not
// captions: with no previous stamps they are marked as already gone.
export const stampLines = (previous: ReadonlyMap<string, CaptionStamp> | null | undefined, lines: readonly CaptionLine[],
    now: number, durationMs: number): Map<string, CaptionStamp> => {
    const next = new Map<string, CaptionStamp>();
    for (const line of lines) {
        const key = signature(line), before = previous?.get(line.id);
        next.set(line.id, before?.key === key ? before : { key, until: previous ? now + durationMs : 0 });
    }
    return next;
};

// What the overlay draws at `now`: the lines whose time has not passed, with
// `fading` set for the last moments.
export const visibleLines = <T extends { until: number }>(lines: readonly T[], now: number): (T & { fading: boolean })[] => lines
    .filter(line => now < line.until)
    .map(line => ({ ...line, fading: now >= line.until - FADE_MS }));

// The next moment the picture changes (a line starts to fade or goes), or null.
export const nextChange = (lines: readonly { until: number }[], now: number): number | null => {
    const times = lines.flatMap(line => [line.until - FADE_MS, line.until]).filter(time => time > now);
    return times.length ? Math.min(...times) : null;
};
