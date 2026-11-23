// The prose of a document, line by line, as the writing rules read it. What the rules must not
// read is blanked out, so the columns stay where they are in the file. The blank is a character
// of the private use area: it is neither a space nor a letter, so the spacing rules do not read
// the edge of a link or of inline code as a space:
//
// - fenced code blocks, inline code, URLs, link targets and HTML (tags and comments)
// - quoted text (lines starting with ">"), which the guidelines leave out
// - front matter, and in .mdx the import and export lines and {expressions}
// - the lines between <!-- writing-exempt-start: reason --> and <!-- writing-exempt-end -->,
//   and the line after <!-- writing-exempt: reason --> on a line of its own, or the line it ends
//   (a table row or a list item, where a line of its own would split the table or the list).
//   Every marker needs a reason.
//
// In locales/*.yml only the text values are read.

export const BLANK = "\uE000";
const blank = (text) => text.replace(/[^\s]/g, BLANK);

const blankMatches = (text, pattern) => text.replace(pattern, (match) => blank(match));

const EXEMPT_START = /<!--\s*writing-exempt-start:\s*(\S[^>]*?)\s*-->/;
const EXEMPT_END = /<!--\s*writing-exempt-end\s*-->/;
const EXEMPT_LINE = /<!--\s*writing-exempt:\s*(\S[^>]*?)\s*-->/;
const EXEMPT_ANY = /<!--\s*writing-exempt(-start|-end)?\b/;
// The end of an HTML comment: "-->", or "--!>", which HTML also reads as the end.
const COMMENT_END = /--!?>/;
// A whole comment. The lines come one at a time (a comment over several lines is followed in
// markdownProse), but the pattern takes any character, line breaks included.
const COMMENT = /<!--[\s\S]*?--!?>/g;

// Inline parts of a Markdown line that are not prose.
const blankInline = (line, mdx) => {
    let text = line;
    text = blankMatches(text, /`[^`]*`/g);
    text = blankMatches(text, COMMENT);
    text = blankMatches(text, /\]\([^)]*\)/g);
    text = blankMatches(text, /<https?:[^>]*>/g);
    text = blankMatches(text, /\bhttps?:\/\/[^\s)>\]]+/g);
    text = blankMatches(text, /<\/?[A-Za-z][^>]*>/g);
    if (mdx) text = blankMatches(text, /\{[^}]*\}/g);
    // The user guide's containers (::: warning Title): the marker and its kind.
    text = blankMatches(text, /^\s*:::\s*[\w-]*/g);
    return text;
};

export const markdownProse = (source, { mdx = false } = {}) => {
    const lines = source.split(/\r?\n/);
    const prose = [];
    const problems = [];
    let fence = null;
    let comment = false;
    let exempt = false;
    let exemptNext = false;
    let front = lines[0]?.trim() === "---";
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const number = index + 1;
        if (front) {
            if (index > 0 && raw.trim() === "---") front = false;
            continue;
        }
        const fenceMark = raw.match(/^\s*(```+|~~~+)/);
        if (fence) {
            if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
            continue;
        }
        if (fenceMark) {
            fence = fenceMark[1];
            continue;
        }
        // A marker written as inline code (`<!-- writing-exempt: … -->`) is text about markers.
        const marker = raw.replace(/`[^`]*`/g, "");
        if (EXEMPT_START.test(marker)) {
            exempt = true;
            continue;
        }
        if (EXEMPT_END.test(marker)) {
            exempt = false;
            continue;
        }
        if (EXEMPT_LINE.test(marker)) {
            // On a line of its own it leaves out the next line; at the end of a line, that line.
            if (!marker.replace(EXEMPT_LINE, "").trim()) exemptNext = true;
            continue;
        }
        if (EXEMPT_ANY.test(marker)) {
            problems.push({
                line: number,
                message: "a writing-exempt marker needs a reason: <!-- writing-exempt: why -->",
            });
            continue;
        }
        if (exempt) continue;
        if (exemptNext) {
            exemptNext = false;
            continue;
        }
        // An HTML comment spanning lines.
        let text = raw;
        if (comment) {
            const end = text.match(COMMENT_END);
            if (!end) continue;
            const after = end.index + end[0].length;
            text = blank(text.slice(0, after)) + text.slice(after);
            comment = false;
        }
        const open = text.lastIndexOf("<!--");
        if (open >= 0 && !COMMENT_END.test(text.slice(open + 4))) {
            text = text.slice(0, open) + blank(text.slice(open));
            comment = true;
        }
        if (/^\s*>/.test(text)) continue;
        if (mdx && /^\s*(import|export)\s/.test(text)) continue;
        text = blankInline(text, mdx);
        if (!text.trim()) continue;
        prose.push({ line: number, text, heading: /^\s*#{1,6}\s/.test(raw) });
    }
    if (exempt) problems.push({ line: lines.length, message: "writing-exempt-start has no writing-exempt-end" });
    return { prose, problems };
};

// The text values of a locale file ("key: value"), with their columns.
export const localeProse = (source) => {
    const prose = [];
    source.split(/\r?\n/).forEach((raw, index) => {
        if (/^\s*#/.test(raw)) return;
        const match = raw.match(/^(\s*[^\s:#][^:]*:\s+)(.*)$/);
        if (!match?.[2].trim() || /^[|>]-?\s*$/.test(match[2])) return;
        const value = match[2].replace(/^(["'])(.*)\1\s*$/, " $2 ");
        prose.push({ line: index + 1, text: blank(match[1]) + blankInline(value, false), heading: false });
    });
    return { prose, problems: [] };
};
