// Which rows of the message log become captions over the desktop, and for how long, and the
// shape of the captions the overlay page draws (CaptionSnapshot, at the end).
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
    realtime?: { namespace?: unknown } | null;
    messages?: {
        original?: CaptionMessage | null;
        translations?: readonly (CaptionMessage | null | undefined)[] | null;
    } | null;
}

export interface CaptionOptions {
    onlyTranslated?: boolean;
    max?: number;
    // The names given to the voices of each realtime session (#447): namespace, label, name.
    speakerNames?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface CaptionLine {
    id: string;
    kind: "sent" | "received";
    text: string;
    translations: string[];
    pending: boolean;
    speakers?: string[];
    // Each speaker's name, or "" for a voice without one; only when one has a name.
    speaker_names?: string[];
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
    { onlyTranslated = false, max = MAX_CAPTION_LINES, speakerNames = {} }: CaptionOptions = {}): CaptionLine[] => {
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
        const session = typeof row.realtime?.namespace === "string" ? speakerNames[row.realtime.namespace] : undefined;
        const names = speakers.map(label => session?.[label] ?? "");
        lines.unshift({ id: String(row.id), kind: row.category, text, translations, pending: row.status === "pending",
            ...(speakers.length ? { speakers } : {}), ...(names.some(Boolean) ? { speaker_names: names } : {}) });
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

// The captions the overlay page draws, as the native command returns them
// (src-tauri/src/caption_overlay.rs, Snapshot). The native side checks them before it keeps
// them; the page checks their shape again before it draws, since the command's answer has no type.

export interface CaptionSnapshotLine {
    id: string;
    // "sent" for the user's own words, "received" for what was heard or read.
    kind: string;
    text: string;
    translations: string[];
    pending: boolean;
    // Labels such as "A", and the names the user gave them; read through speakerLabels.
    speakers?: unknown;
    speaker_names?: unknown;
    // Milliseconds since the epoch after which the line is no longer shown.
    until: number;
}

// One row of a flow item: a stage or an output.
export interface CaptionFlowRow {
    // "stage", "chatbox", "speech" or "conversion".
    kind: string;
    label: string;
    value: string;
    start?: number;
    end?: number;
    off?: boolean;
}

// One of the user's own recent inputs: where it went and how long each step took.
export interface CaptionFlowItem {
    id: string;
    // "voice" or "chat".
    input: string;
    label: string;
    text: string;
    scale?: number;
    rows: CaptionFlowRow[];
}

export interface CaptionSnapshot {
    lines: CaptionSnapshotLine[];
    // "bottom" or "top" of the monitor.
    position: string;
    font_size: number;
    // How dark the plate behind the words is, 0 to 1.
    opacity: number;
    font_family: string;
    flow?: CaptionFlowItem[];
    flow_note?: string;
    adjusting?: boolean;
}

type Fields = { readonly [key: string]: unknown };

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optional = <T>(value: unknown, check: (value: unknown) => value is T): boolean => value === undefined || check(value);
const isListOf = <T>(value: unknown, check: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(check);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isLine = (value: unknown): value is CaptionSnapshotLine => isFields(value)
    && isText(value.id) && isText(value.kind) && isText(value.text)
    && isListOf(value.translations, isText) && isBoolean(value.pending) && isNumber(value.until);

const isFlowRow = (value: unknown): value is CaptionFlowRow => isFields(value)
    && isText(value.kind) && isText(value.label) && isText(value.value)
    && optional(value.start, isNumber) && optional(value.end, isNumber) && optional(value.off, isBoolean);

const isFlowItem = (value: unknown): value is CaptionFlowItem => isFields(value)
    && isText(value.id) && isText(value.input) && isText(value.label) && isText(value.text)
    && optional(value.scale, isNumber) && isListOf(value.rows, isFlowRow);

const isFlow = (value: unknown): value is CaptionFlowItem[] => isListOf(value, isFlowItem);

export const isCaptionSnapshot = (value: unknown): value is CaptionSnapshot => isFields(value)
    && isListOf(value.lines, isLine) && isText(value.position) && isNumber(value.font_size)
    && isNumber(value.opacity) && isText(value.font_family)
    && optional(value.flow, isFlow) && optional(value.flow_note, isText) && optional(value.adjusting, isBoolean);
