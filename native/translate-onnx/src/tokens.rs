//! Text to token ids and back, as the app's tokenizers do it.
//!
//! `tokenizer.json` gives SentencePiece's normalization and segmentation, as pieces.
//! `vocab.json` gives the model's id of each piece. For M2M100 the two differ: 390 pieces
//! SentencePiece can produce are not in the model's vocabulary, and become the unknown token,
//! as in the app's `M2M100Tokenizer`. For NLLB they are the same.

use std::collections::{HashMap, HashSet};

use tokenizers::Tokenizer;

use crate::bundle::{Bundle, TOKENIZER, VOCABULARY};
use crate::{codes, Error, Result};

const SPACE: char = '\u{2581}';

pub(crate) struct Tokens {
    tokenizer: Tokenizer,
    ids: HashMap<String, u32>,
    /// The piece or token of each model id.
    pieces: Vec<Option<String>>,
    unknown: u32,
    m2m100: bool,
    /// For M2M100: the tokens its decoding writes as they are.
    specials: HashSet<u32>,
}

impl Tokens {
    pub fn load(bundle: &Bundle) -> Result<Tokens> {
        let invalid = || Error::new(codes::BUNDLE_INVALID);
        let manifest = bundle.manifest();
        let tokenizer = Tokenizer::from_file(bundle.path(TOKENIZER)).map_err(|_| invalid())?;
        let text = std::fs::read(bundle.path(VOCABULARY)).map_err(|_| invalid())?;
        let ids: HashMap<String, u32> = serde_json::from_slice(&text).map_err(|_| invalid())?;
        let size = ids.values().max().map_or(0, |id| *id as usize + 1);
        if size > 4_000_000 {
            return Err(invalid());
        }
        let mut pieces = vec![None; size];
        for (piece, id) in &ids {
            pieces[*id as usize] = Some(piece.clone());
        }
        let unknown = *ids.get(&manifest.unknown_token).ok_or_else(invalid)?;
        let mut specials: HashSet<u32> = ["<s>", "</s>", "<pad>", manifest.unknown_token.as_str()]
            .iter()
            .filter_map(|token| ids.get(*token).copied())
            .collect();
        for code in &manifest.languages {
            specials.insert(*ids.get(&manifest.language_token.replace("{}", code)).ok_or_else(invalid)?);
        }
        Ok(Tokens { tokenizer, ids, pieces, unknown, m2m100: manifest.family == "m2m100", specials })
    }

    pub fn id(&self, token: &str) -> Option<u32> {
        self.ids.get(token).copied()
    }

    /// The ids of the pieces of `text`, without the language and end tokens.
    pub fn encode(&self, text: &str) -> Result<Vec<u32>> {
        let encoding = self.tokenizer.encode(text, false).map_err(|_| Error::new(codes::TOKENIZER_FAILED))?;
        Ok(encoding.get_tokens().iter().map(|piece| self.id(piece).unwrap_or(self.unknown)).collect())
    }

    /// The text of model ids, special tokens written as they are.
    pub fn decode(&self, ids: &[u32]) -> Result<String> {
        if !self.m2m100 {
            // NLLB's ids are the tokenizer's own; the app decodes with it directly.
            return self.tokenizer.decode(ids, false).map_err(|_| Error::new(codes::TOKENIZER_FAILED));
        }
        let unknown = self.piece(self.unknown);
        let mut text = String::new();
        let mut run: Vec<&str> = Vec::new();
        for id in ids {
            let piece = self.pieces.get(*id as usize).and_then(Option::as_deref).unwrap_or(unknown);
            if self.specials.contains(id) {
                text += &sentencepiece_text(&run);
                text += piece;
                run.clear();
            } else {
                run.push(piece);
            }
        }
        text += &sentencepiece_text(&run);
        Ok(text.trim().to_owned())
    }

    fn piece(&self, id: u32) -> &str {
        self.pieces.get(id as usize).and_then(Option::as_deref).unwrap_or("<unk>")
    }
}

/// SentencePiece's decoding of pieces: the word boundary mark becomes a space, and the one
/// that begins the text, which encoding added, goes.
pub(crate) fn sentencepiece_text(pieces: &[&str]) -> String {
    let mut text = String::new();
    for (index, piece) in pieces.iter().enumerate() {
        let piece = if index == 0 { piece.strip_prefix(SPACE).unwrap_or(piece) } else { piece };
        text.extend(piece.chars().map(|c| if c == SPACE { ' ' } else { c }));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::sentencepiece_text;

    #[test]
    fn pieces_become_words() {
        assert_eq!(sentencepiece_text(&["\u{2581}Hello", ",", "\u{2581}wor", "ld", "!"]), "Hello, world!");
        assert_eq!(sentencepiece_text(&["\u{2581}", "こんにちは", "\u{2581}今日"]), "こんにちは 今日");
        assert_eq!(sentencepiece_text(&[]), "");
    }
}
