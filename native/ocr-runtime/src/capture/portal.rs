//! A window the user shares through the desktop's ScreenCast portal (Linux;
//! [`ocr_capture_portal.py`]).
//!
//! The Tauri process asks the desktop on the user's request (portal_screencast.rs) and
//! starts native/screen-capture, which copies the newest frame of the stream into
//! `<ASTAROT_VR_PANEL_DIR>/screen-frame`. This only reads that file; it never starts a
//! capture.
//!
//! File layout (little-endian): a 64-byte header, then the pixels.
//!   0  "ASTRSCR1"
//!   8  sequence, odd while the pixels are being replaced
//!   16 instance: 0 once the stream is gone; the upper half is the helper's process id
//!   24 width, 28 height, 32 bytes per row, 36 layout (0 BGRx, 1 BGRA, 2 RGBx, 3 RGBA)
//!   40 time of the frame (CLOCK_MONOTONIC, nanoseconds)
//! Rows are `bytes per row` apart; the last one holds only `width * 4` bytes.
//!
//! A window that does not change sends no new frames, so an old frame is not a dead
//! stream. The stream is over when the file is gone, its instance is 0, or the helper
//! that wrote it no longer exists.
//!
//! [`ocr_capture_portal.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture_portal.py

use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::failure::Failure;
use crate::image::BgrImage;

pub const DIRECTORY_ENV: &str = astarot_app_identity::env::VR_PANEL_DIR;
pub const FRAME_NAME: &str = "screen-frame";
const MAGIC: &[u8; 8] = astarot_app_identity::handoff::SCREEN_FRAME;
const HEADER_SIZE: usize = 64;
const MAX_SIDE: u32 = 16384;
const READ_TRIES: usize = 4;

/// The parsed header: sequence, instance, width, height, bytes per row, layout.
pub type Header = (u64, u64, u32, u32, u32, u32);

pub fn frame_path() -> Option<PathBuf> {
    std::env::var_os(DIRECTORY_ENV).filter(|d| !d.is_empty()).map(|d| PathBuf::from(d).join(FRAME_NAME))
}

/// A killed helper cannot mark its file as over; its process id tells.
pub fn writer_alive(instance: u64) -> bool {
    std::path::Path::new(&format!("/proc/{}", instance >> 32)).exists()
}

/// `None` when this is not a frame file.
pub fn parse_header(head: &[u8]) -> Option<Header> {
    if head.len() < 48 {
        return None;
    }
    let u64_at = |o: usize| u64::from_le_bytes(head[o..o + 8].try_into().unwrap());
    let u32_at = |o: usize| u32::from_le_bytes(head[o..o + 4].try_into().unwrap());
    let (sequence, instance) = (u64_at(8), u64_at(16));
    let (width, height, stride, layout) = (u32_at(24), u32_at(28), u32_at(32), u32_at(36));
    if &head[..8] != MAGIC || width > MAX_SIDE || height > MAX_SIDE || stride > MAX_SIDE * 8 {
        return None;
    }
    if (width == 0) != (height == 0) || (width != 0 && stride < width * 4) {
        return None;
    }
    Some((sequence, instance, width, height, stride, layout))
}

/// Rows of four-byte pixels `stride` bytes apart → BGR. Unknown layouts → `None`.
pub fn frame_from_pixels(width: usize, height: usize, stride: usize, layout: u32, data: &[u8]) -> Option<BgrImage> {
    if layout > 3 || width == 0 || height == 0 || stride < width * 4 {
        return None;
    }
    if data.len() < stride * (height - 1) + width * 4 {
        return None;
    }
    let rgb = layout >= 2;
    let mut out = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let row = &data[y * stride..y * stride + width * 4];
        for px in row.as_chunks::<4>().0 {
            // The fourth byte is padding or alpha; chat reading wants the colours only.
            if rgb {
                out.extend_from_slice(&[px[2], px[1], px[0]]);
            } else {
                out.extend_from_slice(&px[..3]);
            }
        }
    }
    BgrImage::new(width, height, out).ok()
}

fn read_at(file: &mut std::fs::File, offset: u64, size: usize) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = Vec::with_capacity(size);
    file.by_ref().take(size as u64).read_to_end(&mut buffer)?;
    Ok(buffer)
}

/// Reads the newest frame of the shared window (`SharedWindowCapture`).
pub struct SharedWindowCapture {
    path: Option<PathBuf>,
    cache: Option<(u64, u64, BgrImage)>,
    alive: fn(u64) -> bool,
}

impl SharedWindowCapture {
    /// `path` overrides the file announced through `ASTAROT_VR_PANEL_DIR`.
    pub fn new(path: Option<PathBuf>) -> Self {
        SharedWindowCapture { path, cache: None, alive: writer_alive }
    }

    /// Replace the liveness check of the writing helper (tests).
    pub fn with_alive_check(mut self, alive: fn(u64) -> bool) -> Self {
        self.alive = alive;
        self
    }

    fn file(&self) -> Option<PathBuf> {
        self.path.clone().or_else(frame_path)
    }

    /// Is a window shared right now? Reads the 64-byte header only.
    pub fn is_active(&self) -> bool {
        let Some(path) = self.file() else { return false };
        let Ok(mut file) = std::fs::File::open(path) else { return false };
        let Ok(head) = read_at(&mut file, 0, HEADER_SIZE) else { return false };
        matches!(parse_header(&head), Some((_, instance, ..)) if instance != 0 && (self.alive)(instance))
    }

    /// The newest frame, or `None` before the first one or once the stream is gone.
    /// An unknown pixel layout is an error rather than a wrong picture.
    pub fn capture(&mut self) -> Result<Option<BgrImage>, Failure> {
        let Some(path) = self.file() else { return Ok(None) };
        let Ok(mut file) = std::fs::File::open(path) else { return Ok(None) };
        let mut instance = 0;
        for _ in 0..READ_TRIES {
            let Ok(head) = read_at(&mut file, 0, HEADER_SIZE) else { return Ok(None) };
            let Some((sequence, inst, width, height, stride, layout)) = parse_header(&head) else { return Ok(None) };
            if inst == 0 {
                return Ok(None);
            }
            instance = inst;
            if sequence % 2 == 1 {
                std::thread::sleep(std::time::Duration::from_millis(1)); // being replaced
                continue;
            }
            if width == 0 {
                return Ok(None);
            }
            if let Some((cached_instance, cached_sequence, frame)) = &self.cache {
                if (*cached_instance, *cached_sequence) == (instance, sequence) {
                    return Ok(Some(frame.clone()));
                }
            }
            let (width, height, stride) = (width as usize, height as usize, stride as usize);
            let size = stride * (height - 1) + width * 4;
            let Ok(data) = read_at(&mut file, HEADER_SIZE as u64, size) else { return Ok(None) };
            let Ok(again) = read_at(&mut file, 0, 24) else { return Ok(None) };
            if data.len() != size || again[..] != head[..24] {
                continue; // replaced while it was read
            }
            let Some(frame) = frame_from_pixels(width, height, stride, layout, &data) else {
                return Err(Failure::new("SharedWindowError", "Unsupported pixel layout in the shared window's frame"));
            };
            self.cache = Some((instance, sequence, frame.clone()));
            return Ok(Some(frame));
        }
        // The writer kept replacing the frame: the previous one of the same stream is
        // still a true picture.
        Ok(self.cache.as_ref().filter(|c| c.0 == instance).map(|c| c.2.clone()))
    }

    pub fn close(&mut self) {
        self.cache = None;
    }
}
