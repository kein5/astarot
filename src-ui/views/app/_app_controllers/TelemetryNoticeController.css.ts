import { globalStyle, style } from "@vanilla-extract/css";

// The first-run notice about usage data. The request and its purpose read first; the
// details (what is sent, what is not, how to change it) follow with air between them.
export const notice = style({});

globalStyle(`${notice} h3`, { margin: "0 0 1.2rem" });
globalStyle(`${notice} p`, { margin: "0 0 1rem" });
// The dialog's gap is the space after it.
globalStyle(`${notice} > :last-child`, { marginBottom: 0 });

// Two lines of about the same length, broken between phrases where the engine can.
export const purpose = style({
    selectors: {
        [`${notice} &`]: { fontSize: "1.5rem", lineHeight: 1.6, textWrap: "balance", wordBreak: "auto-phrase" },
    },
});
