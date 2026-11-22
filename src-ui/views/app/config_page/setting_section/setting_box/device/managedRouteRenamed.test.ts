import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { readLocale, localeAt, textAt } from "../../../../../../logics/test/locales.ts";

// ADR-014, 2.8: the Linux virtual microphone took its ASTAROT name. The core made the user's
// managed route again under it, so VRChat has to be pointed at the new microphone once. The
// route controls say so until the notice is closed, and every sentence names the new microphone.
const source = readFileSync(new URL("./VoiceRouteSettings.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../../../../../logics/useReceiveRoutes.ts", import.meta.url), "utf8");

test("the route controls show the new name of the microphone until the notice is closed", () => {
    assert.match(source, /const renamed = !!route\.managed && route\.notice === "managed_route_renamed";/);
    assert.match(source, /\{renamed && <div role="status">\s*<p>\{t\("voice_ui\.managed_route_renamed"\)\}<\/p>/);
    assert.match(source, /onClick=\{\(\) => send\("\/set\/disable\/managed_route_rename_notice"\)\}>\{t\("common\.close_button_label"\)\}/);
    // The core answers with the route, which no longer has the notice.
    assert.match(routes, /\{ endpoint: "\/set\/disable\/managed_route_rename_notice", ns: voice, hook_name: "useVoice", method_name: "updateRoute" \}/);
});

test("the strings name the new microphone, and the old one only where it is gone, in both languages", () => {
    for (const language of ["en", "ja"]) {
        const text = readLocale(language);
        for (const key of ["voice.managed_lead", "voice.input_selection_hint"]) {
            assert.match(textAt(text, key), /ASTAROT Managed Virtual Microphone/, `${language} ${key}`);
            assert.doesNotMatch(textAt(text, key), /VRCT/, `${language} ${key}`);
        }
        const renamed = textAt(text, "voice_ui.managed_route_renamed");
        assert.match(renamed, /ASTAROT Managed Virtual Microphone/, language);
        assert.match(renamed, /VRCT Managed Virtual Microphone/, language);
        assert.equal(typeof localeAt(text, "common.close_button_label"), "string", language);
        const legacy = textAt(text, "voice_setup_errors.managed_setup_manual_config_legacy");
        assert.match(legacy, /90-vrct-managed\.conf/, language);
        assert.match(legacy, /90-astarot-managed\.conf/, language);
    }
});
