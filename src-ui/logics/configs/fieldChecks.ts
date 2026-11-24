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
