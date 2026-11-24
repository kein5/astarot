import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// #1096: setting controls (checkboxes, action buttons, short text/number/color inputs, selects,
// and FormRow actions) share one field-column start edge across settings pages.
test.use({
    viewport: { width: 1280, height: 800 },
    settings: {
        OVERLAY_VR_PANEL: true,
        EXPERIMENTAL_FEATURES: { tray_companion: true },
    },
});

interface RowControlMeasurement {
    label: string;
    kind: string;
    left: number;
    expectedLeft: number;
}

const measureRowControls = (page: Page): Promise<RowControlMeasurement[]> =>
    page.evaluate(() => {
        const scroller = [...document.querySelectorAll("div")].find(element => {
            const style = getComputedStyle(element);
            return (style.overflowY === "auto" || style.overflowY === "scroll") && element.getBoundingClientRect().width > 400;
        });
        if (!scroller) return [];

        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
        const gapPx = 1.6 * rootFontSize;
        // Exact field-column start for a 1fr / 1.6fr grid with 1.6rem gap inside this row's own width
        // (independent of whether a classic scrollbar is shown on a tall vs short page).
        const columnStartOf = (row: Element) => {
            const rect = row.getBoundingClientRect();
            return Math.round(rect.left + (rect.width - gapPx) / 2.6 + gapPx);
        };

        const results: RowControlMeasurement[] = [];
        const isVisible = (element: Element) =>
            element.checkVisibility() && !element.closest("details:not([open]), dialog, [role=tooltip], [inert], nav");

        // Setting rows built with Templates, SharedItems, or FormRow all carry data-hint-row.
        for (const row of scroller.querySelectorAll<HTMLElement>("[data-hint-row]")) {
            if (!isVisible(row)) continue;
            // Label-only or control-only helper rows (e.g. WordFilter / MessageFormat) span full width.
            if (row.children.length < 2) continue;
            const controlCell = row.children[1];
            if (!(controlCell instanceof HTMLElement) || !isVisible(controlCell)) continue;
            const label = (row.getAttribute("data-setting-label")
                ?? row.children[0]?.textContent
                ?? "").trim().replace(/\s+/g, " ").slice(0, 48);

            // Pick the primary leading visual control in the field column.
            const checkboxVisual = controlCell.querySelector<HTMLElement>('input[type="checkbox"] + span');
            const entryBox = controlCell.querySelector<HTMLElement>('[data-slot="input"]')?.parentElement;
            const dropdown = controlCell.querySelector<HTMLElement>('[role="combobox"]');
            const select = controlCell.querySelector<HTMLElement>("select");
            const formInput = controlCell.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="range"])');
            const button = controlCell.querySelector<HTMLElement>("button");
            const target = checkboxVisual ?? entryBox ?? dropdown ?? select ?? formInput ?? button;
            if (!target || !isVisible(target)) continue;

            const kind = checkboxVisual ? "checkbox"
                : entryBox ? "entry"
                    : dropdown ? "dropdown"
                        : select ? "select"
                            : formInput ? "input"
                                : "button";
            results.push({ label, kind, left: Math.round(target.getBoundingClientRect().left), expectedLeft: columnStartOf(row) });
        }

        // Plain <label> rows in voice forms (e.g. pitch, index rate) share the same two-column grid.
        for (const labelElement of scroller.querySelectorAll<HTMLLabelElement>("fieldset > label")) {
            if (!isVisible(labelElement)) continue;
            const input = labelElement.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select');
            if (!input || !isVisible(input)) continue;
            const label = (labelElement.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
            results.push({ label, kind: input.tagName.toLowerCase(), left: Math.round(input.getBoundingClientRect().left), expectedLeft: columnStartOf(labelElement) });
        }

        return results;
    });

test("settings row controls share one field-column left edge across Advanced, Experimental, RVC, and Device", async ({ app }) => {
    const assertPageAligned = (pageName: string, items: RowControlMeasurement[], minCount: number) => {
        expect(items.length, `${pageName}: measured rows`).toBeGreaterThanOrEqual(minCount);
        const pageLeft = items[0].expectedLeft;
        for (const item of items) {
            expect(Math.abs(item.left - item.expectedLeft), `${pageName} "${item.label}" (${item.kind}): left=${item.left}, expected ${item.expectedLeft}`).toBeLessThanOrEqual(2);
            expect(Math.abs(item.left - pageLeft), `${pageName} "${item.label}" (${item.kind}): left=${item.left}, page column=${pageLeft}`).toBeLessThanOrEqual(2);
        }
        return pageLeft;
    };

    await app.openSettings("Advanced");
    await app.page.waitForTimeout(300);
    assertPageAligned("Advanced", await measureRowControls(app.page), 20);

    // Experimental features: checkboxes, dropdowns, and the lone VR launcher reset button all align.
    await app.page.getByRole("button", { name: "Experimental", exact: true }).click();
    await app.page.waitForTimeout(300);
    assertPageAligned("Experimental", await measureRowControls(app.page), 5);

    // Voice changer (RVC): FormRow buttons (audio route, RVC switch, monitor), numeric inputs,
    // input select + refresh button, Start/Stop buttons, and the disabled-start reason align.
    await app.page.getByRole("button", { name: "Voice changer (RVC)", exact: true }).click();
    await app.page.waitForTimeout(300);
    const rvcLeft = assertPageAligned("RVC", await measureRowControls(app.page), 6);
    const startButtonLeft = await app.page.getByRole("button", { name: "Start input forwarding" }).evaluate(el => Math.round(el.getBoundingClientRect().left));
    expect(Math.abs(startButtonLeft - rvcLeft), `RVC Start button left=${startButtonLeft}, expected ${rvcLeft}`).toBeLessThanOrEqual(2);
    const monitorButtonLeft = await app.page.locator('[data-setting-id="rvc_settings"] [data-page-pointer="tts"]').evaluate(el => Math.round(el.getBoundingClientRect().left));
    expect(Math.abs(monitorButtonLeft - rvcLeft), `RVC Monitor link button left=${monitorButtonLeft}, expected ${rvcLeft}`).toBeLessThanOrEqual(2);

    // Device: Auto select checkboxes remain flush with their own rows' field column start.
    await app.page.getByRole("button", { name: "Device", exact: true }).click();
    await app.page.waitForTimeout(300);
    const deviceBoxes = await app.page.locator('[data-setting-id="mic_host_device"], [data-setting-id="speaker_device"]').evaluateAll(rows => {
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
        const gapPx = 1.6 * rootFontSize;
        return rows.map(row => {
            const box = row.querySelector<HTMLElement>('input[type="checkbox"] + span');
            const rect = row.getBoundingClientRect();
            return {
                left: box ? Math.round(box.getBoundingClientRect().left) : -1,
                expected: Math.round(rect.left + (rect.width - gapPx) / 2.6 + gapPx),
            };
        });
    });
    expect(deviceBoxes.length).toBe(2);
    for (const { left, expected } of deviceBoxes) {
        expect(Math.abs(left - expected), `Device auto-select checkbox left=${left}, expected ${expected}`).toBeLessThanOrEqual(2);
    }
});
