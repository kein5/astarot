import { sameValue } from "../common/polledState.ts";
import { speakerLabels } from "../common/speakerLabels.ts";

export type CaptionSource = "mic" | "speaker";
export type RealtimeCaptionStage = "partial" | "final" | "translated" | "discarded" | "outcome";

// One source's realtime session as the backend reports it (`requested`, `state`, ...).
// `generation` and `namespace` identify the rows it owns.
export type RealtimeSession = {
    generation: number;
    namespace?: string | null;
    requested?: boolean;
    state?: string;
    [key: string]: unknown;
};
export type RealtimeSessions = Partial<Record<CaptionSource, RealtimeSession>>;

// The original text with its readings, as the message log shows it.
export type CaptionMessage = { message: string; transliteration: unknown[] };

// The `result` of /run/realtime_caption (docs/spec/data-and-persistence.md). Checked
// field by field before use.
type CaptionPayloadBase = {
    source: CaptionSource;
    namespace: string;
    item_id: string;
    revision: number;
    generation: number;
};
export type RealtimeCaptionPayload = (CaptionPayloadBase & {
    state: "outcome";
    outcome: string;
    reason?: unknown;
}) | (CaptionPayloadBase & {
    state: Exclude<RealtimeCaptionStage, "outcome">;
    text?: unknown;
    original?: CaptionMessage;
    translations?: unknown[];
    speakers?: unknown;
});

// What a realtime row remembers of its caption.
export type RealtimeRowState = {
    source: CaptionSource;
    namespace: string;
    generation: number;
    item_id: string;
    revision: number;
    state: RealtimeCaptionStage;
    outcome?: string;
    reason?: unknown;
};

// A row of the message log. Only realtime rows carry `realtime`.
export type MessageLogRow = { id: string; realtime?: RealtimeRowState; [key: string]: unknown };

export type RealtimeCaptionRow = {
    id: string;
    created_at: string;
    category: "sent" | "received";
    status: string;
    source: string;
    realtime: RealtimeRowState;
    messages: { original: CaptionMessage; translations: unknown[] };
    speakers?: string[];
    [key: string]: unknown;
};

// The message log rows and the realtime row IDs that may not come back.
export type RealtimeCaptionLog = { rows: MessageLogRow[]; retired: string[] };

// Pure caption state. Receipt time is enforced by Python, identity/order here.
const sources: readonly CaptionSource[] = ["mic", "speaker"];
const states: readonly string[] = ["partial", "final", "translated", "discarded", "outcome"];
const outcomes: Record<string, string> = { delivered: "ok", not_delivered: "not_sent", failed: "failed" };
type CaptionIdentity = { source: CaptionSource; generation: number; namespace?: string | null; item_id: string };
const idFor = (p: CaptionIdentity): string => `realtime:${p.source}:${p.generation}:${p.namespace}:${p.item_id}`;
const retire = (retired: string[], id: string): string[] => [...retired.filter(value => value !== id), id].slice(-256);
const live = (p: CaptionIdentity, active: RealtimeSessions): boolean | undefined => {
    const owner = active[p.source];
    return owner?.requested && owner.generation === p.generation && owner.namespace === p.namespace;
};

export const mergeRealtimeState = (current: RealtimeSessions, incoming: Partial<Record<CaptionSource, RealtimeSession | null>> | null | undefined): RealtimeSessions => {
    let result = current;
    for (const source of sources) {
        // A missing row or one without a valid generation is skipped by the check below.
        const next = incoming?.[source] as RealtimeSession, previous = current[source];
        if (!Number.isSafeInteger(next?.generation) || next.generation < 0) continue;
        if (next.generation === previous?.generation) {
            if ((["stopping", "closed", "failed"] as readonly unknown[]).includes(previous.state) && next.requested) continue;
            if (previous.state === "ready" && next.state === "starting") continue;
        }
        if (!previous || next.generation >= previous.generation) {
            // A delayed starting snapshot may omit a namespace learned from a
            // newer caption in the same generation; do not forget its identity.
            const row = { ...next, namespace: next.namespace ??
                (next.generation === previous?.generation ? previous.namespace : null) };
            if (!sameValue(previous, row)) {
                if (result === current) result = { ...current };
                result[source] = row;
            }
        }
    }
    return result;
};

export const applyRealtimeCaption = (current: RealtimeCaptionLog, payload: RealtimeCaptionPayload | null | undefined, activeNamespaces: RealtimeSessions): RealtimeCaptionLog => {
    const p = payload;
    if (!p || !sources.includes(p.source) || !states.includes(p.state) ||
        typeof p.namespace !== "string" || !p.namespace || p.namespace.length > 128 ||
        typeof p.item_id !== "string" || !p.item_id || p.item_id.length > 256 ||
        !Number.isSafeInteger(p.revision) || p.revision < 1 ||
        !Number.isSafeInteger(p.generation) || p.generation < 0) return current;
    const id = idFor(p), index = current.rows.findIndex(row => row.id === id);
    // Only rows built below get a "realtime:" id, so the row with this id is a realtime row.
    const previous = current.rows[index] as RealtimeCaptionRow | undefined;
    if (current.retired.includes(id)) return current;
    // Outcomes settle only an existing recognized row, including an old
    // generation after stop. They cannot recreate a pruned/unknown item.
    if (p.state === "outcome") {
        if (!Object.hasOwn(outcomes, p.outcome) || !previous || previous.realtime.outcome ||
            !["final", "translated"].includes(previous.realtime.state) ||
            p.revision <= previous.realtime.revision) return current;
        const rows = [...current.rows];
        rows[index] = { ...previous, status: outcomes[p.outcome], realtime: {
            ...previous.realtime, revision: p.revision, outcome: p.outcome, reason: p.reason,
        } };
        return { ...current, rows };
    }
    if (typeof p.text !== "string" || !live(p, activeNamespaces)) return current;
    if (previous?.realtime.outcome) return current;
    if (previous && (p.revision <= previous.realtime.revision ||
        previous.realtime.state === "translated" ||
        (previous.realtime.state === "final" && p.state !== "translated"))) return current;
    if (p.state === "discarded" || !p.text.trim()) {
        return { rows: current.rows.filter(row => row.id !== id), retired: retire(current.retired, id) };
    }
    // Only a completed utterance names its speakers; its translated row keeps them.
    const named: string[] = p.source === "speaker" ? speakerLabels(p.speakers) : [];
    const speakers = named.length ? named : previous?.speakers ?? [];
    const row: RealtimeCaptionRow = {
        id, created_at: previous?.created_at ?? new Date().toLocaleTimeString("ja-JP", { hour12: false, hour: "2-digit", minute: "2-digit" }),
        category: p.source === "mic" ? "sent" : "received", status: "pending",
        source: `realtime_${p.source}`,
        realtime: { source: p.source, namespace: p.namespace, generation: p.generation,
            item_id: p.item_id, revision: p.revision, state: p.state },
        messages: { original: p.original ?? { message: p.text, transliteration: [] }, translations: p.translations ?? [] },
        ...(speakers.length ? { speakers } : {}),
    };
    const rows = [...current.rows];
    if (index < 0) rows.push(row);
    else rows[index] = row;
    return { ...current, rows };
};

export const pruneRealtimeCaptions = (current: RealtimeCaptionLog, activeNamespaces: RealtimeSessions): RealtimeCaptionLog => {
    let retired = current.retired;
    const rows = current.rows.filter(row => {
        if (row.realtime?.state !== "partial" || live(row.realtime, activeNamespaces)) return true;
        retired = retire(retired, row.id);
        return false;
    });
    return rows.length === current.rows.length ? current : { rows, retired };
};
