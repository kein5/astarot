//! Kana and romaji readings of Japanese text (`src-python/models/transliteration/`).
//!
//! The readings come from a morphological analyzer: Python used SudachiPy with SudachiDict
//! full in split mode C, and the Rust side uses sudachi.rs the same way (module `sudachi`, feature `sudachi`). The
//! analyzer is a [`Tokenizer`] given from outside, so tests can give fixed morphemes. Everything
//! after it is here and matches Python: the split of a word's reading over its kanji and kana,
//! the context rule for 何, katakana to hiragana and to Hepburn.

mod hepburn;
#[cfg(feature = "sudachi")]
pub mod sudachi;

pub use hepburn::katakana_to_hepburn;

/// One morpheme as the analyzer gives it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Morpheme {
    pub surface: String,
    /// The reading in katakana (`reading_form`).
    pub reading: String,
    /// The first part-of-speech field (`part_of_speech()[0]`), e.g. `名詞` or `補助記号`.
    pub part_of_speech: String,
}

/// The analyzer could not run (no dictionary, or it failed).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unavailable;

impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("transliteration_unavailable")
    }
}

impl std::error::Error for Unavailable {}

/// A morphological analyzer with readings.
pub trait Tokenizer: Send + Sync {
    fn tokenize(&self, text: &str) -> Result<Vec<Morpheme>, Unavailable>;

    /// Why [`Tokenizer::tokenize`] gave [`Unavailable`], for the process log (a file name,
    /// never any text).
    fn unavailable_reason(&self) -> Option<String> {
        None
    }
}

/// An analyzer that never runs: no readings.
pub struct NoDictionary;

impl Tokenizer for NoDictionary {
    fn tokenize(&self, _text: &str) -> Result<Vec<Morpheme>, Unavailable> {
        Err(Unavailable)
    }
}

/// The reading of one part of the text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reading {
    pub orig: String,
    pub kana: String,
    pub hira: String,
    pub hepburn: String,
}

