// Whether the backend line being read may show its notices in this window (#1236). The main
// window and the settings window both read every line, so each shows the notices of its own
// requests only (noticesHere, settingsWindow.ts); while a line of the other window's is read, the
// notices it would show are left to that window.
let quiet = false;

export const noticesQuiet = (): boolean => quiet;

// Reads a line with its notices shown here (true) or left to the other window (false).
export const withNotices = <T,>(shown: boolean, read: () => T): T => {
    const before = quiet;
    quiet = !shown;
    try {
        return read();
    } finally {
        quiet = before;
    }
};
