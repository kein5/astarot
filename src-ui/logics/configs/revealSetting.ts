// Brings one setting into view on the settings page: the settings search uses it for a chosen
// result, and a row that leads to another page uses it for the setting it names (#554).
//
// Native <details> folds keep their children mounted, so the setting is found also inside a
// closed 「詳細設定」 or 「モデルとサーバー」; the folds around it are opened. Its first field
// takes focus, it scrolls to the middle and is marked for a moment. The page may still be
// drawing after a page change, so it is looked for again for about a second.

export type SettingTarget = {
    setting_id: string;
    // Found by its row's label when it has no id of its own.
    label?: string;
    // A setting shown only under another one: the search leads there while it is hidden.
    prereq?: { parent_id: string } | null;
};

const CONTROLS = "input:not([type='hidden']), select, textarea, button, a[href], summary, [tabindex]";
const FIELDS = "input, select, textarea, [role='switch'], [role='combobox'], [role='slider']";
const HIGHLIGHT = "search_target_highlight";

const findTarget = (target: SettingTarget): HTMLElement | null => {
    const byId = document.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(target.setting_id)}"]`);
    const byLabel = target.label ? document.querySelector<HTMLElement>(`[data-setting-label="${CSS.escape(target.label)}"]`) : null;
    const parent = target.prereq ? document.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(target.prereq.parent_id)}"]`) : null;
    return byId ?? byLabel ?? parent;
};

const focusIn = (target: HTMLElement): void => {
    const available = Array.from(target.querySelectorAll<HTMLElement>(CONTROLS)).filter(node =>
        !node.matches(":disabled, [aria-disabled='true'], [tabindex='-1']") && !node.closest("[hidden], [inert]") && node.getClientRects().length > 0);
    // Help disclosures and documentation links may precede the actual field.
    const control = available.find(node => node.matches(FIELDS)) ?? available[0];
    if (control) {
        control.focus({ preventScroll: true });
        return;
    }
    const previousTabIndex = target.getAttribute("tabindex");
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => {
        if (previousTabIndex === null) target.removeAttribute("tabindex");
        else target.setAttribute("tabindex", previousTabIndex);
    }, { once: true });
    target.focus({ preventScroll: true });
};

const reveal = (target: HTMLElement): void => {
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === "DETAILS") (ancestor as HTMLDetailsElement).open = true;
    }
    focusIn(target);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
    target.classList.remove(HIGHLIGHT);
    void target.offsetWidth; // restart the mark's animation
    target.classList.add(HIGHLIGHT);
    setTimeout(() => { target.classList.remove(HIGHLIGHT); }, 2500);
};

export const revealSetting = (target: SettingTarget): void => {
    let attempts = 0;
    const look = () => {
        const found = findTarget(target);
        if (found) reveal(found);
        else if (attempts < 25) {
            attempts++;
            setTimeout(look, 40);
        }
    };
    setTimeout(look, 60);
};
