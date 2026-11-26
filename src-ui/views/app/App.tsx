import { TranscriptionConsentController } from "./_app_controllers/TranscriptionConsentController";
import { RecognitionFixController } from "./_app_controllers/RecognitionFixController";
import { OcrSetupController } from "./_app_controllers/OcrSetupController";
import { TranslationSetupController } from "./_app_controllers/TranslationSetupController";
import { TelemetryNoticeController } from "./_app_controllers/TelemetryNoticeController";
import { VirtualMicGuideController } from "./_app_controllers/VirtualMicGuideController";
import { FirstRunSetupController } from "./_app_controllers/FirstRunSetupController";
import { SwitchBlocksController } from "./_app_controllers/SwitchBlocksController";
import { useRef } from "react";

import {
    KeyEventController,
    StartPythonController,
    GlobalHotKeyController,
    UiLanguageController,
    ConfigPageCloseTriggerController,
    UiSizeController,
    FontFamilyController,
    ThemeController,
    TransparencyController,
    CornerRadiusController,
    VrPanelSyncController,
    OcrSharedWindowController,
    AppUpdateController,
} from "./_app_controllers";

import * as styles from "./App.css.ts";

import { MainPage } from "./main_page/MainPage";
import { QuickChatController } from "./_app_controllers/QuickChatController";
import { CaptionOverlayController } from "./_app_controllers/CaptionOverlayController";
import { CompanionController } from "./_app_controllers/CompanionController";
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

    return (
        <div className={styles.container}>
            <AppErrorBoundary >
                <KeyEventController />
                <StartPythonController />
                <WindowCloseController />
                <GlobalHotKeyController />
                <QuickChatController />
                <CaptionOverlayController />
                <CompanionController />
                <IoFlowController />
                <UiLanguageController waitForEngine />
                <ConfigPageCloseTriggerController />
                <UiSizeController />
                <FontFamilyController />
                <ThemeController />
                <TransparencyController />
                <CornerRadiusController />
                <VrPanelSyncController />
                <OcrSharedWindowController />
                <AppUpdateController />

                {/* The main page is drawn from the first frame. Until the engine is
                    ready it is locked, with placeholders where its settings go. A new UI
                    language draws the same pages in it: what is open, typed or focused stays (#904). */}
                <Contents locked={isStartupLocked(phase)} />
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
const Contents = ({ locked }: { locked: boolean }) => {
    const { currentIsSoftwareUpdating } = useIsSoftwareUpdating();
    const mainPage = useRef<HTMLDivElement>(null);
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
                    <RecognitionFixController />
                    <TranslationSetupController />
                    <OcrSetupController />
                    <TelemetryNoticeController />
                    <FirstRunSetupController />
                    <VirtualMicGuideController />
                </>}
            </div>
            :
            <UpdatingComponent />
            }
        </>
    );
};
