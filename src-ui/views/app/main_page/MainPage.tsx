import type { RefObject } from "react";
import clsx from "clsx";
import * as styles from "./MainPage.css.ts";
import { SidebarSection } from "./sidebar_section/SidebarSection.tsx";
import { MainSection } from "./main_section/MainSection";
import { useIsOpenedConfigPage } from "@logics_common";
import { StartupContext } from "./startupContext";
import { StartupProgress } from "./main_section/message_container/log_box/StartupProgress";

// While the engine starts (locked), the page keeps its real layout but takes no
// input: inert removes it from focus, pointer and the accessibility tree, and
// data-starting turns what the engine has not sent yet ([data-skeleton]) into
// placeholders of the same size. StartupAnnouncer, outside it, tells screen readers.
// data-main-page and data-showing name the page and which page shows for tests that
// drive the packaged app (tests/platform/native_webdriver.py): its class names are hashed.
// The styles are vanilla-extract (ADR-010).
type MainPageProps = {
    // Where focus goes when nothing on the page has it (App, ModalController).
    focusFallback?: RefObject<HTMLDivElement>;
    locked?: boolean;
};

export const MainPage = ({ focusFallback, locked = false }: MainPageProps) => {
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const hidden = currentIsOpenedConfigPage.data === true;

    return (
        <div ref={focusFallback} tabIndex={-1} inert={hidden || locked ? "" : undefined} aria-hidden={hidden}
            aria-busy={locked || undefined} data-starting={locked ? "" : undefined}
            data-main-page="" data-showing={hidden ? "config" : "main"} className={clsx(styles.page, {
            [styles.showConfig]: hidden,
            [styles.showMain]: !hidden,
        })}>
            <StartupContext.Provider value={locked ? <StartupProgress /> : null}>
                <div className={styles.container}>
                    <SidebarSection />
                    <MainSection />
                </div>
            </StartupContext.Provider>
        </div>
    );
};
