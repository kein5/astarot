//! When a failed translation is tried once more, and after how long: the rules of the SDKs the
//! Python clients used (`docs/spec/cross-cutting.md`: the SDK's own judgement and backoff, one
//! retry at most).
//!
//! - **OpenAI SDK** (openai 3.51; PLaMo, OpenAI, Groq, OpenRouter, the OpenAI-compatible
//!   endpoint, and the core's Google Cloud Translation and Papago): an answer's
//!   `x-should-retry: true` or `false` decides; a `retry-after` of more than 120 seconds means no
//!   retry; else 408, 409, 429, 5xx and a connection that failed or timed out. The pause is the
//!   server's `retry-after-ms` or `retry-after` (seconds, or an HTTP date) when it is above 0 and
//!   at most 120 seconds, else 0.5 seconds less a random 0 to 25 %.
//! - **DeepL SDK** (deepl 1.33): 429, 5xx and a failed connection. The second try starts 1 second
//!   after the first began (its backoff timer starts with the first try).
//! - **Google SDK** (google-genai 2.34; Gemini): 408, 429, 500, 502, 503, 504 and a failed
//!   connection. The pause is 1 second plus a random 0 to 1 second.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::Error;
use crate::http::{HttpError, Request, Response, Timeouts, Transport};

/// The longest `retry-after` the OpenAI SDK waits for (`MAX_RETRY_AFTER_DELAY`).
pub const OPENAI_MAX_RETRY_AFTER: f64 = 120.0;
/// The OpenAI SDK's first pause before the random cut (`INITIAL_RETRY_DELAY`).
pub const OPENAI_PAUSE: f64 = 0.5;
/// When the DeepL SDK's second try starts, counted from the first (`BACKOFF_INITIAL`).
pub const DEEPL_RETRY_START: Duration = Duration::from_secs(1);
/// The Google SDK's first pause before the random part (`_RETRY_INITIAL_DELAY`).
pub const GOOGLE_PAUSE: f64 = 1.0;

/// A transport that keeps the last answer, so that its headers can be read after a failure.
pub(crate) fn watch(transport: &Transport) -> (Transport, Arc<Mutex<Option<Response>>>) {
    let last = Arc::new(Mutex::new(None));
    let inner = Arc::clone(transport);
    let kept = Arc::clone(&last);
    let watching: Transport = Arc::new(move |request: &Request<'_>, timeouts: Timeouts| {
        let answer = inner(request, timeouts);
        *kept.lock().unwrap_or_else(|e| e.into_inner()) = answer.as_ref().ok().cloned();
        answer
    });
    (watching, last)
}

/// A random number in `[0, 1)`; enough for spreading retries out.
fn random_unit() -> f64 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    (hasher.finish() >> 11) as f64 / (1u64 << 53) as f64
}

/// Days from 1970-01-01 to a date of the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Seconds since 1970 of an HTTP date in GMT (`Sun, 06 Nov 1994 08:49:37 GMT`).
fn http_date(text: &str) -> Option<f64> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let words = if words.first()?.ends_with(',') { &words[1..] } else { &words[..] };
    let [day, month, year, time, zone] = words else { return None };
    if !matches!(*zone, "GMT" | "UT" | "UTC" | "Z" | "+0000" | "-0000") {
        return None;
    }
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let month = MONTHS.iter().position(|m| m.eq_ignore_ascii_case(month))? as i64 + 1;
    let (day, year): (i64, i64) = (day.parse().ok()?, year.parse().ok()?);
    let mut clock = time.split(':').map(|p| p.parse::<i64>().ok());
    let (hour, minute, second) = (clock.next()??, clock.next()??, clock.next().unwrap_or(Some(0))?);
    let days = days_from_civil(year, month, day);
    Some((days * 86_400 + hour * 3_600 + minute * 60 + second) as f64)
}

/// The seconds the server asks to wait (`_parse_retry_after_header`): `retry-after-ms`, else
/// `retry-after` as seconds, else `retry-after` as an HTTP date. A number too large for a float
/// counts as longer than any wait the SDK accepts.
pub fn retry_after(answer: &Response) -> Option<f64> {
    for (name, divisor) in [("retry-after-ms", 1000.0), ("retry-after", 1.0)] {
        let Some(value) = answer.header(name) else { continue };
        let Ok(delay) = value.trim().parse::<f64>() else { continue };
        let literal = matches!(value.trim().to_ascii_lowercase().as_str(), "inf" | "+inf" | "infinity" | "+infinity");
        if delay.is_infinite() && !literal {
            return Some(OPENAI_MAX_RETRY_AFTER + 1.0);
        }
        return Some(delay / divisor);
    }
    let date = http_date(answer.header("retry-after")?)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
    Some(date - now)
}

