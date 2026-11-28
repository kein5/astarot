// The default models' catalog in the speech recognition servers' group, through the core (#1403).
// When Listening comes to have a model of its own, a second server state joins the group and a
// model's card says "In use" in the same update. In Chromium (and WebView2 on Windows), the
// catalog's content then lost its layout: the state was added straight into the group's <fieldset>
// in the frame the words of an option of the card's file choice changed, inside the catalog, which
// is a size container. The catalog stayed empty until its fold was closed and opened again.
//
// A model counts as on the PC when its file has the catalog's size (native/ops `present`); its
// SHA-256 is checked only when it is used. So the file here is a sparse one of that size, and Mic
// input's model is set to it in "Your own model" while Listening keeps the file both used: the
// same change in one update as "Use for Listening" on a card, which would check the file.
import { closeSync, ftruncateSync, mkdirSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";

test("the speech recognition catalog stays laid out when Listening comes to have a model of its own", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Speech recognition (ASR)");
    const card = page.locator('section[aria-labelledby="model-catalog-asr"] [data-model-download][data-status=not_downloaded]').first();
    await app.unfold(card);
    const name = await card.getAttribute("aria-label");
    // Its file is chosen among several: the words of that choice change with the card's state.
    await expect(card.locator("select")).toHaveCount(1);

    // Where the download would put the file, and its size: the review's breakdown says both.
    await card.getByRole("button", { name: /^Review download \(/ }).click();
    const review = page.getByRole("dialog", { name: "Model download and terms" });
    await review.locator("summary").filter({ hasText: /Breakdown/ }).click();
    const folder = (await review.locator("code").first().textContent()) ?? "";
    const [, file, bytes] = /^(.+?) · ([\d,]+) bytes/.exec((await review.locator("ul li").first().textContent()) ?? "") ?? [];
    await review.getByRole("button", { name: "Back", exact: true }).click();
    expect(folder && file && bytes, "the review names the file, its size and its folder").toBeTruthy();
    const model = path.join(folder, file);
    mkdirSync(folder, { recursive: true });
    const handle = openSync(model, "w");
    ftruncateSync(handle, Number(bytes.replaceAll(",", "")));
    closeSync(handle);
    try {
        // Mic input and Listening use one file of the user's own: one server.
        const own = path.join(app.state, "own.gguf");
        await app.restartWith({ SPEECH_SERVER_SETTINGS: { profiles: { asr: { model: own, listening_model: own } } } });
        await app.openSettings("Speech recognition (ASR)");
        const onPc = page.locator(`[data-model-download][aria-label="${name}"]`);
        await app.unfold(onPc);
        await expect(onPc).toHaveAttribute("data-status", "downloaded");
        const group = onPc.locator("xpath=ancestor::fieldset[1]");
        const listening = group.getByRole("status").filter({ hasText: /^Listening: / });
        await expect(listening).toHaveCount(0);

        // Mic input takes the model on the PC: Listening keeps the user's file, a model of its own.
        const field = group.getByRole("textbox", { name: "Model GGUF path", includeHidden: true });
        await app.unfold(field);
        await field.fill(model);
        await field.press("Enter");
        await expect(listening).toHaveCount(1);
        await expect(onPc).toHaveAttribute("data-status", "in_use");
        // The catalog is still there: its heading and the card.
        await expect(group.getByRole("heading", { name: /^Download a default model/, level: 3 })).toBeVisible();
        await expect(onPc).toBeVisible();
    } finally {
        // The file has the size of a real model: it is not kept with the results.
        rmSync(model, { force: true });
    }
});
