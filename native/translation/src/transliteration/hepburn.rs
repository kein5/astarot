//! Katakana to Hepburn romaji (`transliteration_kana_to_hepburn.py`), rule for rule.
//!
//! The Python function is ported as it is, quirks included, so that the readings the UI shows
//! do not change: anything that is not katakana passes through, a passing `-` is read as a
//! long-vowel mark, an `n` before `b`, `m` or `p` becomes `m` wherever it comes from, and the
//! result is lower-cased.

fn base(c: char) -> Option<&'static str> {
    Some(match c {
        'ア' => "a",
        'イ' => "i",
        'ウ' => "u",
        'エ' => "e",
        'オ' => "o",
        'カ' => "ka",
        'キ' => "ki",
        'ク' => "ku",
        'ケ' => "ke",
        'コ' => "ko",
        'サ' => "sa",
        'シ' => "shi",
        'ス' => "su",
        'セ' => "se",
        'ソ' => "so",
        'タ' => "ta",
        'チ' => "chi",
        'ツ' => "tsu",
        'テ' => "te",
        'ト' => "to",
        'ナ' => "na",
        'ニ' => "ni",
        'ヌ' => "nu",
        'ネ' => "ne",
        'ノ' => "no",
        'ハ' => "ha",
        'ヒ' => "hi",
        'フ' => "fu",
        'ヘ' => "he",
        'ホ' => "ho",
        'マ' => "ma",
        'ミ' => "mi",
        'ム' => "mu",
        'メ' => "me",
        'モ' => "mo",
        'ヤ' => "ya",
        'ユ' => "yu",
        'ヨ' => "yo",
        'ラ' => "ra",
        'リ' => "ri",
        'ル' => "ru",
        'レ' => "re",
        'ロ' => "ro",
        'ワ' => "wa",
        'ヲ' => "wo",
        'ン' => "n",
        'ガ' => "ga",
        'ギ' => "gi",
        'グ' => "gu",
        'ゲ' => "ge",
        'ゴ' => "go",
        'ザ' => "za",
        'ジ' => "ji",
        'ズ' => "zu",
        'ゼ' => "ze",
        'ゾ' => "zo",
        'ダ' => "da",
        'ヂ' => "ji",
        'ヅ' => "zu",
        'デ' => "de",
        'ド' => "do",
        'バ' => "ba",
        'ビ' => "bi",
        'ブ' => "bu",
        'ベ' => "be",
        'ボ' => "bo",
        'パ' => "pa",
        'ピ' => "pi",
        'プ' => "pu",
        'ペ' => "pe",
        'ポ' => "po",
        'ァ' => "a",
        'ィ' => "i",
        'ゥ' => "u",
        'ェ' => "e",
        'ォ' => "o",
        'ャ' => "ya",
        'ュ' => "yu",
        'ョ' => "yo",
        'ッ' => "xtsu",
        'ー' => "-",
        'ヴ' => "vu",
        _ => return None,
    })
}

fn digraph(a: char, b: char) -> Option<&'static str> {
    Some(match (a, b) {
        ('キ', 'ャ') => "kya",
        ('キ', 'ュ') => "kyu",
        ('キ', 'ョ') => "kyo",
        ('ギ', 'ャ') => "gya",
        ('ギ', 'ュ') => "gyu",
        ('ギ', 'ョ') => "gyo",
        ('シ', 'ャ') => "sha",
        ('シ', 'ュ') => "shu",
        ('シ', 'ョ') => "sho",
        ('ジ', 'ャ') => "ja",
        ('ジ', 'ュ') => "ju",
        ('ジ', 'ョ') => "jo",
        ('チ', 'ャ') => "cha",
        ('チ', 'ュ') => "chu",
        ('チ', 'ョ') => "cho",
        ('ニ', 'ャ') => "nya",
        ('ニ', 'ュ') => "nyu",
        ('ニ', 'ョ') => "nyo",
        ('ヒ', 'ャ') => "hya",
        ('ヒ', 'ュ') => "hyu",
        ('ヒ', 'ョ') => "hyo",
        ('ビ', 'ャ') => "bya",
        ('ビ', 'ュ') => "byu",
        ('ビ', 'ョ') => "byo",
        ('ピ', 'ャ') => "pya",
        ('ピ', 'ュ') => "pyu",
        ('ピ', 'ョ') => "pyo",
        ('ミ', 'ャ') => "mya",
        ('ミ', 'ュ') => "myu",
        ('ミ', 'ョ') => "myo",
        ('リ', 'ャ') => "rya",
        ('リ', 'ュ') => "ryu",
        ('リ', 'ョ') => "ryo",
        ('フ', 'ャ') => "fya",
        ('フ', 'ュ') => "fyu",
        ('フ', 'ョ') => "fyo",
        ('ト', 'ゥ') => "tu",
        ('ド', 'ゥ') => "du",
        ('フ', 'ァ') => "fa",
        ('フ', 'ィ') => "fi",
        ('フ', 'ェ') => "fe",
        ('フ', 'ォ') => "fo",
        ('シ', 'ェ') => "she",
        ('チ', 'ェ') => "che",
        ('テ', 'ィ') => "ti",
        ('ウ', 'ァ') => "wa",
        ('ウ', 'ィ') => "wi",
        ('ウ', 'ェ') => "we",
        ('ウ', 'ォ') => "wo",
        ('ス', 'ィ') => "si",
        ('ズ', 'ィ') => "zi",
        ('ツ', 'ァ') => "tsa",
        ('ツ', 'ィ') => "tsi",
        ('ツ', 'ェ') => "tse",
        ('ツ', 'ォ') => "tso",
        ('キ', 'ェ') => "kye",
        ('ギ', 'ェ') => "gye",
        ('ヴ', 'ァ') => "va",
        ('ヴ', 'ィ') => "vi",
        ('ヴ', 'ェ') => "ve",
        ('ヴ', 'ォ') => "vo",
        ('ヴ', 'ュ') => "vyu",
        _ => return None,
    })
}

