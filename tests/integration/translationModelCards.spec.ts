// The translation catalog's cards of the built-in models, through the core (#1228): pressing a
// downloaded model's card makes it the model in use and the cards follow; the card in use has
// nothing to press; a model that is not downloaded opens its download review, which starts nothing.
// The bridge counts the models listed in translation-models.json as on the PC.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";

const M2M = "m2m100_418M-ct2-int8", NLLB = "nllb-200-distilled-600M-ct2-int8";

test("a downloaded built-in model's card switches the model in use, and the cards follow", async ({ app }) => {
    writeFileSync(path.join(app.state, "translation-models.json"), JSON.stringify([M2M, NLLB]));
    await app.restart();
    const page = app.page;
    await app.openSettings("Translation");
    // The catalog's models are in the page's part for this PC (#1266 ★17).
    const catalog = page.getByRole("region", { name: "Model catalog" });
    const engine = catalog.locator("[data-catalog-group=engine]");
    await engine.getByRole("heading", { name: "Model catalog", exact: true }).click();
    await engine.locator("summary").filter({ hasText: /^Included with the app/ }).click();
    const card = (weight: string) => engine.locator(`[data-catalog-item="${weight}"]`);
    const use = (weight: string) => card(weight).getByRole("button", { name: /^Use for translation on your PC \(/ });

    // M2M100 418M is the model in use at first: nothing to press on its card.
    await expect(card(M2M)).toHaveAttribute("data-status", "in_use");
    await expect(use(M2M)).toHaveCount(0);

    // NLLB-200 600M bars commercial use: its card asks first, as the model list does.
    await use(NLLB).click();
    const license = page.getByRole("dialog");
    await license.getByRole("checkbox").check();
    await license.getByRole("button", { name: "Use this model", exact: true }).click();
    await expect.poll(() => app.settings().CTRANSLATE2_WEIGHT_TYPE).toBe(NLLB);
    await expect(card(NLLB)).toHaveAttribute("data-status", "in_use");
    await expect(card(M2M)).toHaveAttribute("data-status", "ready");

    // Pressing anywhere on M2M100's card switches back, without a question.
    const box = await card(M2M).boundingBox();
    expect(box).not.toBeNull();
    if (box) await page.mouse.click(box.x + 12, box.y + 12);
    await expect.poll(() => app.settings().CTRANSLATE2_WEIGHT_TYPE).toBe(M2M);
    await expect(card(M2M)).toHaveAttribute("data-status", "in_use");
    await expect(card(NLLB)).toHaveAttribute("data-status", "ready");
    await expect(use(NLLB)).toHaveCount(1);
});

test("a built-in model that is not downloaded opens its download review and starts nothing", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Translation");
    // The catalog's models are in the page's part for this PC (#1266 ★17).
    const catalog = page.getByRole("region", { name: "Model catalog" });
    const engine = catalog.locator("[data-catalog-group=engine]");
    await engine.getByRole("heading", { name: "Model catalog", exact: true }).click();
    await engine.locator("summary").filter({ hasText: /^Included with the app/ }).click();
    const missing = engine.locator("[data-status=not_downloaded]").first();
    await expect(missing).toBeVisible();
    await missing.getByRole("button", { name: /^Review download \(/ }).click();
    // A model of one file: its review and consent open at once, over the translation review, which
    // steps back (#1266 T-3). Back closes both.
    const review = page.getByRole("dialog");
    await expect(review).toHaveCount(1);
    await expect(review.getByRole("checkbox", { name: /^I have checked the license and the size/ })).toHaveCount(1);
    await review.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(app.settings().CTRANSLATE2_WEIGHT_TYPE ?? M2M).toBe(M2M);
});
