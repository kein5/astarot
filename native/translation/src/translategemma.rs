//! TranslateGemma on llama.cpp's server (ADR-015): the prompt of its official chat template and
//! one `/completion` request.
//!
//! The prompt is the English sentence `chat_template.jinja` of `google/translategemma-4b-it`
//! writes for a text: the source and target languages by name and ISO code, then the text. No
//! system message and no conversation context: the model was trained on this one turn. The
//! server adds the BOS token itself. Sampling is greedy (temperature 0), as the model card's
//! example (`do_sample=False`). The server stops at `<end_of_turn>`, an end-of-generation token.
//!
//! Nothing here logs. Errors are fixed codes: no key, URL or text is in them.

use crate::http::{Request, Timeouts, Transport};
use crate::providers::{checked, join, json_of, Error};
use serde_json::json;
use std::time::Duration;

/// The longest translation asked for, in tokens: a chat message is far shorter.
pub const MAX_TOKENS: u32 = 512;
/// One translation on the server the app owns: it may still be warming the model up.
pub const COMPLETION: Timeouts = Timeouts { connect: Duration::from_secs(5), read: Duration::from_secs(120), write: Duration::from_secs(10) };

/// The name `chat_template.jinja` gives each code the app uses, copied from its table (which
/// has 581 codes; these are the ones [`APP_LANGUAGES`] maps to).
pub const LANGUAGES: [(&str, &str); 131] = [
    ("en", "English"),
    ("zh-Hans", "Chinese"),
    ("zh-Hant", "Chinese"),
    ("de", "German"),
    ("es", "Spanish"),
    ("ru", "Russian"),
    ("ko", "Korean"),
    ("fr", "French"),
    ("ja", "Japanese"),
    ("pt", "Portuguese"),
    ("tr", "Turkish"),
    ("pl", "Polish"),
    ("ca", "Catalan"),
    ("nl", "Dutch"),
    ("ar", "Arabic"),
    ("sv", "Swedish"),
    ("it", "Italian"),
    ("id", "Indonesian"),
    ("hi", "Hindi"),
    ("fi", "Finnish"),
    ("vi", "Vietnamese"),
    ("he", "Hebrew"),
    ("uk", "Ukrainian"),
    ("el", "Greek"),
    ("ms", "Malay"),
    ("cs", "Czech"),
    ("ro", "Romanian"),
    ("da", "Danish"),
    ("hu", "Hungarian"),
    ("ta", "Tamil"),
    ("no", "Norwegian"),
    ("nn", "Norwegian Nynorsk"),
    ("th", "Thai"),
    ("ur", "Urdu"),
    ("hr", "Croatian"),
    ("bg", "Bulgarian"),
    ("lt", "Lithuanian"),
    ("ml", "Malayalam"),
    ("cy", "Welsh"),
    ("sk", "Slovak"),
    ("fa", "Persian"),
    ("lv", "Latvian"),
    ("bn", "Bengali"),
    ("sr", "Serbian"),
    ("az", "Azerbaijani"),
    ("sl", "Slovenian"),
    ("kn", "Kannada"),
    ("et", "Estonian"),
    ("mk", "Macedonian"),
    ("br", "Breton"),
    ("is", "Icelandic"),
    ("hy", "Armenian"),
    ("ne", "Nepali"),
    ("mn", "Mongolian"),
    ("bs", "Bosnian"),
    ("kk", "Kazakh"),
    ("sq", "Albanian"),
    ("sw", "Swahili"),
    ("gl", "Galician"),
    ("mr", "Marathi"),
    ("pa", "Punjabi"),
    ("si", "Sinhala"),
    ("km", "Central Khmer"),
    ("yo", "Yoruba"),
    ("so", "Somali"),
    ("af", "Afrikaans"),
    ("oc", "Occitan"),
    ("ka", "Georgian"),
    ("be", "Belarusian"),
    ("sd", "Sindhi"),
    ("gu", "Gujarati"),
    ("am", "Amharic"),
    ("yi", "Yiddish"),
    ("lo", "Lao"),
    ("uz", "Uzbek"),
    ("ht", "Haitian"),
    ("ps", "Pashto"),
    ("lb", "Luxembourgish"),
    ("my", "Burmese"),
    ("fil-PH", "Filipino"),
    ("tl", "Tagalog"),
    ("mg", "Malagasy"),
    ("ln", "Lingala"),
    ("ha", "Hausa"),
    ("ba", "Bashkir"),
    ("jv", "Javanese"),
    ("su", "Sundanese"),
    ("ga", "Irish"),
    ("gd", "Scottish Gaelic"),
    ("eu", "Basque"),
    ("eo", "Esperanto"),
    ("la", "Latin"),
    ("mt", "Maltese"),
    ("mi", "Maori"),
    ("fy", "Western Frisian"),
    ("co", "Corsican"),
    ("ny", "Chichewa"),
    ("rw", "Kinyarwanda"),
    ("sn", "Shona"),
    ("xh", "Xhosa"),
    ("zu", "Zulu"),
    ("ig", "Igbo"),
    ("ti", "Tigrinya"),
    ("om", "Oromo"),
    ("ky", "Kyrgyz"),
    ("tg", "Tajik"),
    ("tt", "Tatar"),
    ("tk", "Turkmen"),
    ("ug", "Uyghur"),
    ("bo", "Tibetan"),
    ("dz", "Dzongkha"),
    ("fo", "Faroese"),
    ("gn", "Guarani"),
    ("sa", "Sanskrit"),
    ("sc", "Sardinian"),
    ("as", "Assamese"),
    ("or", "Oriya"),
    ("ee", "Ewe"),
    ("ak", "Akan"),
    ("bm", "Bambara"),
    ("lg", "Ganda"),
    ("ki", "Kikuyu"),
    ("wo", "Wolof"),
    ("tn", "Tswana"),
    ("ts", "Tsonga"),
    ("ss", "Swati"),
    ("st", "Southern Sotho"),
    ("rn", "Rundi"),
    ("sg", "Sango"),
    ("ku", "Kurdish"),
    ("to", "Tonga"),
];

