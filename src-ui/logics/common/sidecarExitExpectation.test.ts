import assert from "node:assert/strict";
import { test } from "vitest";
import { expectBackendExit, isBackendUpdate, rejectExpectedExit, undoExpectedExit } from "./sidecarExitExpectation.ts";

const session = () => ({ expectedExits: new Map() });

test("only shutdown and the two updates are expected to end the backend", () => {
    assert.deepEqual(["/run/update_software", "/run/update_cuda_software", "/run/shutdown"].map(isBackendUpdate), [true, true, false]);
    const s = session();
    assert.equal(expectBackendExit(s, "/set/data/osc_port"), null);
    assert.equal(expectBackendExit(null, "/run/shutdown"), null);
    for (const endpoint of ["/run/shutdown", "/run/update_software", "/run/update_cuda_software"]) {
        const token = expectBackendExit(s, endpoint);
        assert.deepEqual(token, { endpoint });
        assert.ok(s.expectedExits.get(endpoint).has(token), endpoint);
    }
    assert.deepEqual([...s.expectedExits.keys()], ["/run/shutdown", "/run/update_software", "/run/update_cuda_software"]);
});

test("each request is expected on its own, and undoing one keeps the others", () => {
    const s = session();
    const first = expectBackendExit(s, "/run/shutdown"), second = expectBackendExit(s, "/run/shutdown");
    assert.equal(s.expectedExits.get("/run/shutdown").size, 2);
    undoExpectedExit(s, first);
    assert.deepEqual([...s.expectedExits.get("/run/shutdown")], [second]);
    undoExpectedExit(s, first);
    assert.equal(s.expectedExits.get("/run/shutdown").size, 1, "undoing twice changes nothing");
    undoExpectedExit(s, second);
    assert.equal(s.expectedExits.has("/run/shutdown"), false, "the last one removes the endpoint");
    undoExpectedExit(s, null);
    undoExpectedExit(s, second);
    assert.equal(s.expectedExits.size, 0);
});

test("a refused request drops every expectation for its endpoint", () => {
    const s = session();
    const token = expectBackendExit(s, "/run/update_software");
    expectBackendExit(s, "/run/update_software");
    const shutdown = expectBackendExit(s, "/run/shutdown");
    rejectExpectedExit(s, "/run/update_software");
    assert.deepEqual([...s.expectedExits.keys()], ["/run/shutdown"]);
    undoExpectedExit(s, token);
    assert.deepEqual([...s.expectedExits.get("/run/shutdown")], [shutdown]);
    rejectExpectedExit(null, "/run/shutdown");
});
