import { isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";

// Files dragged in from the desktop. A browser drop gives no path, so the paths come from the
// window's Tauri drag-and-drop events (the default handler stays on; positions are physical
// pixels). Every drop zone on the page shares one listener. The zone under the pointer takes the
// drop and the others ignore it; a drop elsewhere does nothing. Nothing reads the files: a zone
// only receives their paths.

export interface DropZone {
    // The zone's box on the page; none while it is not drawn.
    element: Element | null | undefined;
    drop: (paths: string[]) => void;
    disabled?: () => boolean;
}

export interface DragState {
    active: boolean;
    paths: string[];
    over: DropZone | null;
}

export interface Point {
    x: number;
    y: number;
}

const idle: Readonly<DragState> = Object.freeze({ active: false, paths: [], over: null });

// ".PTH" and ".pth" are the same kind of file.
export const extensionOf = (path: string): string => (/\.[^.\\/]+$/.exec(String(path))?.[0] ?? "").toLowerCase();

// The dropped paths a zone takes (in the order given) and the ones it does not.
export const sortFiles = (paths: readonly string[] | null | undefined, accept: readonly string[]): { accepted: string[]; rejected: string[] } => {
    const kinds = accept.map(kind => kind.toLowerCase());
    const accepted: string[] = [], rejected: string[] = [];
    for (const path of paths ?? []) (kinds.includes(extensionOf(path)) ? accepted : rejected).push(path);
    return { accepted, rejected };
};

export const nameOf = (path: string): string | undefined => String(path).split(/[\\/]/).pop();

// The zone whose box holds a point in page (CSS) pixels; a folded or hidden zone has no box.
export const zoneAt = (point: Point, zones: readonly DropZone[]): DropZone | null => zones.find(zone => {
    if (zone.disabled?.() || !zone.element) return false;
    const box = zone.element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 &&
        point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}) ?? null;

const zones = new Set<DropZone>();
const watchers = new Set<(state: Readonly<DragState>) => void>();
let drag: Readonly<DragState> = idle;
let listening: Promise<UnlistenFn | null> | null = null;

const publish = (next: Readonly<DragState>): void => {
    drag = next;
    watchers.forEach(watch => { watch(drag); });
};

const hit = (position: Point | undefined): DropZone | null => position ?
    zoneAt({ x: position.x / (window.devicePixelRatio || 1), y: position.y / (window.devicePixelRatio || 1) }, [...zones]) : null;

// One Tauri drag-and-drop event (exported for tests).
export function handleDragDrop(payload: DragDropEvent | null | undefined): void {
    if (payload?.type === "enter") publish({ active: true, paths: payload.paths ?? [], over: hit(payload.position) });
    else if (payload?.type === "over") {
        const over = hit(payload.position);
        if (!drag.active || over !== drag.over) publish({ ...drag, active: true, over });
    } else if (payload?.type === "drop") {
        const zone = hit(payload.position);
        publish(idle);
        zone?.drop(payload.paths ?? []);
    } else publish(idle);
}

function listen(): void {
    if (listening || !isTauri()) return;
    listening = getCurrentWebview().onDragDropEvent(event => handleDragDrop(event.payload)).catch(() => {
        listening = null;
        return null;
    });
}

function stopListening(): void {
    if (zones.size || !listening) return;
    const pending = listening;
    listening = null;
    pending.then(unlisten => unlisten?.());
}

// Returns the function that removes the zone.
export function addDropZone(zone: DropZone): () => void {
    zones.add(zone);
    listen();
    return () => {
        zones.delete(zone);
        if (drag.over === zone) publish({ ...drag, over: null });
        stopListening();
    };
}

// Calls watch with { active, paths, over } now and on every change; returns the stop function.
export function watchDrag(watch: (state: Readonly<DragState>) => void): () => void {
    watchers.add(watch);
    watch(drag);
    return () => watchers.delete(watch);
}
