import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// Opening a page moves nothing on it (#912): what the core answers as the page opens lands where
// the page has kept room for it. Chromium reports every shift of the layout (the Layout Instability
// API); WebKit has no such report, so there the places and sizes of the page's parts are compared
// just after it opens and once its answers have come. What the core sends is held while a page
// opens, so it is seen before its answers on any machine. Every fold on a settings page is opened
// as soon as the page shows, as a user who opens one before the answers come sees it.

// Tall enough that most of each settings page is in view: a shift is only reported where it is seen.
test.use({ viewport: { width: 1280, height: 3000 } });

// How long a page has to settle once the core's answers are let through.
const SETTLE_MS = 1500;

type Shift = { value: number; nodes: string[] };
// A part's place, its size and what it is; t: a line of words, whose width is its words'.
type Place = { x: number; y: number; w: number; h: number; t: boolean; d: string };

/** Starts recording the layout's shifts (Chromium); the ones since the page loaded come too. */
const observe = (page: Page) => page.evaluate(() => {
    const record = window as unknown as { __shifts?: Shift[]; __phase?: string };
    record.__shifts = [];
    record.__phase = "start";
    if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) return false;
    const name = (node: Node | null) => {
        const element = node instanceof Element ? node : node?.parentElement;
        return element ? `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} "${(element.textContent ?? "").trim().slice(0, 40)}"` : "";
    };
    new PerformanceObserver(list => {
        for (const entry of list.getEntries() as unknown as { value: number; sources?: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }[]) {
            const rect = (box: DOMRectReadOnly) => `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
            record.__shifts?.push({ value: entry.value, phase: record.__phase,
                nodes: (entry.sources ?? []).map(source => `${name(source.node)} ${rect(source.previousRect)} -> ${rect(source.currentRect)}`) } as Shift);
        }
    }).observe({ type: "layout-shift", buffered: true });
    return true;
});

/** The shifts recorded since the phase began, and starts the next one. */
const shiftsOf = (page: Page, phase: string) => page.evaluate(next => {
    const record = window as unknown as { __shifts?: (Shift & { phase?: string })[]; __phase?: string };
    const current = record.__phase;
    const shifts = (record.__shifts ?? []).filter(shift => shift.phase === current);
    record.__phase = next;
    return shifts;
}, phase);

/** Where each part of the page is seen: its headings, rows, fields, buttons and lines. A part is
 *  known by what it is and says, and by how many such parts come before it: a mark that comes and
 *  goes beside it (a spinner while the page waits) does not make it another part. */
const places = (page: Page) => page.evaluate(() => {
    const out: Record<string, Place> = {};
    const parts = "[data-setting-id], h1, h2, h3, h4, [role=heading], button, input, select, textarea, summary, li, p, label, dt, dd";
    const words = "h1, h2, h3, h4, [role=heading], p, label, dt, dd";
    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll(parts)) {
        const box = element.getBoundingClientRect();
        if ((!box.width && !box.height) || box.bottom < 0 || box.top > innerHeight) continue;
        // Only what is seen: a part in a closed fold is laid out by some browsers all the same.
        if (!element.checkVisibility() || element.closest("dialog, [role=tooltip], [inert]")) continue;
        const d = `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
        const what = `${element.tagName}|${element.getAttribute("data-setting-id") ?? ""}|${(element.textContent ?? "").trim().slice(0, 80)}`;
        const n = seen.get(what) ?? 0;
        seen.set(what, n + 1);
        out[`${what}#${n}`] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
            t: element.matches(words), d };
    }
    return out;
});

/** The parts seen both times that moved or changed size. A line whose words grow or shrink in
 * its place moves nothing (a status saying more once it is known); its height still counts. */
const moved = (before: Record<string, Place>, after: Record<string, Place>) => Object.entries(before)
    .filter(([path, place]) => {
        const now = after[path];
        return now && (Math.abs(now.x - place.x) > 1 || Math.abs(now.y - place.y) > 1 || Math.abs(now.h - place.h) > 1
            || (!place.t && Math.abs(now.w - place.w) > 1));
    })
    .map(([path, place]) => `${place.d}: ${JSON.stringify(place)} -> ${JSON.stringify(after[path])}`);

test("the main window does not move as it starts", async ({ app }) => {
    test.skip(!(await observe(app.page)), "no layout shift reports in this browser");
    await app.page.waitForTimeout(SETTLE_MS);
    // Everything since the page loaded, the start-up included.
    expect(await shiftsOf(app.page, "done")).toEqual([]);
});

test("opening each settings page moves nothing on it", async ({ app }) => {
    test.setTimeout(180_000);
    const reports = await observe(app.page);
    await app.page.locator("[data-open-settings]").click();
    await app.page.waitForTimeout(SETTLE_MS);
    const tabs = app.page.locator("nav button");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(10);
    await shiftsOf(app.page, "ignored");
    for (let i = 0; i < count; i++) {
        const name = (await tabs.nth(i).innerText()).trim();
        await app.page.mouse.move(1279, 2999);
        await app.holdCore();
        await shiftsOf(app.page, name);
        await tabs.nth(i).click();
        await app.page.waitForTimeout(150);
        const opened = await places(app.page);
        await app.releaseCore();
        await app.page.waitForTimeout(SETTLE_MS);
        // Every page is opened and checked, so one run names every page that moves.
        expect.soft(moved(opened, await places(app.page)), `${name}: parts that moved once the page had opened`).toEqual([]);
        if (reports) expect.soft(await shiftsOf(app.page, "ignored"), `${name}: layout shifts while the page opened`).toEqual([]);
    }
});
