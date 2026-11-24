// #1111: a setting that saves by itself, through the core. The chat reading page's window name is
// saved when focus leaves the field, without the save bar; an empty name is refused in words under
// the field and never sent; Escape puts the saved name back.
import { expect, test } from "./fixtures";

test("the window name saves when focus leaves it, and an empty one is refused under the field", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Chat reading (OCR)");
    const field = page.getByLabel("Window name", { exact: true });
    await app.unfold(field);
    const saved = app.settings().OCR_WINDOW_TITLE ?? "VRChat";

    // An empty name: said under the field, the field marked, and nothing written.
    await field.fill("");
    await field.press("Tab");
    const problem = page.getByRole("alert").filter({ hasText: "The window name is empty." });
    await expect(problem).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(app.settings().OCR_WINDOW_TITLE ?? "VRChat").toBe(saved);

    // A name: the problem goes as soon as the field is edited, and leaving the field saves it.
    await field.fill("VRChat Beta");
    await expect(problem).toHaveCount(0);
    await field.press("Tab");
    await expect.poll(() => app.settings().OCR_WINDOW_TITLE).toBe("VRChat Beta");
    // The page has nothing left for the save bar: it says its changes apply at once.
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    // Escape puts the saved name back without saving the edit.
    await field.fill("Other client");
    await field.press("Escape");
    await expect(field).toHaveValue("VRChat Beta");
    await field.press("Tab");
    expect(app.settings().OCR_WINDOW_TITLE).toBe("VRChat Beta");
});
