// The translation catalog (#413) through the core: an API entry is added, used and removed from the
// settings page. The core keeps the entry in translation_catalog.json and its key in the key store
// (here the core's in-memory stand-in), checks the address and the key against the server when the
// entry is used, and forgets both on removal.
import { expect, test } from "./fixtures";
import { OpenAiCompatible } from "./standIns";

const KEY = "integration-secret-key";

test("an API entry is added, used against its server and removed, and its key is never written to a file", async ({ app }) => {
    const server = await new OpenAiCompatible(KEY, "unused").start();
    try {
        const page = app.page;
        await app.openSettings("Translation");
        const catalog = page.getByRole("region", { name: "Translation catalog" });
        // The catalog's groups start closed, their bars reading out what they hold: the API group,
        // where the entry is added and its card shown, is opened by its name first.
        const api = catalog.locator("[data-catalog-group=api]");
        await api.getByRole("heading", { name: "APIs", exact: true }).click();
        await expect(api.locator(":scope > details")).toHaveJSProperty("open", true);
        const form = catalog.locator("[data-catalog-add=api]");
        await form.locator("summary").click();
        await form.getByLabel("Display name").fill("Home server");
        await form.getByLabel("Address (URL)").fill(`${server.url}/v1`);
        await form.getByLabel("API key").fill(` ${KEY} `);
        await form.getByRole("button", { name: "Add", exact: true }).click();

        // The core answered with the catalog: the entry is the user's, its key is in the key store,
        // and the form is empty again.
        const card = catalog.getByRole("group", { name: "Home server", exact: true });
        await expect(card).toContainText("Added by you");
        await expect(card).toContainText("Kept in the app's key store");
        await expect(form.getByLabel("API key")).toHaveValue("");
        const entries = () => (app.json("translation_catalog.json")?.entries ?? []) as Record<string, unknown>[];
        await expect.poll(entries).toEqual([expect.objectContaining({ group: "api", name: "Home server", url: `${server.url}/v1`, key: true })]);
        expect(app.written()).not.toContain(KEY);

        // Using it checks the address and the key against the server first.
        await card.getByRole("button", { name: "Use as the OpenAI-compatible connection" }).click();
        await expect(card).toContainText("In use");
        expect(server.received.some(seen => seen.path === "/v1/models" && seen.authorization === `Bearer ${KEY}`)).toBe(true);
        await expect.poll(() => app.settings().OPENAI_COMPATIBLE_URL).toBe(`${server.url}/v1`);
        expect(app.written()).not.toContain(KEY);

        // Removing asks first; going back keeps it.
        await card.getByRole("button", { name: "Remove", exact: true }).click();
        const confirm = card.getByRole("group", { name: "Remove Home server" });
        await expect(confirm).toContainText("The entry and its API key are removed from the app.");
        await confirm.getByRole("button", { name: "Back" }).click();
        await expect(card).toBeVisible();
        await card.getByRole("button", { name: "Remove", exact: true }).click();
        await card.getByRole("group", { name: "Remove Home server" }).getByRole("button", { name: "Remove", exact: true }).click();
        await expect(card).toHaveCount(0);
        await expect.poll(entries).toEqual([]);
    } finally {
        await server.stop();
    }
});

test("switching catalog layout persists without showing the saved toast, and so do settings that save by themselves", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Translation");
    const switcher = page.getByRole("group", { name: "Catalog layout" });
    const listButton = switcher.getByRole("button", { name: "List", exact: true });
    const gridButton = switcher.getByRole("button", { name: "Grid", exact: true });

    // Record every toast that opens so even a short 1 s save toast cannot slip past the check.
    await page.evaluate(() => {
        const seen: string[] = [];
        document.documentElement.dataset.seenToasts = "[]";
        const record = () => {
            for (const toast of document.querySelectorAll(".Toastify__toast")) {
                const text = toast.textContent?.trim();
                if (text && !seen.includes(text)) {
                    seen.push(text);
                    document.documentElement.dataset.seenToasts = JSON.stringify(seen);
                }
            }
        };
        record();
        new MutationObserver(record).observe(document.body, { childList: true, subtree: true });
    });

    await listButton.click();
    await expect(listButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => app.settings().CATALOG_LAYOUT).toBe("list");

    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => app.settings().CATALOG_LAYOUT).toBe("grid");
    // SnackbarController waits 100 ms before opening a toast; give it time to fire if it were going to.
    await page.waitForTimeout(250);
    const readToasts = () => page.evaluate(() => JSON.parse(document.documentElement.dataset.seenToasts ?? "[]") as string[]);
    expect(await readToasts()).toEqual([]);

    // Immediate settings controls (such as toggles) also persist without raising the saved toast.
    await page.getByRole("button", { name: "Advanced", exact: true }).first().click();
    const logToggle = page.getByRole("checkbox", { name: "Auto save message logs" });
    const wasChecked = await logToggle.isChecked();
    await logToggle.click();
    await expect.poll(() => app.settings().LOGGER_FEATURE).toBe(!wasChecked);
    await page.waitForTimeout(250);
    expect(await readToasts()).toEqual([]);

    // A field that saves by itself (#1111) saves without the toast too. Since the advanced settings
    // save by themselves, no settings save raises it; the toast itself goes with the save bar.
    const portInput = page.getByLabel("OSC port");
    await app.unfold(portInput);
    await portInput.fill("9005");
    await portInput.press("Tab");
    await expect.poll(() => app.settings().OSC_PORT).toBe(9005);
    await page.waitForTimeout(250);
    expect(await readToasts()).toEqual([]);
});
