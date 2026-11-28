import { expect, test } from "./fixtures";
import type { App } from "./fixtures";
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

/** A line to the page as the core sends it. */
const coreLine = (page: Page, endpoint: string, result: unknown) =>
    page.evaluate(text => window.__coreLine?.(text), JSON.stringify({ status: 200, endpoint, result }));

// Turning a caption switch on moves nothing on the main window (#1364). The mark beside a language
// that its side is on, and a caption switch's state under its name (its captions starting, or
// stopped on an error), come where the rail has kept room for them and leave it empty when they
// go. The core has no speech model here, so what it sends as the switches turn on and their
// captions start or fail is played to the page as the core sends it.
test.describe("the main window's rail", () => {
    // Every switch in sight, as after an update.
    test.use({ settings: { USAGE_PRESETS: ["all"] } });

    test("a caption switch turning on, starting and stopping on an error moves nothing on the main window", async ({ app }) => {
        const page = app.page;
        const reports = await observe(page);
        await page.waitForTimeout(SETTLE_MS);
        // The mark is drawn just before the language's role (LanguageSelectorOpenButton).
        const mark = (role: string) => page.getByText(role, { exact: true }).locator("xpath=preceding-sibling::*[1]");
        // A state's words in sight: the line keeps the others hidden, for their room (StableWords).
        const shown = (words: string) => page.getByText(words, { exact: true }).filter({ visible: true });
        await expect(mark("Your language")).toBeHidden();
        await expect(mark("Target language")).toBeHidden();
        const off = await places(page);
        // A caption session as /get/data/realtime_asr_state reports it; not asked to run, so the
        // page does not ask the core for it again.
        const session = (state: string, generation = 1) => ({ generation, requested: false, state });
        const steps: [string, () => Promise<void>][] = [
            ["turned on", async () => {
                await coreLine(page, "/set/enable/transcription_send", true);
                await coreLine(page, "/set/enable/transcription_receive", true);
                await expect(mark("Your language")).toBeVisible();
                await expect(mark("Target language")).toBeVisible();
            }],
            ["captions starting", async () => {
                await coreLine(page, "/get/data/realtime_asr_state", { mic: session("starting"), speaker: session("starting") });
                await expect(shown("Starting captions")).toHaveCount(2);
            }],
            ["the mic's captions running, the speaker's stopped on an error", async () => {
                await coreLine(page, "/get/data/realtime_asr_state", { mic: session("ready"), speaker: session("failed") });
                await expect(shown("Stopped on an error")).toHaveCount(1);
                await expect(shown("Starting captions")).toHaveCount(0);
            }],
            ["Listening turned off", async () => {
                await coreLine(page, "/set/disable/transcription_receive", false);
                await coreLine(page, "/get/data/realtime_asr_state", { speaker: session("idle", 2) });
                await expect(shown("Stopped on an error")).toHaveCount(0);
                await expect(mark("Target language")).toBeHidden();
            }],
        ];
        // The shifts are counted from the first step on, each under the step it came in.
        await shiftsOf(page, steps[0][0]);
        for (const [i, [step, run]] of steps.entries()) {
            await run();
            await page.waitForTimeout(150);
            // Every step is checked against the rail with both switches off, so one run names every step that moves.
            expect.soft(moved(off, await places(page)), `${step}: parts that moved`).toEqual([]);
            const shifts = await shiftsOf(page, steps[i + 1]?.[0] ?? "done");
            if (reports) expect.soft(shifts, `${step}: layout shifts`).toEqual([]);
        }
    });
});

/** Opens every settings page in turn, the core's answers held until the page has been seen, and
 *  checks that nothing on it moves once they come. With `unfold`, every fold of the page is opened
 *  as soon as it shows, before its answers, as a user who opens one at once sees it. A fold whose
 *  contents are asked for as it opens (data-asks-on-open) is left closed: what comes then answers
 *  the user's opening, as a layout shift report leaves out what follows the user's input. */
const checkPages = async (app: App, unfold: boolean) => {
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
        if (!unfold) await shiftsOf(app.page, name);
        await tabs.nth(i).click();
        if (unfold) {
            // What opening the folds moves is the user's doing: the shifts counted begin after it.
            await app.page.evaluate(() => new Promise(done => {
                for (const fold of document.querySelectorAll<HTMLDetailsElement>("details:not([data-asks-on-open])")) fold.open = true;
                requestAnimationFrame(() => requestAnimationFrame(done));
            }));
            await shiftsOf(app.page, name);
        }
        await app.page.waitForTimeout(150);
        const opened = await places(app.page);
        await app.releaseCore();
        await app.page.waitForTimeout(SETTLE_MS);
        // Every page is opened and checked, so one run names every page that moves.
        expect.soft(moved(opened, await places(app.page)), `${name}: parts that moved once the page had opened`).toEqual([]);
        if (reports) expect.soft(await shiftsOf(app.page, "ignored"), `${name}: layout shifts while the page opened`).toEqual([]);
    }
};

test("opening each settings page moves nothing on it", async ({ app }) => {
    await checkPages(app, false);
});

test("opening each settings page with its folds opened at once moves nothing on it", async ({ app }) => {
    await checkPages(app, true);
});
