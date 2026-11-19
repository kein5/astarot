import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";

// Codes the servers report as a notice, not a failure (native/speech-server/src/lib.rs).
const NOTICES = { speech_server_cpu_fallback: true };

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

// The codes the bundled speech servers can report (native/speech-server/src/lib.rs, mod codes) and
// those the core's start and stop add (native/core/src/controller/speech.rs), plus the UI's own.
const serverCodes = () => {
    const library = read("../../../native/speech-server/src/lib.rs").split("pub mod codes {")[1].split("}")[0];
    const core = read("../../../native/core/src/controller/speech.rs");
    const codes = new Set([...library.matchAll(/"((?:speech_server|speech_bundle)_[a-z_]+)"/g)].map(([, code]) => code));
    for (const [, code] of core.matchAll(/const [A-Z_]+: &str = "(speech_server_[a-z_]+)"/g)) codes.add(code);
    codes.add("speech_server_request_failed"); // src-ui/logics/useReceiveRoutes.ts, when a reply has no code
    // Standby has its own line on the page (speech_servers.low_latency_failed).
    codes.delete("speech_server_low_latency_failed");
    return codes;
};

// The server page shared by speech recognition and TTS falls back to voice_ui.errors, whose
// texts send the user to the TTS switch. A server code must have its own text here.
test("every speech server code has its own text on the server page in English and Japanese", () => {
    const codes = serverCodes();
    assert.ok(codes.size > 15, `found ${codes.size} codes`);
    for (const language of ["en", "ja"]) {
        const { errors, notices = {} } = yaml.load(read(`../../../locales/${language}.yml`)).speech_servers;
        for (const code of codes) {
            // A notice (the CPU fallback) is shown from speech_servers.notices, not as an error.
            const text = code in NOTICES ? notices[code] : errors[code];
            const section = code in NOTICES ? "notices" : "errors";
            assert.equal(typeof text, "string", `${language}: speech_servers.${section}.${code}`);
            assert.doesNotMatch(text, /TTS/, `${language}: ${code} names TTS`);
        }
    }
});
