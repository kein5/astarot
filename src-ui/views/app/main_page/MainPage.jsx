import clsx from "clsx";
import styles from "./MainPage.module.scss";
import { SidebarSection } from "./sidebar_section/SidebarSection";
import { MainSection } from "./main_section/MainSection";
import { useIsOpenedConfigPage } from "@logics_common";
import { StartupContext } from "./startupContext";
import { StartupProgress } from "./main_section/message_container/log_box/StartupProgress";

// While the engine starts (locked), the page keeps its real layout but takes no
// input: inert removes it from focus, pointer and the accessibility tree, and
// data-starting turns what the engine has not sent yet ([data-skeleton]) into
// placeholders of the same size. StartupAnnouncer, outside it, tells screen readers.
export const MainPage = ({ focusFallback, locked = false }) => {
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const hidden = currentIsOpenedConfigPage.data === true;

    return (
        <div ref={focusFallback} tabIndex={-1} inert={hidden || locked ? "" : undefined} aria-hidden={hidden}
            aria-busy={locked || undefined} data-starting={locked ? "" : undefined} className={clsx(styles.page, styles.main_page, {
            [styles.show_config]: currentIsOpenedConfigPage.data,
            [styles.show_main]: !currentIsOpenedConfigPage.data
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
