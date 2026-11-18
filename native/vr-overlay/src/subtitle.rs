//! The pictures of the small and the large log (`overlay_image.py`).
//!
//! The small log shows the last message alone, centred, 3840 px wide. The large log keeps the
//! last five messages (and the realtime captions still being recognised) as a chat, 960 px wide,
//! sent ones on the right and received ones on the left. Readings (hiragana and romaji) go
//! above the words they belong to. Limits as `docs/spec/overlay-subtitle-rendering.md`.

use crate::canvas::{Canvas, Rgba};
use crate::fonts::{FontLibrary, FontSet, MAX_LINE_CODEPOINTS, MAX_TEXT_CODEPOINTS, TextLine, bounded_text, graphemes, word_tokens};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub const MAX_SUBTITLE_LINES: usize = 24;
pub const MAX_SUBTITLE_WIDTH: u32 = 4096;
pub const MAX_SUBTITLE_HEIGHT: u32 = 2048;
pub const MAX_SUBTITLE_PIXELS: u64 = 4_194_304;
const SUBTITLE_PADDING_RESERVE: i64 = 100;

const SMALL_WIDTH: i64 = 3840;
const SMALL_HEIGHT: i64 = 92;
const SMALL_FONT: u32 = 92;
const BACKGROUND: [u8; 3] = [41, 42, 45];
const TEXT: [u8; 3] = [223, 223, 223];
const LARGE_WIDTH: i64 = 960;
const LARGE_FONT: u32 = 30;
const LARGE_FONT_SMALL: u32 = 20;
const LARGE_MARGIN: i64 = 25;
const LARGE_RADIUS: i64 = 25;
const LARGE_PADDING: i64 = 10;
const LARGE_CLAUSE_MARGIN: i64 = 20;
const TEXT_SMALL: [u8; 3] = [190, 190, 190];
const TEXT_SEND: [u8; 3] = [97, 151, 180];
const TEXT_RECEIVE: [u8; 3] = [168, 97, 180];
const TEXT_TIME: [u8; 3] = [120, 120, 120];
const RUBY_SCALE: f64 = 0.5;
const RUBY_SPACING: i64 = 4;

/// A picture over the raster budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TooLarge;

/// One reading of a word: the word as written, in hiragana and in romaji (Hepburn).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reading {
    pub orig: String,
    pub hira: String,
    pub hepburn: String,
}

