// An atom value of the store: its state ("ok", "pending", ...) and data.
export interface MeterValue<T, S extends string = string> {
    state: S;
    data: T;
}

// The same value is kept as it is, so a meter that reads the same level does not render again.
export function updateMeterValue<T>(previous: MeterValue<T>, data: T): MeterValue<T>;
export function updateMeterValue<T, S extends string>(previous: MeterValue<T, S>, data: T, state: S): MeterValue<T, S>;
export function updateMeterValue<T>(previous: MeterValue<T>, data: T, state = "ok"): MeterValue<T> {
    if (previous.state === state && Object.is(previous.data, data)) return previous;
    return { state, data };
}
