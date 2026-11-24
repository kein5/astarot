import assert from "node:assert/strict";
import { test } from "vitest";
import {
    hexColorProblem,
    instructionsProblem,
    oscAddressProblem,
    papagoClientIdProblem,
    serverUrlProblem,
    temperatureProblem,
    tlsPairProblem,
    websocketHostProblem,
    wholeNumberProblem,
} from "./fieldChecks.ts";

// #1111: the checks a field runs before it saves by itself, which keep the core's rules
// (native/core/src/config/schema.rs): a value the core would refuse is said, not sent.
test("the temperature is empty, or 0 to 2 with at most two places", () => {
    for (const ok of ["", "0", "2", "0.3", "1.25", "2.0"]) assert.equal(temperatureProblem(ok), null, ok);
    for (const bad of ["2.01", "3", "-1", "0.333", ".5", "1.", "10", "a", "1e0"]) assert.equal(temperatureProblem(bad), "config_page.translation.llm_translation_temperature.errors.invalid", bad);
});

test("the extra instructions are one line of at most 500 characters", () => {
    assert.equal(instructionsProblem(""), null);
    assert.equal(instructionsProblem("あ".repeat(500)), null);
    assert.equal(instructionsProblem("😀".repeat(500)), null, "characters, not UTF-16 units");
    assert.equal(instructionsProblem("あ".repeat(501)), "config_page.translation.llm_translation_instructions.errors.invalid");
    assert.equal(instructionsProblem("one\ntwo"), "config_page.translation.llm_translation_instructions.errors.invalid");
});

test("Papago's Client ID is at most 256 characters without control characters", () => {
    assert.equal(papagoClientIdProblem(""), null);
    assert.equal(papagoClientIdProblem("x".repeat(256)), null);
    assert.equal(papagoClientIdProblem("x".repeat(257)), "config_page.translation.papago_client_id.errors.invalid");
    assert.equal(papagoClientIdProblem("id\t"), "config_page.translation.papago_client_id.errors.invalid");
});

test("a server address is one word starting with http:// or https://", () => {
    const check = serverUrlProblem("key");
    for (const ok of ["http://127.0.0.1:1234/v1", " https://lm.example.org/v1 ", "HTTP://localhost:11434"]) assert.equal(check(ok), null, ok);
    for (const bad of ["", "127.0.0.1:1234", "ftp://x", "http://a b", "http://"]) assert.equal(check(bad), "key", bad);
});

test("a whole number is in its range, with spaces and a sign let through as the core does", () => {
    const check = wholeNumberProblem(0, 120, "key");
    for (const ok of ["0", "120", " 7 ", "+12", "-0"]) assert.equal(check(ok), null, ok);
    for (const bad of ["", "121", "-1", "1.5", "1e2", "a", "+", "１２"]) assert.equal(check(bad), "key", bad);
});

test("a color is # and six hexadecimal digits", () => {
    const check = hexColorProblem("key");
    for (const ok of ["#FFFFFF", "#00ff7a", " #ABCDEF "]) assert.equal(check(ok), null, ok);
    for (const bad of ["", "FFFFFF", "#FFF", "#FFFFFFF", "#GGGGGG", "red"]) assert.equal(check(bad), "key", bad);
});

test("OSC is sent to an IPv4 or IPv6 address, as the core reads one", () => {
    const ok = ["127.0.0.1", "192.168.1.20", "0.0.0.0", "::1", "::", "fe80::1", "2001:db8::8a2e:370:7334", "1:2:3:4:5:6:7:8", "::ffff:192.0.2.1", "fe80::1%eth0", "fe80::1%3"];
    for (const address of ok) assert.equal(oscAddressProblem(address), null, address);
    const bad = ["", "localhost", "256.0.0.1", "01.2.3.4", "1.2.3", " 127.0.0.1", "1:2:3:4:5:6:7:8:9", "1::2::3", "12345::", "1:2:3:4:5:6:7", "::ffff:1.2.3", "127.0.0.1%eth0", "fe80::1%", "fe80::1%a%b"];
    for (const address of bad) assert.equal(oscAddressProblem(address), "config_page.advanced_settings.osc_ip_address.errors.invalid", address);
});

test("the WebSocket host is an IPv4 address other than 0.0.0.0, taken as it is", () => {
    for (const ok of ["127.0.0.1", "192.168.1.20"]) assert.equal(websocketHostProblem(ok), null, ok);
    // The core's own refusals (native/core/tests/adapters_servers.rs), and spaces, which it does not trim.
    for (const bad of ["0.0.0.0", "not an address", "::1", "0210.1564.845.0", "", " 127.0.0.1"]) {
        assert.equal(websocketHostProblem(bad), "config_page.advanced_settings.websocket_host.errors.invalid", bad);
    }
});

test("the certificate and key are both given or both left empty", () => {
    assert.equal(tlsPairProblem("", ""), null);
    assert.equal(tlsPairProblem("C:/cert.pem", "C:/key.pem"), null);
    assert.equal(tlsPairProblem("C:/cert.pem", " "), "config_page.advanced_settings.websocket_tls_errors.one_side");
    assert.equal(tlsPairProblem("", "C:/key.pem"), "config_page.advanced_settings.websocket_tls_errors.one_side");
});