/// The app's language names (the translation tables' keys) and their TranslateGemma codes.
pub const APP_LANGUAGES: [(&str, &str); 138] = [
    ("English", "en"),
    ("Chinese Simplified", "zh-Hans"),
    ("Chinese Traditional", "zh-Hant"),
    ("German", "de"),
    ("Spanish", "es"),
    ("Russian", "ru"),
    ("Korean", "ko"),
    ("French", "fr"),
    ("Japanese", "ja"),
    ("Portuguese", "pt"),
    ("Turkish", "tr"),
    ("Polish", "pl"),
    ("Catalan", "ca"),
    ("Dutch", "nl"),
    ("Arabic", "ar"),
    ("Swedish", "sv"),
    ("Italian", "it"),
    ("Indonesian", "id"),
    ("Hindi", "hi"),
    ("Finnish", "fi"),
    ("Vietnamese", "vi"),
    ("Hebrew", "he"),
    ("Ukrainian", "uk"),
    ("Greek", "el"),
    ("Malay", "ms"),
    ("Czech", "cs"),
    ("Romanian", "ro"),
    ("Danish", "da"),
    ("Hungarian", "hu"),
    ("Tamil", "ta"),
    ("Norwegian", "no"),
    ("Norwegian Nynorsk", "nn"),
    ("Thai", "th"),
    ("Urdu", "ur"),
    ("Croatian", "hr"),
    ("Bulgarian", "bg"),
    ("Lithuanian", "lt"),
    ("Malayalam", "ml"),
    ("Welsh", "cy"),
    ("Slovak", "sk"),
    ("Persian", "fa"),
    ("Persian/Farsi", "fa"),
    ("Latvian", "lv"),
    ("Bengali", "bn"),
    ("Serbian", "sr"),
    ("Azerbaijani", "az"),
    ("Slovenian", "sl"),
    ("Kannada", "kn"),
    ("Estonian", "et"),
    ("Macedonian", "mk"),
    ("Breton", "br"),
    ("Icelandic", "is"),
    ("Armenian", "hy"),
    ("Nepali", "ne"),
    ("Mongolian", "mn"),
    ("Bosnian", "bs"),
    ("Kazakh", "kk"),
    ("Albanian", "sq"),
    ("Swahili", "sw"),
    ("Kiswahili", "sw"),
    ("Galician", "gl"),
    ("Marathi", "mr"),
    ("Punjabi", "pa"),
    ("Eastern Panjabi", "pa"),
    ("Sinhala", "si"),
    ("Khmer", "km"),
    ("Yoruba", "yo"),
    ("Somali", "so"),
    ("Afrikaans", "af"),
    ("Occitan", "oc"),
    ("Georgian", "ka"),
    ("Belarusian", "be"),
    ("Sindhi", "sd"),
    ("Gujarati", "gu"),
    ("Amharic", "am"),
    ("Yiddish", "yi"),
    ("Lao", "lo"),
    ("Uzbek", "uz"),
    ("Haitian creole", "ht"),
    ("Haitian Creole", "ht"),
    ("Pashto", "ps"),
    ("Luxembourgish", "lb"),
    ("Myanmar", "my"),
    ("Burmese", "my"),
    ("Filipino", "fil-PH"),
    ("Tagalog", "tl"),
    ("Malagasy", "mg"),
    ("Lingala", "ln"),
    ("Hausa", "ha"),
    ("Bashkir", "ba"),
    ("Javanese", "jv"),
    ("Sundanese", "su"),
    ("Irish", "ga"),
    ("Scottish Gaelic", "gd"),
    ("Basque", "eu"),
    ("Esperanto", "eo"),
    ("Latin", "la"),
    ("Maltese", "mt"),
    ("Maori", "mi"),
    ("Frisian", "fy"),
    ("Corsican", "co"),
    ("Chichewa", "ny"),
    ("Nyanja", "ny"),
    ("Kinyarwanda", "rw"),
    ("Shona", "sn"),
    ("Xhosa", "xh"),
    ("Zulu", "zu"),
    ("Igbo", "ig"),
    ("Tigrinya", "ti"),
    ("Oromo", "om"),
    ("Kyrgyz", "ky"),
    ("Tajik", "tg"),
    ("Tatar", "tt"),
    ("Turkmen", "tk"),
    ("Uyghur", "ug"),
    ("Tibetan", "bo"),
    ("Dzongkha", "dz"),
    ("Faroese", "fo"),
    ("Guarani", "gn"),
    ("Sanskrit", "sa"),
    ("Sardinian", "sc"),
    ("Assamese", "as"),
    ("Odia", "or"),
    ("Ewe", "ee"),
    ("Akan", "ak"),
    ("Bambara", "bm"),
    ("Ganda", "lg"),
    ("Kikuyu", "ki"),
    ("Wolof", "wo"),
    ("Tswana", "tn"),
    ("Tsonga", "ts"),
    ("Swati", "ss"),
    ("Southern Sotho", "st"),
    ("Sesotho", "st"),
    ("Rundi", "rn"),
    ("Sango", "sg"),
    ("Kurdish", "ku"),
    ("Tongan", "to"),
];

