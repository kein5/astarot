import assert from "node:assert/strict";
import { test } from "vitest";
import { angleOf, baseRotation, centroid, dockAt, EDGES, facesInward, innerHexagon, inwardSide, pointAngle, pointTriangle, polygon, TURN } from "./hexagram.ts";

type Point = { x: number; y: number };

const close = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} != ${expected}`);

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
        const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
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

test("at every edge three whole triangles face the screen, whichever way it has turned", () => {
    for (const edge of EDGES) {
        for (let turns = -7; turns <= 7; turns++) {
            const rotation = baseRotation(edge) + TURN * turns;
            const shown = [0, 1, 2, 3, 4, 5].filter(index => facesInward(angleOf(index, rotation), edge));
            assert.equal(shown.length, 3, `${edge}, ${turns} turns`);
        }
    }
    // At the right edge, unturned, the point straight into the screen (180°) shows with its two neighbours.
    const rotation = baseRotation("right");
    assert.equal(rotation, 30);
    assert.deepEqual([0, 1, 2, 3, 4, 5].filter(index => facesInward(angleOf(index, rotation), "right")), [3, 4, 5]);
    // At the bottom edge the top point (mic) faces the screen.
    assert.equal(baseRotation("bottom"), 0);
    assert.ok(facesInward(angleOf(0, 0), "bottom"));
});

test("one turn brings one more feature into view and puts one away", () => {
    const before = [0, 1, 2, 3, 4, 5].filter(index => facesInward(angleOf(index, 30), "right"));
    const after = [0, 1, 2, 3, 4, 5].filter(index => facesInward(angleOf(index, 30 + TURN), "right"));
    assert.equal(before.filter(index => !after.includes(index)).length, 1);
    assert.equal(after.filter(index => !before.includes(index)).length, 1);
});

test("a feature docks out beyond its point, its label growing towards the middle of the screen", () => {
    assert.deepEqual(inwardSide("right"), "left");
    assert.deepEqual(inwardSide("left"), "right");
    assert.deepEqual(inwardSide("top"), "bottom");
    assert.deepEqual(inwardSide("bottom"), "top");
    const { at, side } = dockAt(72, 180, inwardSide("right"));
    assert.deepEqual(at, { x: -72, y: 0 });
    assert.equal(side, "left");
});

// #536: a feature's icon sits in the middle of its triangle, on the line from the centre to its tip.
test("a triangle's middle is on the way to its tip, two thirds of the way out of the hexagon", () => {
    const radius = 58;
    for (let index = 0; index < 6; index++) {
        const triangle = pointTriangle(radius, index);
        const middle = centroid(triangle);
        const angle = (pointAngle(index) * Math.PI) / 180;
        const distance = Math.hypot(middle.x, middle.y);
        assert.ok(Math.abs(Math.atan2(middle.y, middle.x) - Math.atan2(Math.sin(angle), Math.cos(angle))) < 1e-3, `${index}`);
        // The tip at R and the two corners at R/√3, 30° to either side: (R + 2·R/√3·cos 30°) / 3 = 2R/3.
        assert.ok(Math.abs(distance - (2 * radius) / 3) < 1e-2, `${index}: ${distance}`);
    }
});
