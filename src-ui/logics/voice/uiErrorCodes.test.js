import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";

// Codes the UI makes itself (a reply that never came, a request that failed without a code),
// and the sections each page looks them up in, in order. Without a text the page shows the
// bare code, or nothing.
const PAGES = [
    { page: "SpeechServers.tsx", sections: ["speech_servers.errors", "voice_ui.errors"],
        codes: ["speech_server_request_unconfirmed", "speech_server_request_failed", "save_unconfirmed", "backend_unavailable"] },
    { page: "DirectVoiceSettings.tsx", sections: ["voice_setup_errors", "voice_ui.errors"],
        codes: ["source_bridge_request_failed", "save_unconfirmed", "backend_unavailable"] },
    { page: "RealtimeControls.tsx", sections: ["realtime_toggle", "voice_ui.errors"],
        codes: ["realtime_request_failed", "save_unconfirmed", "backend_unavailable"] },
    { page: "RealtimeASRSettings.tsx", sections: ["realtime_toggle"],
        codes: ["realtime_request_failed", "save_unconfirmed", "backend_unavailable"] },
    { page: "VoiceSettings.tsx (voiceErrorText)", sections: ["voice_ui.errors", "voice.input_errors"],
        codes: ["save_unconfirmed", "voice_request_failed", "voice_request_unconfirmed", "backend_unavailable"] },
    { page: "ModelDownloads.tsx", sections: ["model_downloads.errors"], codes: ["request_unconfirmed", "backend_unavailable"] },
];

for (const language of ["en", "ja"]) test(`${language}: every code the UI makes has a text where its page looks`, () => {
    const locale = yaml.load(readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8"));
    const get = path => path.split(".").reduce((node, key) => node?.[key], locale);
    for (const { page, sections, codes } of PAGES) {
        for (const code of codes) {
            assert.ok(sections.some(section => typeof get(section)?.[code] === "string"), `${page}: ${code}`);
        }
    }
});

// The codes listed above are the ones the UI's source makes; a new one fails here until it is listed.
test("the list covers the codes the UI makes", () => {
    const sources = ["../useReceiveRoutes.ts", "./useSettingsDraft.tsx",
        "../../views/app/config_page/setting_section/setting_box/advanced_settings/SpeechServers.tsx"];
    const listed = new Set(PAGES.flatMap(page => page.codes));
    for (const file of sources) {
        const source = readFileSync(new URL(file, import.meta.url), "utf8");
        for (const [, code] of source.matchAll(/"([a-z_]+_(?:unconfirmed|request_failed))"/g)) {
            if (code === "speech_server_cleanup_unconfirmed") continue; // a server code, in speechServerErrors.test.js
            assert.ok(listed.has(code), `${file}: ${code}`);
        }
    }
});
