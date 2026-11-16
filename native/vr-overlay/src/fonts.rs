//! The subtitle fonts, grapheme boundaries and the measurement of a line (`overlay_fonts.py`).
//!
//! The Python sidecar shipped four Noto Sans CJK fonts (29.6 MB). The core does not bundle
//! fonts yet (see "判断が要ること" in `docs/voice-stack/core-integration.md`): it looks in the
//! folders it is given first (a bundle's `fonts`, the Python bundle's `_internal/fonts`), then
//! in the system's font folders, for the fonts below, and falls back per character to any font
//! there that has the glyph. A character no font has is left out of the picture.

use ab_glyph::{Font, FontVec, GlyphId, PxScale, ScaleFont, point};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use unicode_segmentation::UnicodeSegmentation;

use crate::canvas::{Canvas, Rgba};

pub const MAX_TEXT_CODEPOINTS: usize = 8192;
pub const MAX_CLUSTER_CODEPOINTS: usize = 128;
pub const MAX_LINE_CODEPOINTS: usize = 512;

/// The grapheme clusters of `text` (`regex`'s `\X`).
pub fn graphemes(text: &str) -> impl Iterator<Item = &str> {
    text.graphemes(true)
}

/// At most 8192 code points of whole clusters, newlines normalised, tabs as four spaces and
/// control characters left out (`bounded_text`). The flag says whether something was cut.
pub fn bounded_text(text: &str) -> (String, bool) {
    let count = text.chars().count();
    let mut clipped = count > MAX_TEXT_CODEPOINTS;
    let prefix: String = text.chars().take(MAX_TEXT_CODEPOINTS).collect();
    let mut clusters: Vec<&str> = graphemes(&prefix).collect();
    if clipped && !clusters.is_empty() {
        clusters.pop();
    }
    let mut safe = String::new();
    for cluster in clusters {
        if cluster.chars().count() > MAX_CLUSTER_CODEPOINTS {
            clipped = true;
            break;
        }
        safe.push_str(cluster);
    }
    let safe = safe.replace("\r\n", "\n").replace('\r', "\n").replace('\t', "    ");
    (safe.chars().filter(|c| *c == '\n' || !c.is_control()).collect(), clipped)
}

/// Latin letters and digits (Python: `"LATIN" in name(c)` or a number category).
fn latin_or_number(c: char) -> bool {
    let code = c as u32;
    c.is_numeric()
        || (c.is_alphabetic()
            && matches!(code, 0x41..=0x5A | 0x61..=0x7A | 0xAA | 0xBA | 0xC0..=0x24F | 0x1E00..=0x1EFF
                | 0x2C60..=0x2C7F | 0xA720..=0xA7FF | 0xAB30..=0xAB6F | 0xFF21..=0xFF3A | 0xFF41..=0xFF5A))
}

/// Latin words stay together when lines wrap; everything else wraps at any cluster
/// (`word_tokens`).
pub fn word_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    for cluster in graphemes(text) {
        let first = cluster.chars().next().unwrap_or(' ');
        if latin_or_number(first) || (!word.is_empty() && matches!(first, '\'' | '-' | '’')) {
            word.push_str(cluster);
        } else {
            if !word.is_empty() {
                tokens.push(std::mem::take(&mut word));
            }
            tokens.push(cluster.to_string());
        }
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    tokens
}

