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
//! Not connected to the core yet (stage 1 of #388). Nothing here logs or returns audio, a
//! picture, what was said or a key; errors are fixed codes.

pub mod connection;
pub mod conversation;
pub mod protocol;
pub mod talk;

pub use connection::{Key, Network, OpenError, Service};
pub use conversation::Event;
pub use protocol::{SessionSettings, Status, Turns};
pub use talk::{Closed, Failure, Options, Talk, Update};
