import { memo, useRef, useState, useLayoutEffect, useEffect, useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import { useAtomValue } from "jotai";
import { Virtualizer } from "virtua";
import type { CacheSnapshot, VirtualizerHandle } from "virtua";
import styles from "./LogBox.module.scss";
import { MessageContainer } from "./message_container/MessageContainer";
import { EmptyState } from "./EmptyState";
import { useMessageActions, nextLogView, rowsBetween, speakerContinuations, useSpeakerNaming } from "@logics_common";
import { useSettingValue } from "@logics_configs";
import { useI18n } from "@useI18n";
import { store, Atom_MessageLogs } from "@store";
import type { GoneRow, LogView, RowEnds } from "../../../../../../logics/common/messageLogView.ts";
import type { TargetHolder } from "../../../../../../logics/common/targetHolder.ts";
import type { MessageLogRow } from "../../../../../../logics/transcription/realtimeCaptionState";

// Within this many pixels of the end, the log keeps following new rows.
const FOLLOW_THRESHOLD = 5;
// A scroll this soon after wheel, touch or key input counts as the user's.
const USER_SCROLL_MS = 300;
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

// The rows handed to virtua, and the log's rows they were made from.
type LogViewState = LogView<MessageLogRow> & { source: MessageLogRow[] };

// What the VR log window keeps of the log while it is closed, to open it again as it was.
export interface SavedLogView {
    view: LogViewState;
    startMargin: number;
    follow: boolean;
    scrollTop: number;
    cache: CacheSnapshot | undefined;
}

type LogBoxProps = {
    savedView?: MutableRefObject<SavedLogView | null>;
};

// An empty row where a row was removed while the user reads above it (nextLogView).
const isGone = (row: MessageLogRow | GoneRow<string>): row is GoneRow<string> => !!row.gone;

// The keys are read from the window's keydown events only.
const isKeyboardEvent = (event: Event): event is KeyboardEvent => "key" in event;

// Only the rows in view (plus a margin) are in the DOM, so a full log no longer
// slows down typing, layout or the style recalculation when settings open.
export const LogBox = memo(function LogBox({ savedView }: LogBoxProps = {}) {
    const { t } = useI18n();
    // Only the VR window supplies a snapshot. Restore its old rows and measured
    // sizes together before reconciling the log received while it was closed.
    const [restored] = useState(() => savedView?.current);
    const followRef = useRef(restored?.follow ?? true);
    const view = useLogView(useAtomValue(Atom_MessageLogs).data, followRef, restored?.view);
    const currentShowResendButton = useSettingValue("ShowResendButton");
    const actions = useMessageActions();
    const logContainerRef = useRef<HTMLDivElement>(null);
    const virtualizerRef = useRef<VirtualizerHandle>(null);
    const [startMargin, setStartMargin] = useState(restored?.startMargin ?? 0);
    const latestView = useRef({ view, startMargin });
    latestView.current = { view, startMargin };
    const selection = useSelectedRows();
    const keepMounted = useMemo(() => rowsBetween(view.rows, selection), [view.rows, selection]);
    // Speakers (#447): the names given to the voices of each session, and the rows that go on
    // with the voices of the row above them. Only the main window names voices.
    const { speakerNames, nameSpeakers } = useSpeakerNaming();
    const continuing = useMemo(() => speakerContinuations(view.rows), [view.rows]);

    // An empty log shows the empty state, which is read from its top: following its end
    // scrolled the greeting up whenever the list under it grew past the log's height at startup.
    const follow = useCallback(() => {
        const element = logContainerRef.current;
        if (element && followRef.current && latestView.current.view.rows.length) element.scrollTop = element.scrollHeight;
    }, []);

    useLayoutEffect(() => {
        const element = logContainerRef.current;
        if (!element) return;
        if (restored) element.scrollTop = restored.scrollTop;
        store.scroll_log_to_bottom = () => {
            followRef.current = true;
            follow();
        };
        let userUntil = 0, pointerDown = false;
        const onInput = () => { userUntil = performance.now() + USER_SCROLL_MS; };
        // After a click in the log, PageUp and friends may scroll it with the focus on
        // <body>, so listen on the window. Keys another control handled, keys aimed
        // elsewhere and keys while settings cover the log (inert) are not for it.
        const log: TargetHolder = element;
        const onKeyDown = (event: Event) => {
            if (!isKeyboardEvent(event)) return;
            if (!SCROLL_KEYS.has(event.key) || event.defaultPrevented || element.closest("[inert]")
                || !(log.contains(event.target) || event.target === document.body)) return;
            onInput();
            // End scrolls smoothly toward an end that moves while virtua measures
            // the newest rows; go there and follow them as the send button does.
            if (event.key === "End") store.scroll_log_to_bottom?.();
        };
        const onPointerDown = () => { pointerDown = true; };
        // A short drag can be released before its scroll event arrives.
        const onPointerUp = () => {
            if (pointerDown) onInput();
            pointerDown = false;
        };
        // Only the user (wheel, touch, keys, dragging the scrollbar or a selection)
        // stops the following. Scrolls caused by layout, such as rows being measured
        // or a resize, go back to the end instead.
        const onScroll = () => {
            const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD;
            if (pointerDown || performance.now() < userUntil) followRef.current = atEnd;
            else if (atEnd) followRef.current = true;
            else follow();
        };
        // The padding before the rows is in rem, so it changes with the UI scale.
        const observer = new ResizeObserver(() => {
            setStartMargin(parseFloat(getComputedStyle(element).paddingTop) || 0);
            follow();
        });
        const listeners: [EventTarget, string, EventListener][] = [[element, "scroll", onScroll], [element, "wheel", onInput], [element, "touchmove", onInput],
            [window, "keydown", onKeyDown], [element, "pointerdown", onPointerDown],
            [window, "pointerup", onPointerUp], [window, "pointercancel", onPointerUp]];
        listeners.forEach(([target, type, listener]) => target.addEventListener(type, listener, { passive: true }));
        observer.observe(element);
        return () => {
            if (savedView) savedView.current = { ...latestView.current, follow: followRef.current,
                scrollTop: element.scrollTop, cache: virtualizerRef.current?.cache };
            listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
            observer.disconnect();
            store.scroll_log_to_bottom = null;
        };
    }, [follow, savedView, restored]);

    useLayoutEffect(() => follow(), [view, follow]);

    const showResendButton = !!actions && currentShowResendButton.data;
    return (
        // Focusable so the keys keep scrolling it after the clicked row leaves the DOM.
        <div id="log_container" className={styles.container} ref={logContainerRef}
            tabIndex={0} role="region" aria-label={t("main_page.message_log.region_label")}>
            <MessageLogUiSizeController />
            {view.rows.length === 0 && <EmptyState />}
            {/* Rows measured later (new, or after a font size change) call onResize. */}
            <Virtualizer ref={virtualizerRef} cache={restored?.cache}
                data={view.rows} shift={view.shift} scrollRef={logContainerRef} startMargin={startMargin} onResize={follow}
                keepMounted={keepMounted}>
                {message => isGone(message) ? <div key={message.id} /> : <MessageContainer key={message.id} {...message}
                    speaker_names={message.realtime ? speakerNames[message.realtime.namespace] : undefined}
                    continues={continuing.has(message.id)} nameSpeakers={store.is_vr_panel ? undefined : nameSpeakers}
                    showResendButton={showResendButton} sendMessage={actions?.sendMessage}
                    updateMessageInputValue={actions?.updateMessageInputValue} />}
            </Virtualizer>
        </div>
    );
});

// The rows handed to virtua (see nextLogView). When the oldest rows leave,
// virtua has to see that on its own, so that step is committed before the rest.
// Removed rows stay as empty rows only while the user reads above the end.
const useLogView = (rows: MessageLogRow[], followRef: MutableRefObject<boolean>, restoredView: LogViewState | undefined) => {
    const [view, setView] = useState<LogViewState>(() => restoredView ?? { rows, shift: false, source: rows });
    const restoring = view === restoredView;
    const next = restoring || view.source === rows || view.shift ? view
        : { ...nextLogView(view.rows, rows, !followRef.current), source: rows };
    if (next !== view) setView(next);
    useLayoutEffect(() => {
        if (restoring) setView({ ...nextLogView(view.rows, rows, !followRef.current), source: rows });
        else if (view.shift) setView({ ...nextLogView(view.rows, view.source, !followRef.current), source: view.source });
    }, [view, followRef, restoring, rows]);
    return next;
};

// The rows at both ends of a text selection in the log. The rows between them
// stay mounted, so a selection dragged across several screens keeps its start.
const useSelectedRows = () => {
    const [ends, setEnds] = useState<RowEnds | null>(null);
    useEffect(() => {
        const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;
        const rowOf = (node: Node | null) => (node && isElement(node) ? node : node?.parentElement)
            ?.closest<HTMLElement>("[data-log-row]")?.dataset.logRow;
        const onSelectionChange = () => {
            const selection = document.getSelection();
            const from = selection && !selection.isCollapsed ? rowOf(selection.anchorNode) : undefined;
            const to = from && selection ? rowOf(selection.focusNode) : undefined;
            setEnds(current => !from || !to ? null : current?.from === from && current?.to === to ? current : { from, to });
        };
        document.addEventListener("selectionchange", onSelectionChange);
        return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, []);
    return ends;
};

const MessageLogUiSizeController = memo(function MessageLogUiSizeController() {
    const currentMessageLogUiScaling = useSettingValue("MessageLogUiScaling");
    const font_size = currentMessageLogUiScaling.data / 100;

    useEffect(() => {
        // Drawn inside the log's container, so the container is there.
        const log_container_el = document.getElementById("log_container");
        log_container_el?.style.setProperty("font-size", `${font_size}rem`);
    }, [currentMessageLogUiScaling.data]);

    return null;
});
