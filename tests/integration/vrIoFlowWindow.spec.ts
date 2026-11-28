// The VR panel's "Inputs and outputs" window shows its whole graph (#1404). The page draws the
// window at the size of the VR page's popup region (src-ui/views/vr/vr_layout.json) from the
// sample of tests/voice/fixtures/io_flow_sample.json, as the main window mirrors it to VR
// (app/vrFlow.tsx). Nothing comes from the core, so these tests start none.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LAYOUT = JSON.parse(readFileSync(path.join(ROOT, "src-ui/views/vr/vr_layout.json"), "utf8"));
const [, , WIDTH, HEIGHT] = LAYOUT.regions.popup as number[];
const GRAPH = { ja: "入力から出力への図", en: "Inputs to outputs" };

type Box = { left: number; right: number; top: number; bottom: number };

for (const lang of ["ja", "en"] as const) {
    test(`the VR Inputs and outputs window shows its whole graph across the window (${lang})`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(String(error)));
        await page.setViewportSize({ width: WIDTH, height: HEIGHT });
        await page.goto(`/vr-flow.html?lang=${lang}`);
        const graph = page.getByRole("group", { name: GRAPH[lang] });
        await expect(graph.locator("[data-node]").first()).toBeVisible();
        const sizes = await graph.evaluate(element => {
            const box = (target: Element): Box => {
                const { left, right, top, bottom } = target.getBoundingClientRect();
                return { left, right, top, bottom };
            };
            const frame = element.parentElement;
            // The window: the first child of the page's popup-sized box (app/vrFlow.tsx).
            const panel = document.querySelector("#root > div > div");
            if (!frame || !panel) return null;
            return {
                panel: box(panel), frame: box(frame),
                frameScroll: frame.scrollWidth, frameClient: frame.clientWidth,
                nodes: [...element.querySelectorAll("[data-node]")].map(node => ({ id: node.getAttribute("data-node"), ...box(node) })),
            };
        });
        if (!sizes) throw new Error("The graph's frame or the window is missing");
        const { panel, frame, nodes } = sizes;
        expect(panel.right - panel.left, "the window is as wide as the popup region").toBeCloseTo(WIDTH, 0);
        // The graph has the window's width, less its padding: not only the width of the latest
        // times under it, which left the right half of the window empty (#1404).
        expect(frame.right - frame.left, "the graph's frame spans the window").toBeGreaterThan(0.9 * WIDTH);
        // VR cannot scroll: the graph fits its frame, and every box is in sight.
        expect(sizes.frameScroll, "the graph does not run past its frame").toBeLessThanOrEqual(sizes.frameClient);
        expect(nodes.length).toBeGreaterThan(0);
        for (const node of nodes) {
            expect(node.right, `${node.id} ends inside the graph's frame`).toBeLessThanOrEqual(frame.right + 0.5);
            expect(node.left, `${node.id} starts inside the graph's frame`).toBeGreaterThanOrEqual(frame.left - 0.5);
            expect(node.bottom, `${node.id} ends above the window's bottom`).toBeLessThanOrEqual(panel.bottom);
        }
        expect(errors, "errors on the page").toEqual([]);
    });
}
