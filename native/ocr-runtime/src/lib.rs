//! Chat-bubble OCR for VRCT-VOX (issue #281): the reading engine, the bubble pipeline
//! and the VRChat frame capture paths, replacing `src-python/models/ocr`.

pub mod cv;
pub mod det;
pub mod engine;
pub mod error;
pub mod image;
pub mod languages;
pub mod models;
pub mod numeric;
pub mod rec;
pub mod unclip;

pub use error::{Error, Result};
pub use image::BgrImage;
