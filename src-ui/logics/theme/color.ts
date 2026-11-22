// Colour arithmetic for the themes (#965): sRGB hex, OKLCH as CSS Color 4 converts it, and the
// WCAG 2.x contrast ratio DESIGN.md "Colors" measures with. No DOM: the settings page, the theme
// controller and the tests share it.

export interface Oklch {
    lightness: number;
    chroma: number;
    // Degrees, 0 to 360.
    hue: number;
}

// "#rrggbb" or "#rrggbbaa", in either case.
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

export const isHexColor = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

// The colour part ("#rrggbb", lower case) and the alpha suffix ("" or two hex digits).
export const splitHex = (hex: string): { rgb: string; alpha: string } => {
    const match = HEX.exec(hex);
    if (!match) throw new Error(`not a hex colour: ${hex}`);
    return { rgb: `#${match[1].toLowerCase()}`, alpha: (match[2] ?? "").toLowerCase() };
};

const toLinear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
const fromLinear = (channel: number) => channel <= .0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - .055;

const linearRgb = (hex: string): [number, number, number] => {
    const { rgb } = splitHex(hex);
    const [r, g, b] = [1, 3, 5].map(at => toLinear(parseInt(rgb.slice(at, at + 2), 16) / 255));
    return [r, g, b];
};

// The relative luminance WCAG 2.x defines.
export const luminance = (hex: string): number => {
    const [r, g, b] = linearRgb(hex);
    return r * .2126 + g * .7152 + b * .0722;
};

export const contrast = (a: string, b: string): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + .05) / (low + .05);
};

export const toOklch = (hex: string): Oklch => {
    const [r, g, b] = linearRgb(hex);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    const a = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
    const bb = .0259040371 * l + .7827717662 * m - .8086757660 * s;
    return {
        lightness: .2104542553 * l + .7936177850 * m - .0040720468 * s,
        chroma: Math.hypot(a, bb),
        hue: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360,
    };
};

// Linear sRGB of an OKLCH colour, which may lie outside 0..1 when the colour is out of gamut.
const oklchToLinear = ({ lightness, chroma, hue }: Oklch): [number, number, number] => {
    const a = chroma * Math.cos(hue * Math.PI / 180);
    const b = chroma * Math.sin(hue * Math.PI / 180);
    const l = (lightness + .3963377774 * a + .2158037573 * b) ** 3;
    const m = (lightness - .1055613458 * a - .0638541728 * b) ** 3;
    const s = (lightness - .0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
        -.0041960863 * l - .7034186147 * m + 1.7076147010 * s,
    ];
};

const inGamut = (rgb: readonly number[]) => rgb.every(channel => channel >= -1e-6 && channel <= 1 + 1e-6);

// The hex of an OKLCH colour. Out of the sRGB gamut, the chroma is lowered until it fits; the
// lightness and the hue stay, so a derived step keeps its place in the scale and its hue.
export const fromOklch = (color: Oklch): string => {
    const lightness = Math.min(1, Math.max(0, color.lightness));
    let chroma = Math.max(0, color.chroma);
    if (!inGamut(oklchToLinear({ lightness, chroma, hue: color.hue }))) {
        let low = 0, high = chroma;
        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2;
            if (inGamut(oklchToLinear({ lightness, chroma: mid, hue: color.hue }))) low = mid; else high = mid;
        }
        chroma = low;
    }
    const rgb = oklchToLinear({ lightness, chroma, hue: color.hue });
    return `#${rgb.map(channel => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, channel))))) * 255)
        .toString(16).padStart(2, "0")).join("")}`;
};

// The hex of a derived colour. 8-bit rounding can turn a dark, nearly grey colour a few degrees
// off its hue, or make a vivid one a little more vivid than asked. Of the rounded colour and its
// neighbours (one step on each channel), those as light as asked (to within .003) and no more
// vivid than asked (to within .001) are kept, and the one with the hue closest to the asked one
// is taken.
export const fromOklchKeepingHue = (color: Oklch): string => {
    const rounded = fromOklch(color);
    const got = toOklch(rounded);
    const limit = Math.min(color.chroma, got.chroma + .002) + .001;
    const { rgb } = splitHex(rounded);
    const channels = [1, 3, 5].map(at => parseInt(rgb.slice(at, at + 2), 16));
    let best: string | null = null, bestHue = Infinity;
    for (const dr of [0, -1, 1]) for (const dg of [0, -1, 1]) for (const db of [0, -1, 1]) {
        const next = [dr, dg, db].map((d, i) => channels[i] + d);
        if (next.some(channel => channel < 0 || channel > 255)) continue;
        const hex = `#${next.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
        const near = toOklch(hex);
        if (Math.abs(near.lightness - got.lightness) > .003 || near.chroma > limit) continue;
        // A colour with almost no chroma has no hue to keep.
        const off = near.chroma < .005 ? 0 : hueApart(near.hue, color.hue);
        if (off < bestHue - 1e-9) { best = hex; bestHue = off; }
    }
    return best ?? rounded;
};

// How far apart two hues are, in degrees (0 to 180).
export const hueApart = (x: number, y: number): number => {
    const turn = Math.abs(x - y) % 360;
    return Math.min(turn, 360 - turn);
};