/// The languages the subtitles pick a font for (`OverlayImage.LANGUAGES`); any other language
/// uses the default (Japanese) font.
fn preferred(language: &str) -> &'static [(&'static str, u32)] {
    match language {
        "Korean" => &[
            ("notosanskr-regular.ttf", 0),
            ("notosanscjkkr-regular.otf", 0),
            ("notosanscjk-regular.ttc", 1),
            ("malgun.ttf", 0),
        ],
        "Chinese Simplified" => &[
            ("notosanssc-regular.ttf", 0),
            ("notosanscjksc-regular.otf", 0),
            ("notosanscjk-regular.ttc", 2),
            ("msyh.ttc", 0),
            ("simsun.ttc", 0),
        ],
        "Chinese Traditional" => &[
            ("notosanstc-regular.ttf", 0),
            ("notosanscjktc-regular.otf", 0),
            ("notosanscjk-regular.ttc", 3),
            ("msjh.ttc", 0),
            ("mingliu.ttc", 0),
        ],
        _ => &[
            ("notosansjp-regular.ttf", 0),
            ("notosanscjkjp-regular.otf", 0),
            ("notosanscjk-regular.ttc", 0),
            ("yugothm.ttc", 0),
            ("yugothr.ttc", 0),
            ("meiryo.ttc", 0),
            ("msgothic.ttc", 0),
            ("ipagp.ttf", 0),
            ("ipaexg.ttf", 0),
        ],
    }
}

/// Fonts tried after the language's own, before searching every font file.
const FALLBACKS: &[(&str, u32)] = &[
    ("notosansjp-regular.ttf", 0),
    ("notosanskr-regular.ttf", 0),
    ("notosanssc-regular.ttf", 0),
    ("notosanstc-regular.ttf", 0),
    ("notosanscjk-regular.ttc", 0),
    ("segoeui.ttf", 0),
    ("arial.ttf", 0),
    ("dejavusans.ttf", 0),
    ("notosans-regular.ttf", 0),
    ("liberationsans-regular.ttf", 0),
    ("seguisym.ttf", 0),
    ("seguiemj.ttf", 0),
    ("symbola.ttf", 0),
];

/// Where fonts are looked for, and the fonts loaded so far.
pub struct FontLibrary {
    folders: Vec<PathBuf>,
    files: OnceLock<HashMap<String, PathBuf>>,
    loaded: Mutex<HashMap<(PathBuf, u32), Option<Arc<FontVec>>>>,
    /// Every font file, for characters the named fonts lack; read on first need.
    every: OnceLock<Vec<PathBuf>>,
}

impl FontLibrary {
    /// `first` folders are searched before the system's.
    pub fn new(first: Vec<PathBuf>) -> Self {
        let mut folders = first;
        folders.extend(system_font_folders());
        Self { folders, files: OnceLock::new(), loaded: Mutex::new(HashMap::new()), every: OnceLock::new() }
    }

    /// Only the given folders (tests).
    pub fn only(folders: Vec<PathBuf>) -> Self {
        Self { folders, files: OnceLock::new(), loaded: Mutex::new(HashMap::new()), every: OnceLock::new() }
    }

    fn files(&self) -> &HashMap<String, PathBuf> {
        self.files.get_or_init(|| {
            let mut found = HashMap::new();
            for path in self.every().iter() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    found.entry(name.to_lowercase()).or_insert_with(|| path.clone());
                }
            }
            found
        })
    }

    fn every(&self) -> &Vec<PathBuf> {
        self.every.get_or_init(|| {
            let mut out = Vec::new();
            for folder in &self.folders {
                collect_fonts(folder, 0, &mut out);
            }
            out
        })
    }

    fn load(&self, path: &Path, index: u32) -> Option<Arc<FontVec>> {
        let key = (path.to_path_buf(), index);
        if let Some(found) = self.loaded.lock().unwrap().get(&key) {
            return found.clone();
        }
        let font = std::fs::read(path)
            .ok()
            .and_then(|data| FontVec::try_from_vec_and_index(data, index).ok())
            .map(Arc::new);
        self.loaded.lock().unwrap().insert(key, font.clone());
        font
    }

    fn named(&self, list: &[(&str, u32)]) -> Vec<Arc<FontVec>> {
        list.iter()
            .filter_map(|(name, index)| self.files().get(*name).and_then(|path| self.load(path, *index)))
            .collect()
    }

    /// The faces for a language: its own first, then the fallbacks.
    pub fn faces(&self, language: &str) -> Vec<Arc<FontVec>> {
        let mut faces = self.named(preferred(language));
        for face in self.named(FALLBACKS) {
            if !faces.iter().any(|f| Arc::ptr_eq(f, &face)) {
                faces.push(face);
            }
        }
        faces
    }

    /// Any font that has every character of `cluster` (searched in every font file).
    fn covering(&self, cluster: &str) -> Option<Arc<FontVec>> {
        for path in self.every().iter().take(400) {
            let lower = path.to_string_lossy().to_lowercase();
            if lower.contains("emoji") && lower.contains("color") {
                continue; // Bitmap colour emoji have no outlines to draw.
            }
            if let Some(face) = self.load(path, 0)
                && covers(&face, cluster)
            {
                return Some(face);
            }
        }
        None
    }

    /// Whether at least one font was found.
    pub fn any(&self) -> bool {
        !self.faces("Default").is_empty() || self.every().iter().any(|path| self.load(path, 0).is_some())
    }
}

