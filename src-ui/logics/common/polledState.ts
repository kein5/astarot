import type { Atom } from "jotai";

type JsonRecord = { readonly [key: string]: unknown };

// IPC snapshots contain JSON values. Object key order is not meaningful.
export const sameValue = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
        Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length &&
        keys.every(key => Object.hasOwn(right, key) && sameValue((left as JsonRecord)[key], (right as JsonRecord)[key]));
};

export const sameSnapshot = (left: object, right: object) => {
    const keys = Object.keys(left).filter(key => key !== "observation_id");
    return keys.length === Object.keys(right).filter(key => key !== "observation_id").length &&
        keys.every(key => Object.hasOwn(right, key) && sameValue((left as JsonRecord)[key], (right as JsonRecord)[key]));
};

// A polled snapshot: observation_id is a decimal counter the backend increases.
export interface ObservedSnapshot {
    observation_id?: string | null;
}

// The part of a Jotai store this module reads.
export interface ObservationStore {
    get<Value>(atom: Atom<Value>): Value;
}

// Shared by hook instances, isolated by Jotai store and atom. An equal snapshot
// still advances this cursor without publishing an atom update.
const observations = new WeakMap<ObservationStore, Map<Atom<ObservedSnapshot>, string>>();
export const acceptObservation = (store: ObservationStore, target: Atom<ObservedSnapshot>, incoming: unknown) => {
    // Reading a field of any other value gives undefined, which the check below refuses.
    const id = (incoming as ObservedSnapshot | null | undefined)?.observation_id;
    if (typeof id !== "string" || !/^\d+$/.test(id)) return false;
    let cursors = observations.get(store);
    if (!cursors) observations.set(store, cursors = new Map());
    const latest = cursors.get(target) ?? store.get(target).observation_id;
    if (latest != null && BigInt(id) <= BigInt(latest)) return false;
    cursors.set(target, id);
    return true;
};

export const resetObservations = (store: ObservationStore, targets: Iterable<Atom<ObservedSnapshot>>) => {
    const cursors = observations.get(store);
    for (const target of targets) cursors?.delete(target);
};
