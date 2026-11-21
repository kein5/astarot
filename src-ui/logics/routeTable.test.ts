import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import { loadBridgeRoutes } from "./test/bridgeHarness.ts";

// The endpoints of the IPC reference (docs/spec/reference/ipc-endpoints.md), which
// tools/spec_catalog.py writes from the core's routes and the UI's and CI keeps current: the
// requests, the notices the core sends, and the routes only the UI defines.
const reference = readFileSync(new URL("../../docs/spec/reference/ipc-endpoints.md", import.meta.url), "utf8");
const section = (title: string) => {
    const start = reference.indexOf(`## ${title}`);
    assert.ok(start >= 0, title);
    const end = reference.indexOf("\n## ", start + 1);
    return reference.slice(start, end < 0 ? undefined : end);
};
const endpoints = (text: string, pattern: RegExp) => new Set([...text.matchAll(pattern)].map(match => match[1]));
const requests = endpoints(section("要求"), /^\| `(\/[^`]+)`/gm);
const notices = endpoints(section("通知"), /^\| `[^`]+` \| `(\/[^`]+)`/gm);
const uiOnly = endpoints(section("UIだけにあるルート"), /^- `(\/[^`]+)`/gm);

test("the reference lists the requests, the notices and the UI's own routes", () => {
    // A heading or table that changes shape would empty a set and pass every route below.
    assert.ok(requests.size > 400 && notices.size > 50 && uiOnly.size > 20, `${requests.size} ${notices.size} ${uiOnly.size}`);
});

test("every route the UI listens on is an endpoint of the IPC reference", async () => {
    const { routeTable } = await loadBridgeRoutes();
    assert.ok(routeTable.length > 300, String(routeTable.length));
    const unknown = routeTable.map(route => route.endpoint)
        .filter(endpoint => !requests.has(endpoint) && !notices.has(endpoint) && !uiOnly.has(endpoint));
    assert.deepEqual(unknown, []);
});

test("every route of the settings reaches a method of its settings hook", async () => {
    // A route whose hook or method the settings do not have logs it and does nothing.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { routeTable } = await loadBridgeRoutes();
    const missing = [...errors.mock.calls, ...warnings.mock.calls]
        .filter(([message]) => message === "Method not found." || String(message).startsWith("Hook not found on namespace"));
    assert.deepEqual(missing, []);
    // The settings make most routes; each names a hook of a settings category.
    assert.ok(routeTable.filter(route => route.hook_name?.startsWith("use")).length > 300);
});