/// The template's name of a code, or None for a code it does not have.
pub fn language_name(code: &str) -> Option<&'static str> {
    LANGUAGES.iter().find(|(c, _)| *c == code).map(|(_, name)| *name)
}

/// The language table of a TranslateGemma model for the app (`{"source": {name: code},
/// "target": ...}`), limited to `offered` codes when that is not empty.
pub fn language_table(offered: &[String]) -> serde_json::Value {
    let names: serde_json::Map<String, serde_json::Value> = APP_LANGUAGES
        .iter()
        .filter(|(_, code)| offered.is_empty() || offered.iter().any(|o| o == code))
        .map(|(name, code)| ((*name).to_owned(), json!(code)))
        .collect();
    json!({ "source": names.clone(), "target": names })
}

/// The prompt for `text` from `source` to `target` (codes of [`LANGUAGES`]), or None when the
/// template has no such code.
pub fn prompt(text: &str, source: &str, target: &str) -> Option<String> {
    let (from, to) = (language_name(source)?, language_name(target)?);
    Some(format!(
        "<start_of_turn>user\nYou are a professional {from} ({source}) to {to} ({target}) translator. Your goal is to accurately convey the meaning and nuances of the original {from} text while adhering to {to} grammar, vocabulary, and cultural sensitivities.\nProduce only the {to} translation, without any additional explanations or commentary. Please translate the following {from} text into {to}:\n\n\n{}<end_of_turn>\n<start_of_turn>model\n",
        text.trim()
    ))
}

/// Translates `text` on the llama.cpp server at `base` (its own loopback address) with its key:
/// one `/completion`, no retry. A translation cut at [`MAX_TOKENS`] is not returned.
pub fn translate(transport: &Transport, base: &str, key: &str, text: &str, source: &str, target: &str) -> Result<String, Error> {
    let prompt = prompt(text, source, target).ok_or(Error::UnsupportedPair)?;
    let body = json!({ "prompt": prompt, "n_predict": MAX_TOKENS, "temperature": 0.0, "top_k": 1, "stream": false });
    let url = join(base, "/completion");
    let request = Request::post_json(&url, &body).header("Authorization", format!("Bearer {key}"));
    let answer = json_of(&checked(transport(&request, COMPLETION)?)?)?;
    if answer["stop_type"] == "limit" {
        return Err(Error::Answer);
    }
    let content = answer["content"].as_str().ok_or(Error::Answer)?;
    Ok(content.trim_end_matches("<end_of_turn>").trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_is_the_templates_sentence() {
        let expected = "<start_of_turn>user\nYou are a professional Japanese (ja) to English (en) translator. Your goal is to accurately convey the meaning and nuances of the original Japanese text while adhering to English grammar, vocabulary, and cultural sensitivities.\nProduce only the English translation, without any additional explanations or commentary. Please translate the following Japanese text into English:\n\n\nこんにちは<end_of_turn>\n<start_of_turn>model\n";
        assert_eq!(prompt("  こんにちは\n", "ja", "en").as_deref(), Some(expected));
        assert!(prompt("x", "zh-Hans", "zh-Hant").unwrap().contains("professional Chinese (zh-Hans) to Chinese (zh-Hant) translator"));
        assert_eq!(prompt("x", "ja", "xx"), None);
        assert_eq!(prompt("x", "jpn_Jpan", "en"), None);
    }

    #[test]
    fn every_app_language_has_a_template_name() {
        for (name, code) in APP_LANGUAGES {
            assert!(language_name(code).is_some(), "{name}: {code}");
        }
        let table = language_table(&["ja".into(), "en".into(), "xx".into()]);
        assert_eq!(table["source"], json!({ "English": "en", "Japanese": "ja" }));
        assert_eq!(table["source"], table["target"]);
        assert_eq!(language_table(&[])["source"].as_object().unwrap().len(), APP_LANGUAGES.len());
    }
}
