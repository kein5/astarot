import { useEffect, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import * as styles from "./ConfigPage.css.ts";

import { useIsOpenedConfigPage } from "@logics_common";
import { useOcr } from "@logics_configs";

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

    useLayoutEffect(() => {
        // Laid out again as it opens: WebKitGTK sometimes leaves it with its first layout (relayoutFromAbove.ts).
        if (!isClosed) relayoutFromAbove(root.current);
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