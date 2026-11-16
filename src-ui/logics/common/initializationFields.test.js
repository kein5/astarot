import assert from "node:assert/strict";
import { test } from "node:test";
import { applyInitializationFields, createInitializationValidators } from "./initializationFields.ts";

const PLACEMENT = "/get/data/overlay_desktop_placement";
const validators = createInitializationValidators([
    { base_endpoint_name: "overlay_desktop_placement", logics_template_id: "get_set", default_value: { x: null, y: null } },
]);

// A caption window dragged once is saved as whole px and has to come back on the next start.
test("a saved caption window place is applied at start-up", () => {
    const applied = [];
    const failed = applyInitializationFields({ [PLACEMENT]: { x: -1700, y: 640 } },
        { [PLACEMENT]: value => applied.push(value) }, validators, () => {});
    assert.deepEqual(failed, []);
    assert.deepEqual(applied, [{ x: -1700, y: 640 }]);
});

test("the caption window place accepts the band and refuses half or broken places", () => {
    const valid = validators[PLACEMENT];
    assert.equal(valid({ x: null, y: null }), true);
    assert.equal(valid({ x: 0, y: 0 }), true);
    for (const bad of [{ x: 1, y: null }, { x: null, y: 2 }, { x: 1.5, y: 2 }, { x: "1", y: 2 }, null, [], 3]) {
        assert.equal(valid(bad), false, JSON.stringify(bad));
    }
});