fn collect_fonts(folder: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 4 || out.len() > 5000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(folder) else { return };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect_fonts(&path, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_lowercase().as_str(), "ttf" | "otf" | "ttc")) {
            out.push(path);
        }
    }
}

/// The system's font folders.
pub fn system_font_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if cfg!(windows) {
        folders.push(PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into())).join("Fonts"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            folders.push(PathBuf::from(local).join("Microsoft").join("Windows").join("Fonts"));
        }
    } else {
        if let Some(data) = std::env::var_os("XDG_DATA_HOME") {
            folders.push(PathBuf::from(data).join("fonts"));
        }
        if let Some(home) = std::env::var_os("HOME") {
            folders.push(PathBuf::from(&home).join(".local/share/fonts"));
            folders.push(PathBuf::from(&home).join(".fonts"));
        }
        folders.push(PathBuf::from("/usr/share/fonts"));
        folders.push(PathBuf::from("/usr/local/share/fonts"));
    }
    folders
}

fn covers(face: &FontVec, cluster: &str) -> bool {
    cluster.chars().all(|c| shaping_control(c) || face.glyph_id(c) != GlyphId(0))
}

/// Characters that need no glyph of their own (format characters and variation selectors).
fn shaping_control(c: char) -> bool {
    let code = c as u32;
    matches!(code, 0x200B..=0x200F | 0x2060..=0x2064 | 0xFE00..=0xFE0F | 0xFEFF | 0xE0100..=0xE01EF | 0xE0020..=0xE007F)
}

/// The fonts for one language and size (`FontSet`).
#[derive(Clone)]
pub struct FontSet {
    library: Arc<FontLibrary>,
    faces: Vec<Arc<FontVec>>,
    pub size: u32,
}

/// A line measured and ready to draw (`TextLine`).
#[derive(Clone)]
pub struct TextLine {
    runs: Vec<(Arc<FontVec>, String, f32)>,
    size: u32,
    pub left: i64,
    pub width: i64,
    pub top: i64,
    pub height: i64,
    pub ink_height: i64,
}

fn scale_of(face: &FontVec, size: u32) -> PxScale {
    let upem = face.units_per_em().unwrap_or(1000.0);
    PxScale::from(size as f32 * face.height_unscaled() / upem)
}

impl FontSet {
    pub fn new(library: Arc<FontLibrary>, language: &str, size: u32) -> Self {
        let faces = library.faces(language);
        Self { library, faces, size }
    }

    fn face_for(&self, cluster: &str) -> Option<Arc<FontVec>> {
        if let Some(face) = self.faces.iter().find(|face| covers(face, cluster)) {
            return Some(face.clone());
        }
        self.library.covering(cluster).or_else(|| self.faces.first().cloned())
    }

