// The tray companion's hexagram: a magic circle around a hexagram, the shape of the ASTAROT symbol
// (docs/brand/astarot). Each of the six triangles at the star's points stands for one of the main
// switches; hovering one docks that feature out beyond its point, towards the middle of the screen.
//
// A hexagram of circumradius R is two equilateral triangles. Its points are at -90°, -30°, 30°,
// 90°, 150° and 210° (clockwise from the top, y down); the two triangles cross on a hexagon of
// circumradius R/√3 whose corners lie halfway between the points. Each point's triangle is the
// tip and the two hexagon corners beside it.

export type Point = { readonly x: number; readonly y: number };
export type Side = "top" | "right" | "bottom" | "left";

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const at = (radius: number, degrees: number): Point => ({
    x: round(radius * Math.cos(toRadians(degrees))),
    y: round(radius * Math.sin(toRadians(degrees))),
});
// Path data stays short and stable; the drawing is never finer than this.
const round = (value: number) => Math.round(value * 1000) / 1000 + 0;

// The angle of the point that stands for the index-th feature, clockwise from the top.
export const pointAngle = (index: number): number => -90 + 60 * index;

// The triangle at the index-th point, about the centre (0, 0): tip, then the two corners.
export const pointTriangle = (radius: number, index: number): readonly [Point, Point, Point] => {
    const angle = pointAngle(index), inner = radius / Math.sqrt(3);
    return [at(radius, angle), at(inner, angle - 30), at(inner, angle + 30)];
};

// The hexagon in the middle, where the two triangles cross.
export const innerHexagon = (radius: number): readonly Point[] =>
    Array.from({ length: 6 }, (_, index) => at(radius / Math.sqrt(3), -60 + 60 * index));

export const polygon = (points: readonly Point[]): string => points.map(({ x, y }) => `${x},${y}`).join(" ");

// The screen edge the hexagram hides at (TRAY_COMPANION_EDGE). Out, its centre is on the edge, so
// only the half towards the screen shows.
export const EDGES = ["right", "left", "top", "bottom"] as const;
export type Edge = (typeof EDGES)[number];
export const isEdge = (value: unknown): value is Edge => (EDGES as readonly unknown[]).includes(value);

// The direction from the edge into the screen, and the side a docked label grows to: towards the
// middle of the screen.
const INWARD: Record<Edge, number> = { right: 180, left: 0, top: 90, bottom: -90 };
const INWARD_SIDE: Record<Edge, Side> = { right: "left", left: "right", top: "bottom", bottom: "top" };
export const inwardSide = (edge: Edge): Side => INWARD_SIDE[edge];
export const inwardAngle = (edge: Edge): number => INWARD[edge];

// One turn of the wheel turns the hexagram by one point.
export const TURN = 60;

// The rotation that points one triangle straight into the screen, so that three whole
// triangles show (that one and its two neighbours) and three hide beyond the edge.
export const baseRotation = (edge: Edge): number => (((INWARD[edge] + 90) % TURN) + TURN) % TURN;

// The angle of the index-th point after the hexagram has turned by `rotation`.
export const angleOf = (index: number, rotation: number): number => pointAngle(index) + rotation;

const difference = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

// The point shows whole, on the screen's side of the edge.
export const facesInward = (angle: number, edge: Edge): boolean => difference(angle, INWARD[edge]) <= TURN + 0.5;

// Where a feature docks out: `distance` from the centre beyond its point, the label growing to
// `side` (towards the middle of the screen), so it leaves the hexagram instead of covering it.
export const dockAt = (distance: number, angle: number, side: Side): { at: Point; side: Side } =>
    ({ at: at(distance, angle), side });