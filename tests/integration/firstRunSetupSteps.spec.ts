import { expect, test } from "./fixtures";

// The first-run setup's numbered steps (#1253). A step that fails says why in a notice: a sentence
// in a frame. It took the state's column, which grew to the sentence's width, and the step's name
// was left a column of single characters. The failure here is the one seen on a real PC: another
// model download was running, so the core refused to start this one. The page's request to start a
// download is answered so, without reaching the core: nothing is downloaded.
test("a failed step says why under its name, and the name keeps the row's width", async ({ app }) => {
    const page = app.page;
    await page.evaluate(() => {
        const internals = window.__TAURI_INTERNALS__;
        const original = internals.invoke.bind(internals);
        internals.invoke = (command: string, args?: unknown) => {
            const line = command === "backend_write" ? JSON.parse(String((args as { line: string }).line)) : null;
            if (line?.endpoint === "/run/start_model_download") {
                setTimeout(() => window.__coreLine?.(JSON.stringify({ status: 400, endpoint: "/run/start_model_download",
                    result: { error_code: "download_busy", message: "busy", data: null } })), 50);
                return Promise.resolve(null);
            }
            return original(command, args);
        };
    });
    await page.getByRole("button", { name: "Open setup" }).first().click();
    // The setup's one consent and start, under the sections (#1266).
    const recognition = page.getByRole("region", { name: "Prepare speech recognition" });
    await page.getByRole("checkbox", { name: /I have checked the licenses and sizes/ }).check();
    await page.getByRole("button", { name: "Start setup" }).click();
    const steps = recognition.getByRole("list", { name: /progress/i });
    const failed = steps.getByRole("alert");
    await expect(failed).toHaveText("Another model download is running. Wait or cancel it first.");

    const list = await steps.boundingBox();
    const name = await steps.locator("li").first().locator("span").first().boundingBox();
    const notice = await failed.boundingBox();
    expect(list && name && notice).toBeTruthy();
    if (!list || !name || !notice) return;
    // The name keeps most of the row and its words on their lines; the notice is under it.
    expect(name.width).toBeGreaterThan(list.width * 0.5);
    expect(name.height).toBeLessThan(60);
    expect(notice.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(notice.x).toBeCloseTo(name.x, 0);
});
