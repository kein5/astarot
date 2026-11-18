//! The term dictionary (Issue #446): the recognition vocabulary ([`crate::speechcpp`]) applied
//! the same way to what is recognised, translated and spoken.
//!
//! A term is a speech.cpp keyword, `written=reading,reading`: the written form the text should
//! hold and the kana readings a recognizer would otherwise write. The same entries do three jobs:
//!
//! - [`Dictionary::corrected`]: recognised text gets the written form where a reading was
//!   heard, and a written form in Latin letters gets the letter case it was registered with
//!   ("ぶいちゃ" and "vrchat" become "VRChat"). Haas already rewrites the readings it is given;
//!   this does the same for every engine.
//! - [`Dictionary::spoken`]: Japanese text for speech gets the first reading in place of the
//!   written form ("VRChat" is read "ブイアールチャット").
//! - [`Dictionary::occurring`]: the written forms that appear in a text, for an AI translator
//!   to keep as names.
//!
//! A match never splits a word: a term in Latin letters or digits must not continue a longer
//! such word, and a term that begins or ends in katakana must not continue a longer katakana
//! word ("クエスト" is not taken out of "リクエスト"). Hiragana and kanji have no such edge,
//! since Japanese is written without spaces. Hiragana and katakana are the same for matching,
//! and so are capital and small Latin letters.
//!
//! Nothing here logs a term or a text.

/// One entry: its written form and its readings, as the settings keep it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Term {
    pub written: String,
    pub readings: Vec<String>,
}

impl Term {
    /// A `written=reading,reading` entry. The settings validate entries when they are saved
    /// (`voice_settings::parse_term`); this only splits one.
    pub fn parse(entry: &str) -> Term {
        let (written, readings) = entry.split_once('=').unwrap_or((entry, ""));
        let readings = readings.split(',').map(str::trim).filter(|r| !r.is_empty()).map(str::to_string).collect();
        Term { written: written.trim().to_string(), readings }
    }
}

/// What a match is compared by: hiragana as katakana, Latin capitals as small letters.
fn fold(c: char) -> char {
    match c {
        '\u{3041}'..='\u{3096}' | '\u{309D}'..='\u{309E}' => char::from_u32(c as u32 + 0x60).unwrap_or(c),
        _ => c.to_ascii_lowercase(),
    }
}

fn is_katakana(c: char) -> bool {
    matches!(c, '\u{30A1}'..='\u{30FA}' | '\u{30FC}'..='\u{30FE}' | '\u{31F0}'..='\u{31FF}' | '\u{FF66}'..='\u{FF9F}')
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric()
}

/// Whether two characters belong to one word that a match may not cut.
fn joined(edge: char, other: Option<char>) -> bool {
    other.is_some_and(|other| (is_word(edge) && is_word(other)) || (is_katakana(edge) && is_katakana(other)))
}

struct Pattern {
    folded: Vec<char>,
    replacement: String,
}

/// Replacements found longest first, never across a word's edge.
struct Matcher {
    patterns: Vec<Pattern>,
}

impl Matcher {
    fn new(mut pairs: Vec<(String, String)>) -> Matcher {
        pairs.retain(|(from, _)| !from.is_empty());
        let mut patterns: Vec<Pattern> =
            pairs.into_iter().map(|(from, to)| Pattern { folded: from.chars().map(fold).collect(), replacement: to }).collect();
        // The longest first, so "VRChat SDK" wins over "VRChat"; the order of equal lengths stays.
        patterns.sort_by_key(|p| std::cmp::Reverse(p.folded.len()));
        Matcher { patterns }
    }

    /// The pattern that matches at `start`, if any.
    fn at(&self, chars: &[char], folded: &[char], start: usize) -> Option<&Pattern> {
        self.patterns.iter().find(|p| {
            let end = start + p.folded.len();
            end <= chars.len()
                && folded[start..end] == p.folded[..]
                && !joined(chars[start], start.checked_sub(1).map(|i| chars[i]))
                && !joined(chars[end - 1], chars.get(end).copied())
        })
    }

