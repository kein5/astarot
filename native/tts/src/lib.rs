//! Speech synthesis for VRCT-VOX: requests to a local speech.cpp server, one
//! bounded speech worker, and the hand-off of streamed PCM to an output.
//!
//! Codename: Forau (#689; the table is in `docs/voice-stack/project-rename.md`).
//!
//! This is the Rust counterpart of `src-python/models/tts/`. It keeps the same
//! settings format, the same error codes and the same queueing, interruption and
//! expiry rules. Output devices, the voice conversion and the speech.cpp process
//! owner stay outside this crate; they plug in through the traits in
//! [`playback`], [`converted`] and [`listener`].
//!
//! Nothing here logs or returns spoken text, instructions, audio or server bodies.
//! Failures carry short, fixed codes only.

pub mod cancel;
pub mod client;
pub mod clock;
pub mod converted;
pub mod engines;
pub mod error;
pub mod events;
mod http;
pub mod listener;
pub mod message_hook;
pub mod model_options;
pub mod onset;
pub mod playback;
mod resample;
pub mod scheduler;
pub mod settings;
pub mod sync;
pub mod trace;

pub use cancel::CancelToken;
pub use client::{PcmStream, SpeechCppTts};
pub use error::{SpeechError, TtsError};
pub use events::{AudioFrame, Source, SpeechMessageEvent};
pub use model_options::SynthesisOptions;
pub use scheduler::{BusOptions, VoiceEventBus, VoiceStatus};
pub use settings::{local_url, VoiceSettings};
