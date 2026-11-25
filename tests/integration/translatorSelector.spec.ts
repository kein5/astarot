import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// #1095: opening the translator list from the main sidebar must not scroll the rail or shift
// any control in the rail or the conversation column.

type Rect = { x: number; y: number; w: number; h: number };

const measurePage = (page: Page) => page.evaluate(() => {
    const box = (el: Element | null): Rect | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const railScroll = document.querySelector("[data-sidebar-scroll]");
    const switches = [...document.querySelectorAll("[data-main-page] [role=switch]")].map(el => box(el));
    const heading = document.querySelector("[data-main-page] h1");
    // The translator button opens the kit's Popover (a dialog).
    const translatorBtn = document.querySelector('[data-sidebar-rail] button[aria-haspopup="dialog"][aria-expanded]');
    return {
        railScrollTop: railScroll ? Math.round(railScroll.scrollTop) : null,
        rail: box(document.querySelector("[data-sidebar-rail]")),
        translatorBtn: box(translatorBtn),
        settingsBtn: box(document.querySelector("[data-open-settings]")),
        switches,
        topbarToggle: box(document.querySelector("[data-sidebar-toggle]")),
        heading: box(heading),
        input: box(document.querySelector("textarea[data-message-input]")),
    };
});

test.use({ settings: { UI_LANGUAGE: "ja" }, viewport: { width: 1280, height: 720 } });

test("opening the translator selector moves nothing in the rail or main area", async ({ app }) => {
    const page = app.page;
    await expect(page.locator("[data-main-page] h1")).toBeVisible();

    const trigger = page.locator("[data-main-page]").getByRole("button", { name: /^翻訳エンジン/ });
    // Ensure the trigger itself is already inside the rail scrollport before measuring the baseline:
    // on engines whose fallback CJK font wraps taller (e.g. WebKit on ubuntu-latest at 1280×720),
    // the trigger's bottom edge can extend past the scrollport, causing Playwright's click() to
    // scroll the rail via scrollIntoViewIfNeeded() before the popover opens.
    await trigger.scrollIntoViewIfNeeded();

    const before = await measurePage(page);
    expect(before.translatorBtn).not.toBeNull();
    expect(before.heading).not.toBeNull();
    expect(before.input).not.toBeNull();

    await trigger.click();

    const popover = page.locator("[data-translator-selector]");
    await expect(popover).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const after = await measurePage(page);
    expect(after).toEqual(before);

    // Popover opens beside the rail, inside the viewport and below the title bar.
    const layout = await page.evaluate(() => {
        const pop = document.querySelector("[data-translator-selector]")?.getBoundingClientRect();
        const rail = document.querySelector("[data-sidebar-rail]")?.getBoundingClientRect();
        const main = document.querySelector("[data-main-page]")?.getBoundingClientRect();
        return {
            pop: pop ? { left: Math.round(pop.left), right: Math.round(pop.right), top: Math.round(pop.top), bottom: Math.round(pop.bottom) } : null,
            railRight: rail ? Math.round(rail.right) : 0,
            mainTop: main ? Math.round(main.top) : 0,
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    });
    expect(layout.pop).not.toBeNull();
    expect(layout.pop!.left).toBeGreaterThanOrEqual(layout.railRight);
    expect(layout.pop!.top).toBeGreaterThanOrEqual(layout.mainTop);
    expect(layout.pop!.right).toBeLessThanOrEqual(layout.vw);
    expect(layout.pop!.bottom).toBeLessThanOrEqual(layout.vh);

    // Escape closes the popover and returns focus to the trigger button.
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();

    // Clicking outside closes the popover without moving anything.
    await trigger.click();
    await expect(popover).toBeVisible();
    await page.locator("textarea[data-message-input]").click();
    await expect(popover).toHaveCount(0);
    expect(await measurePage(page)).toEqual(before);
});

test.describe("narrow overlay rail", () => {
    test.use({ viewport: { width: 700, height: 600 } });

    test("opening the translator selector in a narrow overlay rail keeps the conversation still", async ({ app }) => {
        const page = app.page;
        await expect(page.locator("[data-sidebar-toggle]")).toHaveAttribute("aria-expanded", "false");

        const beforeConversation = await page.evaluate(() => {
            const heading = document.querySelector("[data-main-page] h1")?.getBoundingClientRect();
            const input = document.querySelector("textarea[data-message-input]")?.getBoundingClientRect();
            return {
                heading: heading ? { x: Math.round(heading.x), y: Math.round(heading.y) } : null,
                input: input ? { x: Math.round(input.x), y: Math.round(input.y), w: Math.round(input.width) } : null,
            };
        });

        await page.locator("[data-sidebar-toggle]").click();
        const trigger = page.locator("[data-main-page]").getByRole("button", { name: /^翻訳エンジン/ });
        await expect(trigger).toBeVisible();
        await trigger.click();

        const popover = page.locator("[data-translator-selector]");
        await expect(popover).toBeVisible();

        const afterConversation = await page.evaluate(() => {
            const heading = document.querySelector("[data-main-page] h1")?.getBoundingClientRect();
            const input = document.querySelector("textarea[data-message-input]")?.getBoundingClientRect();
            return {
                heading: heading ? { x: Math.round(heading.x), y: Math.round(heading.y) } : null,
                input: input ? { x: Math.round(input.x), y: Math.round(input.y), w: Math.round(input.width) } : null,
            };
        });
        expect(afterConversation).toEqual(beforeConversation);

        // Pressing inside the portaled popover keeps both the popover and the overlay rail open.
        await popover.click({ position: { x: 12, y: 12 } });
        await expect(popover).toBeVisible();
        await expect(trigger).toBeVisible();

        // Pressing Escape closes only the popover first while keeping the overlay rail open.
        await page.keyboard.press("Escape");
        await expect(popover).toHaveCount(0);
        await expect(trigger).toBeVisible();
        await expect(trigger).toBeFocused();
    });
});
