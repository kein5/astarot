import { globalStyle, style } from "@vanilla-extract/css";

// The first-run notice about usage data (and the virtual microphone's guide). The request and its
// purpose read first, under the title of the kit's DialogHeader; the details (what is sent, what is
// not, how to change it) follow, spaced by the header's gap.
export const notice = style({});

globalStyle(`${notice} p`, { margin: 0 });

// Two lines of about the same length, broken between phrases where the engine can.
export const purpose = style({
    selectors: {
        [`${notice} &`]: { fontSize: "1.5rem", lineHeight: 1.6, textWrap: "balance", wordBreak: "auto-phrase" },
    },
});