    fn replace(&self, text: &str) -> String {
        if self.patterns.is_empty() {
            return text.to_string();
        }
        let chars: Vec<char> = text.chars().collect();
        let folded: Vec<char> = chars.iter().copied().map(fold).collect();
        let mut result = String::with_capacity(text.len());
        let mut i = 0;
        while i < chars.len() {
            match self.at(&chars, &folded, i) {
                Some(pattern) => {
                    result.push_str(&pattern.replacement);
                    i += pattern.folded.len();
                }
                None => {
                    result.push(chars[i]);
                    i += 1;
                }
            }
        }
        result
    }

    fn contains(&self, chars: &[char], folded: &[char], pattern: usize) -> bool {
        let wanted = &self.patterns[pattern];
        (0..chars.len()).any(|start| {
            let end = start + wanted.folded.len();
            end <= chars.len()
                && folded[start..end] == wanted.folded[..]
                && !joined(chars[start], start.checked_sub(1).map(|i| chars[i]))
                && !joined(chars[end - 1], chars.get(end).copied())
        })
    }
}

/// The terms ready to apply. Cheap to build for each use (at most 150 terms).
pub struct Dictionary {
    corrections: Matcher,
    readings: Matcher,
    written: Matcher,
}

impl Dictionary {
    /// From the entries in order (the user's first, as [`crate::speechcpp::merged_terms`] gives
    /// them): an earlier entry with the same written form wins.
    pub fn new(entries: &[String]) -> Dictionary {
        let terms: Vec<Term> = entries.iter().map(|entry| Term::parse(entry)).collect();
        let mut corrections = Vec::new();
        let mut readings = Vec::new();
        let mut written = Vec::new();
        for term in terms.iter().filter(|term| !term.written.is_empty()) {
            for reading in &term.readings {
                corrections.push((reading.clone(), term.written.clone()));
            }
            // Only the letter case of a Latin written form is put right; a written form in
            // kana is not turned into the other kana.
            if term.written.chars().any(|c| c.is_ascii_alphabetic()) {
                corrections.push((term.written.clone(), term.written.clone()));
            }
            if let Some(first) = term.readings.first() {
                readings.push((term.written.clone(), first.clone()));
            }
            written.push((term.written.clone(), term.written.clone()));
        }
        // A pattern seen before keeps its first replacement: the user's term wins.
        let first_only = |pairs: Vec<(String, String)>| {
            let mut seen: Vec<Vec<char>> = Vec::new();
            pairs
                .into_iter()
                .filter(|(from, _)| {
                    let key: Vec<char> = from.chars().map(fold).collect();
                    let new = !seen.contains(&key);
                    seen.push(key);
                    new
                })
                .collect::<Vec<_>>()
        };
        Dictionary {
            corrections: Matcher::new(first_only(corrections)),
            readings: Matcher::new(first_only(readings)),
            written: Matcher::new(first_only(written)),
        }
    }

    /// Recognised text with the written forms in place of the readings heard, and Latin
    /// written forms in their registered letter case.
    pub fn corrected(&self, text: &str) -> String {
        self.corrections.replace(text)
    }

    /// Japanese text for speech with each written form that has a reading replaced by its
    /// first reading.
    pub fn spoken(&self, text: &str) -> String {
        self.readings.replace(text)
    }

