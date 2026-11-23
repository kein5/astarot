// The font sizes a stylesheet sets, for the tests that keep them on DESIGN.md's steps (#568):
// font-size, and the size in a font shorthand (`font: 600 1.4rem/1.2 ...`). A vanilla-extract
// file (.css.ts, ADR-010) sets them as fontSize and font, with the value quoted; a value that is
// not a literal (a theme variable) is left to the file that defines it. An !important is not part of the size.
export const isStylesheet = (name: string): boolean => /\.(s?css|css\.ts)$/.test(name);

const sizeOf = (value: string): string[] => value.match(/\b[\d.]+(?:px|rem)\b/)?.slice(0, 1) ?? [];

export const fontSizes = (source: string, name: string): string[] => name.endsWith(".css.ts") ? [
    ...[...source.matchAll(/\bfontSize:\s*["'`]([^"'`]+)["'`]/g)].map(([, value]) => value.replace("!important", "").trim()),
    ...[...source.matchAll(/\bfont:\s*["'`]([^"'`]+)["'`]/g)].flatMap(([, value]) => sizeOf(value)),
] : [
    ...[...source.matchAll(/font-size:\s*([^;}]+)/g)].map(([, value]) => value.replace("!important", "").trim()),
    ...[...source.matchAll(/(?<![-\w])font:\s*([^;}]+)/g)].flatMap(([, value]) => sizeOf(value)),
];
