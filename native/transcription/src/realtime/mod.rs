//! Realtime recognition on a speech.cpp server (#288): the caption events, the session that
//! streams one endpoint, and the delivery of its captions and finals.

pub mod delivery;
pub mod events;
pub mod session;

pub use delivery::{Admission, Delivery};
pub use events::Update;
pub use session::{Limits, Options, Session};
