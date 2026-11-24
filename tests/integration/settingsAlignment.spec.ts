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
}

const measureRowControls = (page: Page): Promise<RowControlMeasurement[]> =>
    page.evaluate(() => {
        const scroller = [...document.querySelectorAll("div")].find(element => {
            const style = getComputedStyle(element);
            return (style.overflowY === "auto" || style.overflowY === "scroll") && element.getBoundingClientRect().width > 400;
        });
        if (!scroller) return [];

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
            results.push({ label, kind, left: Math.round(target.getBoundingClientRect().left) });
        }

        // Plain <label> rows in voice forms (e.g. pitch, index rate) share the same two-column grid.
        for (const labelElement of scroller.querySelectorAll<HTMLLabelElement>("fieldset > label")) {
            if (!isVisible(labelElement)) continue;
            const input = labelElement.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select');
            if (!input || !isVisible(input)) continue;
            const label = (labelElement.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
            results.push({ label, kind: input.tagName.toLowerCase(), left: Math.round(input.getBoundingClientRect().left) });
        }

        return results;
    });

test("settings row controls share one field-column left edge across Advanced, Experimental, RVC, and Device", async ({ app }) => {
    await app.openSettings("Advanced");
    await app.page.waitForTimeout(300);

    const advanced = await measureRowControls(app.page);
    expect(advanced.length).toBeGreaterThanOrEqual(20);
    // Use the full-width dropdown on Advanced (RVC block length) as the reference column start.
    const ref = advanced.find(item => item.kind === "dropdown");
    expect(ref).toBeDefined();
    const fieldLeft = ref!.left;

    for (const item of advanced) {
        expect(Math.abs(item.left - fieldLeft), `Advanced "${item.label}" (${item.kind}): left=${item.left}, expected ${fieldLeft}`).toBeLessThanOrEqual(2);
    }

    // Experimental features: checkboxes, dropdowns, and the lone VR launcher reset button all align.
    await app.page.getByRole("button", { name: "Experimental", exact: true }).click();
    await app.page.waitForTimeout(300);
    const experimental = await measureRowControls(app.page);
    expect(experimental.length).toBeGreaterThanOrEqual(5);
    for (const item of experimental) {
        expect(Math.abs(item.left - fieldLeft), `Experimental "${item.label}" (${item.kind}): left=${item.left}, expected ${fieldLeft}`).toBeLessThanOrEqual(2);
    }

    // Voice changer (RVC): FormRow buttons (audio route, RVC switch, monitor), numeric inputs,
    // input select + refresh button, Start/Stop buttons, and the disabled-start reason align.
    await app.page.getByRole("button", { name: "Voice changer (RVC)", exact: true }).click();
    await app.page.waitForTimeout(300);
    const rvc = await measureRowControls(app.page);
    expect(rvc.length).toBeGreaterThanOrEqual(6);
    for (const item of rvc) {
        expect(Math.abs(item.left - fieldLeft), `RVC "${item.label}" (${item.kind}): left=${item.left}, expected ${fieldLeft}`).toBeLessThanOrEqual(2);
    }
    const startButtonLeft = await app.page.getByRole("button", { name: "Start input forwarding" }).evaluate(el => Math.round(el.getBoundingClientRect().left));
    expect(Math.abs(startButtonLeft - fieldLeft), `RVC Start button left=${startButtonLeft}, expected ${fieldLeft}`).toBeLessThanOrEqual(2);
    const monitorButtonLeft = await app.page.locator('[data-setting-id="rvc_settings"] [data-page-pointer="tts"]').evaluate(el => Math.round(el.getBoundingClientRect().left));
    expect(Math.abs(monitorButtonLeft - fieldLeft), `RVC Monitor link button left=${monitorButtonLeft}, expected ${fieldLeft}`).toBeLessThanOrEqual(2);

    // Device: Auto select checkboxes remain flush with the field column start.
    await app.page.getByRole("button", { name: "Device", exact: true }).click();
    await app.page.waitForTimeout(300);
    const deviceBoxes = await app.page.locator('[data-setting-id="mic_host_device"] input[type="checkbox"] + span, [data-setting-id="speaker_device"] input[type="checkbox"] + span')
        .evaluateAll(elements => elements.map(el => Math.round(el.getBoundingClientRect().left)));
    expect(deviceBoxes.length).toBe(2);
    for (const left of deviceBoxes) {
        expect(Math.abs(left - fieldLeft), `Device auto-select checkbox left=${left}, expected ${fieldLeft}`).toBeLessThanOrEqual(2);
    }
});
