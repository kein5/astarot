import { useEffect, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import * as styles from "./ConfigPage.css.ts";

import { useIsOpenedConfigPage } from "@logics_common";
import { useOcr } from "@logics_configs";
import { useStore_IsBreakPoint } from "@store";

import { Topbar } from "./topbar/Topbar";
import { SidebarSection } from "./sidebar_section/SidebarSection";
import { SettingSection } from "./setting_section/SettingSection";
import { SearchBar } from "./search_bar/SearchBar";
import { relayoutFromAbove } from "./relayoutFromAbove.ts";

// Element has no focus(); the tab and the button that opened the settings have it.
const focusable = (element: Element | null | undefined): element is Element & HTMLOrSVGElement =>
    !!element && "focus" in element && typeof element.focus === "function";

export const ConfigPage = () => {
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const root = useRef<HTMLDivElement>(null);
    const wasOpen = useRef(false);
    const isClosed = currentIsOpenedConfigPage.data === false;
    // The narrow layout, which turns the settings menu to icons (SidebarSection.tsx).
    const { currentIsBreakPoint } = useStore_IsBreakPoint();
    const narrow = currentIsBreakPoint.data === true;
    const { getOcrCaptureStatus } = useOcr();
    const askCaptureStatus = useRef(getOcrCaptureStatus);
    askCaptureStatus.current = getOcrCaptureStatus;

    // Where chat reading can read (the window, the headset) is asked as the settings open, so its
    // page draws a reading area for each from the start, even with its folds opened before its own
    // answers come (#912). The page asks again while it is open. It is not asked at start-up: the
    // core looks for the headset to answer it.
    useEffect(() => { if (!isClosed) askCaptureStatus.current(); }, [isClosed]);

    // Opening settings moves focus to the selected tab for keyboard users.
    // WebKit can draw that focus ring after a mouse click too, so the sidebar
    // hides it while the last input was a pointer.
    useEffect(() => {
        const set = (input: string) => () => { document.documentElement.dataset.lastInput = input; };
        const pointer = set("pointer"), keyboard = set("keyboard");
        window.addEventListener("pointerdown", pointer, true);
        window.addEventListener("keydown", keyboard, true);
        return () => {
            window.removeEventListener("pointerdown", pointer, true);
            window.removeEventListener("keydown", keyboard, true);
        };
    }, []);

    // Laid out again as it opens, and when the menu turns to icons or back while it is open: WebKitGTK
    // sometimes leaves it with its first layout (relayoutFromAbove.ts). The settings window (#1236)
    // shows the page from its first frame, and the menu's change, drawn as a transition, lands right
    // after that first layout: at 150% the page then stayed as first laid out, and a press on a tab
    // of the menu opened nothing.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the menu's change is what calls for the layout; the effect does not read it.
    useLayoutEffect(() => {
        if (!isClosed) relayoutFromAbove(root.current);
    }, [isClosed, narrow]);

    useLayoutEffect(() => {
        const target = !isClosed ? root.current?.querySelector('[aria-current="page"]')
            : wasOpen.current ? document.querySelector('[data-open-settings]') : null;
        if (focusable(target)) target.focus({ preventScroll: true });
        wasOpen.current = !isClosed;
    }, [isClosed]);

    return (
        <div ref={root} inert={isClosed} aria-hidden={isClosed} className={clsx(styles.page, { [styles.is_closed]: isClosed })}>
            <div className={styles.container}>
                <SidebarSection />
                <div className={styles.content_wrapper}>
                    <div className={styles.main_container}>
                        <SettingSection />
                    </div>
                    <Topbar />
                </div>
                <SearchBar />
            </div>
        </div>
    );
};