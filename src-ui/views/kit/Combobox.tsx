import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import clsx from "clsx";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover.tsx";
import { chevron, field } from "./Field.css.ts";
import * as styles from "./Combobox.css.ts";
import { activeOption, optionsOf, searchGroups, startingOption, stepOption } from "./comboboxModel.ts";
import type { ComboboxGroup, ComboboxOption } from "./comboboxModel.ts";

export type { ComboboxGroup, ComboboxOption } from "./comboboxModel.ts";

export type ComboboxProps = {
    // The value chosen, or none.
    value: string | undefined;
    onValueChange: (value: string) => void;
    // The choices: under headings of their own (groups) or as one list (options).
    groups?: readonly ComboboxGroup[];
    options?: readonly ComboboxOption[];
    // The button's words while no choice is the value.
    placeholder?: ReactNode;
    // Names the search field, and is its words while it is empty unless searchPlaceholder is given.
    searchLabel: string;
    searchPlaceholder?: string;
    // Said in the list's place when the search keeps no choice.
    emptyText: ReactNode;
    // While the value waits on the app: the button stays in its place and in the Tab order, drawn
    // as one that cannot be used, and does not open.
    busy?: boolean;
    disabled?: boolean;
    // Open when first drawn (the component catalog).
    defaultOpen?: boolean;
    // Which edge of the button the panel lines up with: "end" for a button at the end of its row,
    // so a panel wider than the button grows away from the window's edge.
    align?: "start" | "end";
    id?: string;
    className?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
};

// Scrolls the list just enough to show the row: the first row of a group with its heading. The
// list, not the page, scrolls: the panel lies outside the page's flow.
const keepInSight = (list: HTMLElement, row: HTMLElement | null) => {
    if (!row) return;
    const group = row.parentElement;
    const first = group !== list && group?.querySelector("[data-slot='command-item']") === row;
    const top = first && group ? group.offsetTop : row.offsetTop;
    const bottom = row.offsetTop + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
};

