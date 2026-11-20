// A page change is deferred while a settings form has unsaved edits: a listener that prevents the
// event keeps the page and takes `proceed` to call later.
// The event starts at the document and bubbles to the window, so the window's capture listener
// (the save bar's one confirmation for every form on the page, Topbar.tsx) runs before the forms'
// own listeners (useSettingsDraft.tsx) on every engine. Dispatched on the window itself, Chromium
// calls the listeners in the order they were added, whatever their phase, and a form adds its own
// before the save bar hears of the edit: the form's confirmation opened instead of the shared one.
export function requestSettingsNavigation(proceed: () => void): void {
    const event = new CustomEvent("vrct:settings-leave", { bubbles: true, cancelable: true, detail: { proceed } });
    if (document.dispatchEvent(event)) proceed();
}
