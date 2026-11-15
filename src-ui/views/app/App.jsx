import { TranscriptionConsentController } from "./_app_controllers/TranscriptionConsentController";
import { OcrSetupController } from "./_app_controllers/OcrSetupController";
import { TranslationSetupController } from "./_app_controllers/TranslationSetupController";
import { TelemetryNoticeController } from "./_app_controllers/TelemetryNoticeController";
import { LocalAsrNoticeController } from "./_app_controllers/LocalAsrNoticeController";
import { SwitchBlocksController } from "./_app_controllers/SwitchBlocksController";
import { useI18n } from "@useI18n";
import { useRef } from "react";

import {
    KeyEventController,
    StartPythonController,
    GlobalHotKeyController,
    UiLanguageController,
    ConfigPageCloseTriggerController,
    UiSizeController,
    FontFamilyController,
    TransparencyController,
    CornerRadiusController,
    VrPanelSyncController,
    OcrSharedWindowController,
} from "./_app_controllers";

import styles from "./App.module.scss";

import { MainPage } from "./main_page/MainPage";
import { QuickChatController } from "./_app_controllers/QuickChatController";
import { CaptionOverlayController } from "./_app_controllers/CaptionOverlayController";
import { IoFlowController } from "./_app_controllers/IoFlowController";
import { ConfigPage } from "./config_page/ConfigPage";

import {
    WindowTitleBar,
    UpdatingComponent,
    ModalController,
    SnackbarController,
    AppErrorBoundary,
} from "./others";

import { useIsSoftwareUpdating, WindowGeometryController, WindowCloseController } from "@logics_common";
import { useBackendStartup } from "../../logics/common/useBackendStartup";
import { isStartupLocked } from "../../logics/common/startupPhase";
import { StartupFailedDialog } from "./others/startup/StartupFailedDialog";
import { StartupAnnouncer } from "./others/startup/StartupAnnouncer";

export const App = () => {
    const { phase } = useBackendStartup();
    const { i18n } = useI18n();

    return (
        <div className={styles.container}>
            <AppErrorBoundary >
                <KeyEventController />
                <StartPythonController />
                <WindowCloseController />
                <GlobalHotKeyController />
                <QuickChatController />
                <CaptionOverlayController />
                <IoFlowController />
                <UiLanguageController />
                <ConfigPageCloseTriggerController />
                <UiSizeController />
                <FontFamilyController />
                <TransparencyController />
                <CornerRadiusController />
                <VrPanelSyncController />
                <OcrSharedWindowController />

                {/* The main page is drawn from the first frame. Until the engine is
                    ready it is locked, with placeholders where its settings go. */}
                <Contents key={i18n.language} locked={isStartupLocked(phase)} />
                {phase === "starting" && <StartupAnnouncer />}
                {phase === "failed" && <StartupFailedDialog />}

                <SnackbarController />
            </AppErrorBoundary>
        </div>
    );
};

// While locked, only the main page and the title bar are drawn: the settings
// page, dialogs and notices that act on the engine's settings wait for them,
// and the window geometry is not saved over the one the engine will restore.
const Contents = ({ locked }) => {
    const { currentIsSoftwareUpdating } = useIsSoftwareUpdating();
    const mainPage = useRef(null);
    return (
        <>
            <WindowGeometryController saveGeometry={!locked} />

            <WindowTitleBar />
            {currentIsSoftwareUpdating.data === false
            ?
            <div className={styles.pages_wrapper}>
                {!locked && <>
                    <SwitchBlocksController />
                    <ConfigPage />
                </>}
                <MainPage focusFallback={mainPage} locked={locked} />
                {!locked && <>
                    <ModalController fallback={mainPage} />
                    <TranscriptionConsentController />
                    <TranslationSetupController />
                    <OcrSetupController />
                    <TelemetryNoticeController />
                    <LocalAsrNoticeController />
                </>}
            </div>
            :
            <UpdatingComponent />
            }
        </>
    );
};
