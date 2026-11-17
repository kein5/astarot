// How long the converted voice comes after the voice itself, for the RVC page: the 80 ms
// the app collects before sending a block, the delay the worker adds (latency_ms, from its
// ready packet; on the CPU it includes waiting for the 0.5 s block to be converted) and the
// measured round trip. Output device buffering is not known here and not included.
export const CAPTURE_BLOCK_MS = 80;

// The direct voice state, as far as it is read here. Numbers are null until measured.
export type ConversionState = {
    active?: unknown;
    conversion_device?: unknown;
    conversion_latency_ms?: number | null;
    round_trip_ms?: number | null;
} | null | undefined;

export type ConversionDelay = { device: "gpu" | "cpu"; seconds: string };

// `latency!` and `round_trip_ms!`: Number.isInteger has ruled out null before they are read.
export const conversionDelaySeconds = (directState: ConversionState): ConversionDelay | null => {
    const device = directState?.conversion_device;
    const latency = directState?.conversion_latency_ms;
    if (!directState?.active || (device !== "gpu" && device !== "cpu") || !Number.isInteger(latency) || latency! < 0) return null;
    const roundTrip = Number.isInteger(directState.round_trip_ms) && directState.round_trip_ms! >= 0 ? directState.round_trip_ms! : 0;
    return { device, seconds: ((CAPTURE_BLOCK_MS + latency! + roundTrip) / 1000).toFixed(1) };
};
