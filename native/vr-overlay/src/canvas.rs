//! An RGBA picture with the few drawing operations the subtitles use (Pillow's `Image.new`,
//! `paste`, `alpha_composite` and `rounded_rectangle`). Colours are straight (not premultiplied)
//! alpha, as Pillow's RGBA.

pub type Rgba = [u8; 4];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    /// Row-major RGBA, top row first.
    pub pixels: Vec<u8>,
}

impl Canvas {
    pub fn new(width: u32, height: u32, color: Rgba) -> Self {
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..width as usize * height as usize {
            pixels.extend_from_slice(&color);
        }
        Self { width, height, pixels }
    }

    pub fn transparent(width: u32, height: u32) -> Self {
        Self::new(width, height, [0, 0, 0, 0])
    }

    fn index(&self, x: u32, y: u32) -> usize {
        (y as usize * self.width as usize + x as usize) * 4
    }

    pub fn pixel(&self, x: u32, y: u32) -> Rgba {
        let i = self.index(x, y);
        [self.pixels[i], self.pixels[i + 1], self.pixels[i + 2], self.pixels[i + 3]]
    }

    /// Copies `source` with its top left at (x, y), replacing what was there (`Image.paste`).
    pub fn paste(&mut self, source: &Canvas, x: i64, y: i64) {
        for row in 0..source.height {
            let ty = y + i64::from(row);
            if ty < 0 || ty >= i64::from(self.height) {
                continue;
            }
            for column in 0..source.width {
                let tx = x + i64::from(column);
                if tx < 0 || tx >= i64::from(self.width) {
                    continue;
                }
                let from = source.index(column, row);
                let to = self.index(tx as u32, ty as u32);
                self.pixels[to..to + 4].copy_from_slice(&source.pixels[from..from + 4]);
            }
        }
    }

    /// Blends `color` over the pixel with `coverage` (0 to 1) of its alpha.
    pub fn blend(&mut self, x: i64, y: i64, color: Rgba, coverage: f32) {
        if x < 0 || y < 0 || x >= i64::from(self.width) || y >= i64::from(self.height) || coverage <= 0.0 {
            return;
        }
        let i = self.index(x as u32, y as u32);
        let source = [color[0], color[1], color[2], (f32::from(color[3]) * coverage.min(1.0)).round() as u8];
        let blended = over(source, [self.pixels[i], self.pixels[i + 1], self.pixels[i + 2], self.pixels[i + 3]]);
        self.pixels[i..i + 4].copy_from_slice(&blended);
    }

    /// `Image.alpha_composite(self, top)`: `top` (the same size) over this picture.
    pub fn composite(&mut self, top: &Canvas) {
        debug_assert_eq!((self.width, self.height), (top.width, top.height));
        for (bottom, top) in self.pixels.chunks_exact_mut(4).zip(top.pixels.chunks_exact(4)) {
            let result = over([top[0], top[1], top[2], top[3]], [bottom[0], bottom[1], bottom[2], bottom[3]]);
            bottom.copy_from_slice(&result);
        }
    }

    /// Fills the rounded rectangle from (x0, y0) to (x1, y1), both included, as Pillow does for
    /// `rounded_rectangle((x0, y0, x1, y1), radius, fill)`.
    pub fn rounded_rectangle(&mut self, x0: i64, y0: i64, x1: i64, y1: i64, radius: i64, color: Rgba) {
        for y in y0.max(0)..=y1.min(i64::from(self.height) - 1) {
            for x in x0.max(0)..=x1.min(i64::from(self.width) - 1) {
                if inside_rounded(x, y, (x0, y0, x1, y1), radius) {
                    let i = self.index(x as u32, y as u32);
                    self.pixels[i..i + 4].copy_from_slice(&color);
                }
            }
        }
    }

    /// Whether any pixel has some alpha.
    pub fn has_ink(&self) -> bool {
        self.pixels.chunks_exact(4).any(|p| p[3] > 0)
    }
}

/// Whether pixel (x, y) is inside a rounded rectangle with included corners `rect`.
pub fn inside_rounded(x: i64, y: i64, rect: (i64, i64, i64, i64), radius: i64) -> bool {
    let (x0, y0, x1, y1) = rect;
    if x < x0 || x > x1 || y < y0 || y > y1 {
        return false;
    }
    let radius = radius.min((x1 - x0 + 1) / 2).min((y1 - y0 + 1) / 2).max(0);
    if radius == 0 {
        return true;
    }
    let cx = if x < x0 + radius { x0 + radius } else if x > x1 - radius { x1 - radius } else { return true };
    let cy = if y < y0 + radius { y0 + radius } else if y > y1 - radius { y1 - radius } else { return true };
    let (dx, dy) = ((x - cx) as f64, (y - cy) as f64);
    dx * dx + dy * dy <= (radius as f64 + 0.5) * (radius as f64 + 0.5)
}

/// Straight-alpha "over".
fn over(top: Rgba, bottom: Rgba) -> Rgba {
    let ta = f32::from(top[3]) / 255.0;
    let ba = f32::from(bottom[3]) / 255.0;
    let out = ta + ba * (1.0 - ta);
    if out <= 0.0 {
        return [0, 0, 0, 0];
    }
    let channel = |t: u8, b: u8| ((f32::from(t) * ta + f32::from(b) * ba * (1.0 - ta)) / out).round().clamp(0.0, 255.0) as u8;
    [channel(top[0], bottom[0]), channel(top[1], bottom[1]), channel(top[2], bottom[2]), (out * 255.0).round() as u8]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composite_and_paste() {
        let mut bottom = Canvas::new(2, 1, [10, 20, 30, 255]);
        let mut top = Canvas::transparent(2, 1);
        top.blend(1, 0, [255, 255, 255, 255], 1.0);
        bottom.composite(&top);
        assert_eq!(bottom.pixel(0, 0), [10, 20, 30, 255]);
        assert_eq!(bottom.pixel(1, 0), [255, 255, 255, 255]);
        let mut target = Canvas::transparent(3, 3);
        target.paste(&bottom, 1, 2);
        assert_eq!(target.pixel(1, 2), [10, 20, 30, 255]);
        assert_eq!(target.pixel(0, 0), [0, 0, 0, 0]);
    }

    #[test]
    fn rounded_corners_stay_clear() {
        let mut canvas = Canvas::transparent(100, 60);
        canvas.rounded_rectangle(0, 0, 99, 59, 20, [1, 2, 3, 255]);
        assert_eq!(canvas.pixel(0, 0)[3], 0, "the corner is cut");
        assert_eq!(canvas.pixel(50, 0)[3], 255, "the edge is filled");
        assert_eq!(canvas.pixel(50, 30)[3], 255);
    }
}
