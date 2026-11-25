import { expect, test } from "./fixtures";

// #1035: the WebSocket and OBS captions carry the names given to voices only when the user turns
// this on. It starts off, and the switch saves through the core at once.
test("the switch for the names given to voices starts off and saves through the core", async ({ app }) => {
    await app.openSettings("Advanced");
    const names = app.page.getByRole("checkbox", { name: "Send the names given to voices", exact: true });
    await app.unfold(names);
    await expect(names).not.toBeChecked();
    expect(app.settings().WEBSOCKET_SPEAKER_NAMES ?? false).toBe(false);
    await names.click();
    await expect(names).toBeChecked();
    await expect.poll(() => app.settings().WEBSOCKET_SPEAKER_NAMES).toBe(true);
    await names.click();
    await expect(names).not.toBeChecked();
    await expect.poll(() => app.settings().WEBSOCKET_SPEAKER_NAMES).toBe(false);
});
