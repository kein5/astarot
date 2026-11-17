//! The system prompts of the chat providers and the conversation history they carry
//! (`translation_settings/prompt/*.yml` and the `translate` methods of the Python clients).

/// One earlier message of the conversation (`Model.addTranslationHistory`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryItem {
    /// "chat", "mic", "speaker" or "ocr".
    pub source: String,
    pub text: String,
    /// The local time it was said, `HH:MM`, or empty when unknown.
    pub time: String,
}

const GENERAL: &str = "You are a helpful translation assistant.\nSupported languages:\n{supported_languages}\n\n\
Translate the user provided text from {input_lang} to {output_lang}.\n\
Return ONLY the translated text. Do not add quotes or extra commentary.\n";

const PLAMO: &str = "You are a translation assistant that uses the `plamo-translate` tool.\n\
Translate the following text.Supported languages include:\n{supported_languages}\n\n\
Translate the following text from {input_lang} to {output_lang}.\n\
output only the translated text without any additional commentary.\n";

/// The history settings shared by every prompt file.
const HISTORY_SOURCES: [&str; 3] = ["chat", "mic", "speaker"];
const HISTORY_MAX_MESSAGES: usize = 5;
const HISTORY_MAX_CHARS: usize = 4000;

/// Python's `repr` of a string.
fn python_repr(text: &str) -> String {
    let quote = if text.contains('\'') && !text.contains('"') { '"' } else { '\'' };
    let mut out = String::new();
    out.push(quote);
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// Python's `repr` of a list of strings, as `str.format` writes `supported_languages`.
pub fn python_list(items: &[String]) -> String {
    format!("[{}]", items.iter().map(|s| python_repr(s)).collect::<Vec<_>>().join(", "))
}

/// The history block appended to the system prompt.
fn history_block(history: &[HistoryItem]) -> String {
    let filtered: Vec<&HistoryItem> = history.iter().filter(|h| HISTORY_SOURCES.contains(&h.source.as_str())).collect();
    let recent = &filtered[filtered.len().saturating_sub(HISTORY_MAX_MESSAGES)..];
    let items: Vec<String> = recent.iter().map(|h| format!("[{}][{}] {}", h.time, h.source, h.text)).collect();
    let mut blob = items.join("\n").trim().to_string();
    let count = blob.chars().count();
    if count > HISTORY_MAX_CHARS {
        blob = blob.chars().skip(count - HISTORY_MAX_CHARS).collect();
    }
    format!("Conversation context (recent {HISTORY_MAX_MESSAGES} messages):\n{blob}\n")
}

/// The system prompt for one translation.
pub fn system_prompt(plamo: bool, supported: &[String], input: &str, output: &str, history: &[HistoryItem]) -> String {
    let template = if plamo { PLAMO } else { GENERAL };
    let prompt = template
        .replace("{supported_languages}", &python_list(supported))
        .replace("{input_lang}", input)
        .replace("{output_lang}", output);
    // The header is never empty, so it is always added (as in Python).
    format!("{prompt}\n\n{}", history_block(history))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(source: &str, text: &str) -> HistoryItem {
        HistoryItem { source: source.into(), text: text.into(), time: "12:34".into() }
    }

    #[test]
    fn the_prompt_matches_the_python_template() {
        let prompt = system_prompt(false, &["Japanese".into(), "English".into()], "Japanese", "English", &[]);
        assert_eq!(
            prompt,
            "You are a helpful translation assistant.\nSupported languages:\n['Japanese', 'English']\n\n\
             Translate the user provided text from Japanese to English.\n\
             Return ONLY the translated text. Do not add quotes or extra commentary.\n\n\n\
             Conversation context (recent 5 messages):\n\n"
        );
    }

    #[test]
    fn the_history_keeps_the_last_five_spoken_or_typed_messages() {
        let mut history: Vec<HistoryItem> = (0..7).map(|i| item("chat", &format!("m{i}"))).collect();
        history.push(item("ocr", "not included"));
        let block = history_block(&history);
        assert_eq!(
            block,
            "Conversation context (recent 5 messages):\n[12:34][chat] m2\n[12:34][chat] m3\n[12:34][chat] m4\n\
             [12:34][chat] m5\n[12:34][chat] m6\n"
        );
    }

    #[test]
    fn a_long_history_keeps_its_end() {
        let history = vec![item("mic", &"あ".repeat(5000))];
        let block = history_block(&history);
        let blob = block.trim_start_matches("Conversation context (recent 5 messages):\n").trim_end_matches('\n');
        assert_eq!(blob.chars().count(), 4000);
        assert!(blob.chars().all(|c| c == 'あ'));
    }

    #[test]
    fn names_are_quoted_as_python_quotes_them() {
        assert_eq!(python_list(&["N'Ko".into(), "a".into()]), "[\"N'Ko\", 'a']");
    }
}
