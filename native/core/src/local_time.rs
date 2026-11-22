//! The local times the core writes: the name of a vocabulary export, the conversation log's file
//! and the stamp on each of its lines, and the time of a message in the translation history.
//! The formats are the ones chrono wrote; jiff writes them since chrono stopped being maintained
//! (#879, RUSTSEC-2026-0543). Each takes the moment, so a test can give a fixed one; [`now`] is
//! the PC's local time.

use jiff::Zoned;

/// Now, in the PC's time zone.
pub fn now() -> Zoned {
    Zoned::now()
}

/// The file a vocabulary export is written to: `vocabulary-20261121-090503.txt`.
pub fn vocabulary_export_name(at: &Zoned) -> String {
    at.strftime("vocabulary-%Y%m%d-%H%M%S.txt").to_string()
}

/// The conversation log's file: `2026-11-21_09-05-03.log`.
pub fn conversation_log_name(at: &Zoned) -> String {
    at.strftime("%Y-%m-%d_%H-%M-%S.log").to_string()
}

/// The time at the start of a conversation log's line, to the millisecond (cut, not rounded):
/// `2026-11-21 09:05:03,042`.
pub fn conversation_log_stamp(at: &Zoned) -> String {
    at.strftime("%Y-%m-%d %H:%M:%S,%3f").to_string()
}

/// The time of a message in the translation history: `09:05`.
pub fn message_time(at: &Zoned) -> String {
    at.strftime("%H:%M").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;
    use jiff::tz::{TimeZone, offset};

    fn at(year: i16, month: i8, day: i8, hour: i8, minute: i8, second: i8, nanosecond: i32) -> Zoned {
        let zone = TimeZone::fixed(offset(9));
        date(year, month, day).at(hour, minute, second, nanosecond).to_zoned(zone).unwrap()
    }

    #[test]
    fn the_local_times_keep_the_formats_chrono_wrote() {
        let moment = at(2026, 11, 21, 9, 5, 3, 42_999_999);
        assert_eq!(vocabulary_export_name(&moment), "vocabulary-20261121-090503.txt");
        assert_eq!(conversation_log_name(&moment), "2026-11-21_09-05-03.log");
        assert_eq!(conversation_log_stamp(&moment), "2026-11-21 09:05:03,042", "milliseconds, cut");
        assert_eq!(message_time(&moment), "09:05");
    }

    #[test]
    fn every_field_is_padded_with_zeros() {
        let moment = at(2027, 1, 2, 3, 4, 5, 0);
        assert_eq!(vocabulary_export_name(&moment), "vocabulary-20270102-030405.txt");
        assert_eq!(conversation_log_name(&moment), "2027-01-02_03-04-05.log");
        assert_eq!(conversation_log_stamp(&moment), "2027-01-02 03:04:05,000");
        assert_eq!(message_time(&moment), "03:04");
        assert_eq!(conversation_log_stamp(&at(2027, 12, 31, 23, 59, 59, 999_999_999)), "2027-12-31 23:59:59,999");
    }

    #[test]
    fn the_formats_follow_the_time_zone_of_the_moment() {
        // The same instant in UTC and in UTC+9: the local time is what is written.
        let tokyo = at(2026, 11, 21, 0, 30, 0, 0);
        let utc = tokyo.with_time_zone(TimeZone::UTC);
        assert_eq!(message_time(&tokyo), "00:30");
        assert_eq!(message_time(&utc), "15:30");
        assert_eq!(conversation_log_name(&utc), "2026-11-20_15-30-00.log");
    }
}
