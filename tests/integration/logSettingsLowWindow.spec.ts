import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

// #563 (item 5 of #431): the log font size panel above the conversation log was 18rem high
// whatever the log's height, so in a very low window its slider was cut off by the log's edge.
// It is no taller than the log now, its settings scroll inside it, and closed it shows the same
// strip as before. The check came from a Python browser test that went with the Python backend.

interface Geometry {
    panel: [number, number];
    log: [number, number];
    slider: [number, number] | null;
    rem: number;
}

// The panel holds the gear (gear → its wrapper → the panel); the log's box holds the panel.
const geometry = (gear: Locator) =>
    gear.evaluate((element): Geometry => {
        const panel = element.parentElement?.parentElement;
        const log = panel?.parentElement;
        if (!panel || !log) throw new Error("the gear is not in the log's panel");
        const p = panel.getBoundingClientRect();
        const l = log.getBoundingClientRect();
        const s = panel.querySelector("input[type=range], [role=slider]")?.getBoundingClientRect();
        return {
            panel: [p.top, p.bottom],
            log: [l.top, l.bottom],
            slider: s ? [s.top, s.bottom] : null,
            rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
    });

const WINDOWS: { width: number; height: number }[] = [
    { width: 870, height: 654 },
    { width: 870, height: 300 },
    { width: 400, height: 200 },
];

for (const { width, height } of WINDOWS) {
    test(`the log font size panel stays inside the log in a ${width} × ${height} window`, async ({ app }) => {
        const { page } = app;
        await page.setViewportSize({ width, height });
        await page.mouse.move(0, 0);
        const gear = page.getByRole("button", { name: "Message log font size", exact: true });
        // Closed, only its strip shows over the log's top edge (at most 2rem of it).
        await expect.poll(async () => {
            const closed = await geometry(gear);
            return closed.panel[1] <= closed.log[0] + 2 * closed.rem + 1;
        }).toBe(true);

        await gear.focus();
        await page.keyboard.press("Enter");
        await expect(gear).toHaveAttribute("aria-expanded", "true");
        // Opened, it stays within the log, and its slider can be scrolled into the log.
        await expect.poll(async () => {
            const opened = await geometry(gear);
            return opened.panel[0] >= opened.log[0] - 1 && opened.panel[1] <= opened.log[1] + 1 && opened.slider !== null;
        }).toBe(true);
        await page.locator("input[type=range], [role=slider]").first().scrollIntoViewIfNeeded();
        await expect.poll(async () => {
            const { slider, log } = await geometry(gear);
            return slider !== null && log[0] - 1 <= slider[0] && slider[1] <= log[1] + 1;
        }).toBe(true);

        await page.keyboard.press("Escape");
        await expect(gear).toHaveAttribute("aria-expanded", "false");
    });
}
