import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// #1096: setting controls of every kind (checkboxes, standalone icon buttons, inputs,
// dropdowns/selects, color inputs, sliders, radios, hotkeys, and FormRow/form action buttons)
// align their right edge on one vertical column at the row's right end across every settings page.
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
    inFold: boolean;
    right: number;
    expectedRight: number;
}

const measureRowControls = (page: Page): Promise<RowControlMeasurement[]> =>
    page.evaluate(() => {
        const scroller = [...document.querySelectorAll("div")].find(element => {
            const style = getComputedStyle(element);
            return (style.overflowY === "auto" || style.overflowY === "scroll") && element.getBoundingClientRect().width > 400;
        });
        if (!scroller) return [];

        const rowRightOf = (row: Element) => Math.round(row.getBoundingClientRect().right);

        const results: RowControlMeasurement[] = [];
        const isVisible = (element: Element) =>
            element.checkVisibility() && !element.closest("details:not([open]), dialog, [role=tooltip], [inert], nav");

        const rightmostOf = (elements: HTMLElement[]) =>
            elements.reduce<HTMLElement | null>(
                (best, current) => (!best || current.getBoundingClientRect().right > best.getBoundingClientRect().right ? current : best),
                null,
            );

        // Setting rows built with Templates, SharedItems, or FormRow all carry data-hint-row.
        for (const row of scroller.querySelectorAll<HTMLElement>("[data-hint-row]")) {
            if (!isVisible(row)) continue;
            // Label-only or control-only helper rows (e.g. WordFilter / MessageFormat) span full width.
            if (row.children.length < 2) continue;
            const controlCell = row.children[1];
            if (!(controlCell instanceof HTMLElement) || !isVisible(controlCell)) continue;
            // The VR overlay's 2D position/rotation diagram is centred by design (DESIGN.md).
            if (controlCell.querySelector('[role="slider"][aria-orientation="vertical"]')) continue;

            const label = (row.getAttribute("data-setting-label")
                ?? row.children[0]?.textContent
                ?? "").trim().replace(/\s+/g, " ").slice(0, 48);

            // Pick the rightmost primary visual edge in the field column.
            const checkboxVisual = controlCell.querySelector<HTMLElement>('input[type="checkbox"] + span');
            const entryBox = controlCell.querySelector<HTMLElement>('[data-slot="input"]')?.parentElement;
            const dropdown = controlCell.querySelector<HTMLElement>('[role="combobox"]');
            const select = controlCell.querySelector<HTMLElement>("select");
            const sliderTrack = controlCell.querySelector<HTMLElement>('[role="slider"]')?.parentElement
                ?? controlCell.querySelector<HTMLElement>('input[type="range"]');
            const radios = [...controlCell.querySelectorAll<HTMLElement>('input[type="radio"]')].filter(isVisible);
            const formInput = controlCell.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="range"])');
            const buttons = [...controlCell.querySelectorAll<HTMLElement>("button")].filter(isVisible);
            const rightmostButton = rightmostOf(buttons);

            let target: HTMLElement | null = null;
            let kind = "";
            if (checkboxVisual && isVisible(checkboxVisual) && (checkboxVisual.closest("label")?.textContent ?? "").trim() === "") {
                target = checkboxVisual;
                kind = "checkbox";
            } else if (entryBox && isVisible(entryBox) && rightmostButton) {
                // ColorEntryWithSaveButton (input + swatch) or HotkeysEntry (input + delete button).
                target = rightmostButton;
                kind = entryBox.getBoundingClientRect().width < 220 ? "color" : "hotkey";
            } else if (entryBox && isVisible(entryBox)) {
                target = entryBox;
                kind = "entry";
            } else if (dropdown && isVisible(dropdown)) {
                target = dropdown;
                kind = "dropdown";
            } else if (select && isVisible(select)) {
                target = select;
                kind = "select";
            } else if (sliderTrack && isVisible(sliderTrack)) {
                target = sliderTrack;
                kind = "slider";
            } else if (radios.length > 0) {
                const radioBoxes = radios.map(input => input.closest<HTMLElement>("label")).filter((el): el is HTMLElement => Boolean(el && isVisible(el)));
                // DownloadModels puts a download button to the right of each radio label.
                target = rightmostOf([...radioBoxes, ...buttons]) ?? controlCell;
                kind = "radio";
            } else if (formInput && isVisible(formInput)) {
                target = formInput;
                kind = "input";
            } else if (rightmostButton) {
                // ConnectionCheckButton renders an EnvReadout box (status + padded button) whose
                // outer frame sits flush at the row's right end.
                target = controlCell.querySelector('[role="status"]') ? controlCell : rightmostButton;
                kind = (rightmostButton.textContent ?? "").trim() === "" ? "icon-button" : "button";
            }
            if (!target) continue;

            results.push({
                label,
                kind,
                inFold: Boolean(row.closest("details")),
                right: Math.round(target.getBoundingClientRect().right),
                expectedRight: rowRightOf(row),
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
                inFold: Boolean(labelElement.closest("details")),
                right: Math.round(input.getBoundingClientRect().right),
                expectedRight: rowRightOf(labelElement),
            });
        }

        return results;
    });

