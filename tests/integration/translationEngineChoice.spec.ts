// #1369: the translation engine of Settings → Translation is chosen in a dropdown found by typing,
// not a list of radios. Its two groups stay; choosing by the keys saves the engine through the
// core as the radios did; Escape and a press outside close the list and change nothing; opening
// it moves nothing on the page, and the model and its device come right under it.
import { expect, test } from "./fixtures";
import { OpenAiCompatible } from "./standIns";

test("the engine is chosen in a searchable dropdown, by the keys, and saved through the core", async ({ app }) => {
    // LM Studio on a loopback address answers, so the core offers it at once.
    const server = await new OpenAiCompatible(null, "unused").start();
    try {
        await app.restartWith({ LMSTUDIO_URL: `${server.url}/v1` });
        const page = app.page;
        await app.openSettings("Translation");

        const choice = page.getByRole("combobox", { name: "Engine used for translation", exact: true });
        // The words shown (every engine's words lie hidden beside them, for the button's width).
        const shown = choice.locator("[data-slot=combobox-value]");
        await expect(shown).toHaveText("AI translation (local)");
        await expect(choice).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByRole("radio", { name: "DeepL API" })).toHaveCount(0);
        // With no list of radios above it, the model and its device are in sight.
        const model = page.locator("summary").filter({ hasText: "Model and device" });
        await expect(model).toBeInViewport();
        const before = await model.boundingBox();

        // Opening: a panel over the page; the search field takes the keys, on the engine in use.
        await choice.click();
        const search = page.getByRole("combobox", { name: "Search translation engines", exact: true });
        await expect(search).toBeFocused();
        await expect(choice).toHaveAttribute("aria-expanded", "true");
        const list = page.getByRole("listbox", { name: "Engine used for translation", exact: true });
        await expect(list.getByRole("group")).toHaveText([/^On your PC/, /^API \(cloud or your own server\)/]);
        await expect(list.getByRole("option", { selected: true })).toHaveText("AI translation (local)");
        // An engine with no key cannot be chosen now.
        await expect(list.getByRole("option", { name: "DeepL API" })).toHaveAttribute("aria-disabled", "true");
        expect(await model.boundingBox()).toEqual(before);

        // A search that finds nothing says so; Escape closes the list and changes nothing.
        await search.fill("whisper");
        await expect(list.getByRole("option")).toHaveCount(0);
        await expect(page.getByRole("status").filter({ hasText: "No matching engines" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(search).toHaveCount(0);
        await expect(choice).toBeFocused();
        await expect(shown).toHaveText("AI translation (local)");

        // Down on the button opens it again, with the search emptied; typing keeps LM Studio and
        // Enter chooses it.
        await page.keyboard.press("ArrowDown");
        await expect(search).toBeFocused();
        await expect(search).toHaveValue("");
        await search.pressSequentially("lm");
        await expect(list.getByRole("option")).toHaveCount(1);
        await expect(list.getByRole("option", { selected: true })).toHaveText(/LM ?Studio/);
        await page.keyboard.press("Enter");
        await expect(search).toHaveCount(0);
        await expect(choice).toBeFocused();
        await expect(shown).toHaveText(/LM ?Studio/);
        await expect(page.getByText(/In use for language preset 1: LM ?Studio/)).toBeVisible();
        await expect.poll(() => (app.settings().SELECTED_TRANSLATION_ENGINES as Record<string, string> | undefined)?.["1"]).toBe("LMStudio");

        // A press outside closes it as well.
        await choice.click();
        await expect(search).toBeFocused();
        await page.getByRole("heading", { name: "Translation engine", exact: true }).click();
        await expect(search).toHaveCount(0);
        await expect(shown).toHaveText(/LM ?Studio/);
    } finally {
        await server.stop();
    }
});