fn is_kanji(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

/// Katakana to hiragana (`kata_to_hira`): ァ to ン move down; the rest stays.
pub fn kata_to_hira(text: &str) -> String {
    text.chars()
        .map(|c| if ('ァ'..='ン').contains(&c) { char::from_u32(c as u32 - 0x60).unwrap_or(c) } else { c })
        .collect()
}

fn reading(orig: String, kana: String, use_macron: bool) -> Reading {
    let hira = kata_to_hira(&kana);
    let hepburn = katakana_to_hepburn(&kana, use_macron);
    Reading { orig, kana, hira, hepburn }
}

/// Splits a word and its reading over its kanji and non-kanji blocks
/// (`split_kanji_okurigana`): each block first gets as many kana as it has characters, extra
/// kana go to the kanji blocks left to right and then to every block in turn, and a short
/// reading is taken back from the right.
pub fn split_kanji_okurigana(surface: &str, reading_kana: &str, use_macron: bool) -> Vec<Reading> {
    let mut blocks: Vec<(bool, String)> = Vec::new();
    for c in surface.chars() {
        let kanji = is_kanji(c);
        match blocks.last_mut() {
            Some((last, text)) if *last == kanji => text.push(c),
            _ => blocks.push((kanji, c.to_string())),
        }
    }
    let kana: Vec<char> = reading_kana.chars().collect();
    let mut allocs: Vec<usize> = blocks.iter().map(|(_, part)| part.chars().count()).collect();
    let mut remaining = kana.len() as i64 - allocs.iter().sum::<usize>() as i64;
    if remaining > 0 {
        for (at, (kanji, _)) in blocks.iter().enumerate() {
            if remaining <= 0 {
                break;
            }
            if *kanji {
                allocs[at] += 1;
                remaining -= 1;
            }
        }
        let mut at = 0;
        while remaining > 0 && !blocks.is_empty() {
            allocs[at] += 1;
            remaining -= 1;
            at = (at + 1) % blocks.len();
        }
    }
    if remaining < 0 {
        let mut need = -remaining;
        let mut at = blocks.len() as i64 - 1;
        while need > 0 && at >= 0 {
            let index = at as usize;
            let take = if allocs[index] > 1 { (allocs[index] as i64 - 1).min(need) } else { 0 };
            allocs[index] -= take as usize;
            need -= take;
            at -= 1;
        }
    }
    let mut position = 0;
    let mut out = Vec::new();
    for ((_, part), count) in blocks.into_iter().zip(allocs) {
        let start = position.min(kana.len());
        let end = (position + count).min(kana.len());
        position += count;
        out.push(reading(part, kana[start..end].iter().collect(), use_macron));
    }
    out
}

/// The context rules (`transliteration_context_rules.DEFAULT_RULES`): 何 reads ナン before a
/// part starting with タ, チ, ツ, テ, ト, ダ, ヂ, ヅ, デ, ド, ナ, ニ, ヌ, ネ or ノ, else ナニ. The
/// rule rewrites `kana` and clears `hira` and `hepburn` until they are worked out again.
pub fn apply_context_rules(results: &mut [Reading]) {
    const NAN_BEFORE: &str = "タチツテトダヂヅデドナニヌネノ";
    for at in 0..results.len() {
        if results[at].orig != "何" {
            continue;
        }
        let neighbor = results[at + 1..].iter().find(|r| !r.orig.is_empty());
        let condition = match neighbor {
            Some(next) if !next.kana.is_empty() => next.kana.chars().next().is_some_and(|c| NAN_BEFORE.contains(c)),
            Some(next) => {
                next.orig.chars().next().is_some_and(|c| ('ァ'..='ン').contains(&c) && NAN_BEFORE.contains(c))
            }
            None => false,
        };
        let entry = &mut results[at];
        entry.kana = if condition { "ナン" } else { "ナニ" }.to_string();
        entry.hira.clear();
        entry.hepburn.clear();
    }
}

/// The readings of a text (`Transliterator.analyze`).
pub fn analyze(tokenizer: &dyn Tokenizer, text: &str, use_macron: bool) -> Result<Vec<Reading>, Unavailable> {
    let mut results = Vec::new();
    for morpheme in tokenizer.tokenize(text)? {
        let surface = morpheme.surface;
        let mut kana = morpheme.reading;
        if ["記号", "補助記号", "空白"].contains(&morpheme.part_of_speech.as_str()) {
            kana = surface.clone();
        }
        if surface == kana {
            results.push(Reading { orig: surface.clone(), kana, hira: surface.clone(), hepburn: surface });
        } else if surface.chars().count() == 1 {
            results.push(reading(surface, kana, use_macron));
        } else {
            results.extend(split_kanji_okurigana(&surface, &kana, use_macron));
        }
    }
    apply_context_rules(&mut results);
    for entry in &mut results {
        if !entry.kana.is_empty() {
            entry.hira = kata_to_hira(&entry.kana);
            entry.hepburn = katakana_to_hepburn(&entry.kana, use_macron);
        }
    }
    Ok(results)
}

/// What the message pipeline sends (`Model.convertMessageToTransliteration`): `orig`, with
/// `hira` and `hepburn` when asked for, as JSON objects in that order.
pub fn convert(
    tokenizer: &dyn Tokenizer,
    text: &str,
    hiragana: bool,
    romaji: bool,
) -> Result<Vec<serde_json::Value>, Unavailable> {
    if !hiragana && !romaji {
        return Ok(Vec::new());
    }
    let readings = analyze(tokenizer, text, false)?;
    Ok(readings
        .into_iter()
        .map(|r| {
            let mut object = serde_json::Map::new();
            object.insert("orig".into(), r.orig.into());
            if hiragana {
                object.insert("hira".into(), r.hira.into());
            }
            if romaji {
                object.insert("hepburn".into(), r.hepburn.into());
            }
            serde_json::Value::Object(object)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Morphemes as SudachiDict full gives them, written out by hand for the tests.
    struct Fixed(Vec<(&'static str, &'static str, &'static str)>);

    impl Tokenizer for Fixed {
        fn tokenize(&self, _text: &str) -> Result<Vec<Morpheme>, Unavailable> {
            Ok(self
                .0
                .iter()
                .map(|(s, r, p)| Morpheme {
                    surface: s.to_string(),
                    reading: r.to_string(),
                    part_of_speech: p.to_string(),
                })
                .collect())
        }
    }

    fn row(r: &Reading) -> (&str, &str, &str) {
        (r.orig.as_str(), r.hira.as_str(), r.hepburn.as_str())
    }

    #[test]
    fn readings_split_over_kanji_and_okurigana() {
        let parts = split_kanji_okurigana("美しい", "ウツクシイ", false);
        assert_eq!(parts.iter().map(row).collect::<Vec<_>>(), [("美", "うつく", "utsuku"), ("しい", "しい", "shii")]);
        let parts = split_kanji_okurigana("取り敢えず", "トリアエズ", false);
        assert_eq!(
            parts.iter().map(row).collect::<Vec<_>>(),
            [("取", "と", "to"), ("り", "り", "ri"), ("敢", "あ", "a"), ("えず", "えず", "ezu")]
        );
        // A reading shorter than the word is taken back from the right.
        let parts = split_kanji_okurigana("東京都", "ト", false);
        assert_eq!(parts[0].kana, "ト");
        // Extra kana beyond the kanji blocks go round every block.
        let parts = split_kanji_okurigana("今日は", "キョウハハ", false);
        assert_eq!(parts.iter().map(|p| p.kana.as_str()).collect::<Vec<_>>(), ["キョウハ", "ハ"]);
    }

    #[test]
    fn nan_or_nani_follows_the_next_part() {
        let tokenizer = Fixed(vec![("何", "ナニ", "代名詞"), ("色", "イロ", "名詞"), ("です", "デス", "助動詞")]);
        let readings = analyze(&tokenizer, "", false).unwrap();
        assert_eq!(row(&readings[0]), ("何", "なに", "nani"));
        let tokenizer = Fixed(vec![("何", "ナニ", "代名詞"), ("です", "デス", "助動詞"), ("か", "カ", "助詞")]);
        let readings = analyze(&tokenizer, "", false).unwrap();
        assert_eq!(row(&readings[0]), ("何", "なん", "nan"));
        // The last part has no next part.
        let tokenizer = Fixed(vec![("何", "ナン", "代名詞")]);
        assert_eq!(row(&analyze(&tokenizer, "", false).unwrap()[0]), ("何", "なに", "nani"));
    }

    #[test]
    fn symbols_keep_their_surface_and_romaji_is_recomputed() {
        let tokenizer =
            Fixed(vec![("ラーメン", "ラーメン", "名詞"), ("！", "キゴウ", "補助記号"), ("ID", "ID", "名詞")]);
        let readings = analyze(&tokenizer, "", false).unwrap();
        assert_eq!(row(&readings[0]), ("ラーメン", "らーめん", "raamen"));
        assert_eq!(row(&readings[1]), ("！", "！", "！"));
        // A surface that is its own reading still goes through the conversion (lower-cased).
        assert_eq!(row(&readings[2]), ("ID", "ID", "id"));
    }

    #[test]
    fn the_pipeline_keeps_only_the_readings_asked_for() {
        let tokenizer = Fixed(vec![("東京", "トウキョウ", "名詞"), ("に", "ニ", "助詞")]);
        let both = convert(&tokenizer, "", true, true).unwrap();
        assert_eq!(
            serde_json::Value::Array(both).to_string(),
            r#"[{"orig":"東京","hira":"とうきょう","hepburn":"toukyou"},{"orig":"に","hira":"に","hepburn":"ni"}]"#
        );
        let romaji = convert(&tokenizer, "", false, true).unwrap();
        assert_eq!(
            serde_json::Value::Array(romaji).to_string(),
            r#"[{"orig":"東京","hepburn":"toukyou"},{"orig":"に","hepburn":"ni"}]"#
        );
        assert!(convert(&NoDictionary, "", false, false).unwrap().is_empty());
        assert_eq!(convert(&NoDictionary, "日本", true, false), Err(Unavailable));
    }

    #[test]
    fn hiragana_comes_from_katakana_only() {
        assert_eq!(kata_to_hira("ァアンヴー漢a"), "ぁあんヴー漢a");
    }
}
