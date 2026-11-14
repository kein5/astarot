import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// Files dragged in from the desktop. A browser drop gives no path, so the paths come from the
// window's Tauri drag-and-drop events (the default handler stays on; positions are physical
// pixels). Every drop zone on the page shares one listener. The zone under the pointer takes the
// drop and the others ignore it; a drop elsewhere does nothing. Nothing reads the files: a zone
// only receives their paths.

const idle = Object.freeze({ active: false, paths: [], over: null });

// ".PTH" and ".pth" are the same kind of file.
export const extensionOf = path => (/\.[^.\\/]+$/.exec(String(path))?.[0] ?? "").toLowerCase();

// The dropped paths a zone takes (in the order given) and the ones it does not.
export const sortFiles = (paths, accept) => {
    const kinds = accept.map(kind => kind.toLowerCase());
    const accepted = [], rejected = [];
    for (const path of paths ?? []) (kinds.includes(extensionOf(path)) ? accepted : rejected).push(path);
    return { accepted, rejected };
};

export const nameOf = path => String(path).split(/[\\/]/).pop();

// The zone whose box holds a point in page (CSS) pixels; a folded or hidden zone has no box.
export const zoneAt = (point, zones) => zones.find(zone => {
    if (zone.disabled?.() || !zone.element) return false;
    const box = zone.element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 &&
        point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}) ?? null;

const zones = new Set();
const watchers = new Set();
let drag = idle;
let listening = null;

const publish = next => {
    drag = next;
    watchers.forEach(watch => watch(drag));
};

const hit = position => position ?
    zoneAt({ x: position.x / (window.devicePixelRatio || 1), y: position.y / (window.devicePixelRatio || 1) }, [...zones]) : null;

// One Tauri drag-and-drop event (exported for tests).
export function handleDragDrop(payload) {
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

function listen() {
    if (listening || !isTauri()) return;
    listening = getCurrentWebview().onDragDropEvent(event => handleDragDrop(event.payload)).catch(() => {
        listening = null;
        return null;
    });
}

function stopListening() {
    if (zones.size || !listening) return;
    const pending = listening;
    listening = null;
    pending.then(unlisten => unlisten?.());
}

// zone: { element, drop(paths), disabled() }. Returns the function that removes it.
export function addDropZone(zone) {
    zones.add(zone);
    listen();
    return () => {
        zones.delete(zone);
        if (drag.over === zone) publish({ ...drag, over: null });
        stopListening();
    };
}

// Calls watch with { active, paths, over } now and on every change; returns the stop function.
export function watchDrag(watch) {
    watchers.add(watch);
    watch(drag);
    return () => watchers.delete(watch);
}
