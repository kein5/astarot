import { expect, test } from "./fixtures";

test("the main window takes input once the core has started and sent its settings", async ({ app }) => {
    // The languages come from the core's answers at start-up: the saved defaults of a new
    // settings folder (Japanese to English).
    await expect(app.page.getByRole("button", { name: "Your language: Japanese (Japan)" })).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Target language: English (United States)" })).toBeVisible();
    expect(app.settings().UI_LANGUAGE).toBe("en");
});