test("settings controls of every kind share one right edge across every settings page", async ({ app }) => {
    const assertPageRightAligned = (pageName: string, items: RowControlMeasurement[], minCount: number) => {
        expect(items.length, `${pageName}: measured rows`).toBeGreaterThanOrEqual(minCount);
        const topLevel = items.filter(item => !item.inFold);
        const pageRight = (topLevel[0] ?? items[0]).expectedRight;
        for (const item of items) {
            expect.soft(Math.abs(item.right - item.expectedRight), `${pageName} "${item.label}" (${item.kind}): right=${item.right}, expected ${item.expectedRight}`).toBeLessThanOrEqual(2);
            if (!item.inFold) {
                expect.soft(Math.abs(item.right - pageRight), `${pageName} "${item.label}" (${item.kind}): right=${item.right}, page right=${pageRight}`).toBeLessThanOrEqual(2);
            }
        }
        return pageRight;
    };

    // Sweep every settings page in the sidebar (including rows inside folds) so no control kind is missed.
    await app.openSettings("Advanced");
    await app.page.waitForTimeout(300);
    const tabs = app.page.locator("nav button");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(10);

    const seenKinds = new Set<string>();
    for (let i = 0; i < tabCount; i++) {
        const name = (await tabs.nth(i).innerText()).trim();
        await tabs.nth(i).click();
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => {
            for (const fold of document.querySelectorAll<HTMLDetailsElement>("details:not([data-asks-on-open])")) {
                fold.open = true;
            }
        });
        await app.page.waitForTimeout(100);
        const items = await measureRowControls(app.page);
        for (const item of items) seenKinds.add(item.kind);
        if (items.length > 0) {
            assertPageRightAligned(name, items, 1);
        }
    }

    for (const requiredKind of ["checkbox", "icon-button", "entry", "color", "dropdown", "select", "radio", "slider", "hotkey", "button"]) {
        expect(seenKinds.has(requiredKind), `Measured at least one right-aligned ${requiredKind} across settings pages`).toBe(true);
    }

    // Advanced: check all expected kinds are present together on one page.
    await app.page.getByRole("button", { name: "Advanced", exact: true }).click();
    await app.page.waitForTimeout(250);
    const advancedItems = await measureRowControls(app.page);
    assertPageRightAligned("Advanced", advancedItems, 20);
    for (const requiredKind of ["checkbox", "icon-button", "entry", "color", "dropdown"]) {
        expect(advancedItems.some(item => item.kind === requiredKind), `Advanced includes right-aligned ${requiredKind}`).toBe(true);
    }

    // Voice changer (RVC): FormRow buttons (audio route, RVC switch, monitor), numeric inputs,
    // input select + refresh button, Start/Stop buttons, and the disabled-start reason share one right edge.
    await app.page.getByRole("button", { name: "Voice changer (RVC)", exact: true }).click();
    await app.page.waitForTimeout(250);
    const rvcRight = assertPageRightAligned("RVC", await measureRowControls(app.page), 6);
    const stopButtonRight = await app.page.getByRole("button", { name: "Stop input forwarding" }).evaluate(el => Math.round(el.getBoundingClientRect().right));
    expect(Math.abs(stopButtonRight - rvcRight), `RVC Stop button right=${stopButtonRight}, expected ${rvcRight}`).toBeLessThanOrEqual(2);
    const refreshButtonRight = await app.page.getByRole("button", { name: "Refresh inputs" }).evaluate(el => Math.round(el.getBoundingClientRect().right));
    expect(Math.abs(refreshButtonRight - rvcRight), `RVC Refresh inputs button right=${refreshButtonRight}, expected ${rvcRight}`).toBeLessThanOrEqual(2);
    const monitorButtonRight = await app.page.locator('[data-setting-id="rvc_settings"] [data-page-pointer="tts"]').evaluate(el => Math.round(el.getBoundingClientRect().right));
    expect(Math.abs(monitorButtonRight - rvcRight), `RVC Monitor link button right=${monitorButtonRight}, expected ${rvcRight}`).toBeLessThanOrEqual(2);

    // Device: dropdowns align to the row's right end, while Auto select checkboxes remain flush
    // with their own rows' field column start over the lists they choose for.
    await app.page.getByRole("button", { name: "Device", exact: true }).click();
    await app.page.waitForTimeout(250);
    const deviceRows = await app.page.locator('[data-setting-id="mic_host_device"], [data-setting-id="speaker_device"]').evaluateAll(rows => {
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
        const gapPx = 1.6 * rootFontSize;
        return rows.map(row => {
            const box = row.querySelector<HTMLElement>('input[type="checkbox"] + span');
            const dropdown = row.querySelector<HTMLElement>('[role="combobox"]');
            const rect = row.getBoundingClientRect();
            return {
                boxLeft: box ? Math.round(box.getBoundingClientRect().left) : -1,
                expectedLeft: Math.round(rect.left + (rect.width - gapPx) / 2.6 + gapPx),
                dropdownRight: dropdown ? Math.round(dropdown.getBoundingClientRect().right) : -1,
                expectedRight: Math.round(rect.right),
            };
        });
    });
    expect(deviceRows.length).toBe(2);
    for (const { boxLeft, expectedLeft, dropdownRight, expectedRight } of deviceRows) {
        expect(Math.abs(boxLeft - expectedLeft), `Device auto-select checkbox left=${boxLeft}, expected ${expectedLeft}`).toBeLessThanOrEqual(2);
        expect(Math.abs(dropdownRight - expectedRight), `Device dropdown right=${dropdownRight}, expected ${expectedRight}`).toBeLessThanOrEqual(2);
    }
});
