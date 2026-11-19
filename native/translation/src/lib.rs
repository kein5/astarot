//! Translation providers and readings for VRCT-VOX (#277), moved from
//! `src-python/models/translation/` and `src-python/models/transliteration/`.
//!
//! - [`providers`]: DeepL, Google Cloud Translation, Papago (NAVER Cloud Platform), Plamo,
//!   Gemini, OpenAI, Groq, OpenRouter, an OpenAI-compatible endpoint, LM Studio and Ollama, one
//!   module each: checking a key or a server, listing models, translating.
//! - [`prompt`]: the system prompt and conversation history of the chat providers.
//! - [`transliteration`]: kana and Hepburn readings over a morphological analyzer given from
//!   outside (the dictionary is not chosen yet).
//! - [`http`]: the small HTTP/1.1 client the providers use.
//! - [`proxy`]: the proxy speech recognition's requests go through (not translation's).
//! - [`translategemma`]: TranslateGemma's prompt and one request to the llama.cpp server the
//!   app owns (ADR-015); not a provider of the engine list.
//!
//! Nothing here logs. Errors are fixed codes: no key, URL or text is in them.

#[cfg(feature = "fake-server")]
pub mod fake;
pub mod http;
pub mod prompt;
pub mod providers;
pub mod proxy;
pub mod translategemma;
pub mod transliteration;