// A choice of one among many, found by typing (#1369): shadcn/ui's Combobox, a Popover around a
// Command, as the kit's own parts with no new dependency (D-36 kept the app's search fields
// hand-built). The button is the field: it shows the choice in the select field's look, and is a
// combobox named by its row's label, so the choice is read as its value. Pressing it, or Down or
// Up on it, opens the kit's Popover (D-25) with a search field over the choices and their group
// headings. The focus goes to the search field, and the keys work there as in the settings search:
// Down and Up move through the choices that can be chosen, from the last back to the first, and
// Enter chooses; the list opens on the value, and a search starts on the first choice it keeps.
// A choice that cannot be chosen is drawn dim and the keys pass it. As in the kit's other popovers,
// Escape, a press outside and choosing close it and give the focus back to the button, and Tab
// stays in the panel. Keys that compose text (an IME) are left to it, Escape and Enter included.
export function Combobox({
    value, onValueChange, groups, options, placeholder, searchLabel, searchPlaceholder, emptyText,
    busy = false, disabled = false, defaultOpen = false, align = "start", id, className,
    "aria-label": label, "aria-labelledby": labelledBy, "aria-describedby": describedBy,
}: ComboboxProps) {
    const all: readonly ComboboxGroup[] = groups ?? [{ id: "", options: options ?? [] }];
    const everyOption = optionsOf(all);
    const [open, setOpen] = useState(defaultOpen);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState<string | undefined>(() => startingOption(everyOption, value));
    const search = useRef<HTMLInputElement>(null);
    // The list once it is on the page: Radix draws a portal's content a moment after it opens.
    const [list, setList] = useState<HTMLDivElement | null>(null);
    const base = useId();
    const listId = `${base}-list`;
    // An option's id follows its place in the whole list, so a search does not rename it.
    const optionId = (option: ComboboxOption) => `${base}-option-${everyOption.indexOf(option)}`;

    const shown = searchGroups(all, query);
    const shownOptions = optionsOf(shown);
    const current = activeOption(shownOptions, active);
    const currentOption = shownOptions.find(option => option.value === current);
    const chosen = everyOption.find(option => option.value === value);

    // The active choice is in sight when the list opens and as the keys move it.
    useLayoutEffect(() => {
        if (list && current !== undefined) keepInSight(list, list.querySelector<HTMLElement>("[data-slot='command-item'][aria-selected='true']"));
    }, [list, current]);

    // Each opening starts from the value, with no search.
    const openChange = (next: boolean) => {
        if (next && (busy || disabled)) return;
        setOpen(next);
        setQuery("");
        if (next) setActive(startingOption(everyOption, value));
    };

    // While the value waits, a choice waits too and the list stays open.
    const choose = (option: ComboboxOption) => {
        if (option.disabled === true || busy) return;
        if (option.value !== value) onValueChange(option.value);
        openChange(false);
    };

    const typed = (event: ChangeEvent<HTMLInputElement>) => {
        const next = event.target.value;
        setQuery(next);
        const kept = optionsOf(searchGroups(all, next));
        setActive(next.trim() ? startingOption(kept, undefined) : startingOption(kept, value));
    };

    const keys = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(stepOption(shownOptions, current, event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (currentOption) choose(currentOption);
        }
    };

    const triggerKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        if (!open) openChange(true);
    };

    // A waiting button keeps the focus and ignores the press.
    const press = (event: MouseEvent<HTMLButtonElement>) => {
        if (busy) event.preventDefault();
    };

    // The keys stay in the search field, which points to the active choice (aria-activedescendant,
    // the WAI-ARIA combobox pattern): a choice takes neither the focus nor keys of its own.
    const item = (option: ComboboxOption) => (
        // biome-ignore lint/a11y/useFocusableInteractive: the search field points to it (aria-activedescendant); it is not focused itself.
        // biome-ignore lint/a11y/useKeyWithClickEvents: Enter in the search field chooses the active choice.
        <div key={option.value} id={optionId(option)} role="option" data-slot="command-item" data-value={option.value} className={styles.item}
            aria-selected={option.value === current}
            aria-disabled={option.disabled === true || undefined}
            data-checked={option.value === value || undefined}
            // The focus stays in the search field while the pointer chooses.
            onMouseDown={event => { event.preventDefault(); }}
            onPointerMove={() => { if (option.disabled !== true && option.value !== current) setActive(option.value); }}
            onClick={() => { choose(option); }}>
            <span className={styles.itemLabel}>{option.label}</span>
            <svg className={styles.check} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </div>
    );

    return (
        <Popover open={open} onOpenChange={openChange}>
            <PopoverTrigger asChild>
                {/* Radix gives the button aria-expanded and aria-controls too; said here, the same. */}
                <button type="button" id={id} data-slot="combobox-trigger" role="combobox" aria-expanded={open}
                    className={clsx(field({ kind: "select" }), styles.trigger, className)}
                    disabled={disabled}
                    aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}
                    aria-busy={busy || undefined} aria-disabled={busy || undefined}
                    onKeyDown={triggerKeys} onClick={press}>
                    {/* As wide as the longest choice, as a system's select is, so choosing moves nothing
                        around it (#912): every choice's words lie hidden in the same place. */}
                    <span className={styles.value}>
                        {everyOption.map(option => <span key={option.value} className={styles.sizer} aria-hidden="true">{option.label}</span>)}
                        {typeof placeholder === "string" && <span className={styles.sizer} aria-hidden="true">{placeholder}</span>}
                        <span data-slot="combobox-value" className={clsx(styles.shown, { [styles.placeholder]: !chosen })}>{chosen ? chosen.label : placeholder}</span>
                    </span>
                    <svg className={chevron} data-slot="combobox-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                        <path d="M2 4.25 6 8l4-3.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </PopoverTrigger>
            <PopoverContent data-slot="combobox-content" inset="tight" align={align} collisionPadding={8} className={styles.content}
                aria-label={label} aria-labelledby={labelledBy}
                onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus({ preventScroll: true }); }}
                onEscapeKeyDown={event => { if (event.isComposing) event.preventDefault(); }}>
                <div data-slot="command" className={styles.command}>
                    <div data-slot="command-input-wrapper" className={styles.searchRow}>
                        <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                            <path d="m10.5 10.5 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                        <input ref={search} type="text" data-slot="command-input" className={styles.search}
                            role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
                            aria-activedescendant={currentOption ? optionId(currentOption) : undefined}
                            aria-label={searchLabel} placeholder={searchPlaceholder ?? searchLabel}
                            autoComplete="off" spellCheck={false}
                            value={query} onChange={typed} onKeyDown={keys} />
                    </div>
                    <div ref={setList} id={listId} role="listbox" data-slot="command-list" className={styles.list}
                        aria-label={label} aria-labelledby={labelledBy} aria-busy={busy || undefined}>
                        {shown.flatMap(group => group.label === undefined ? group.options.map(item) : [
                            // biome-ignore lint/a11y/useSemanticElements: a listbox holds options and groups of them; a <fieldset> is not one.
                            <div key={group.id} role="group" data-slot="command-group" className={styles.group}
                                aria-labelledby={`${base}-group-${group.id}`}>
                                <div id={`${base}-group-${group.id}`} data-slot="command-group-heading" className={styles.heading}>{group.label}</div>
                                {group.options.map(item)}
                            </div>,
                        ])}
                    </div>
                    {/* Kept on the page while the list is open, so a screen reader hears when the search keeps nothing. */}
                    <div role="status" data-slot="command-empty" className={styles.empty}>
                        {shownOptions.length === 0 ? emptyText : null}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