/// The OpenAI SDK's rule (`_should_retry` and `_calculate_retry_timeout`).
pub fn openai(error: Error, answer: Option<&Response>) -> Option<Duration> {
    let pause = || Duration::from_secs_f64(OPENAI_PAUSE * (1.0 - 0.25 * random_unit()));
    match error {
        Error::Http(HttpError::Url) => None,
        Error::Http(_) => Some(pause()),
        Error::Status(status) => {
            let after = answer.and_then(retry_after).filter(|a| a.is_finite());
            if after.is_some_and(|a| a > OPENAI_MAX_RETRY_AFTER) {
                return None;
            }
            let retry = match answer.and_then(|a| a.header("x-should-retry")) {
                Some("true") => true,
                Some("false") => false,
                _ => matches!(status, 408 | 409 | 429) || status >= 500,
            };
            if !retry {
                return None;
            }
            Some(match after {
                Some(a) if a > 0.0 => Duration::from_secs_f64(a),
                _ => pause(),
            })
        }
        _ => None,
    }
}

/// The DeepL SDK's rule: the second try starts [`DEEPL_RETRY_START`] after the first began.
pub fn deepl(error: Error, since_start: Duration) -> Option<Duration> {
    error.retryable_with(|status| status == 429 || status >= 500).then(|| DEEPL_RETRY_START.saturating_sub(since_start))
}

/// The Google SDK's rule.
pub fn google(error: Error) -> Option<Duration> {
    error
        .retryable_with(|status| matches!(status, 408 | 429 | 500 | 502 | 503 | 504))
        .then(|| Duration::from_secs_f64(GOOGLE_PAUSE + random_unit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(status: u16, headers: &[(&str, &str)]) -> Response {
        Response {
            status,
            headers: headers.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect(),
            body: Vec::new(),
        }
    }

    fn seconds(pause: Option<Duration>) -> Option<f64> {
        pause.map(|p| p.as_secs_f64())
    }

    #[test]
    fn the_openai_sdk_follows_the_servers_headers() {
        let busy = Error::Status(503);
        assert_eq!(seconds(openai(busy, Some(&answer(503, &[("retry-after", "1.5")])))), Some(1.5));
        assert_eq!(
            seconds(openai(busy, Some(&answer(503, &[("retry-after-ms", "700"), ("retry-after", "9")])))),
            Some(0.7)
        );
        assert_eq!(openai(busy, Some(&answer(503, &[("retry-after", "121")]))), None, "longer than 120 s");
        assert_eq!(openai(busy, Some(&answer(503, &[("retry-after", "1e999")]))), None, "too large to read");
        assert_eq!(openai(busy, Some(&answer(503, &[("x-should-retry", "false")]))), None);
        assert!(openai(Error::Status(400), Some(&answer(400, &[("x-should-retry", "true")]))).is_some());
        for pause in [openai(busy, None), openai(Error::Http(HttpError::Unreachable), None)] {
            let pause = seconds(pause).unwrap();
            assert!((0.375..=0.5).contains(&pause), "{pause}");
        }
        assert_eq!(openai(Error::Status(400), None), None);
        assert_eq!(openai(Error::Http(HttpError::Url), None), None);
    }

    #[test]
    fn a_retry_after_date_is_seconds_from_now() {
        assert_eq!(http_date("Sun, 06 Nov 1994 08:49:37 GMT"), Some(784_111_777.0));
        assert_eq!(http_date("06 Nov 1994 08:49:37 +0000"), Some(784_111_777.0));
        assert_eq!(http_date("Sun, 06 Nov 1994 08:49:37 JST"), None);
        let past = answer(429, &[("retry-after", "Sun, 06 Nov 1994 08:49:37 GMT")]);
        assert!(retry_after(&past).unwrap() < 0.0);
        // A date in the past is no pause of its own: the SDK's default applies.
        let pause = seconds(openai(Error::Status(429), Some(&past))).unwrap();
        assert!((0.375..=0.5).contains(&pause), "{pause}");
    }

    #[test]
    fn deepl_and_google_have_their_own_statuses_and_pauses() {
        assert_eq!(deepl(Error::Status(409), Duration::ZERO), None);
        assert_eq!(deepl(Error::Status(408), Duration::ZERO), None);
        assert_eq!(deepl(Error::Status(429), Duration::from_millis(300)), Some(Duration::from_millis(700)));
        assert_eq!(deepl(Error::Http(HttpError::Timeout), Duration::from_secs(5)), Some(Duration::ZERO));
        assert_eq!(google(Error::Status(409)), None);
        assert_eq!(google(Error::Status(501)), None);
        let pause = seconds(google(Error::Status(504))).unwrap();
        assert!((1.0..2.0).contains(&pause), "{pause}");
    }
}