const SMALL_KANA: [char; 12] = ['ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ', 'ヵ', 'ヶ', 'ッ'];

/// The consonant at the start of a romaji syllable: everything before the first vowel.
fn initial_consonant(romaji: &str) -> &str {
    match romaji.find(['a', 'e', 'i', 'o', 'u']) {
        Some(at) => &romaji[..at],
        None => romaji,
    }
}

/// Python's `str.strip()` set of whitespace for the characters a reading can hold.
fn trim_python(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
}

/// Katakana to Hepburn (`katakana_to_hepburn`).
pub fn katakana_to_hepburn(kata: &str, use_macron: bool) -> String {
    let chars: Vec<char> = trim_python(kata).chars().collect();
    let length = chars.len();
    let mut parts: Vec<String> = Vec::new();
    let mut i = 0;
    while i < length {
        let c = chars[i];
        if c == 'ッ' {
            if i + 1 < length {
                let next = if i + 2 < length {
                    digraph(chars[i + 1], chars[i + 2]).or_else(|| base(chars[i + 1]))
                } else {
                    base(chars[i + 1])
                };
                if let Some(next) = next {
                    let consonant = initial_consonant(next);
                    if let Some(first) = consonant.chars().next() {
                        parts.push(first.to_string());
                    }
                }
            }
            i += 1;
            continue;
        }
        if c == 'ー' {
            parts.push("-".into());
            i += 1;
            continue;
        }
        if let Some(pair) = chars.get(i + 1).and_then(|next| digraph(c, *next)) {
            parts.push(pair.into());
            i += 2;
            continue;
        }
        if SMALL_KANA.contains(&c) {
            parts.push(base(c).unwrap_or("").into());
            i += 1;
            continue;
        }
        match base(c) {
            Some(romaji) => parts.push(romaji.into()),
            None => parts.push(c.to_string()),
        }
        i += 1;
    }
    let raw: Vec<char> = parts.concat().chars().collect();

    // n before b, m or p becomes m.
    let mut nasal: Vec<char> = Vec::with_capacity(raw.len());
    for (at, c) in raw.iter().enumerate() {
        if *c == 'n' && raw.get(at + 1).is_some_and(|next| matches!(next, 'b' | 'm' | 'p')) {
            nasal.push('m');
        } else {
            nasal.push(*c);
        }
    }

    // Each '-' repeats the vowel before it, or goes.
    let mut raw = nasal;
    while let Some(at) = raw.iter().position(|c| *c == '-') {
        if at == 0 {
            raw.remove(0);
            continue;
        }
        let previous = raw[at - 1];
        if "aiueo".contains(previous) {
            raw[at] = previous;
        } else {
            raw.remove(at);
        }
    }
    let mut text: String = raw.into_iter().collect();
    if use_macron {
        for (pair, macron) in [("aa", "ā"), ("ii", "ī"), ("uu", "ū"), ("ee", "ē"), ("oo", "ō"), ("ou", "ō")] {
            text = text.replace(pair, macron);
        }
    }
    text.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::katakana_to_hepburn as h;

    #[test]
    fn the_python_examples_read_the_same() {
        // The examples at the end of the Python module, with use_macron=True as it runs them.
        let cases = [
            ("カタカナ", "katakana"),
            ("コンピューター", "kompyūtā"),
            ("キャッチ", "kyacchi"),
            ("マッチャ", "maccha"),
            ("シェア", "shea"),
            ("ジェット", "jietto"),
            ("ヴァイオリン", "vaiorin"),
            ("ホテル", "hoteru"),
            ("スーパー", "sūpā"),
            ("ギュウニュウ", "gyūnyū"),
            ("パーティー", "pātī"),
            ("トウキョウ", "tōkyō"),
            ("オーケー", "ōkē"),
            ("ファイル", "fairu"),
            ("ニューヨーク", "nyūyōku"),
            ("ラーメン", "rāmen"),
            ("パン", "pan"),
            ("チョコレート", "chokorēto"),
        ];
        for (kana, romaji) in cases {
            assert_eq!(h(kana, true), romaji, "{kana}");
        }
    }

    #[test]
    fn without_macrons_the_vowels_stay_doubled() {
        assert_eq!(h("トウキョウ", false), "toukyou");
        assert_eq!(h("ラーメン", false), "raamen");
        assert_eq!(h("コンピューター", false), "kompyuutaa");
        assert_eq!(h("シンブン", false), "shimbun");
    }

    #[test]
    fn the_python_quirks_are_kept() {
        // A long mark after a consonant, or first, goes.
        assert_eq!(h("ーア", false), "a");
        assert_eq!(h("ンー", false), "n");
        // Anything not katakana passes through and is lower-cased; a passing hyphen is a long mark.
        assert_eq!(h("ID", false), "id");
        assert_eq!(h("ab-c", false), "abc");
        assert_eq!(h("a-b", false), "aab");
        assert_eq!(h("ひらがな", false), "ひらがな");
        // A small kana alone, and the ones the table lacks.
        assert_eq!(h("ァヮ", false), "a");
        // ッ at the end, before a vowel, and twice.
        assert_eq!(h("アッ", false), "a");
        assert_eq!(h("ッア", false), "a");
        assert_eq!(h("ッッカ", false), "xkka");
        // An n before m, b or p from anywhere.
        assert_eq!(h("input", false), "imput");
        assert_eq!(h("  カ  ", false), "ka");
    }
}
