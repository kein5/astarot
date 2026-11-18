// The baseline of hard-coded text that was already in the UI when the gate came in. It counts
// each text per file (no line numbers, so edits elsewhere in a file do not disturb it). A
// count may only go down: more is new hard-coded text, fewer must be written back so the
// fixed text cannot return unnoticed.
const entryOf = (item) => `${item.kind}|${item.text}`;

export const countFindings = (findings) => {
    const counts = {};
    for (const item of [...findings].sort((a, b) => a.file.localeCompare(b.file) || entryOf(a).localeCompare(entryOf(b)))) {
        counts[item.file] ??= {};
        counts[item.file][entryOf(item)] = (counts[item.file][entryOf(item)] ?? 0) + 1;
    }
    return counts;
};

export const compareBaseline = (findings, baseline) => {
    const actual = countFindings(findings);
    const added = [];
    const fixed = [];
    for (const item of findings) {
        const allowed = baseline[item.file]?.[entryOf(item)] ?? 0;
        if (actual[item.file][entryOf(item)] > allowed) added.push(item);
    }
    for (const [file, entries] of Object.entries(baseline)) {
        for (const [entry, allowed] of Object.entries(entries)) {
            const count = actual[file]?.[entry] ?? 0;
            if (count < allowed) {
                const cut = entry.indexOf("|");
                fixed.push({ file, kind: entry.slice(0, cut), text: entry.slice(cut + 1), count: allowed - count });
            }
        }
    }
    return { added, fixed };
};
