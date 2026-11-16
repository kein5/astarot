import assert from "node:assert/strict";
import { test } from "node:test";
import { dockAnchor, innerHexagon, pointAngle, pointTriangle, polygon } from "./hexagram.ts";

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} != ${expected}`);

test("the six points go clockwise from the top", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(pointAngle), [-90, -30, 30, 90, 150, 210]);
});

test("each point's triangle is equilateral and rests on the inner hexagon", () => {
    const radius = 60;
    for (let index = 0; index < 6; index++) {
        const [tip, left, right] = pointTriangle(radius, index);
        close(Math.hypot(tip.x, tip.y), radius, "tip on the outer circle");
        for (const corner of [left, right]) close(Math.hypot(corner.x, corner.y), radius / Math.sqrt(3), "corner on the hexagon");
        // The two triangles of a hexagram of circumradius R have sides R√3; each point's sides are a third: R/√3.
        const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        close(length(tip, left), radius / Math.sqrt(3), "tip to corner");
        close(length(left, right), length(tip, left), "base");
    }
    // The top point is straight up.
    const [top] = pointTriangle(radius, 0);
    assert.deepEqual(top, { x: 0, y: -60 });
});

test("the inner hexagon's corners lie between the points", () => {
    const corners = innerHexagon(60);
    assert.equal(corners.length, 6);
    close(corners[0].x, 60 / Math.sqrt(3) * Math.cos(-Math.PI / 3), "first corner at -60°");
    assert.equal(polygon([{ x: 1, y: 2 }, { x: 3, y: -4 }]), "1,2 3,-4");
});

test("a feature docks out beyond its own point, on the side away from the star", () => {
    assert.deepEqual(dockAnchor(80, 0), { at: { x: 0, y: -80 }, side: "top" });
    assert.deepEqual(dockAnchor(80, 3), { at: { x: 0, y: 80 }, side: "bottom" });
    assert.equal(dockAnchor(80, 1).side, "right");
    assert.equal(dockAnchor(80, 2).side, "right");
    assert.equal(dockAnchor(80, 4).side, "left");
    assert.equal(dockAnchor(80, 5).side, "left");
});
