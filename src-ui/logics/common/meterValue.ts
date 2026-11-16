// An atom value of the store: its state ("ok", "pending", ...) and data.
export interface MeterValue<T> {
    state: string;
    data: T;
}

export const updateMeterValue = <T>(previous: MeterValue<T>, data: T, state = "ok"): MeterValue<T> => {
    if (previous.state === state && Object.is(previous.data, data)) return previous;
    return { state, data };
};
