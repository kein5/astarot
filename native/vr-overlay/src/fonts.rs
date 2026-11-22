//! The subtitle fonts, grapheme boundaries and the measurement of a line ([`overlay_fonts.py`]).
//!
//! The Python sidecar shipped four Noto Sans CJK fonts (29.6 MB). The core bundles none: the
//! subtitles use the fonts on the user's system. The family chosen in the settings
//! (`OVERLAY_FONT_FAMILY`) is drawn first; each character it lacks falls back to the language's
//! usual system family (Yu Gothic UI and Meiryo or Noto Sans CJK JP for Japanese, Malgun Gothic or
//! Noto Sans CJK KR for Korean, and so on, Segoe UI or Noto Sans for Latin), then to any font
//! that has the glyph. Families are found by the names in the fonts' `name` tables, as the app's
//! font list (font-kit) names them. A character no font has is left out of the picture;
//! [`FontLibrary::missing_languages`] tells which scripts that would hit.
//!
//! [`overlay_fonts.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_fonts.py

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

/// The font families tried first for a language, from the fonts Windows and common Linux
/// systems carry: Japanese (also for times, samples and languages without a list), Korean,
/// Simplified and Traditional Chinese, and Latin for every other language.
fn language_families(language: &str) -> &'static [&'static str] {
    match language {
        "Korean" => &["Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", "Source Han Sans K", "NanumGothic"],
        "Chinese Simplified" => {
            &["Microsoft YaHei", "Microsoft YaHei UI", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "SimSun"]
        }
        "Chinese Traditional" => {
            &["Microsoft JhengHei", "Microsoft JhengHei UI", "Noto Sans CJK TC", "Noto Sans TC", "Source Han Sans TC", "MingLiU"]
        }
        "Latin" => &["Segoe UI", "Noto Sans", "DejaVu Sans", "Arial", "Liberation Sans"],
        _ => &["Yu Gothic UI", "Meiryo", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", "Source Han Sans", "IPAexGothic", "IPAPGothic", "MS Gothic"],
    }
}

/// Families tried after the language's own, before searching every font file.
const FALLBACKS: &[&str] = &[
    "Segoe UI",
    "Noto Sans",
    "DejaVu Sans",
    "Arial",
    "Liberation Sans",
    "Yu Gothic UI",
    "Meiryo",
    "Noto Sans CJK JP",
    "Noto Sans JP",
    "Malgun Gothic",
    "Noto Sans CJK KR",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "Microsoft JhengHei",
    "Noto Sans CJK TC",
    "Segoe UI Symbol",
    "Noto Sans Symbols",
    "Noto Sans Symbols 2",
    "Symbola",
];

/// The scripts the subtitles must be able to draw, with a character of each: when no font on
/// this system has it, the settings say so ([`FontLibrary::missing_languages`]).
pub const CHECKED_LANGUAGES: [(&str, &str); 4] = [("Japanese", "あ漢"), ("Korean", "한"), ("Chinese Simplified", "汉"), ("Chinese Traditional", "漢")];

/// The longest font family name taken from the settings.
pub const MAX_FAMILY_CHARS: usize = 256;

/// A face of a family: the file, its index in a collection, and whether it is the family's
/// regular style.
#[derive(Clone, Debug)]
struct FaceEntry {
    path: PathBuf,
    index: u32,
    regular: bool,
}

/// Where fonts are looked for, and the fonts loaded so far. No font is bundled with the app:
/// the system's fonts are used, the family chosen in the settings first.
pub struct FontLibrary {
    folders: Vec<PathBuf>,
    /// Lower-case family name to its faces, from the fonts' name tables; read on first need.
    families: OnceLock<HashMap<String, Vec<FaceEntry>>>,
    loaded: Mutex<HashMap<(PathBuf, u32), Option<Arc<FontVec>>>>,
    /// Every font file, for characters the named fonts lack; read on first need.
    every: OnceLock<Vec<PathBuf>>,
    /// The family chosen in the settings (`OVERLAY_FONT_FAMILY`); `None` is automatic.
    chosen: Mutex<Option<String>>,
}

impl FontLibrary {
    /// The system's fonts, with `first` folders searched before the system's.
    pub fn new(first: Vec<PathBuf>) -> Self {
        let mut folders = first;
        folders.extend(system_font_folders());
        Self::only(folders)
    }

    /// Only the given folders (tests).
    pub fn only(folders: Vec<PathBuf>) -> Self {
        Self { folders, families: OnceLock::new(), loaded: Mutex::new(HashMap::new()), every: OnceLock::new(), chosen: Mutex::new(None) }
    }

    fn families(&self) -> &HashMap<String, Vec<FaceEntry>> {
        self.families.get_or_init(|| {
            let mut found: HashMap<String, Vec<FaceEntry>> = HashMap::new();
            for path in self.every().iter() {
                for (index, names) in names::read(path).into_iter().enumerate() {
                    for (family, regular) in names.families() {
                        let entry = FaceEntry { path: path.clone(), index: index as u32, regular };
                        found.entry(family.to_lowercase()).or_default().push(entry);
                    }
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
        // Held while the file is read, so that a font is read once: the fonts read ahead of the
        // first picture (on a thread of their own) and the first picture would otherwise read
        // the same files side by side, which doubled the wait on a cold Windows runner (#861).
        let mut loaded = self.loaded.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(found) = loaded.get(&key) {
            return found.clone();
        }
        let font = std::fs::read(path)
            .ok()
            .and_then(|data| FontVec::try_from_vec_and_index(data, index).ok())
            .map(Arc::new);
        loaded.insert(key, font.clone());
        font
    }

    /// The regular face of a family (the first face when none says it is regular).
    fn family_face(&self, family: &str) -> Option<Arc<FontVec>> {
        let faces = self.families().get(&family.to_lowercase())?;
        faces
            .iter()
            .filter(|f| f.regular)
            .chain(faces.iter().filter(|f| !f.regular))
            .find_map(|face| self.load(&face.path, face.index))
    }

    fn named(&self, families: &[&str]) -> Vec<Arc<FontVec>> {
        families.iter().filter_map(|family| self.family_face(family)).collect()
    }

    /// Whether a family by this name is on the system (any language's name in the font counts).
    pub fn has_family(&self, family: &str) -> bool {
        self.families().contains_key(&family.to_lowercase())
    }

    /// The family names found, sorted (each once, as the first file spells it in English).
    pub fn family_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.every().iter().flat_map(|path| names::read(path)).filter_map(|n| n.display_family()).collect();
        names.sort_by_key(|n| n.to_lowercase());
        names.dedup_by_key(|n| n.to_lowercase());
        names
    }

    /// Chooses the family drawn first; `None` (or an empty name) goes back to automatic.
    pub fn set_family(&self, family: Option<&str>) {
        *self.chosen.lock().unwrap() = family.map(str::trim).filter(|f| !f.is_empty()).map(str::to_string);
    }

    pub fn family(&self) -> Option<String> {
        self.chosen.lock().unwrap().clone()
    }

    /// The faces for a language: the chosen family, the language's own, then the fallbacks.
    pub fn faces(&self, language: &str) -> Vec<Arc<FontVec>> {
        let mut faces: Vec<Arc<FontVec>> = self.family().and_then(|family| self.family_face(&family)).into_iter().collect();
        for face in self.named(language_families(language)).into_iter().chain(self.named(FALLBACKS)) {
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

    /// The languages of [`CHECKED_LANGUAGES`] no font here can draw: their text would be left
    /// out of the subtitles (on Linux without CJK fonts, for one).
    pub fn missing_languages(&self) -> Vec<&'static str> {
        CHECKED_LANGUAGES
            .iter()
            .filter(|(language, sample)| {
                let faces = self.faces(language);
                !graphemes(sample).all(|c| faces.iter().any(|f| covers(f, c)) || self.covering(c).is_some())
            })
            .map(|(language, _)| *language)
            .collect()
    }
}

/// Whether a font family name from the settings is well-formed: not blank, at most
/// [`MAX_FAMILY_CHARS`] characters, no control characters.
pub fn valid_family_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= MAX_FAMILY_CHARS && !name.chars().any(char::is_control)
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

/// The system's font folders: Windows' own and the user's; on Linux the folders fontconfig
/// reads by default (fontconfig itself is not called).
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

/// The names in a font file's `name` table, read without loading the whole file.
mod names {
    use std::fs::File;
    use std::io::{Read, Seek, SeekFrom};
    use std::path::Path;

    const MAX_FACES: u32 = 64;
    const MAX_TABLES: u16 = 512;
    const MAX_NAME_TABLE: u32 = 1 << 20;

    /// One face's names: (name ID, is English, text).
    #[derive(Default, Debug)]
    pub struct Names(Vec<(u16, bool, String)>);

    impl Names {
        fn all(&self, id: u16) -> impl Iterator<Item = &str> {
            self.0.iter().filter(move |(i, _, _)| *i == id).map(|(_, _, text)| text.as_str())
        }

        /// Each family name with whether this face is its regular style. The typographic (16,
        /// 17), WWS (21, 22) and legacy (1, 2) names all count, in every language.
        pub fn families(&self) -> Vec<(String, bool)> {
            let mut out = Vec::new();
            for (family, style) in [(16, 17), (21, 22), (1, 2)] {
                let styles: Vec<&str> = if self.all(style).next().is_some() { self.all(style).collect() } else { self.all(2).collect() };
                let regular = styles.iter().any(|s| matches!(s.trim().to_lowercase().as_str(), "regular" | "normal" | "book" | "roman" | "standard"));
                for name in self.all(family) {
                    if !out.iter().any(|(n, _): &(String, bool)| n.eq_ignore_ascii_case(name)) {
                        out.push((name.to_string(), regular));
                    }
                }
            }
            out
        }

        /// The family name to show: the typographic one, else the legacy one, in English first.
        pub fn display_family(&self) -> Option<String> {
            for id in [16, 1] {
                let english = self.0.iter().find(|(i, en, _)| *i == id && *en).map(|(_, _, t)| t.clone());
                if let Some(name) = english.or_else(|| self.all(id).next().map(str::to_string)) {
                    return Some(name);
                }
            }
            None
        }
    }

    fn u16_at(data: &[u8], at: usize) -> Option<u16> {
        Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
    }

    fn u32_at(data: &[u8], at: usize) -> Option<u32> {
        Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
    }

    fn read_at(file: &mut File, offset: u64, length: usize) -> Option<Vec<u8>> {
        let mut data = vec![0u8; length];
        file.seek(SeekFrom::Start(offset)).ok()?;
        file.read_exact(&mut data).ok()?;
        Some(data)
    }

    /// The names of each face in the file (one for a plain font, several for a collection).
    /// A file that cannot be read gives none.
    pub fn read(path: &Path) -> Vec<Names> {
        let Ok(mut file) = File::open(path) else { return Vec::new() };
        let Some(head) = read_at(&mut file, 0, 12) else { return Vec::new() };
        let offsets: Vec<u32> = if &head[..4] == b"ttcf" {
            let count = u32_at(&head, 8).unwrap_or(0).min(MAX_FACES);
            match read_at(&mut file, 12, count as usize * 4) {
                Some(table) => (0..count as usize).filter_map(|i| u32_at(&table, i * 4)).collect(),
                None => Vec::new(),
            }
        } else {
            vec![0]
        };
        offsets.into_iter().map(|offset| face_names(&mut file, u64::from(offset)).unwrap_or_default()).collect()
    }

    fn face_names(file: &mut File, offset: u64) -> Option<Names> {
        let head = read_at(file, offset, 12)?;
        let tables = u16_at(&head, 4)?.min(MAX_TABLES);
        let records = read_at(file, offset + 12, usize::from(tables) * 16)?;
        let (name_offset, name_length) = (0..usize::from(tables))
            .map(|i| i * 16)
            .find(|at| &records[*at..*at + 4] == b"name")
            .and_then(|at| Some((u32_at(&records, at + 8)?, u32_at(&records, at + 12)?)))?;
        let table = read_at(file, u64::from(name_offset), name_length.min(MAX_NAME_TABLE) as usize)?;
        let count = u16_at(&table, 2)?;
        let strings = usize::from(u16_at(&table, 4)?);
        let mut names = Names::default();
        for i in 0..usize::from(count) {
            let at = 6 + i * 12;
            let (platform, encoding, language, id) = (u16_at(&table, at)?, u16_at(&table, at + 2)?, u16_at(&table, at + 4)?, u16_at(&table, at + 6)?);
            if !matches!(id, 1 | 2 | 16 | 17 | 21 | 22) {
                continue;
            }
            let (length, start) = (usize::from(u16_at(&table, at + 8)?), usize::from(u16_at(&table, at + 10)?));
            let Some(bytes) = table.get(strings + start..strings + start + length) else { continue };
            let text = match (platform, encoding) {
                (0, _) | (3, 0 | 1 | 10) => {
                    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                    String::from_utf16_lossy(&units)
                }
                (1, 0) => bytes.iter().map(|b| if b.is_ascii() { char::from(*b) } else { '?' }).collect(),
                _ => continue,
            };
            let text = text.trim_matches(char::from(0)).trim().to_string();
            if text.is_empty() {
                continue;
            }
            let english = matches!((platform, language), (3, 0x0409) | (1, 0) | (0, _));
            names.0.push((id, english, text));
        }
        Some(names)
    }
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

    /// A font file with only a `name` table: (name ID, platform, language, text) records.
    fn name_only_font(records: &[(u16, u16, u16, &str)]) -> Vec<u8> {
        let mut strings = Vec::new();
        let mut table = Vec::new();
        table.extend_from_slice(&0u16.to_be_bytes());
        table.extend_from_slice(&(records.len() as u16).to_be_bytes());
        table.extend_from_slice(&((6 + 12 * records.len()) as u16).to_be_bytes());
        for (id, platform, language, text) in records {
            let bytes: Vec<u8> = text.encode_utf16().flat_map(u16::to_be_bytes).collect();
            let encoding: u16 = if *platform == 3 { 1 } else { 0 };
            for value in [*platform, encoding, *language, *id, bytes.len() as u16, strings.len() as u16] {
                table.extend_from_slice(&value.to_be_bytes());
            }
            strings.extend(bytes);
        }
        table.extend(strings);
        let mut file = Vec::new();
        file.extend_from_slice(&0x0001_0000u32.to_be_bytes());
        file.extend_from_slice(&1u16.to_be_bytes());
        file.extend_from_slice(&[0; 6]);
        file.extend_from_slice(b"name");
        file.extend_from_slice(&0u32.to_be_bytes());
        file.extend_from_slice(&28u32.to_be_bytes());
        file.extend_from_slice(&(table.len() as u32).to_be_bytes());
        file.extend(table);
        file
    }

    #[test]
    fn families_are_found_by_any_of_their_names() {
        let folder = std::env::temp_dir().join(format!("vrct-fonts-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let regular = name_only_font(&[(1, 3, 0x409, "Example Sans"), (2, 3, 0x409, "Regular"), (1, 3, 0x411, "例ゴシック")]);
        let bold = name_only_font(&[(1, 3, 0x409, "Example Sans Bold"), (2, 3, 0x409, "Regular"), (16, 3, 0x409, "Example Sans"), (17, 3, 0x409, "Bold")]);
        std::fs::write(folder.join("example-regular.ttf"), regular).unwrap();
        std::fs::write(folder.join("example-bold.ttf"), bold).unwrap();
        let library = FontLibrary::only(vec![folder.clone()]);
        assert!(library.has_family("Example Sans"));
        assert!(library.has_family("example sans"), "any case");
        assert!(library.has_family("例ゴシック"), "a localised name");
        assert!(library.has_family("Example Sans Bold"), "the legacy name of a style");
        assert!(!library.has_family("Missing Sans"));
        let faces = &library.families()["example sans"];
        let regular = faces.iter().find(|f| f.regular).unwrap();
        assert!(regular.path.ends_with("example-regular.ttf"), "the regular face comes first");
        assert_eq!(library.family_names(), ["Example Sans"]);
        library.set_family(Some("  "));
        assert_eq!(library.family(), None, "blank is automatic");
        library.set_family(Some("Example Sans"));
        assert_eq!(library.family().as_deref(), Some("Example Sans"));
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn family_names_from_the_settings_are_checked() {
        assert!(valid_family_name("Yu Gothic UI"));
        assert!(valid_family_name("游ゴシック"));
        assert!(!valid_family_name("   "));
        assert!(!valid_family_name("a\nb"));
        assert!(!valid_family_name(&"x".repeat(MAX_FAMILY_CHARS + 1)));
    }

    #[test]
    fn without_fonts_every_checked_language_is_missing() {
        let library = FontLibrary::only(vec![PathBuf::from("does-not-exist")]);
        assert_eq!(library.missing_languages(), ["Japanese", "Korean", "Chinese Simplified", "Chinese Traditional"]);
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
