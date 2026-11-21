// The top bar's stop (#937): what it stops, and how a press of it is answered.

// What the core's /run/stop_voice stops (controller/voice/mod.rs): the speech being read and its
// queue, a voice audition, and the virtual microphone's test tone. The stop is offered only while
// one of them runs; the voice status comes every second (useReceiveRoutes), so a speech that has
// just begun or ended is seen within a second.
export interface StopTargets {
    status: { active?: unknown; queued?: unknown };
    audition?: { phase?: unknown } | null;
    check?: { phase?: unknown } | null;
}
export const somethingToStop = ({ status, audition, check }: StopTargets): boolean =>
    status.active === true || (typeof status.queued === "number" && status.queued > 0)
    || audition?.phase === "pending" || audition?.phase === "playing" || check?.phase === "running";

// How a press is answered, as the hexagram's switches answer theirs (#911): "stopping" while it
// waits for the core's answer, taking no other press; "stopped" for a moment once the core has
// stopped; then "idle". A press refused goes back to "idle" at once, and a notice says why
// (useReceiveRoutes); so does one not answered in time.
export type StopPhase = "idle" | "stopping" | "stopped";
export interface StopPress {
    phase: StopPhase;
    // Counts the presses, so a late timer or answer for an earlier one changes nothing.
    press: number;
}
export const IDLE_STOP: StopPress = { phase: "idle", press: 0 };
// How long a press waits for the answer, and how long "stopped" stays.
export const STOP_ANSWER_MS = 4000;
export const STOPPED_MS = 1500;
