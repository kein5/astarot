import assert from "node:assert/strict";
import { test } from "vitest";
import i18next from "i18next";
import { hooks, loadModule, find, stubGlobals } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import { readLocale } from "../../../logics/test/locales.ts";
import type { CloseButtonProps } from "./CloseButton.tsx";

for (const language of ["en", "ja"]) {
    test(`${language}: close icon has a localized default, precise overrides and no SVG name`, async () => {
        const translations = i18next.createInstance();
        const resource = readLocale(language);
        await translations.init({ lng: language, resources: { [language]: { translation: resource } } });
        const runtime = hooks();
        const { CloseButton } = await loadModule<typeof import("./CloseButton.tsx")>(new URL("./CloseButton.tsx", import.meta.url), runtime, {
            "@useI18n": { useI18n: () => ({ t: translations.t.bind(translations) }) },
        });
        let clicks = 0;
        const render = (props?: CloseButtonProps) => runtime.render(CloseButton, { onClick: () => clicks++, ...props });
        const button = render();
        assert.equal(button.type, "button");
        assert.equal(button.props.type, "button", "closing must never submit an enclosing form");
        assert.equal(button.props["aria-label"], language === "ja" ? "閉じる" : "Close");
        const icon = find(button, node => typeof node.type === "function");
        assert.ok(icon);
        assert.equal(icon.props["aria-hidden"], "true");
        assert.equal(icon.props.focusable, "false");
        for (const key of ["common.dismiss_notification", "studio.close"]) {
            assert.equal(translations.exists(key), true, key);
            assert.equal(render({ "aria-label": translations.t(key) }).props["aria-label"], translations.t(key));
        }
        button.props.onClick();
        assert.equal(clicks, 1);
    });
}

test("the error fallback names the close-application action", async () => {
    for (const name of ["AppErrorBoundary"] as const) {
        const runtime = hooks();
        let closed = 0;
        // A broken window is not put away in the tray: the error screen's close ends the app.
        const common = { useWindow: () => ({ asyncQuitApp: () => closed++ }),
            useSoftwareVersion: () => ({ currentSoftwareVersion: { data: "test" } }),
            useCopyToClipboard: () => ({ is_copied: false }) };
        const exports = await loadModule<typeof import("../../app/others/error_boundary/AppErrorBoundary.tsx")>(new URL(`../../app/others/error_boundary/${name}.tsx`, import.meta.url), runtime, {
            "@common_components": { CloseButton: "close-button" }, "@logics_common": common,
            "react-error-boundary": { ErrorBoundary: "error-boundary" },
            "./contacts_container/ContactsContainer": { ContactsContainer: "contacts" },
            "../../../../logics/common/useAppUpdate": { useAppUpdate: () => ({ appUpdate: { info: null } }) },
        });
        let tree = runtime.render(exports[name], {});
        if (name === "AppErrorBoundary") {
            const fallback = tree.props.fallbackRender({ error: null });
            tree = runtime.render(fallback.type, fallback.props);
        }
        const close = find(tree, node => node.type === "close-button");
        assert.ok(close);
        assert.equal(close.props["aria-label"], "studio.close", name);
        close.props.onClick();
        assert.equal(closed, 1);
        runtime.unmount();
    }
});

test("notification close names dismissal and retains its toast callback", async context => {
    const runtime = hooks();
    // The toast's options, as far as the test reads them: the close button it draws.
    let options: { closeButton: (props: { closeToast: () => void }) => TreeNode } | undefined, dismissed = 0;
    stubGlobals(context, { setTimeout: (callback: () => void) => { callback(); } });
    const notification = runtime.jotai.atom({ state: "ok", data: { is_open: true, status: "info", message: "notice" } });
    const { SnackbarController } = await loadModule<typeof import("../../app/others/snackbar_controller/SnackbarController.tsx")>(new URL("../../app/others/snackbar_controller/SnackbarController.tsx", import.meta.url), runtime, {
        "@common_components": { CloseButton: "close-button" },
        "./ReactToastifyOverrideClass.scss": {},
        "react-toastify": { ToastContainer: "toasts", cssTransition: () => ({}), toast: (_: unknown, value: NonNullable<typeof options>) => { options = value; } },
        "@store": { Atom_NotificationStatus: notification },
        "@logics_common": { useNotificationStatus: () => ({ closeNotification: () => {} }),
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { state: "ok", data: false } }) },
    });
    runtime.render(SnackbarController);
    assert.ok(options);
    const button = options.closeButton({ closeToast: () => dismissed++ });
    assert.equal(button.props["aria-label"], "common.dismiss_notification");
    button.props.onClick();
    assert.equal(dismissed, 1);
    runtime.unmount();
});