    /// The written forms that appear in `text`, in the dictionary's order (longest first),
    /// at most `limit`.
    pub fn occurring(&self, text: &str, limit: usize) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        let folded: Vec<char> = chars.iter().copied().map(fold).collect();
        (0..self.written.patterns.len())
            .filter(|&i| self.written.contains(&chars, &folded, i))
            .map(|i| self.written.patterns[i].replacement.clone())
            .take(limit)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dictionary(entries: &[&str]) -> Dictionary {
        Dictionary::new(&entries.iter().map(|e| e.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn an_entry_splits_into_its_written_form_and_readings() {
        assert_eq!(Term::parse("VRChat=ブイアールチャット, ブイチャ"), Term {
            written: "VRChat".into(),
            readings: vec!["ブイアールチャット".into(), "ブイチャ".into()],
        });
        assert_eq!(Term::parse("ワールド"), Term { written: "ワールド".into(), readings: vec![] });
    }

    #[test]
    fn readings_become_the_written_form_in_either_kana() {
        let terms = dictionary(&["VRChat=ブイアールチャット,ぶいちゃ", "お砂糖=おさとう", "猫丸=ねこまる"]);
        assert_eq!(terms.corrected("ぶいちゃで会おう"), "VRChatで会おう");
        assert_eq!(terms.corrected("ブイチャのブイアールチャット"), "VRChatのVRChat");
        assert_eq!(terms.corrected("おさとうがいい"), "お砂糖がいい");
        assert_eq!(terms.corrected("ネコマルさんとねこまるさん"), "猫丸さんと猫丸さん");
    }

    #[test]
    fn latin_written_forms_get_their_letter_case() {
        let terms = dictionary(&["VRChat", "SteamVR=スチームブイアール"]);
        assert_eq!(terms.corrected("vrchat and STEAMVR"), "VRChat and SteamVR");
        // Part of a longer word is left alone.
        assert_eq!(terms.corrected("vrchatter"), "vrchatter");
    }

    #[test]
    fn a_katakana_reading_is_not_taken_out_of_a_longer_word() {
        let terms = dictionary(&["Quest=クエスト", "Unity=ユニティ"]);
        assert_eq!(terms.corrected("リクエストを送る"), "リクエストを送る");
        assert_eq!(terms.corrected("クエストで遊ぶ"), "Questで遊ぶ");
        assert_eq!(terms.corrected("クエストー"), "クエストー");
        assert_eq!(terms.corrected("ユニティちゃん"), "Unityちゃん");
    }

    #[test]
    fn the_first_entry_of_a_reading_wins_and_the_longest_match_first() {
        let terms = dictionary(&["ねこ丸=ねこまる", "猫丸=ねこまる", "VRChat SDK=ぶいちゃえすでぃーけー", "VRChat=ぶいちゃ"]);
        assert_eq!(terms.corrected("ねこまる"), "ねこ丸");
        assert_eq!(terms.corrected("ぶいちゃえすでぃーけー"), "VRChat SDK");
    }

    #[test]
    fn japanese_speech_reads_the_first_reading() {
        let terms = dictionary(&["VRChat=ブイアールチャット,ブイチャ", "お砂糖=おさとう", "ワールド", "VRChat SDK"]);
        assert_eq!(terms.spoken("VRChatのワールドでお砂糖"), "ブイアールチャットのワールドでおさとう");
        assert_eq!(terms.spoken("vrchat"), "ブイアールチャット");
        // A term without readings stays, and so does a longer word.
        assert_eq!(terms.spoken("VRChatters"), "VRChatters");
    }

    #[test]
    fn the_written_forms_in_a_text_are_found_once_each() {
        let terms = dictionary(&["猫丸=ねこまる", "Midnight Rooftop", "VRChat"]);
        assert_eq!(terms.occurring("猫丸とmidnight rooftopで猫丸と", 10), vec!["Midnight Rooftop", "猫丸"]);
        assert_eq!(terms.occurring("nothing here", 10), Vec::<String>::new());
        assert_eq!(terms.occurring("猫丸 VRChat", 1).len(), 1);
    }

    #[test]
    fn an_empty_dictionary_changes_nothing() {
        let terms = dictionary(&[]);
        assert_eq!(terms.corrected("そのまま"), "そのまま");
        assert_eq!(terms.spoken("そのまま"), "そのまま");
    }
}
