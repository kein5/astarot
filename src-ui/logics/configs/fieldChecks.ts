// What a settings field checks before it saves by itself (#1111): the rules the core keeps
// (native/core/src/config/schema.rs), so a value the core would refuse is said under the field and
// never sent. Each check gives the locale key of what to say, or null when the value may be saved.

// The LLM translation's temperature: empty (the engine's own), or 0 to 2 with at most two places.
export const temperatureProblem = (text: string): string | null =>
    text === "" || (/^\d(?:\.\d{1,2})?$/.test(text) && Number(text) <= 2)
        ? null : "config_page.translation.llm_translation_temperature.errors.invalid";

export const LLM_INSTRUCTIONS_MAX_CHARS = 500;
// Control characters (Unicode's Cc), which Rust's char::is_control matches.
const CONTROL = /\p{Cc}/u;

// The extra instructions: one line of at most 500 characters.
export const instructionsProblem = (text: string): string | null =>
    [...text].length <= LLM_INSTRUCTIONS_MAX_CHARS && !CONTROL.test(text)
        ? null : "config_page.translation.llm_translation_instructions.errors.invalid";

// Papago's Client ID: at most 256 characters, no control characters.
export const papagoClientIdProblem = (text: string): string | null =>
    [...text].length <= 256 && !CONTROL.test(text) ? null : "config_page.translation.papago_client_id.errors.invalid";

// The address of a server the user runs (LM Studio, Ollama): not empty, one word, http or https.
// What else the core asks of it (plain http only on the PC or the LAN, no credentials in it) and
// whether the server answers there are said with the core's refusal.
export const serverUrlProblem = (key: string) => (text: string): string | null =>
    /^https?:\/\/\S+$/i.test(text.trim()) ? null : key;

// A whole number from `min` to `max` (a port, the OBS page's numbers), said with `key`. Like the
// core, spaces around it and a sign before it are let through.
export const wholeNumberProblem = (min: number, max: number, key: string) => (text: string): string | null => {
    const value = text.trim();
    return /^[+-]?\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? null : key;
};

// A color as # and six hexadecimal digits (the OBS page's colors), said with `key`.
export const hexColorProblem = (key: string) => (text: string): string | null =>
    /^#[0-9a-f]{6}$/i.test(text.trim()) ? null : key;

// Four numbers from 0 to 255, without leading zeros, as the core reads an IPv4 address.
const ipv4 = (text: string): boolean => {
    const parts = text.split(".");
    return parts.length === 4 && parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
};

// An IPv6 address (no zone): up to eight groups of one to four hexadecimal digits, one "::" for
// the groups left out, and an IPv4 address in place of the last two.
const ipv6 = (text: string): boolean => {
    if (!text.includes(":") || /[^0-9a-f:.]/i.test(text)) return false;
    const halves = text.split("::");
    if (halves.length > 2) return false;
    const groups = halves.flatMap(half => half === "" ? [] : half.split(":"));
    const last = groups.at(-1);
    const tail = last?.includes(".") ? (ipv4(last) ? 2 : Number.NaN) : 0;
    const hex = tail ? groups.slice(0, -1) : groups;
    if (Number.isNaN(tail) || !hex.every(group => /^[0-9a-f]{1,4}$/i.test(group))) return false;
    const count = hex.length + tail;
    return halves.length === 2 ? count <= 7 : count === 8;
};

// Where OSC is sent: an IPv4 or IPv6 address, the latter with a zone after "%" if needed. The core
// takes the text as it is, so spaces around it are refused here too.
export const oscAddressProblem = (text: string): string | null => {
    const [address, zone, ...more] = text.split("%");
    const valid = zone === undefined ? ipv4(address) || ipv6(address) : zone !== "" && more.length === 0 && ipv6(address);
    return valid ? null : "config_page.advanced_settings.osc_ip_address.errors.invalid";
};

// The WebSocket server's host: an IPv4 address other than 0.0.0.0, taken as it is like the core.
export const websocketHostProblem = (text: string): string | null =>
    ipv4(text) && text !== "0.0.0.0" ? null : "config_page.advanced_settings.websocket_host.errors.invalid";

// The TLS certificate and key are saved together (#1111, decided 3): both paths, or neither.
export const tlsPairProblem = (cert: string, key: string): string | null =>
    (cert.trim() === "") === (key.trim() === "") ? null : "config_page.advanced_settings.websocket_tls_errors.one_side";
