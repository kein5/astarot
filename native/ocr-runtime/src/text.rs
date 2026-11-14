//! Turning recognised lines into one message, and comparing messages
//! (`ocr_pipeline.py`: `_mergeWords`, `_lineJoiner`, `_similar`, `_textHash`).

use crate::engine::Word;
use crate::numeric::py_strip;

/// A line ending in one of these was ended by the sender, not wrapped.
pub const SENTENCE_END_CHARS: &[char] = &['。', '．', '.', '！', '!', '？', '?', '…', '」', '』', ')', '）'];

/// ASCII letters, digits and quotes: a line break between them needs a space.
fn is_latin(c: Option<char>) -> bool {
    matches!(c, Some(c) if c.is_ascii() && (c.is_ascii_alphanumeric() || c == '"' || c == '\''))
}

/// The key two messages share when they differ only in case (`str.casefold`).
pub fn text_key(text: &str) -> String {
    caseless::default_case_fold_str(text)
}

/// Bounded edit distance: equal, or within `max_distance` edits and 20 % of the
/// shorter text (so texts under five characters must match exactly).
pub fn similar(a: &str, b: &str, max_distance: usize) -> bool {
    if a == b {
        return true;
    }
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let max_distance = max_distance.min(a.len().min(b.len()) / 5);
    if max_distance == 0 || a.len().abs_diff(b.len()) > max_distance {
        return false;
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut current = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let value = (previous[j + 1] + 1).min(current[j] + 1).min(previous[j] + usize::from(ca != cb));
            current.push(value);
        }
        if current.iter().min().copied().unwrap_or(0) > max_distance {
            return false;
        }
        previous = current;
    }
    previous[b.len()] <= max_distance
}

/// How two lines join: a line break after a sentence end, a space where Latin letters
/// meet, nothing between Japanese or Chinese characters.
pub fn line_joiner(previous: &str, next: &str) -> &'static str {
    let previous = py_strip(previous);
    if previous.ends_with(SENTENCE_END_CHARS) {
        return "\n";
    }
    if is_latin(previous.chars().last()) || is_latin(next.chars().next()) {
        " "
    } else {
        ""
    }
}

/// One message from a bubble's lines, top to bottom.
///
/// VRChat draws the sender's line breaks and its own wrapping the same way, so only a
/// sentence-ending character marks a break; other lines are joined (measured on real
/// bubbles: the right-margin heuristic misjudged wrapped text when other text was near).
pub fn merge_words(words: &[Word]) -> String {
    let mut lines: Vec<&Word> = words.iter().filter(|w| !py_strip(&w.text).is_empty()).collect();
    if lines.is_empty() {
        return String::new();
    }
    if lines.iter().any(|w| w.bounds.is_some()) {
        // Stable, like Python's sort; lines without a position count as top 0.
        lines.sort_by(|a, b| a.bounds.map_or(0.0, |r| r.2).partial_cmp(&b.bounds.map_or(0.0, |r| r.2)).unwrap_or(std::cmp::Ordering::Equal));
    }
    let mut merged = py_strip(&lines[0].text).to_string();
    for pair in lines.windows(2) {
        let text = py_strip(&pair[1].text);
        merged.push_str(line_joiner(&pair[0].text, text));
        merged.push_str(text);
    }
    py_strip(&merged).to_string()
}
