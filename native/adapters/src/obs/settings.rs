//! Numeric limits shared by persistence, IPC and the OBS page ([`models/obs/settings.py`]).
//!
//! [`models/obs/settings.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/obs/settings.py

/// The settings with a numeric range, by their Python names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumericSetting {
    MaxMessages,
    DisplayDuration,
    FadeoutDuration,
    FontSize,
    FontOutlineThickness,
}

impl NumericSetting {
    pub const ALL: [Self; 5] =
        [Self::MaxMessages, Self::DisplayDuration, Self::FadeoutDuration, Self::FontSize, Self::FontOutlineThickness];

    /// The key in Python's `NUMERIC_RANGES`.
    pub fn name(self) -> &'static str {
        match self {
            Self::MaxMessages => "MAX_MESSAGES",
            Self::DisplayDuration => "DISPLAY_DURATION",
            Self::FadeoutDuration => "FADEOUT_DURATION",
            Self::FontSize => "FONT_SIZE",
            Self::FontOutlineThickness => "FONT_OUTLINE_THICKNESS",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|setting| setting.name() == name)
    }

    /// The inclusive range.
    pub fn range(self) -> (i64, i64) {
        match self {
            Self::MaxMessages => (1, 50),
            Self::DisplayDuration => (1, 120),
            Self::FadeoutDuration => (0, 120),
            Self::FontSize => (10, 200),
            Self::FontOutlineThickness => (0, 20),
        }
    }
}

pub fn is_valid_numeric_setting(setting: NumericSetting, value: i64) -> bool {
    let (minimum, maximum) = setting.range();
    (minimum..=maximum).contains(&value)
}

/// A value from IPC: an integer, or a decimal string as the existing text controls send.
#[derive(Debug, Clone, PartialEq)]
pub enum RawNumeric<'a> {
    Int(i64),
    Text(&'a str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidNumericSetting(pub NumericSetting);

impl std::fmt::Display for InvalidNumericSetting {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Invalid OBS {}", self.0.name())
    }
}

impl std::error::Error for InvalidNumericSetting {}

/// `parse_numeric_setting`: `[+-]?[0-9]+` after trimming, then the range.
pub fn parse_numeric_setting(setting: NumericSetting, value: RawNumeric<'_>) -> Result<i64, InvalidNumericSetting> {
    let number = match value {
        RawNumeric::Int(number) => Some(number),
        RawNumeric::Text(text) => {
            // Python's str.strip() and re.fullmatch(r"[+-]?[0-9]+"); [0-9] is ASCII only.
            let text = text.trim();
            let digits = text.strip_prefix(['+', '-']).unwrap_or(text);
            if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                // A number too large for i64 is out of every range anyway.
                text.parse::<i64>().ok()
            } else {
                None
            }
        }
    };
    match number {
        Some(number) if is_valid_numeric_setting(setting, number) => Ok(number),
        _ => Err(InvalidNumericSetting(setting)),
    }
}
