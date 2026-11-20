import { isInteger } from "../common/numberGuards.ts";

// How long the converted voice comes after the voice itself, for the RVC page: the block the
// app collects before sending it (conversion_block_ms, from the Advanced settings; 80 ms from
// a backend that does not report it), the delay the worker adds (latency_ms, from its ready
// packet; on the CPU it includes waiting for the 0.5 s block to be converted) and the measured
// round trip. Output device buffering is not known here and not included.

export const CAPTURE_BLOCK_MS = 80;

// The direct voice state, as far as it is read here. Numbers are null until measured.
export type ConversionState = {
    active?: unknown;
    conversion_device?: unknown;
    conversion_latency_ms?: number | null;
    conversion_block_ms?: number | null;
    round_trip_ms?: number | null;
} | null | undefined;

export type ConversionDelay = { device: "gpu" | "cpu"; seconds: string };

export const conversionDelaySeconds = (directState: ConversionState): ConversionDelay | null => {
    const device = directState?.conversion_device;
    const latency = directState?.conversion_latency_ms;
    if (!directState?.active || (device !== "gpu" && device !== "cpu") || !isInteger(latency) || latency < 0) return null;
    const measured = directState.round_trip_ms;
    const roundTrip = isInteger(measured) && measured >= 0 ? measured : 0;
    const block = directState.conversion_block_ms;
    const capture = isInteger(block) && block > 0 ? block : CAPTURE_BLOCK_MS;
    return { device, seconds: ((capture + latency + roundTrip) / 1000).toFixed(1) };
};
