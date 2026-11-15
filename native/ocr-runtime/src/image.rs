//! 8-bit BGR pictures (the channel order every capture path and OpenCV use).

use std::path::Path;

use crate::error::{Error, Result};

/// An interleaved 8-bit BGR picture, rows packed without padding.
#[derive(Clone, PartialEq, Eq)]
pub struct BgrImage {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl std::fmt::Debug for BgrImage {
    // Never print pixels.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "BgrImage({}x{})", self.width, self.height)
    }
}

impl BgrImage {
    pub fn new(width: usize, height: usize, data: Vec<u8>) -> Result<Self> {
        if data.len() != width * height * 3 {
            return Err(Error::invalid("pixel buffer does not match the picture size"));
        }
        Ok(BgrImage { width, height, data })
    }

    pub fn filled(width: usize, height: usize, value: u8) -> Self {
        BgrImage { width, height, data: vec![value; width * height * 3] }
    }

    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }

    pub fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
        let i = (y * self.width + x) * 3;
        [self.data[i], self.data[i + 1], self.data[i + 2]]
    }

    /// The part `[x, x + w) × [y, y + h)`, clipped to the picture.
    pub fn crop(&self, x: usize, y: usize, w: usize, h: usize) -> BgrImage {
        let x1 = (x + w).min(self.width);
        let y1 = (y + h).min(self.height);
        let (x0, y0) = (x.min(x1), y.min(y1));
        let (cw, ch) = (x1 - x0, y1 - y0);
        let mut data = Vec::with_capacity(cw * ch * 3);
        for row in y0..y1 {
            let start = (row * self.width + x0) * 3;
            data.extend_from_slice(&self.data[start..start + cw * 3]);
        }
        BgrImage { width: cw, height: ch, data }
    }

    /// Black rows added above and below (`cv2.copyMakeBorder` with a constant zero).
    pub fn pad_vertical(&self, top: usize, bottom: usize) -> BgrImage {
        let mut data = vec![0u8; self.width * 3 * top];
        data.extend_from_slice(&self.data);
        data.resize(data.len() + self.width * 3 * bottom, 0);
        BgrImage { width: self.width, height: self.height + top + bottom, data }
    }

    /// `np.rot90`: a quarter turn counter-clockwise.
    pub fn rot90(&self) -> BgrImage {
        let (w, h) = (self.height, self.width);
        let mut data = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                // out[y][x] = in[x][W_in - 1 - y]
                let src = (x * self.width + (self.width - 1 - y)) * 3;
                let dst = (y * w + x) * 3;
                data[dst..dst + 3].copy_from_slice(&self.data[src..src + 3]);
            }
        }
        BgrImage { width: w, height: h, data }
    }

    pub fn resize(&self, width: usize, height: usize, interpolation: crate::cv::Interpolation) -> BgrImage {
        let data = crate::cv::resize(&self.data, self.width, self.height, 3, width, height, interpolation);
        BgrImage { width, height, data }
    }

    /// Read a PNG file (8-bit grey, grey + alpha, RGB or RGBA; alpha is dropped) as BGR.
    pub fn read_png(path: &Path) -> Result<BgrImage> {
        let file = std::fs::File::open(path)?;
        let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| Error::format("PNG", e))?;
        let mut buffer = vec![0u8; reader.output_buffer_size().ok_or_else(|| Error::format("PNG", "picture too large"))?];
        let info = reader.next_frame(&mut buffer).map_err(|e| Error::format("PNG", e))?;
        let (width, height) = (info.width as usize, info.height as usize);
        let channels = match info.color_type {
            png::ColorType::Grayscale => 1,
            png::ColorType::GrayscaleAlpha => 2,
            png::ColorType::Rgb => 3,
            png::ColorType::Rgba => 4,
            png::ColorType::Indexed => return Err(Error::unsupported("PNG", "indexed colour after expansion")),
        };
        let mut data = Vec::with_capacity(width * height * 3);
        for row in 0..height {
            let line = &buffer[row * info.line_size..row * info.line_size + width * channels];
            for px in line.chunks_exact(channels) {
                match channels {
                    1 | 2 => data.extend_from_slice(&[px[0], px[0], px[0]]),
                    _ => data.extend_from_slice(&[px[2], px[1], px[0]]),
                }
            }
        }
        BgrImage::new(width, height, data)
    }
}
