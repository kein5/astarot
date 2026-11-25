// Temporary (Issue #1073, not to be merged): what changes the page inside a ResizeObserver callback
// while the main window opens narrow, as in translatorSelector.spec.ts's narrow overlay rail test.
// A run that hits "ResizeObserver loop completed with undelivered notifications" prints the record.
import { test as base, expect } from "./fixtures";

const PROBE = `(() => {
  const log = window.__roLog = [];
  const mo = new MutationObserver(() => {});
  const describe = n => {
    if (!n || n.nodeType !== 1) return n && n.nodeName;
    const a = [...n.attributes].filter(x => x.name.startsWith('data-') || x.name === 'id' || x.name === 'role').map(x => x.name + (x.value && x.value.length < 20 ? '=' + x.value : '')).join(',');
    return n.tagName.toLowerCase() + (a ? '[' + a + ']' : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0].slice(0, 24) : '');
  };
  const start = () => mo.observe(document, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true });
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  const Native = window.ResizeObserver;
  let next = 0;
  window.ResizeObserver = class extends Native {
    constructor(callback) {
      const id = next++;
      const where = (new Error().stack || '').split('\\n').slice(1, 4).join(' | ').slice(0, 240);
      super((entries, observer) => {
        mo.takeRecords();
        const t = performance.now();
        callback(entries, observer);
        const changed = mo.takeRecords();
        log.push({ t: Math.round(t), id, where, targets: entries.map(e => describe(e.target) + ' ' + Math.round(e.contentRect.width) + 'x' + Math.round(e.contentRect.height)).slice(0, 4), n: entries.length,
          mutations: changed.length, sample: changed.slice(0, 12).map(r => r.type + ':' + (r.attributeName || '') + ':' + describe(r.target)
            + (r.type === 'attributes' ? ' [' + String(r.oldValue || '').slice(0, 80) + '] -> [' + String(r.target.getAttribute(r.attributeName) || '').slice(0, 80) + ']' : '')
            + (r.type === 'childList' ? ' +' + r.addedNodes.length + ' -' + r.removedNodes.length : '')) });
      });
    }
  };
  window.addEventListener('error', e => log.push({ t: Math.round(performance.now()), error: e.message }));
  const watch = () => {
    if (!document.documentElement) return setTimeout(watch, 0);
    new MutationObserver(() => log.push({ t: Math.round(performance.now()), narrow: document.documentElement.hasAttribute('data-narrow'), lang: document.documentElement.lang })).observe(document.documentElement, { attributes: true, attributeFilter: ['data-narrow', 'lang'] });
  };
  watch();
})();`;

const test = base.extend({
    page: async ({ page }, use) => {
        await page.addInitScript(PROBE);
        await use(page);
    },
});

test.use({ settings: { UI_LANGUAGE: "ja" }, viewport: { width: 700, height: 600 } });

test("opening the translator selector in a narrow overlay rail (probe)", async ({ app }) => {
    const page = app.page;
    await expect(page.locator("[data-sidebar-toggle]")).toHaveAttribute("aria-expanded", "false");
    await page.locator("[data-sidebar-toggle]").click();
    const trigger = page.locator("[data-main-page]").getByRole("button", { name: /^翻訳エンジン/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const popover = page.locator("[data-translator-selector]");
    await expect(popover).toBeVisible();
    await popover.click({ position: { x: 12, y: 12 } });
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    const log = await page.evaluate(() => (window as unknown as { __roLog?: unknown[] }).__roLog);
    if (JSON.stringify(log ?? []).includes("\"error\"")) {
        console.log(`=== ResizeObserver record #${test.info().repeatEachIndex}\n${JSON.stringify(log, null, 1)}`);
    }
});
