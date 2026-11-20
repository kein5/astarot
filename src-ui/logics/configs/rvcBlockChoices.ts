// The choices of the RVC conversion's block length under Advanced (#531): "Automatic" (0, the
// default: the worker times the GPU when conversion starts and picks the shortest length it
// keeps up with), then 20 to 200 ms in steps of 20, the lengths the backend accepts.
export const RVC_BLOCK_AUTO = 0;
export const RVC_BLOCK_LENGTHS_MS: readonly number[] = Array.from({ length: 10 }, (_, n) => 20 * (n + 1));

// Keyed by the saved value as text; the keys are integers, so they keep this order.
export const rvcBlockChoices = (automatic: string, length: (ms: number) => string): Readonly<Record<string, string>> =>
    Object.fromEntries([[String(RVC_BLOCK_AUTO), automatic], ...RVC_BLOCK_LENGTHS_MS.map(ms => [String(ms), length(ms)])]);

// The saved value as a choice's key; what the backend would not keep shows as Automatic.
export const rvcBlockChoiceId = (saved: unknown): string =>
    typeof saved === "number" && (saved === RVC_BLOCK_AUTO || RVC_BLOCK_LENGTHS_MS.includes(saved)) ? String(saved) : String(RVC_BLOCK_AUTO);