impl Reading {
    /// The readings of a message as the transliteration sends them (a list of objects);
    /// anything else is no reading.
    pub fn list(value: &Value) -> Vec<Reading> {
        value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|item| {
                        let text = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
                        Reading { orig: text("orig"), hira: text("hira"), hepburn: text("hepburn") }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Whether a message was sent (shown on the right) or received.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Send,
    Receive,
}

impl Direction {
    fn color(self) -> [u8; 3] {
        match self {
            Self::Send => TEXT_SEND,
            Self::Receive => TEXT_RECEIVE,
        }
    }
}

/// A picture with the rows it is made of (`subtitle_rows`, `subtitle_clipped`).
#[derive(Clone, Debug)]
pub struct Block {
    pub canvas: Canvas,
    pub rows: Vec<(i64, i64)>,
    pub clipped: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Align {
    Left,
    Right,
    Center,
}

struct Cell {
    orig: TextLine,
    hira: Option<TextLine>,
    romaji: Option<TextLine>,
    width: i64,
}

struct Row {
    cells: Vec<Cell>,
    color: [u8; 3],
    align: Align,
    padding: i64,
    romaji_height: i64,
    hira_height: i64,
    ruby_spacing: i64,
    original_spacing: i64,
    height: i64,
    width: i64,
}

fn row(cells: Vec<Cell>, color: [u8; 3], align: Align, padding: i64, ruby_spacing: i64, original_spacing: i64, extra: i64) -> Row {
    let romaji_height = cells.iter().filter_map(|c| c.romaji.as_ref()).map(|l| l.height).max().unwrap_or(0);
    let hira_height = cells.iter().filter_map(|c| c.hira.as_ref()).map(|l| l.height).max().unwrap_or(0);
    let orig_height = cells.iter().map(|c| c.orig.height).max().unwrap_or(1);
    let ruby_height = romaji_height + hira_height + if romaji_height > 0 && hira_height > 0 { ruby_spacing } else { 0 };
    let width = cells.iter().map(|c| c.width).sum();
    Row {
        cells,
        color,
        align,
        padding,
        romaji_height,
        hira_height,
        ruby_spacing,
        original_spacing,
        height: padding * 2 + ruby_height + original_spacing + orig_height + extra,
        width,
    }
}

pub fn validate_texture_size(width: i64, height: i64) -> Result<(), TooLarge> {
    if width <= 0 || width > i64::from(MAX_SUBTITLE_WIDTH) || height <= 0 || height > i64::from(MAX_SUBTITLE_HEIGHT)
        || (width * height) as u64 > MAX_SUBTITLE_PIXELS
    {
        return Err(TooLarge);
    }
    Ok(())
}

fn content_height(width: i64) -> i64 {
    (i64::from(MAX_SUBTITLE_HEIGHT)).min(MAX_SUBTITLE_PIXELS as i64 / (width + SUBTITLE_PADDING_RESERVE)) - SUBTITLE_PADDING_RESERVE
}

fn new_image(width: i64, height: i64, color: Rgba) -> Result<Canvas, TooLarge> {
    validate_texture_size(width, height)?;
    Ok(Canvas::new(width as u32, height as u32, color))
}

fn ruby_size(font_size: u32, scale: f64) -> u32 {
    if scale.is_finite() { ((f64::from(font_size) * scale) as i64).clamp(1, 128) as u32 } else { (font_size / 2).max(1) }
}

/// Draws the subtitle pictures. Cheap to share; the fonts are loaded once.
pub struct Renderer {
    library: Arc<FontLibrary>,
    sets: Mutex<VecDeque<((String, u32), FontSet)>>,
}

/// The font group of a language: Japanese (also the times, the samples and no language), the
/// three other CJK languages, and Latin for the rest.
fn family(language: &str) -> &str {
    match language {
        "Korean" | "Chinese Simplified" | "Chinese Traditional" => language,
        "Default" | "Japanese" | "" => "Default",
        _ => "Latin",
    }
}

impl Renderer {
    pub fn new(library: Arc<FontLibrary>) -> Self {
        Self { library, sets: Mutex::new(VecDeque::new()) }
    }

    pub fn library(&self) -> &Arc<FontLibrary> {
        &self.library
    }

    /// The family drawn first from now on (`None`: automatic); later pictures use it.
    pub fn set_font_family(&self, family: Option<&str>) {
        self.library.set_family(family);
        self.sets.lock().unwrap().clear();
    }

    fn fonts(&self, language: &str, size: u32) -> FontSet {
        let key = (family(language).to_string(), size.clamp(1, 128));
        let mut sets = self.sets.lock().unwrap();
        if let Some((_, set)) = sets.iter().find(|(k, _)| *k == key) {
            return set.clone();
        }
        if sets.len() >= 32 {
            sets.pop_front();
        }
        let set = FontSet::new(Arc::clone(&self.library), &key.0, key.1);
        sets.push_back((key, set.clone()));
        set
    }

    fn wrap(&self, text: &str, fonts: &FontSet, width: i64) -> (Vec<String>, bool) {
        let (text, clipped) = bounded_text(text);
        let mut lines: Vec<String> = Vec::new();
        let existing: Vec<&str> = text.split('\n').collect();
        let fits = |candidate: &str| candidate.chars().count() <= MAX_LINE_CODEPOINTS && fonts.layout(candidate).width <= width;
        for (line_index, line) in existing.iter().enumerate() {
            let mut current = String::new();
            for token in word_tokens(line) {
                let candidate = format!("{current}{token}");
                if fits(&candidate) {
                    current = candidate;
                    continue;
                }
                if !current.is_empty() {
                    lines.push(std::mem::take(&mut current));
                }
                if lines.len() >= MAX_SUBTITLE_LINES {
                    return (lines, true);
                }
                for cluster in graphemes(&token) {
                    let candidate = format!("{current}{cluster}");
                    if !fits(&candidate) {
                        if !current.is_empty() {
                            lines.push(std::mem::take(&mut current));
                        }
                        if lines.len() >= MAX_SUBTITLE_LINES {
                            return (lines, true);
                        }
                        current = cluster.to_string();
                        if fonts.layout(cluster).width > width {
                            return (lines, true);
                        }
                    } else {
                        current = candidate;
                    }
                }
            }
            lines.push(current);
            if lines.len() >= MAX_SUBTITLE_LINES {
                return (lines, clipped || line_index < existing.len() - 1);
            }
        }
        (lines, clipped)
    }

    #[allow(clippy::too_many_arguments)]
    fn plain_rows(&self, text: &str, language: &str, size: u32, color: [u8; 3], width: i64, align: Align, padding: i64, extra: i64) -> (Vec<Row>, bool) {
        let fonts = self.fonts(language, size);
        let (lines, clipped) = self.wrap(text, &fonts, width);
        let rows = lines
            .iter()
            .map(|line| {
                let layout = fonts.layout(line);
                let width = layout.width;
                row(vec![Cell { orig: layout, hira: None, romaji: None, width }], color, align, padding, 4, 0, extra)
            })
            .collect();
        (rows, clipped)
    }

    fn ellipsis_row(&self, width: i64) -> Row {
        let size = if width > 1000 { 92 } else { 30 };
        let (mut rows, _) = self.plain_rows("…", "Default", size, TEXT, width, Align::Center, 5, 0);
        rows.remove(0)
    }

    fn render_rows(&self, rows: Vec<Row>, width: i64, mut clipped: bool) -> Result<Block, TooLarge> {
        let limit = content_height(width);
        let mut selected = Vec::new();
        let mut height = 0;
        for row in rows {
            if selected.len() >= MAX_SUBTITLE_LINES || height + row.height > limit {
                clipped = true;
                break;
            }
            height += row.height;
            selected.push(row);
        }
        if clipped {
            let marker = self.ellipsis_row(width);
            while !selected.is_empty() && (selected.len() >= MAX_SUBTITLE_LINES || height + marker.height > limit) {
                height -= selected.pop().map_or(0, |r| r.height);
            }
            height += marker.height;
            selected.push(marker);
        }
        let mut canvas = new_image(width, height.max(1), [0, 0, 0, 0])?;
        let mut bounds = Vec::new();
        let mut y = 0;
        for row in &selected {
            draw_row(&mut canvas, row, y);
            bounds.push((y, y + row.height));
            y += row.height;
        }
        Ok(Block { canvas, rows: bounds, clipped })
    }

    fn concatenate(&self, first: Block, second: Block, margin: i64) -> Result<Block, TooLarge> {
        if first.clipped {
            return Ok(first);
        }
        let width = i64::from(first.canvas.width);
        let first_height = i64::from(first.canvas.height);
        let mut total = first_height + i64::from(second.canvas.height) + margin;
        let mut rows = if first.rows.is_empty() { vec![(0, first_height)] } else { first.rows.clone() };
        let second_rows = if second.rows.is_empty() { vec![(0, i64::from(second.canvas.height))] } else { second.rows.clone() };
        rows.extend(second_rows.iter().map(|(a, b)| (a + first_height + margin, b + first_height + margin)));
        let clipped = rows.len() > MAX_SUBTITLE_LINES || total > content_height(width);
        let mut marker = None;
        if clipped {
            let ellipsis = self.ellipsis_row(width);
            rows.truncate(MAX_SUBTITLE_LINES - 1);
            while rows.last().is_some_and(|r| r.1 + ellipsis.height > content_height(width)) {
                rows.pop();
            }
            total = rows.last().map_or(0, |r| r.1) + ellipsis.height;
            marker = Some(ellipsis);
        }
        let mut canvas = new_image(width, total, [0, 0, 0, 0])?;
        canvas.paste(&first.canvas, 0, 0);
        canvas.paste(&second.canvas, 0, first_height + margin);
        if let Some(marker) = marker {
            let y = total - marker.height;
            let start = (y.max(0) * width * 4) as usize;
            canvas.pixels[start..].fill(0);
            draw_row(&mut canvas, &marker, y);
            rows.push((y, total));
        }
        Ok(Block { canvas, rows, clipped: clipped || second.clipped })
    }

    fn combine(&self, blocks: impl IntoIterator<Item = Result<Block, TooLarge>>, margin: i64) -> Result<Block, TooLarge> {
        let mut result: Option<Block> = None;
        for block in blocks {
            let block = block?;
            let combined = match result.take() {
                None => block,
                Some(previous) => self.concatenate(previous, block, margin)?,
            };
            let stop = combined.clipped;
            result = Some(combined);
            if stop {
                break;
            }
        }
        match result {
            Some(block) => Ok(block),
            None => Ok(Block { canvas: new_image(1, 1, [0, 0, 0, 0])?, rows: Vec::new(), clipped: false }),
        }
    }

    fn add_margin(&self, block: Block, margin: i64) -> Result<Block, TooLarge> {
        let mut canvas = new_image(i64::from(block.canvas.width) + margin * 2, i64::from(block.canvas.height) + margin * 2, [0, 0, 0, 0])?;
        canvas.paste(&block.canvas, margin, margin);
        Ok(Block { canvas, ..block })
    }

    /// The rounded background under a picture.
    fn on_background(&self, block: Block, radius: i64) -> Result<Block, TooLarge> {
        let (w, h) = (i64::from(block.canvas.width), i64::from(block.canvas.height));
        let mut background = new_image(w, h, [0, 0, 0, 0])?;
        let color = [BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 255];
        background.rounded_rectangle(0, 0, w, h, radius, color);
        background.composite(&block.canvas);
        validate_texture_size(w, h)?;
        Ok(Block { canvas: background, ..block })
    }

    #[allow(clippy::too_many_arguments)]
    fn ruby_rows(&self, message: &str, readings: &[Reading], language: &str, font_size: u32, original_spacing: i64, color: [u8; 3], width: i64, align: Align) -> (Vec<Row>, bool) {
        let (message, mut clipped) = bounded_text(message);
        let orig_font = self.fonts(language, font_size);
        let ruby_font = self.fonts(language, ruby_size(font_size, RUBY_SCALE));
        let spacing = RUBY_SPACING.clamp(0, 128);
        let limit = (width as f64 * 0.9) as i64;
        let mut boundaries = std::collections::HashSet::from([0usize]);
        let mut end = 0;
        for cluster in graphemes(&message) {
            end += cluster.len();
            boundaries.insert(end);
        }
        // The message cut into pieces with and without a reading, in order.
        let mut pieces: Vec<(String, String, String)> = Vec::new();
        let mut cursor = 0usize;
        for token in readings.iter().take(MAX_TEXT_CODEPOINTS) {
            if token.orig.is_empty() {
                continue;
            }
            let Some(found) = message[cursor..].find(&token.orig).map(|i| i + cursor) else { continue };
            if !boundaries.contains(&found) || !boundaries.contains(&(found + token.orig.len())) {
                continue;
            }
            if found > cursor {
                pieces.push((message[cursor..found].to_string(), String::new(), String::new()));
            }
            pieces.push((token.orig.clone(), token.hira.clone(), token.hepburn.clone()));
            cursor = found + token.orig.len();
        }
        if cursor < message.len() {
            pieces.push((message[cursor..].to_string(), String::new(), String::new()));
        }

        let mut rows: Vec<Row> = Vec::new();
        let mut cells: Vec<Cell> = Vec::new();
        let flush = |cells: &mut Vec<Cell>, rows: &mut Vec<Row>| {
            let taken = if cells.is_empty() {
                vec![Cell { orig: orig_font.layout(""), hira: None, romaji: None, width: 0 }]
            } else {
                std::mem::take(cells)
            };
            rows.push(row(taken, color, align, 10, spacing, original_spacing, 0));
        };
        for (original, hira, romaji) in pieces {
            let (orig_parts, cut) = self.wrap(&original, &orig_font, limit);
            let (hira_parts, cut_h) = self.wrap(&hira, &ruby_font, limit);
            let (romaji_parts, cut_r) = self.wrap(&romaji, &ruby_font, limit);
            clipped |= cut || cut_h || cut_r;
            let count = orig_parts.len().max(hira_parts.len()).max(romaji_parts.len());
            for i in 0..count {
                if i > 0 {
                    flush(&mut cells, &mut rows);
                }
                let part = |parts: &Vec<String>| parts.get(i).cloned().unwrap_or_default();
                let (o, h, r) = (part(&orig_parts), part(&hira_parts), part(&romaji_parts));
                let orig = orig_font.layout(&o);
                let hira = (!h.is_empty()).then(|| ruby_font.layout(&h));
                let romaji = (!r.is_empty()).then(|| ruby_font.layout(&r));
                let cell_width = orig.width.max(hira.as_ref().map_or(0, |l| l.width)).max(romaji.as_ref().map_or(0, |l| l.width));
                if !cells.is_empty() && cells.iter().map(|c| c.width).sum::<i64>() + cell_width > limit {
                    flush(&mut cells, &mut rows);
                }
                cells.push(Cell { orig, hira, romaji, width: cell_width });
                if rows.len() >= MAX_SUBTITLE_LINES {
                    return (rows, true);
                }
            }
            if cut || cut_h || cut_r {
                break;
            }
        }
        if !cells.is_empty() {
            flush(&mut cells, &mut rows);
        }
        (rows, clipped)
    }

    fn small_textbox(&self, text: &str, language: &str) -> Result<Block, TooLarge> {
        let font_size = SMALL_FONT;
        let (mut rows, clipped) = self.plain_rows(text, language, font_size, TEXT, (SMALL_WIDTH as f64 * 0.9) as i64, Align::Center, 10, 0);
        if !rows.is_empty() {
            let half = i64::from(font_size / 2);
            rows[0].padding += half;
            rows[0].height += half;
            let last = rows.len() - 1;
            rows[last].height += i64::from(font_size) - half;
        }
        let _ = SMALL_HEIGHT;
        self.render_rows(rows, SMALL_WIDTH, clipped)
    }

    fn small_textbox_with_readings(&self, message: &str, readings: &[Reading], language: &str) -> Result<Block, TooLarge> {
        if message.is_empty() || readings.is_empty() {
            return self.small_textbox(message, language);
        }
        let (rows, clipped) = self.ruby_rows(message, readings, language, SMALL_FONT, 2, TEXT, SMALL_WIDTH, Align::Center);
        self.render_rows(rows, SMALL_WIDTH, clipped)
    }

    /// The small log's picture of one message (`createOverlayImageSmallLog`). With translations,
    /// the message (when given) above each translation; otherwise the message with its readings.
    pub fn small_log(&self, message: &Subtitle) -> Result<Canvas, TooLarge> {
        let language = message.language.as_deref().unwrap_or("Default");
        let mut blocks: Vec<Result<Block, TooLarge>> = Vec::new();
        if !message.translations.is_empty() {
            if let Some(original) = message.original.as_deref().filter(|m| !m.is_empty()) {
                blocks.push(self.small_textbox(original, language));
            }
            for translation in &message.translations {
                blocks.push(self.small_textbox_with_readings(&translation.text, &translation.readings, &translation.language));
            }
        } else {
            blocks.push(self.small_textbox_with_readings(message.original.as_deref().unwrap_or(""), &message.readings, language));
        }
        let block = self.combine(blocks, 0)?;
        let block = self.add_margin(block, 50)?;
        Ok(self.on_background(block, 50)?.canvas)
    }

    fn large_text(&self, direction: Direction, large: bool, text: &str, language: &str) -> Result<Block, TooLarge> {
        let (size, color) = if large { (LARGE_FONT, TEXT) } else { (LARGE_FONT_SMALL, TEXT_SMALL) };
        let align = if direction == Direction::Receive { Align::Left } else { Align::Right };
        let (rows, clipped) = self.plain_rows(text, language, size, color, LARGE_WIDTH, align, 5, 0);
        self.render_rows(rows, LARGE_WIDTH, clipped)
    }

    fn large_text_with_readings(&self, direction: Direction, text: &str, readings: &[Reading], language: &str) -> Result<Block, TooLarge> {
        if text.is_empty() || readings.is_empty() {
            return self.large_text(direction, true, text, language);
        }
        let align = if direction == Direction::Receive { Align::Left } else { Align::Right };
        let (rows, clipped) = self.ruby_rows(text, readings, language, LARGE_FONT, 0, TEXT, LARGE_WIDTH, align);
        self.render_rows(rows, LARGE_WIDTH, clipped)
    }

    /// The line above a message: the time and "Send" or "Receive" (`createTextImageMessageType`),
    /// then who spoke a received message when the voices were told apart (#447).
    fn message_type(&self, direction: Direction, time: &str, who: Option<&str>) -> Result<Block, TooLarge> {
        let fonts = self.fonts("Default", LARGE_FONT_SMALL);
        let height = i64::from(LARGE_FONT_SMALL) + LARGE_PADDING;
        let mut canvas = new_image(LARGE_WIDTH, height, [0, 0, 0, 0])?;
        let time_line = fonts.layout(time);
        let text_width = time_line.width;
        let character = text_width / (time.chars().count().max(1) as i64);
        let label = fonts.layout(if direction == Direction::Receive { "Receive" } else { "Send" });
        let middle = |line: &TextLine| (height / 2 - line.height / 2) as f64;
        match direction {
            Direction::Receive => {
                time_line.draw(&mut canvas, 0.0, middle(&time_line), TEXT_TIME);
                let label_left = text_width + character;
                label.draw(&mut canvas, label_left as f64, middle(&label), direction.color());
                if let Some(who) = who.filter(|w| !w.is_empty()) {
                    let speaker = fonts.layout(who);
                    speaker.draw(&mut canvas, (label_left + label.width + character) as f64, middle(&speaker), TEXT);
                }
            }
            Direction::Send => {
                let time_right = LARGE_WIDTH - (text_width + character);
                time_line.draw(&mut canvas, (time_right - time_line.width) as f64, middle(&time_line), TEXT_TIME);
                label.draw(&mut canvas, (LARGE_WIDTH - label.width) as f64, middle(&label), direction.color());
            }
        }
        Ok(Block { canvas, rows: Vec::new(), clipped: false })
    }

    fn large_entry(&self, entry: &Entry) -> Result<Block, TooLarge> {
        let message = &entry.subtitle;
        let language = message.language.as_deref().unwrap_or("Default");
        let mut blocks = vec![self.message_type(entry.direction, &entry.time, entry.who.as_deref())];
        if !message.translations.is_empty() {
            if let Some(original) = &message.original {
                blocks.push(self.large_text(entry.direction, false, original, language));
            }
            for translation in &message.translations {
                blocks.push(self.large_text_with_readings(entry.direction, &translation.text, &translation.readings, &translation.language));
            }
        } else {
            blocks.push(self.large_text_with_readings(entry.direction, message.original.as_deref().unwrap_or(""), &message.readings, language));
        }
        self.combine(blocks, 0)
    }

    fn large_log(&self, entries: &[&Entry]) -> Result<Canvas, TooLarge> {
        if entries.is_empty() {
            return new_image(1, 1, [0, 0, 0, 0]);
        }
        let block = self.combine(entries.iter().map(|entry| self.large_entry(entry)), LARGE_CLAUSE_MARGIN)?;
        let block = self.add_margin(block, LARGE_MARGIN)?;
        Ok(self.on_background(block, LARGE_RADIUS)?.canvas)
    }

    /// The large log's sample shown from the settings (`createOverlayImageLargeMessage`): the
    /// text as five messages, alternating sides.
    pub fn large_sample(&self, text: &str, time: &str) -> Result<Canvas, TooLarge> {
        let subtitle = Subtitle { original: Some(text.to_string()), language: Some("Default".into()), ..Subtitle::default() };
        let entry = |direction| Entry { direction, subtitle: subtitle.clone(), time: time.to_string(), caption: None, who: None };
        let entries = [entry(Direction::Send), entry(Direction::Receive), entry(Direction::Send), entry(Direction::Receive), entry(Direction::Send)];
        self.large_log(&entries.iter().collect::<Vec<_>>())
    }

    /// The small log's sample shown from the settings (`createOverlayImageSmallMessage`).
    pub fn small_sample(&self, text: &str) -> Result<Canvas, TooLarge> {
        self.small_log(&Subtitle { original: Some(text.to_string()), language: Some("Default".into()), ..Subtitle::default() })
    }
}

fn draw_row(canvas: &mut Canvas, row: &Row, y: i64) {
    let mut x = if row.align == Align::Left { 0 } else { i64::from(canvas.width) - row.width };
    if row.align == Align::Center {
        x /= 2;
    }
    for cell in &row.cells {
        let mut top = y + row.padding;
        if row.romaji_height > 0 {
            if let Some(romaji) = &cell.romaji {
                romaji.draw(canvas, x as f64 + (cell.width - romaji.width) as f64 / 2.0, top as f64, row.color);
            }
            top += row.romaji_height + if row.hira_height > 0 { row.ruby_spacing } else { 0 };
        }
        if row.hira_height > 0 {
            if let Some(hira) = &cell.hira {
                hira.draw(canvas, x as f64 + (cell.width - hira.width) as f64 / 2.0, top as f64, row.color);
            }
            top += row.hira_height;
        }
        cell.orig.draw(canvas, x as f64 + (cell.width - cell.orig.width) as f64 / 2.0, (top + row.original_spacing) as f64, row.color);
        x += cell.width;
    }
}

/// A translation with its language and readings.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Translation {
    pub text: String,
    pub language: String,
    pub readings: Vec<Reading>,
}

/// What a log shows of one message (what the controller passed to `createOverlayImage*`).
/// `original` is `None` when only translations are shown.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Subtitle {
    pub original: Option<String>,
    /// The original's language (`None`: the default font).
    pub language: Option<String>,
    /// The original's readings.
    pub readings: Vec<Reading>,
    pub translations: Vec<Translation>,
    /// Who spoke a realtime caption, by the speech server's labels ("A", "B", ...), in the
    /// order they spoke (#447). Empty when the voices were not told apart.
    pub speakers: Vec<String>,
}

/// The most voices a session's names are kept for, and the sessions kept.
const MAX_NAMED_SESSIONS: usize = 4;
/// The longest line of speakers the large log draws, in characters.
const MAX_WHO: usize = 48;

/// Who spoke, as the large log writes it: each label's name if the user gave one, else the
/// label, joined by "·" ("Mika·B").
fn who(speakers: &[String], names: &[(String, String)]) -> Option<String> {
    if speakers.is_empty() {
        return None;
    }
    let parts: Vec<&str> = speakers
        .iter()
        .map(|label| names.iter().find(|(named, _)| named == label).map_or(label.as_str(), |(_, name)| name.as_str()))
        .collect();
    let joined = parts.join("·");
    Some(if joined.chars().count() > MAX_WHO { format!("{}…", joined.chars().take(MAX_WHO - 1).collect::<String>()) } else { joined })
}

/// A realtime caption: its source ("mic" or "speaker"), namespace and item.
pub type CaptionId = (String, String, String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptionState {
    Partial,
    Final,
    Translated,
    Discarded,
}

impl CaptionState {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "partial" => Some(Self::Partial),
            "final" => Some(Self::Final),
            "translated" => Some(Self::Translated),
            "discarded" => Some(Self::Discarded),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
struct Entry {
    direction: Direction,
    subtitle: Subtitle,
    time: String,
    caption: Option<CaptionId>,
    /// Who spoke, as drawn; set when the log is drawn, from the speakers and their names.
    who: Option<String>,
}

/// The large log's history (`message_log`, `caption_pending`, `_caption_latest`) and the names
/// the user gave the voices of the latest sessions (#447).
#[derive(Clone, Debug, Default)]
pub struct LargeLog {
    entries: Vec<Entry>,
    pending: Vec<(CaptionId, Entry)>,
    latest: Vec<(CaptionId, (u64, CaptionState))>,
    names: Vec<(String, Vec<(String, String)>)>,
}

/// A rendered large log and the version it shows.
pub struct LargePicture {
    pub canvas: Canvas,
    pub revision: u64,
}

impl LargeLog {
    fn remember(&mut self, id: CaptionId, revision: u64, state: CaptionState) {
        self.latest.retain(|(k, _)| *k != id);
        self.latest.push((id, (revision, state)));
        while self.latest.len() > 256 {
            self.latest.remove(0);
        }
    }

    fn latest(&self, id: &CaptionId) -> Option<(u64, CaptionState)> {
        self.latest.iter().find(|(k, _)| k == id).map(|(_, v)| *v)
    }

    /// An entry with who spoke it written out, by the names of its caption's session.
    fn named(&self, entry: &Entry) -> Entry {
        let names = entry
            .caption
            .as_ref()
            .and_then(|(_, namespace, _)| self.names.iter().find(|(named, _)| named == namespace))
            .map_or(&[][..], |(_, names)| names.as_slice());
        Entry { who: who(&entry.subtitle.speakers, names), ..entry.clone() }
    }

    /// Whether the log shows a caption of this session that names its speakers.
    fn shows_speakers_of(&self, namespace: &str) -> bool {
        self.entries
            .iter()
            .chain(self.pending.iter().map(|(_, e)| e))
            .any(|e| !e.subtitle.speakers.is_empty() && e.caption.as_ref().is_some_and(|(_, n, _)| n == namespace))
    }
}

/// The subtitles' state: the renderer and the large log's history, behind one lock
/// (`log_lock`): render and publish of the large log happen under it.
pub struct Subtitles {
    pub renderer: Renderer,
    state: Mutex<(LargeLog, u64)>,
    clock: Arc<dyn Fn() -> String + Send + Sync>,
}

/// What the caller of a large-log change does with the picture: show it and say whether it
/// was shown. A picture not shown is taken back out of the history.
pub type Publish<'a> = &'a mut dyn FnMut(&LargePicture) -> bool;

/// Why a caption update was refused (`invalid_overlay_caption`).
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidCaption;

impl Subtitles {
    /// `clock` gives the local time as "HH:MM".
    pub fn new(library: Arc<FontLibrary>, clock: Arc<dyn Fn() -> String + Send + Sync>) -> Self {
        Self { renderer: Renderer::new(library), state: Mutex::new((LargeLog::default(), 0)), clock }
    }

    fn render(&self, log: &LargeLog, revision: &mut u64) -> Result<LargePicture, TooLarge> {
        let named: Vec<Entry> = log.entries.iter().chain(log.pending.iter().map(|(_, e)| e)).map(|e| log.named(e)).collect();
        let all: Vec<&Entry> = named.iter().collect();
        let canvas = self.renderer.large_log(&all)?;
        *revision += 1;
        Ok(LargePicture { canvas, revision: *revision })
    }

    /// Whether a picture is still the newest version of the large log (`isCurrentLargeLog`).
    pub fn is_current(&self, picture: &LargePicture) -> bool {
        self.state.lock().unwrap().1 == picture.revision
    }

    /// Adds a message to the large log and offers the picture to `publish`
    /// (`publishMessageOverlayLargeLog`). Nothing is added when it was not shown.
    pub fn publish_message(&self, direction: Direction, subtitle: Subtitle, publish: Publish) -> Result<bool, TooLarge> {
        let mut guard = self.state.lock().unwrap();
        let checkpoint = guard.0.clone();
        let (log, revision) = &mut *guard;
        log.entries.push(Entry { direction, subtitle, time: (self.clock)(), caption: None, who: None });
        trim(&mut log.entries);
        let picture = match self.render(log, revision) {
            Ok(picture) => picture,
            Err(error) => {
                guard.0 = checkpoint;
                guard.1 += 1;
                return Err(error);
            }
        };
        let shown = publish(&picture);
        if !shown {
            guard.0 = checkpoint;
            guard.1 += 1;
        }
        Ok(shown)
    }

    /// Adds or updates a realtime caption (`publishRealtimeCaptionOverlay`). `None` when an old
    /// or finished revision changed nothing.
    pub fn publish_caption(
        &self,
        id: CaptionId,
        state: CaptionState,
        revision: u64,
        direction: Direction,
        subtitle: Subtitle,
        publish: Publish,
    ) -> Result<Option<bool>, InvalidCaption> {
        if !matches!(id.0.as_str(), "mic" | "speaker") || id.1.is_empty() || id.2.is_empty() || revision < 1 {
            return Err(InvalidCaption);
        }
        let mut guard = self.state.lock().unwrap();
        let checkpoint = guard.0.clone();
        let (log, counter) = &mut *guard;
        let previous = log.latest(&id);
        let existing = log.entries.iter().position(|e| e.caption.as_ref() == Some(&id));
        if let Some((last, last_state)) = previous
            && (revision <= last
                || matches!(last_state, CaptionState::Discarded | CaptionState::Translated)
                || (last_state == CaptionState::Final && (state != CaptionState::Translated || existing.is_none())))
        {
            return Ok(None);
        }
        let pending = log.pending.iter().position(|(k, _)| *k == id);
        let time = existing
            .map(|i| log.entries[i].time.clone())
            .or_else(|| pending.map(|i| log.pending[i].1.time.clone()))
            .unwrap_or_else(|| (self.clock)());
        let entry = Entry { direction, subtitle, time, caption: Some(id.clone()), who: None };
        log.remember(id.clone(), revision, state);
        if state == CaptionState::Partial {
            if pending.is_none() && log.pending.len() >= 16 {
                let (oldest, _) = log.pending.remove(0);
                let last = log.latest(&oldest).map_or(0, |v| v.0);
                log.remember(oldest, last, CaptionState::Discarded);
            }
            match log.pending.iter().position(|(k, _)| *k == id) {
                Some(i) => log.pending[i].1 = entry,
                None => log.pending.push((id.clone(), entry)),
            }
        } else {
            log.pending.retain(|(k, _)| *k != id);
            if state != CaptionState::Discarded {
                match existing {
                    Some(i) => log.entries[i] = entry,
                    None => log.entries.push(entry),
                }
            }
        }
        trim(&mut log.entries);
        let shown = match self.render(log, counter) {
            Ok(picture) => publish(&picture),
            Err(_) => false,
        };
        if !shown {
            guard.0 = checkpoint;
            guard.1 += 1;
            let (log, _) = &mut *guard;
            log.pending.retain(|(k, _)| *k != id);
            let last = log.latest(&id).map_or(0, |v| v.0);
            log.remember(id, revision.max(last), CaptionState::Discarded);
        }
        Ok(Some(shown))
    }

    /// Drops the pending captions of a source's namespace and offers the picture
    /// (`clearRealtimeCaptionOverlay`).
    pub fn discard_captions(&self, source: &str, namespace: &str, publish: Publish) {
        let mut guard = self.state.lock().unwrap();
        let (log, counter) = &mut *guard;
        let gone: Vec<CaptionId> = log.pending.iter().filter(|(k, _)| k.0 == source && k.1 == namespace).map(|(k, _)| k.clone()).collect();
        for id in gone {
            log.pending.retain(|(k, _)| *k != id);
            let last = log.latest(&id).map_or(0, |v| v.0);
            log.remember(id, last, CaptionState::Discarded);
        }
        if let Ok(picture) = self.render(log, counter) {
            publish(&picture);
        }
    }

    /// The names the user gave the voices of a realtime session (#447): `names` is the whole set
    /// for that session, label and name. The large log is drawn again and offered to `publish`
    /// when it shows a caption of that session with speakers. Returns whether it was drawn.
    pub fn set_speaker_names(&self, namespace: &str, names: Vec<(String, String)>, publish: Publish) -> bool {
        let mut guard = self.state.lock().unwrap();
        let (log, counter) = &mut *guard;
        log.names.retain(|(named, _)| named != namespace);
        log.names.push((namespace.to_string(), names));
        while log.names.len() > MAX_NAMED_SESSIONS {
            log.names.remove(0);
        }
        if !log.shows_speakers_of(namespace) {
            return false;
        }
        match self.render(log, counter) {
            Ok(picture) => {
                publish(&picture);
                true
            }
            Err(_) => false,
        }
    }

    /// The number of messages the large log holds (tests).
    pub fn large_log_len(&self) -> usize {
        self.state.lock().unwrap().0.entries.len()
    }
}

fn trim(entries: &mut Vec<Entry>) {
    let excess = entries.len().saturating_sub(5);
    entries.drain(..excess);
}

/// The local time as "HH:MM" (`datetime.now().strftime("%H:%M")`).
pub fn local_time() -> String {
    #[cfg(windows)]
    {
        let time = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
        format!("{:02}:{:02}", time.wHour, time.wMinute)
    }
    #[cfg(unix)]
    {
        let now = unsafe { libc::time(std::ptr::null_mut()) };
        let mut parts: libc::tm = unsafe { std::mem::zeroed() };
        if unsafe { libc::localtime_r(&now, &mut parts) }.is_null() {
            return String::new();
        }
        format!("{:02}:{:02}", parts.tm_hour, parts.tm_min)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn renderer() -> Subtitles {
        Subtitles::new(Arc::new(FontLibrary::new(Vec::new())), Arc::new(|| "12:34".to_string()))
    }

    #[test]
    fn the_small_log_has_its_width_and_a_background() {
        let subtitles = renderer();
        let message = Subtitle {
            original: Some("こんにちは".into()),
            language: Some("Japanese".into()),
            translations: vec![Translation { text: "Hello".into(), language: "English".into(), readings: Vec::new() }],
            ..Subtitle::default()
        };
        let picture = subtitles.renderer.small_log(&message).unwrap();
        assert_eq!(picture.width, 3840 + 100);
        assert!(picture.height >= 100, "two rows and the margin");
        assert_eq!(picture.pixel(picture.width / 2, 2), [41, 42, 45, 255], "the background");
        assert_eq!(picture.pixel(0, 0)[3], 0, "the rounded corner");
        if subtitles.renderer.library().any() {
            let text = picture.pixels.chunks_exact(4).filter(|p| p[0] > 150).count();
            assert!(text > 0, "the glyphs are drawn");
        }
    }

    #[test]
    fn readings_add_rows_above_the_words() {
        let subtitles = renderer();
        let plain = Subtitle { original: Some("慮る".into()), language: Some("Japanese".into()), ..Subtitle::default() };
        let with = Subtitle {
            readings: vec![Reading { orig: "慮".into(), hira: "おもんぱか".into(), hepburn: "omonpaka".into() }],
            ..plain.clone()
        };
        let a = subtitles.renderer.small_log(&plain).unwrap();
        let b = subtitles.renderer.small_log(&with).unwrap();
        assert!(b.height > a.height);
    }

    #[test]
    fn the_large_log_keeps_five_messages_and_takes_back_what_was_not_shown() {
        let subtitles = renderer();
        let message = |text: &str| Subtitle { original: Some(text.into()), ..Subtitle::default() };
        let mut heights = Vec::new();
        for _ in 0..7 {
            let shown = subtitles
                .publish_message(Direction::Send, message("message"), &mut |picture| {
                    assert_eq!(picture.canvas.width, 960 + 50);
                    heights.push(picture.canvas.height);
                    true
                })
                .unwrap();
            assert!(shown);
        }
        assert_eq!(subtitles.large_log_len(), 5);
        assert_eq!(heights[5], heights[6], "the oldest message left");
        let shown = subtitles.publish_message(Direction::Receive, message("not shown"), &mut |_| false).unwrap();
        assert!(!shown);
        assert_eq!(subtitles.large_log_len(), 5);
    }

    #[test]
    fn captions_update_in_place_and_ignore_old_revisions() {
        let subtitles = renderer();
        let id: CaptionId = ("mic".into(), "n".into(), "1".into());
        let text = |t: &str| Subtitle { original: Some(t.into()), ..Subtitle::default() };
        let mut show = |_: &LargePicture| true;
        assert_eq!(subtitles.publish_caption(id.clone(), CaptionState::Partial, 1, Direction::Send, text("a"), &mut show), Ok(Some(true)));
        assert_eq!(subtitles.large_log_len(), 0, "a partial caption is pending");
        assert_eq!(subtitles.publish_caption(id.clone(), CaptionState::Final, 2, Direction::Send, text("ab"), &mut show), Ok(Some(true)));
        assert_eq!(subtitles.large_log_len(), 1);
        assert_eq!(subtitles.publish_caption(id.clone(), CaptionState::Partial, 1, Direction::Send, text("x"), &mut show), Ok(None));
        let bad: CaptionId = ("tv".into(), "n".into(), "1".into());
        assert_eq!(subtitles.publish_caption(bad, CaptionState::Final, 1, Direction::Send, text("x"), &mut show), Err(InvalidCaption));
    }

    #[test]
    fn who_spoke_is_written_with_the_names_given_else_the_labels() {
        let labels = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let names = vec![("A".to_string(), "ミカ".to_string())];
        assert_eq!(who(&labels(&["A", "B"]), &names).as_deref(), Some("ミカ·B"));
        assert_eq!(who(&labels(&["B"]), &[]).as_deref(), Some("B"));
        assert_eq!(who(&[], &names), None);
        let long = vec![("A".to_string(), "x".repeat(32)), ("B".to_string(), "y".repeat(32))];
        let written = who(&labels(&["A", "B"]), &long).unwrap();
        assert_eq!(written.chars().count(), MAX_WHO);
        assert!(written.ends_with('…'));
    }

    #[test]
    fn naming_a_voice_draws_the_large_log_again_only_for_its_session() {
        let subtitles = renderer();
        let id: CaptionId = ("speaker".into(), "n1".into(), "1".into());
        let spoken = Subtitle { original: Some("こんにちは".into()), speakers: vec!["A".into()], ..Subtitle::default() };
        let mut show = |_: &LargePicture| true;
        assert_eq!(subtitles.publish_caption(id, CaptionState::Final, 1, Direction::Receive, spoken, &mut show), Ok(Some(true)));
        let mut drawn = 0;
        assert!(subtitles.set_speaker_names("n1", vec![("A".into(), "ミカ".into())], &mut |_| {
            drawn += 1;
            true
        }));
        assert_eq!(drawn, 1);
        let state = subtitles.state.lock().unwrap();
        assert_eq!(state.0.named(&state.0.entries[0]).who.as_deref(), Some("ミカ"));
        drop(state);
        // Another session's names change nothing on screen.
        assert!(!subtitles.set_speaker_names("n2", vec![("A".into(), "別の人".into())], &mut |_| panic!("not drawn")));
    }

    #[test]
    fn a_huge_text_is_cut_with_an_ellipsis_within_the_budget() {
        let subtitles = renderer();
        let long = "長い文章です。".repeat(400);
        let picture = subtitles.renderer.small_log(&Subtitle { original: Some(long), ..Subtitle::default() }).unwrap();
        assert!(validate_texture_size(i64::from(picture.width), i64::from(picture.height)).is_ok());
        let _ = PathBuf::new();
    }
}
