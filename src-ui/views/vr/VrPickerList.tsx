import { cloneElement, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactElement, RefObject } from "react";
import { Virtualizer } from "virtua";
import type { VirtualizerHandle } from "virtua";
import styles from "./VrPickerList.module.scss";

// Below 50 choices the native list is small enough to keep tab order for free.
// A filtered long list can opt in even when only a few matches remain.
export const VR_PICKER_WINDOW_THRESHOLD = 50;
const neverDisabled = () => false;

// What the list lets its owner do: bring a choice into view, and focus it.
export interface VrPickerNavigation {
    scrollToIndex: (index: number, options?: { focus?: boolean }) => void;
}

export interface VrPickerListProps<T> {
    options: readonly T[];
    // The button for one choice.
    children: (option: T, index: number) => ReactElement;
    scrollRef: RefObject<HTMLElement | null>;
    navigationRef?: MutableRefObject<VrPickerNavigation | null>;
    columns?: number;
    initialIndex?: number;
    stickyHeader?: boolean;
    isDisabled?: (option: T) => boolean;
    virtualized?: boolean;
}

const isElement = (target: EventTarget | null): target is Element => target !== null && "closest" in target;
// The index a choice's button carries, if the event came from one.
const pickerIndex = (target: EventTarget | null): string | undefined =>
    isElement(target) ? target.closest<HTMLElement>("[data-vr-picker-index]")?.dataset.vrPickerIndex : undefined;

// Each child is the existing option button. Two-column pickers virtualize whole
// grid rows so wrapping, equal cell heights and the 8px gaps remain unchanged.
export function VrPickerList<T>({ options, children, scrollRef, navigationRef, columns = 1,
    initialIndex = -1, stickyHeader = false, isDisabled = neverDisabled, virtualized = options.length >= VR_PICKER_WINDOW_THRESHOLD }: VrPickerListProps<T>) {
    const container = useRef<HTMLDivElement>(null);
    const virtualizer = useRef<VirtualizerHandle>(null);
    const buttons = useRef(new Map<number, HTMLElement>());
    const [startMargin, setStartMargin] = useState<number | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [pendingFocus, setPendingFocus] = useState<number | null>(null);
    const focusRequest = useRef<number | null>(null);
    const focusFrame = useRef<number | null>(null);
    focusRequest.current = pendingFocus;
    const initialized = useRef(false);
    const rows = useMemo(() => Array.from({ length: Math.ceil(options.length / columns) },
        (_, index) => options.slice(index * columns, (index + 1) * columns)), [options, columns]);

    useLayoutEffect(() => {
        const list = scrollRef.current, element = container.current;
        if (!list || !element) return;
        const measure = () => {
            const bounds = list.getBoundingClientRect();
            if (!bounds.height) return;
            // Rects include the atlas transform; scroll offsets do not.
            setStartMargin((element.getBoundingClientRect().top - bounds.top) * list.clientHeight / bounds.height + list.scrollTop);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        // Headers/helpers can wrap after a locale or font change. Observe them,
        // never poll, and do not observe the virtualizer's changing total height.
        for (let previous = element.previousElementSibling; previous; previous = previous.previousElementSibling) observer.observe(previous);
        return () => observer.disconnect();
    }, [scrollRef]);

    const scrollToIndex = (index: number, { focus = false }: { focus?: boolean } = {}) => {
        if (index < 0 || index >= options.length) return;
        const offset = stickyHeader ? -(startMargin ?? 0) : 0;
        if (virtualized) {
            virtualizer.current?.scrollToIndex(Math.floor(index / columns), { align: "start", offset, smooth: false });
        } else {
            const list = scrollRef.current, button = buttons.current.get(index);
            const bounds = list?.getBoundingClientRect();
            if (list && button && bounds?.height) list.scrollTop += (button.getBoundingClientRect().top - bounds.top) * list.clientHeight / bounds.height + offset;
        }
        if (focus) setPendingFocus(index);
    };
    useLayoutEffect(() => {
        if (navigationRef) navigationRef.current = { scrollToIndex };
        return () => { if (navigationRef) navigationRef.current = null; };
    });
    useLayoutEffect(() => {
        if (startMargin === null || initialized.current) return;
        let cancelled = false;
        // With scrollRef, virtua attaches in a microtask. StrictMode cleanup
        // drops scrolls waiting on the first attachment, so position after that
        // setup and only mark this open initialized when the request is sent.
        queueMicrotask(() => {
            if (cancelled || initialized.current) return;
            initialized.current = true;
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
            scrollToIndex(initialIndex);
        });
        return () => { cancelled = true; };
    }, [startMargin, initialIndex]);
    const focusWhenMeasured = useCallback(() => {
        if (focusRequest.current === null || focusFrame.current !== null) return;
        focusFrame.current = requestAnimationFrame(() => {
            focusFrame.current = null;
            if (focusRequest.current === null) return;
            const button = buttons.current.get(focusRequest.current);
            if (!button) return;
            // virtua hides unmeasured rows. A resize notification retries after
            // that row becomes visible; no timer or frame loop runs while idle.
            if (getComputedStyle(button).visibility === "hidden") return;
            button.focus({ preventScroll: true });
            setPendingFocus(null);
        });
    }, []);
    useLayoutEffect(() => {
        focusWhenMeasured();
        return () => {
            if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
            focusFrame.current = null;
        };
    }, [pendingFocus, focusWhenMeasured]);

    // Keep the focused row alive on stick/wheel scroll, and the two endpoints
    // reachable when tabbing into the list. Tab within the list uses indices so
    // it cannot skip unmounted rows. At either end native Tab leaves the picker.
    const tabEdges = useMemo(() => {
        let last = options.length - 1;
        while (last >= 0 && isDisabled(options[last])) last--;
        return [options.findIndex(option => !isDisabled(option)), last];
    }, [options, isDisabled]);
    const keepMounted = [...new Set([...tabEdges.map(index => Math.floor(index / columns)),
        focusedIndex === null ? -1 : Math.floor(focusedIndex / columns),
        pendingFocus === null ? -1 : Math.floor(pendingFocus / columns)].filter(index => index >= 0))];
    const renderRow = (row: readonly T[], rowIndex: number) => <div key={rowIndex} className={styles.row}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, paddingBottom: rowIndex === rows.length - 1 ? 0 : undefined }}>
        {row.map((option, column) => {
            const index = rowIndex * columns + column;
            const props = { "data-vr-picker-index": index,
                ref: (element: HTMLElement | null) => { if (element) buttons.current.set(index, element); else buttons.current.delete(index); } };
            return cloneElement(children(option, index), props);
        })}
    </div>;

    return <div ref={container} className={styles.list}
        onFocusCapture={event => {
            const index = pickerIndex(event.target);
            if (index !== undefined) setFocusedIndex(Number(index));
        }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedIndex(null); }}
        onKeyDown={event => {
            if (!virtualized || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
            const index = pickerIndex(event.target);
            if (index === undefined) return;
            const direction = event.shiftKey ? -1 : 1;
            for (let next = Number(index) + direction; next >= 0 && next < options.length; next += direction) {
                if (isDisabled(options[next])) continue;
                event.preventDefault();
                scrollToIndex(next, { focus: true });
                return;
            }
        }}>
        {virtualized ? startMargin !== null && <Virtualizer ref={virtualizer} data={rows} scrollRef={scrollRef}
            startMargin={startMargin} itemSize={80} keepMounted={keepMounted} onResize={focusWhenMeasured}>{renderRow}</Virtualizer>
            : rows.map(renderRow)}
    </div>;
}
