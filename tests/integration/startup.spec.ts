import { expect, test } from "./fixtures";

test("the main window takes input once the core has started and sent its settings", async ({ app }) => {
    // The languages come from the core's answers at start-up: the saved defaults of a new
    // settings folder (Japanese to English).
    await expect(app.page.getByRole("button", { name: "Your language: Japanese (Japan)" })).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Target language: English (United States)" })).toBeVisible();
    expect(app.settings().UI_LANGUAGE).toBe("en");
});

test("the page that is not shown takes no input: it is inert", async ({ app }) => {
    // React 19 takes inert as true or false; a page given "" would quietly lose it.
    const main = app.page.locator("[data-main-page]");
    const input = app.page.locator("textarea[class*=message_box_input_area]");
    const inert = app.page.locator("[inert]");
    await expect(main).not.toHaveAttribute("inert");
    // Settings is drawn while closed: it is the one inert page.
    await expect(inert).toHaveCount(1);
    await expect(inert.locator("[data-main-page]")).toHaveCount(0);

    await app.openSettings("Translation");
    await expect(main).toHaveAttribute("inert", "");
    await expect(inert).toHaveCount(1);
    expect(await input.evaluate(element => element.closest("[inert]") !== null)).toBe(true);
    expect(await app.page.getByRole("button", { name: "Go back" }).evaluate(element => element.closest("[inert]") === null)).toBe(true);

    await app.closeSettings();
    await expect(main).not.toHaveAttribute("inert");
    await expect(inert).toHaveCount(1);
});
