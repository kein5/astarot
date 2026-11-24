import assert from "node:assert/strict";
import { test } from "vitest";
import { FIRST_SETTINGS_TAB, SETTINGS_MENU_GROUPS, SETTINGS_MENU_TABS, visibleMenuGroups } from "./settingsMenu.ts";

test("the menu keeps only the pages shown, and leaves out a group left without a page", () => {
    assert.deepEqual(visibleMenuGroups(() => true), SETTINGS_MENU_GROUPS.map(group => ({ id: group.id, tabs: [...group.tabs] })));
    const shown = new Set(["translation", "vr", "about_vrct"]);
    assert.deepEqual(visibleMenuGroups(tab => shown.has(tab)), [{ id: "conversation", tabs: ["translation", "vr"] }, { id: "app", tabs: ["about_vrct"] }]);
    assert.deepEqual(visibleMenuGroups(() => false), []);
    assert.deepEqual(SETTINGS_MENU_TABS, SETTINGS_MENU_GROUPS.flatMap(group => group.tabs));
    assert.equal(FIRST_SETTINGS_TAB, "translation");
});
