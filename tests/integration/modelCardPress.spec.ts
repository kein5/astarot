import { expect, test } from "./fixtures";

// The speech catalogs' cards are pressed anywhere for their main action (#1254), as the built-in
// translation models' are (#1228): a model that is not on the PC opens its download review, which
// starts nothing before the consent. The card's other controls (its facts' fold) are pressed on
// their own and open no review. The keyboard meets one button for the main action, named with the
// model after its words.
test("a speech model's card opens its download review when pressed anywhere, and its own fold does not", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Text to speech (TTS)");
    const card = page.locator("[data-model-download][data-status=not_downloaded]").first();
    await app.unfold(card);
    const review = page.getByRole("dialog", { name: "Model download and terms" });
    const main = card.getByRole("button", { name: /^Review download \(/ });
    await expect(main).toHaveCount(1);

    // The facts' fold of the card (the grid's, the layout a new install starts with) opens by itself.
    const facts = card.locator("details").first();
    await facts.locator(":scope > summary").click();
    await expect(facts).toHaveJSProperty("open", true);
    await expect(review).toHaveCount(0);

    // A press on the card's name, away from its button, opens the review.
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) await page.mouse.click(box.x + 12, box.y + 12);
    await expect(review).toBeVisible();
    await review.getByRole("button", { name: "Back", exact: true }).click();
    await expect(review).toBeHidden();
    // Back is not consent: nothing started.
    await expect(card).toHaveAttribute("data-status", "not_downloaded");
    await expect(card.getByRole("progressbar")).toHaveCount(0);
});