    /// Measures a line (`FontSet.layout`): runs of one face each, and the box of their ink
    /// and advances, the top above the baseline negative.
    pub fn layout(&self, text: &str) -> TextLine {
        let mut runs: Vec<(Arc<FontVec>, String, f32)> = Vec::new();
        for cluster in graphemes(text) {
            let Some(face) = self.face_for(cluster) else { continue };
            match runs.last_mut() {
                Some((last, run, _)) if Arc::ptr_eq(last, &face) => run.push_str(cluster),
                _ => runs.push((face, cluster.to_string(), 0.0)),
            }
        }
        let (mut cursor, mut left, mut right, mut top, mut bottom) = (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for (face, run, offset) in &mut runs {
            *offset = cursor;
            let scaled = face.as_scaled(scale_of(face, self.size));
            let mut x = 0.0f32;
            let mut previous: Option<GlyphId> = None;
            for c in run.chars() {
                let id = face.glyph_id(c);
                if let Some(previous) = previous {
                    x += scaled.kern(previous, id);
                }
                let glyph = id.with_scale_and_position(scaled.scale(), point(cursor + x, 0.0));
                if let Some(outline) = face.outline_glyph(glyph) {
                    let bounds = outline.px_bounds();
                    left = left.min(bounds.min.x);
                    right = right.max(bounds.max.x);
                    top = top.min(bounds.min.y);
                    bottom = bottom.max(bounds.max.y);
                }
                x += scaled.h_advance(id);
                previous = Some(id);
            }
            cursor += x;
            right = right.max(cursor);
        }
        let (left, right, top, bottom) = (left.floor() as i64, right.ceil() as i64, top.floor() as i64, bottom.ceil() as i64);
        TextLine {
            runs,
            size: self.size,
            left,
            width: right - left,
            top,
            height: i64::from(self.size).max(bottom - top),
            ink_height: bottom - top,
        }
    }
}

impl TextLine {
    /// Draws the line with its box's top left at (x, y) (`TextLine.draw`).
    pub fn draw(&self, canvas: &mut Canvas, x: f64, y: f64, color: [u8; 3]) {
        let baseline = y - self.top as f64 + ((self.height - self.ink_height) / 2) as f64;
        let ink: Rgba = [color[0], color[1], color[2], 255];
        for (face, run, offset) in &self.runs {
            let scaled = face.as_scaled(scale_of(face, self.size));
            let mut pen = x as f32 - self.left as f32 + offset;
            let mut previous: Option<GlyphId> = None;
            for c in run.chars() {
                let id = face.glyph_id(c);
                if let Some(previous) = previous {
                    pen += scaled.kern(previous, id);
                }
                let glyph = id.with_scale_and_position(scaled.scale(), point(pen, baseline as f32));
                if let Some(outline) = face.outline_glyph(glyph) {
                    let bounds = outline.px_bounds();
                    outline.draw(|gx, gy, coverage| {
                        canvas.blend(bounds.min.x as i64 + i64::from(gx), bounds.min.y as i64 + i64::from(gy), ink, coverage);
                    });
                }
                pen += scaled.h_advance(id);
                previous = Some(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_bounded_and_cleaned() {
        assert_eq!(bounded_text("a\r\nb\tc\u{7}"), ("a\nb    c".to_string(), false));
        let long = "あ".repeat(MAX_TEXT_CODEPOINTS + 5);
        let (text, clipped) = bounded_text(&long);
        assert!(clipped);
        assert!(text.chars().count() < MAX_TEXT_CODEPOINTS);
    }

    #[test]
    fn latin_words_stay_together() {
        assert_eq!(word_tokens("Hello world"), ["Hello", " ", "world"]);
        assert_eq!(word_tokens("こんにちは"), ["こ", "ん", "に", "ち", "は"]);
        assert_eq!(word_tokens("don't 2nd"), ["don't", " ", "2nd"]);
    }

    #[test]
    fn a_missing_font_folder_draws_nothing_and_does_not_fail() {
        let library = Arc::new(FontLibrary::only(vec![PathBuf::from("does-not-exist")]));
        let set = FontSet::new(library, "Japanese", 30);
        let line = set.layout("abc");
        assert_eq!(line.width, 0);
        assert_eq!(line.height, 30);
    }
}
