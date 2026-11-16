export const isSidecarWarning = (line: unknown): boolean => {
    if (typeof line !== "string") return false;
    try {
        // Any JSON value: reading a field of a number or string gives undefined, as for a missing field.
        const value = JSON.parse(line) as { readonly [key: string]: unknown } | null;
        return value?.type === "vrct_warning" && typeof value.category === "string"
            && typeof value.message === "string" && typeof value.filename === "string"
            && Number.isInteger(value.lineno);
    } catch {
        // Older backends may still use Python's default warning header.
        // ONNX Runtime logs native warnings itself, optionally ANSI-colored:
        // "2026-10-31 10:57:46.65 [W:onnxruntime:Default, file.cc:95 Fn] ..."
        return /^.+:\d+:\s+[A-Za-z]\w*Warning:\s/.test(line)
            || /^(?:\x1b\[[0-9;]*m)?\d{4}-\d\d-\d\d [\d:.]+ \[W:onnxruntime:/.test(line);
    }
};
