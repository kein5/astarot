import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The IPC reference (docs/spec/reference/ipc-endpoints.md), which tools/spec_catalog.py writes from
// the core's routes and the UI's, and CI keeps current: the requests, the notices the core sends,
// and the routes only the UI defines.
const reference = readFileSync(new URL("../../../docs/spec/reference/ipc-endpoints.md", import.meta.url), "utf8");
const section = (title: string) => {
    const start = reference.indexOf(`## ${title}`);
    assert.ok(start >= 0, title);
    const end = reference.indexOf("\n## ", start + 1);
    return reference.slice(start, end < 0 ? undefined : end);
};
const endpoints = (text: string, pattern: RegExp) => new Set([...text.matchAll(pattern)].map(match => match[1]));
export const requests = endpoints(section("要求"), /^\| `(\/[^`]+)`/gm);
export const notices = endpoints(section("通知"), /^\| `[^`]+` \| `(\/[^`]+)`/gm);
export const uiOnly = endpoints(section("UIだけにあるルート"), /^- `(\/[^`]+)`/gm);

// The UI's receiver of each request and notice, as the reference names it: the hook and its
// function ("useVoice.updateStatus"), RECEIVE_ONLY for a route that takes the answer and does
// nothing with it, or NONE for no route. tools/spec_catalog.py writes it by reading the route table
// and the settings as text, as buildRouteMetaList() reads them.
export const RECEIVE_ONLY = "（受け取るだけ）", NONE = "—";
export const receivers = new Map<string, string>([
    ...section("要求").matchAll(/^\| `(\/[^`]+)` \| [^|]* \| [^|]* \| ([^|]*?) \|/gm),
    ...section("通知").matchAll(/^\| `[^`]+` \| `(\/[^`]+)` \| ([^|]*?) \|/gm),
].map(([, endpoint, receiver]): [string, string] => [endpoint, receiver]));
