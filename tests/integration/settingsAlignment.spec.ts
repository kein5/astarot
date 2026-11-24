import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// #1096: setting controls align in two steady columns by control kind across settings pages:
// inputs, selects, color inputs, and text/FormRow buttons start at the field column's left edge;
// standalone checkboxes and standalone icon buttons sit flush at the row's right end.
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
    align: "start" | "end";
    edge: number;
    expectedEdge: number;
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
        // Exact field-column start and row right end for a 1fr / 1.6fr grid with 1.6rem gap inside
        // this row's own width (independent of whether a classic scrollbar is shown on tall vs short pages).
        const columnStartOf = (row: Element) => {
            const rect = row.getBoundingClientRect();
            return Math.round(rect.left + (rect.width - gapPx) / 2.6 + gapPx);
        };
        const rowRightOf = (row: Element) => Math.round(row.getBoundingClientRect().right);

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

            // Pick the primary visual control in the field column.
            const checkboxVisual = controlCell.querySelector<HTMLElement>('input[type="checkbox"] + span');
            const entryBox = controlCell.querySelector<HTMLElement>('[data-slot="input"]')?.parentElement;
            const dropdown = controlCell.querySelector<HTMLElement>('[role="combobox"]');
            const select = controlCell.querySelector<HTMLElement>("select");
            const formInput = controlCell.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="range"])');
            const button = controlCell.querySelector<HTMLElement>("button");
            const target = checkboxVisual ?? entryBox ?? dropdown ?? select ?? formInput ?? button;
            if (!target || !isVisible(target)) continue;

            const isStandaloneCheckbox = Boolean(checkboxVisual && (checkboxVisual.closest("label")?.textContent ?? "").trim() === "");
            const isStandaloneIconButton = Boolean(!checkboxVisual && !entryBox && !dropdown && !select && !formInput && button && (button.textContent ?? "").trim() === "");
            const kind = checkboxVisual ? "checkbox"
                : entryBox ? "entry"
                    : dropdown ? "dropdown"
                        : select ? "select"
                            : formInput ? "input"
                                : isStandaloneIconButton ? "icon-button"
                                    : "button";
            const align: "start" | "end" = isStandaloneCheckbox || isStandaloneIconButton ? "end" : "start";
            const rect = target.getBoundingClientRect();
            results.push({
                label,
                kind,
                align,
                edge: Math.round(align === "end" ? rect.right : rect.left),
                expectedEdge: align === "end" ? rowRightOf(row) : columnStartOf(row),
            });
        }

        // Plain <label> rows in voice forms (e.g. pitch, index rate) share the same two-column grid.
        for (const labelElement of scroller.querySelectorAll<HTMLLabelElement>("fieldset > label")) {
            if (!isVisible(labelElement)) continue;
            const input = labelElement.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select');
            if (!input || !isVisible(input)) continue;
            const label = (labelElement.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
            results.push({
                label,
                kind: input.tagName.toLowerCase(),
                align: "start",
                edge: Math.round(input.getBoundingClientRect().left),
                expectedEdge: columnStartOf(labelElement),
            });
        }

        return results;
    });

test("settings controls keep two steady alignment columns by kind across Advanced, Experimental, RVC, and Device", async ({ app }) => {
    const assertPageAligned = (
        pageName: string,
        items: RowControlMeasurement[],
        minStart: number,
        minEnd: number,
    ) => {
        const startItems = items.filter(item => item.align === "start");
        const endItems = items.filter(item => item.align === "end");
        expect(startItems.length, `${pageName}: left-aligned field rows`).toBeGreaterThanOrEqual(minStart);
        expect(endItems.length, `${pageName}: right-aligned checkbox/icon rows`).toBeGreaterThanOrEqual(minEnd);

        const pageLeft = startItems[0]?.expectedEdge ?? 0;
        for (const item of startItems) {
            expect(Math.abs(item.edge - item.expectedEdge), `${pageName} "${item.label}" (${item.kind}): left=${item.edge}, expected ${item.expectedEdge}`).toBeLessThanOrEqual(2);
            expect(Math.abs(item.edge - pageLeft), `${pageName} "${item.label}" (${item.kind}): left=${item.edge}, page column=${pageLeft}`).toBeLessThanOrEqual(2);
        }

        const pageRight = endItems[0]?.expectedEdge ?? 0;
        for (const item of endItems) {
            expect(Math.abs(item.edge - item.expectedEdge), `${pageName} "${item.label}" (${item.kind}): right=${item.edge}, expected ${item.expectedEdge}`).toBeLessThanOrEqual(2);
            expect(Math.abs(item.edge - pageRight), `${pageName} "${item.label}" (${item.kind}): right=${item.edge}, page right=${pageRight}`).toBeLessThanOrEqual(2);
        }

        return { pageLeft, pageRight };
    };

    // Advanced: short/color inputs & selects align on the field column's left edge;
    // standalone checkboxes (including SharedItems) and standalone icon buttons align flush on the row's right end.
    await app.openSettings("Advanced");
    await app.page.waitForTimeout(300);
    const advancedItems = await measureRowControls(app.page);
    assertPageAligned("Advanced", advancedItems, 5, 9);
    expect(advancedItems.some(item => item.kind === "icon-button" && item.align === "end"), "Advanced has right-aligned standalone icon buttons").toBe(true);

    // Experimental features: dropdowns align on the field column's left edge;
    // checkboxes and the lone VR launcher reset icon button share the row's right end.
    await app.page.getByRole("button", { name: "Experimental", exact: true }).click();
    await app.page.waitForTimeout(300);
    const experimentalItems = await measureRowControls(app.page);
    assertPageAligned("Experimental", experimentalItems, 1, 3);
    expect(experimentalItems.some(item => item.kind === "icon-button" && item.align === "end"), "Experimental has right-aligned reset icon button").toBe(true);

    // Voice changer (RVC): FormRow buttons (audio route, RVC switch, monitor), numeric inputs,
    // input select + refresh button, Start/Stop buttons, and the disabled-start reason align on the field column's left edge.
    await app.page.getByRole("button", { name: "Voice changer (RVC)", exact: true }).click();
    await app.page.waitForTimeout(300);
    const { pageLeft: rvcLeft } = assertPageAligned("RVC", await measureRowControls(app.page), 6, 0);
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
