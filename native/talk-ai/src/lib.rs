//! The talk AI's connection to a realtime conversation service (#388, ADR-018): the user's voice
//! and pictures go to the service, and its spoken answers come back, over the OpenAI Realtime
//! events on a WebSocket. OpenAI speaks them, and so does vLLM-Omni's `/v1/realtime` on the
//! user's own machine. The app runs no conversation model.
//!
//! - [`protocol`]: the events sent and read, as plain values.
//! - [`conversation`]: what the conversation is doing and what each event asks of it, without
//!   I/O: whose turn it is, and where an answer the user cut into is cut.
//! - [`connection`]: opening the WebSocket under the network policy, through the system proxy.
//! - [`talk`]: one conversation on a thread of its own, and the right to stop it.
//!
//! Gemini Live uses its own protocol. The crate is independent of the application core.
//! Diagnostics contain fixed codes and no credentials or conversation data.

pub mod connection;
pub mod gemini;
pub mod conversation;
pub mod protocol;
pub mod talk;

pub use connection::{Key, Network, OpenError, Service};
pub use conversation::Event;
pub use protocol::{SessionSettings, Status, Turns};
pub use talk::{Closed, Failure, Options, Talk, Update};
