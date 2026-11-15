// Layout checks for the main screen. Returns a list of findings for the current viewport.
// Only geometry, component names and the element's own label are reported; message text is not.
() => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const root = document.querySelector("#root");
    const main = document.querySelector("[class*='main_page']") || root;
    const findings = [];
    const SKIP_TEXT_IN = "[class*='log_box'], [class*='message_container'] [class*='message'], textarea";

    const componentOf = el => {
        const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
        let fiber = key ? el[key] : null;
        const names = [];
        while (fiber && names.length < 3) {
            if (typeof fiber.type === "function" && fiber.type.name && !/^(Fragment|Suspense)$/.test(fiber.type.name)) names.push(fiber.type.name);
            fiber = fiber.return;
        }
        return names.join(" < ");
    };
    const cls = el => [...el.classList].map(c => c.replace(/^_?(.*?)_[a-z0-9]{5,}$/i, "$1")).join(".");
    const label = el => {
        const own = el.getAttribute("aria-label") || el.getAttribute("title") || "";
        if (own) return own.slice(0, 40);
        if (el.closest(SKIP_TEXT_IN)) return "(message)";
        const t = (el.innerText || "").trim().replace(/\s+/g, " ");
        return t.slice(0, 40);
    };
    const visible = el => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) return false; // visually hidden helpers (1px)
        for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).clipPath.startsWith("inset(50%")) return false;
        if (el.closest("[inert], [aria-hidden='true']")) return false;
        return true;
    };
    // The visible area of an element: the viewport, cut by every ancestor that clips.
    const clipOf = el => {
        let c = { left: 0, top: 0, right: vw, bottom: vh }, by = null, scrollable = false;
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            const s = getComputedStyle(a);
            const ox = s.overflowX, oy = s.overflowY;
            if (ox === "visible" && oy === "visible") continue;
            const r = a.getBoundingClientRect();
            const box = { left: r.left + a.clientLeft, top: r.top + a.clientTop, right: r.left + a.clientLeft + a.clientWidth, bottom: r.top + a.clientTop + a.clientHeight };
            const next = { left: Math.max(c.left, box.left), top: Math.max(c.top, box.top), right: Math.min(c.right, box.right), bottom: Math.min(c.bottom, box.bottom) };
            if (next.left > c.left || next.top > c.top || next.right < c.right || next.bottom < c.bottom) {
                // remember the innermost clipping ancestor
                if (!by) { by = a; scrollable = /(auto|scroll)/.test(ox + oy); }
            }
            c = next;
        }
        return { c, by, scrollable };
    };
    const rectOut = (r, c) => ({
        left: Math.max(0, c.left - r.left), right: Math.max(0, r.right - c.right),
        top: Math.max(0, c.top - r.top), bottom: Math.max(0, r.bottom - c.bottom),
    });
    const round = n => Math.round(n);

    // 1) Interactive and text-bearing elements that leave their visible area.
    const targets = main.querySelectorAll("button, a, input, select, textarea, [role='button'], [role='tab'], [role='switch'], h1, h2, h3, p, label, span, svg");
    for (const el of targets) {
        if (!visible(el)) continue;
        if (el.tagName === "svg" && el.closest("button")) continue;
        const r = el.getBoundingClientRect();
        const { c, by, scrollable } = clipOf(el);
        const out = rectOut(r, c);
        const max = Math.max(out.left, out.right, out.top, out.bottom);
        if (max <= 1) continue;
        const fully = r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom;
        // An element scrolled out of a scroll container is reachable; report it only when the container itself is cut.
        if (scrollable && fully) continue;
        const clippedBy = by ? `${componentOf(by).split(" < ")[0]} .${cls(by)}` : "viewport";
        findings.push({
            kind: scrollable ? "partly-outside-scroll-area" : (by ? "clipped" : "outside-viewport"),
            component: componentOf(el), el: `${el.tagName.toLowerCase()}.${cls(el)}`, label: label(el),
            rect: [round(r.left), round(r.top), round(r.width), round(r.height)],
            out: Object.fromEntries(Object.entries(out).filter(([, v]) => v > 1).map(([k, v]) => [k, round(v)])),
            fully, clippedBy,
        });
    }

    // 2) Scroll containers that currently scroll (scrollbars shown) and always-on scrollbars.
    for (const el of main.querySelectorAll("*")) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el);
        const y = /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
        const x = /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
        const always = s.overflowY === "scroll" || s.overflowX === "scroll";
        const hiddenOverflow = s.overflowX === "hidden" && el.scrollWidth > el.clientWidth + 1 || s.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 1;
        if (!(x || y || always || hiddenOverflow)) continue;
        if (el.closest("[class*='log_box']") && !hiddenOverflow) continue; // the message log is meant to scroll
        findings.push({
            kind: hiddenOverflow && !(x || y) ? "hidden-overflow" : "scroll",
            component: componentOf(el), el: `${el.tagName.toLowerCase()}.${cls(el)}`,
            x, y, always, overflow: `${s.overflowX}/${s.overflowY}`,
            size: [el.clientWidth, el.clientHeight], content: [el.scrollWidth, el.scrollHeight],
        });
    }

    // 3) Text that is cut inside its own box (ellipsis, nowrap, line clamp) — not message text.
    for (const el of main.querySelectorAll("*")) {
        if (!visible(el) || el.closest(SKIP_TEXT_IN)) continue;
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) continue;
        const s = getComputedStyle(el);
        const cutX = el.scrollWidth > el.clientWidth + 1 && s.overflowX !== "visible";
        const cutY = el.scrollHeight > el.clientHeight + 1 && s.overflowY !== "visible";
        if (!(cutX || cutY)) continue;
        findings.push({
            kind: "text-cut", component: componentOf(el), el: `${el.tagName.toLowerCase()}.${cls(el)}`, label: label(el),
            textOverflow: s.textOverflow, whiteSpace: s.whiteSpace, size: [el.clientWidth, el.clientHeight], content: [el.scrollWidth, el.scrollHeight],
        });
    }

    // 4) Controls whose own content spills out of their box (overflow: visible), and controls that overlap.
    const controls = [...main.querySelectorAll("button, [role='button'], input, textarea, select, a")].filter(visible);
    for (const el of controls) {
        const s = getComputedStyle(el);
        if (s.overflowX === "visible" && el.scrollWidth > el.clientWidth + 1 || s.overflowY === "visible" && el.scrollHeight > el.clientHeight + 1) {
            findings.push({ kind: "content-spills", component: componentOf(el), el: `${el.tagName.toLowerCase()}.${cls(el)}`, label: label(el),
                size: [el.clientWidth, el.clientHeight], content: [el.scrollWidth, el.scrollHeight] });
        }
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i], b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w <= 2 || h <= 2) continue;
        // Overlap that is hidden by a clip (both inside different scroll areas) is not visible.
        const ca = clipOf(a).c, cb = clipOf(b).c;
        const vis = (r, c) => Math.min(r.right, c.right) - Math.max(r.left, c.left) > 2 && Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top) > 2;
        if (!vis(ra, ca) || !vis(rb, cb)) continue;
        // A control that an overlay (popover, selector page) covers completely is not a collision.
        const hittable = (el, r) => [[.5, .5], [.15, .5], [.85, .5], [.5, .2], [.5, .8]].some(([fx, fy]) => {
            const x = r.left + r.width * fx, y = r.top + r.height * fy;
            if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
            const hit = document.elementFromPoint(x, y);
            return hit && (el === hit || el.contains(hit));
        });
        if (!hittable(a, ra) || !hittable(b, rb)) continue;
        findings.push({ kind: "overlap", component: `${componentOf(a).split(" < ")[0]} × ${componentOf(b).split(" < ")[0]}`,
            el: `${a.tagName.toLowerCase()}.${cls(a)} × ${b.tagName.toLowerCase()}.${cls(b)}`, label: `${label(a)} × ${label(b)}`, area: [round(w), round(h)] });
    }

    // 5) The page itself.
    const doc = { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, vw, vh };
    // 6) Sizes worth comparing between window sizes: the message log, the message box and the sidebar.
    const box = selector => { const e = main.querySelector(selector); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const sidebar = main.querySelector("[class*='scroll_container']");
    const metrics = {
        log: box("[class*='log_box_resize_wrapper']"), input: box("[class*='message_box_resize_wrapper']"),
        sidebar: sidebar ? { visible: sidebar.clientHeight, content: sidebar.scrollHeight } : null,
    };
    return { doc, metrics, findings };
}
