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

/// The names and terms of the user's term dictionary that appear in the text (#446). Only the
/// written forms already in the text are listed, so nothing is sent that the text does not hold.
fn glossary_block(glossary: &[String]) -> String {
    if glossary.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = glossary.iter().map(|term| format!("- {term}")).collect();
    format!(
        "Registered names and terms in the text. Treat each as a proper noun: do not translate its \
         meaning; keep its spelling, or write it in the output language's script if that language \
         needs another one.\n{}\n\n",
        lines.join("\n")
    )
}

/// What the user adds to the system prompt (#392), after the rules it cannot change. Empty adds
/// nothing.
fn instructions_block(instructions: &str) -> String {
    let instructions = instructions.trim();
    if instructions.is_empty() {
        return String::new();
    }
    format!(
        "Additional instructions from the user. Follow them as far as they do not change the rule \
         above: return only the translated text.\n{instructions}\n\n"
    )
}

/// The system prompt for one translation. `glossary` is empty unless the user's term dictionary
/// has words in the text, and `instructions` unless the user wrote some; without them the prompt is
/// the one Python sent.
pub fn system_prompt(
    plamo: bool,
    supported: &[String],
    input: &str,
    output: &str,
    history: &[HistoryItem],
    glossary: &[String],
    instructions: &str,
) -> String {
    let template = if plamo { PLAMO } else { GENERAL };
    let prompt = template
        .replace("{supported_languages}", &python_list(supported))
        .replace("{input_lang}", input)
        .replace("{output_lang}", output);
    // The header is never empty, so it is always added (as in Python).
    format!("{prompt}\n\n{}{}{}", instructions_block(instructions), glossary_block(glossary), history_block(history))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instructions_of_nothing_but_spaces_add_nothing() {
        let plain = system_prompt(false, &[], "Japanese", "English", &[], &[], "");
        assert_eq!(system_prompt(false, &[], "Japanese", "English", &[], &[], " \n "), plain);
        assert!(!plain.contains("Additional instructions"));
    }

    fn item(source: &str, text: &str) -> HistoryItem {
        HistoryItem { source: source.into(), text: text.into(), time: "12:34".into() }
    }

    #[test]
    fn the_prompt_matches_the_python_template() {
        let prompt = system_prompt(false, &["Japanese".into(), "English".into()], "Japanese", "English", &[], &[], "");
        assert_eq!(
            prompt,
            "You are a helpful translation assistant.\nSupported languages:\n['Japanese', 'English']\n\n\
             Translate the user provided text from Japanese to English.\n\
             Return ONLY the translated text. Do not add quotes or extra commentary.\n\n\n\
             Conversation context (recent 5 messages):\n\n"
        );
    }

    #[test]
    fn the_terms_in_the_text_come_before_the_history() {
        let prompt = system_prompt(false, &[], "Japanese", "English", &[item("chat", "前")], &["猫丸".into(), "Midnight Rooftop".into()], "");
        let terms = prompt.find("- 猫丸\n- Midnight Rooftop\n").expect("the terms are listed");
        assert!(prompt[..terms].contains("Treat each as a proper noun"));
        assert!(terms < prompt.find("Conversation context").unwrap());
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
