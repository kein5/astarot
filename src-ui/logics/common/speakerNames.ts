import { speakerLabels } from "./speakerLabels.ts";

// Names the user gave the voices of a realtime session of the game audio (#447). The server
// labels the voices of one session "A", "B", ...; the labels start again with the next session,
// so a name belongs to one session (its namespace) and is not saved. The core keeps the same
// names for the VR large log (`/set/data/speaker_names`).

// Label to name, for one session.
export type SessionSpeakerNames = Record<string, string>;
// Session (namespace) to its names, the latest sessions only.
export type SpeakerNames = Record<string, SessionSpeakerNames>;

// What the core accepts (native/core/src/controller/speakers.rs).
export const MAX_SPEAKER_NAME = 32;
const MAX_NAMESPACE = 128;
const MAX_SESSIONS = 8;

// A name as the core keeps it: single spaces, no space at either end.
export const tidySpeakerName = (value: string): string => value.split(/\s+/).filter(Boolean).join(" ");

// Whether the core would take this name (an empty one removes the name).
export const isSpeakerName = (value: string): boolean => {
    const name = tidySpeakerName(value);
    return [...name].length <= MAX_SPEAKER_NAME && !/\p{Cc}/u.test(value);
};

// The answer of /set/data/speaker_names, checked field by field: the whole set of names of one
// session. Anything else leaves the names as they were.
export const applySpeakerNames = (current: SpeakerNames, answer: unknown): SpeakerNames => {
    if (!answer || typeof answer !== "object") return current;
    const { namespace, names } = answer as { namespace?: unknown; names?: unknown };
    if (typeof namespace !== "string" || !namespace || namespace.length > MAX_NAMESPACE) return current;
    if (!names || typeof names !== "object" || Array.isArray(names)) return current;
    const kept: SessionSpeakerNames = {};
    for (const [label, name] of Object.entries(names)) {
        if (speakerLabels([label]).length === 1 && typeof name === "string" && name && isSpeakerName(name)) kept[label] = name;
    }
    const next: SpeakerNames = {};
    for (const [key, value] of Object.entries(current)) if (key !== namespace) next[key] = value;
    next[namespace] = kept;
    const sessions = Object.keys(next);
    for (const old of sessions.slice(0, Math.max(0, sessions.length - MAX_SESSIONS))) delete next[old];
    return next;
};

// The fields of a log row read here.
type LogRow = {
    id: string;
    category?: unknown;
    status?: unknown;
    speakers?: unknown;
    realtime?: { namespace?: unknown; generation?: unknown } | null;
};

const voices = (row: LogRow | undefined): string => {
    if (!row || row.category !== "received" || !row.realtime) return "";
    const labels = speakerLabels(row.speakers);
    return labels.length ? `${row.realtime.generation}:${row.realtime.namespace}:${labels.join("·")}` : "";
};

// The rows that go on with the voices of the row before them: received captions of the same
// session, with the same speakers. The log shows who spoke once, on the first row of such a run.
// A row whose state is not plain (still being processed, failed) is never a continuation, so
// its state stays in sight.
export const speakerContinuations = (rows: readonly LogRow[]): Set<string> => {
    const continuing = new Set<string>();
    for (let index = 1; index < rows.length; index++) {
        const row = rows[index];
        const key = voices(row);
        if (key && row.status === "ok" && key === voices(rows[index - 1])) continuing.add(row.id);
    }
    return continuing;
};
