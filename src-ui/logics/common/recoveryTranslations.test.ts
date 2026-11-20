import assert from "node:assert/strict";
import { test, vi } from "vitest";
import i18next from "i18next";
import { componentName, componentOf, hooks, loadModule, find, stubGlobals, treeNode, unchecked } from "../test/hookHarness.ts";
import { readLocale } from "../test/locales.ts";
import { loadBridgeStore } from "../test/bridgeHarness.ts";
import type { SidecarSessionHandlers } from "./sidecarSession.ts";

// Draws a function component's element, as calling its type with no props always did. Something
// that is not an element fails the test there, as reading its type did.
const drawWithoutProps = (element: unknown) => {
    const node = treeNode(element);
    assert.ok(node, "not an element");
    return componentOf(node)();
};

const resources = Object.fromEntries(["en", "ja"].map(language => [language, { translation: readLocale(language) }]));
const icon = () => null;

for (const language of ["en", "ja"]) test(`${language}: recovery actions, stderr and startup use the selected locale with unchanged diagnostics`, async context => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, fallbackLng: "en", resources });
    const t = i18n.t.bind(i18n), translations = { useI18n: () => ({ t, i18n }) };
    for (const key of ["common_error.recovery_instructions", "common_error.copy_error_log", "common_error.updating",
        "common_error.update_now", "common_error.check_issues", "common_error.last_error_line",
        "main_page.backend_disconnected", "common_error.backend_startup_title", "common_error.backend_startup_reason_spawn",
        "common_error.backend_startup_reason_exit", "common_error.backend_startup_detail", "common_error.backend_startup_next",
        "common_error.backend_startup_retry", "common_error.backend_startup_quit", "studio.startup_label", "studio.startup_status",
        "studio.startup_step", "studio.startup_download_translation"]) {
        assert.equal(i18n.exists(key), true, key);
        assert.notEqual(t(key), key);
    }
    const runtime = hooks(), copies: string[] = [];
    stubGlobals(context, { window: { location: { origin: "http://localhost" } } });
    let updating = false, mode = "install";
    const errorModule = await loadModule<typeof import("../../views/app/others/error_boundary/AppErrorBoundary.tsx")>(new URL("../../views/app/others/error_boundary/AppErrorBoundary.tsx", import.meta.url), runtime, {
        "@useI18n": translations, "react-error-boundary": { ErrorBoundary: icon },
        "./contacts_container/ContactsContainer": { ContactsContainer: icon }, "@common_components": { CloseButton: icon },
        "../../../../logics/common/useAppUpdate": { useAppUpdate: () => ({ appUpdate: { info: { mode } } }) },
        "@logics_common": { useWindow: () => ({ asyncQuitApp() {} }),
            useSoftwareVersion: () => ({ currentSoftwareVersion: { data: "test-version" }, currentLatestSoftwareVersionInfo: { data: { is_update_available: true } } }),
            useCopyToClipboard: () => ({ copyToClipboard: (text: string) => copies.push(text) }), useComputeMode: () => ({ currentComputeMode: { data: "cpu" } }),
            useUpdateSoftware: () => ({}), useIsSoftwareUpdating: () => ({ currentIsSoftwareUpdating: { data: updating } }) },
    });
    const boundary = runtime.render(errorModule.AppErrorBoundary, {});
    const error = { stack: "TypeError: untranslated diagnostic\n at component (app.js:20)" };
    const fallback = boundary.props.fallbackRender({ error });
    const tree = fallback.type(fallback.props);
    assert.ok(find(tree, node => node.props.children === t("common_error.recovery_instructions")));
    assert.match(t("common_error.recovery_instructions"), /ASTAROT/);
    const copy = find(tree, node => node.type === "button");
    assert.ok(find(copy, node => node.props.children === t("common_error.copy_error_log")));
    assert.ok(copy);
    copy.props.onClick();
    assert.ok(copies[0].includes(error.stack));
    const safeActions = find(tree, node => componentName(node) === "SafeActionButtons");
    const actions = drawWithoutProps(safeActions);
    assert.ok(find(drawWithoutProps(actions), node => node.props.children === t("common_error.check_issues")));
    assert.ok(find(drawWithoutProps(actions), node => node.props.children === t("common_error.update_now")));
    updating = true;
    assert.ok(find(drawWithoutProps(actions), node => node.props.children === t("common_error.updating")));
    // A copy updated by hand (ZIP, tar.gz) or by a package manager gets no update button.
    for (const other of ["manual", "package_manager", "disabled"]) {
        mode = other;
        assert.equal(find(drawWithoutProps(actions), node => node.type === "button"), null, other);
    }
    mode = "install";

    const b = await loadBridgeStore(), notices: unknown[] = [];
    let handlers: SidecarSessionHandlers | undefined;
    // Test data: an owner with only attach, which is all the controller uses here.
    b.stores.store.backend_session_owner = unchecked({ attach: (get: () => SidecarSessionHandlers) => { handlers = get(); return () => {}; } });
    const controller = await loadModule<typeof import("../../views/app/_app_controllers/StartPythonController.tsx")>(new URL("../../views/app/_app_controllers/StartPythonController.tsx", import.meta.url), b.runtime, {
        "@useI18n": translations, "@store": b.stores, "@utils": {},
        "@tauri-apps/api/core": {}, "@useReceiveRoutes": { useReceiveRoutes: () => ({}) },
        "../../../logics/common/sidecarSession.ts": {},
        "../../../logics/common/backendCommand.ts": {},
        "../../../logics/common/startupPhase.ts": { describeStartupFailure: (detail: unknown) => detail },
        "@logics_common": { useIsBackendReady: b.stores.useStore_IsBackendReady,
            useNotificationStatus: () => ({ showNotification_Error: (text: unknown) => notices.push(text) }) },
    });
    b.runtime.render(controller.StartPythonController);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const line = "ImportError: unchanged diagnostics";
    assert.ok(handlers);
    handlers.stderr(line);
    assert.equal(notices[0], `${t("common_error.recovery_instructions")}\n${t("common_error.last_error_line")}: ${JSON.stringify(line)}`);
    for (const phase of ["failed", "stopped"] as const) {
        b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
        handlers.setStartupState(phase);
        assert.equal(b.runtime.store.get(b.stores.Atom_IsBackendReady).data, false);
    }
    runtime.unmount(); b.runtime.unmount();
});
