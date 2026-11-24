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

// #1111: the refusal of a field's own save, said by the core, is said under the field in the words
// of its old notice, and the notice is not shown as well. The value the core keeps stays saved.
test("a server address the core refuses is said under the field, without a notice as well", async ({ app }) => {
    const page = app.page;
    await page.evaluate(() => {
        const seen: string[] = [];
        document.documentElement.dataset.seenToasts = "[]";
        new MutationObserver(() => {
            for (const toast of document.querySelectorAll(".Toastify__toast")) {
                const text = toast.textContent?.trim();
                if (text && !seen.includes(text)) seen.push(text);
            }
            document.documentElement.dataset.seenToasts = JSON.stringify(seen);
        }).observe(document.body, { childList: true, subtree: true });
    });
    await app.openSettings("Translation");
    const field = page.getByLabel("LM Studio URL", { exact: true });
    await app.unfold(field);
    const saved = app.settings().LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1";

    // Not an address at all: the field's own check says what would do.
    await field.fill("127.0.0.1:1234");
    await field.press("Tab");
    await expect(page.getByRole("alert").filter({ hasText: "starting with http:// or https://" })).toBeVisible();

    // An address where no server answers: the core refuses it, and its reason is under the field.
    await field.fill("http://127.0.0.1:9/v1");
    await field.press("Tab");
    const refusal = page.getByRole("alert").filter({ hasText: "the server could not be reached" });
    await expect(refusal).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(app.settings().LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1").toBe(saved);
    // SnackbarController waits 100 ms before opening a toast; give it time to fire if it were going to.
    await page.waitForTimeout(250);
    const toasts = await page.evaluate(() => JSON.parse(document.documentElement.dataset.seenToasts ?? "[]") as string[]);
    expect(toasts.filter(text => text.includes("could not be reached"))).toEqual([]);
});
