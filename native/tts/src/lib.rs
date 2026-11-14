//! Speech synthesis for VRCT-VOX: requests to a local speech.cpp server, one
//! bounded speech worker, and the hand-off of streamed PCM to an output.
//!
//! This is the Rust counterpart of `src-python/models/tts/`. It keeps the same
//! settings format, the same error codes and the same queueing, interruption and
//! expiry rules.
//!
//! Nothing here logs or returns spoken text, instructions, audio or server bodies.
//! Failures carry short, fixed codes only.

pub mod clock;
pub mod error;
pub mod events;
pub mod model_options;
pub mod settings;
pub mod sync;

pub use error::{SpeechError, TtsError};
pub use events::{AudioFrame, Source, SpeechMessageEvent};
pub use model_options::SynthesisOptions;
pub use settings::{local_url, VoiceSettings};
