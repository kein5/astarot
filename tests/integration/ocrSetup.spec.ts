import { expect, test } from "./fixtures";

// Chat reading refused because its models are missing (#1241): the dialog offers the models the
// reading language needs, as the chat reading page shows them, each with its review, and nothing
// downloads before consent. The core's host runs no OCR (native/browser-core-bridge), so the
// switch's refusal is the line the app's core sends for it; the models and what is missing are
// the core's own answers for this settings folder.
test("chat reading refused for its models offers them in its dialog, each reviewed before it downloads", async ({ app }) => {
    const page = app.page;
    await page.evaluate(text => window.__coreLine?.(text), JSON.stringify({ status: 400, endpoint: "/set/enable/ocr_capture",
        result: { error_code: "OCR_DISABLED_MODEL_MISSING", message: "OCR disabled", data: false } }));
    const dialog = page.getByRole("dialog", { name: "Chat reading needs its recognition models" });
    await expect(dialog).toBeVisible();
    // The first focus is the safe action, not the models' section in front of it.
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    const cards = dialog.locator("[data-model-download]");
    await expect(cards.first()).toBeVisible();
    // None is on this new settings folder's PC: each card offers its review.
    const count = await cards.count();
    await expect(dialog.getByRole("button", { name: "Review download" })).toHaveCount(count);

    // The review: what it is, its terms and size, and a start that waits for the consent.
    await cards.first().getByRole("button", { name: "Review download" }).click();
    const review = page.getByRole("dialog", { name: "Model download and terms" });
    await expect(review).toBeVisible();
    await expect(review.getByText(/bytes/).first()).toBeVisible();
    const start = review.getByRole("button", { name: "Agree and download" });
    await expect(start).toBeDisabled();
    await review.getByRole("checkbox").check();
    await expect(start).toBeEnabled();
    await review.getByRole("button", { name: "Back" }).click();
    await expect(review).toBeHidden();
    // Back is not consent: nothing started.
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Review download" })).toHaveCount(count);

    // Closing leaves chat reading off, and the way to the settings is there instead.
    await expect(dialog.getByRole("button", { name: "Open the chat reading settings" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("switch", { name: "Chat reading (OCR)", exact: true })).toHaveAttribute("aria-checked", "false");
});
