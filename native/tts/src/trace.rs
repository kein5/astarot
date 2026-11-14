//! Opt-in, bounded timing records. Never called from an audio callback.
//!
//! Set `VRCT_VOICE_TRACE` to a local regular file only while measuring. Each
//! utterance appends one JSON line after playback: no text, audio, URLs or
//! error details. Missing parents, full files and special files disable the
//! record, never speech. A measuring harness must require a complete trace; a
//! missing row is not a fast trial.

use std::io::Write;

use serde_json::json;

const LIMIT: u64 = 8 * 1024 * 1024;

/// Python's `str(UUID(value))`, or `None` for anything that is not a UUID.
/// Arbitrary event ids could carry user content and are never written.
pub fn canonical_uuid(value: &str) -> Option<String> {
    let hex = value.replace("urn:", "").replace("uuid:", "");
    let hex = hex.trim_matches(|c| c == '{' || c == '}').replace('-', "");
    if hex.len() != 32 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let hex = hex.to_ascii_lowercase();
    Some(format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..]))
}

/// Append one record when `VRCT_VOICE_TRACE` is set. Best effort.
///
/// `first_write` is `(monotonic_ns, sample_rate)` of the first audible write.
/// `outcome` is `completed`, `cancelled` or `error`.
pub fn write_voice_trace(event_id: &str, started_ns: i64, first_write: Option<(i64, u32)>, outcome: &str) {
    let Some(path) = std::env::var_os("VRCT_VOICE_TRACE").filter(|path| !path.is_empty()) else {
        return;
    };
    let mut row = json!({
        "schema": 1,
        "event_id": canonical_uuid(event_id),
        "started_ns": started_ns,
        "first_write_ns": first_write.map(|(ns, _)| ns),
        "sample_rate": first_write.map(|(_, rate)| rate),
        "outcome": outcome,
    });
    if std::env::var_os("VRCT_VOICE_GC_DIAGNOSTICS").is_some_and(|value| value == "1") {
        // Python recorded garbage-collector pauses here. Rust has none; the
        // field stays so the record's shape does not depend on the runtime.
        row["gc_pauses"] = json!([]);
    }
    let mut data = serde_json::to_vec(&row).expect("plain values serialize");
    data.push(b'\n');
    let _ = append(std::path::Path::new(&path), &data);
}

fn append(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let mut file = options.open(path)?;
    let info = file.metadata()?;
    if info.is_file() && info.len() + data.len() as u64 <= LIMIT {
        file.write_all(data)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::canonical_uuid;

    #[test]
    fn only_uuids_are_recorded() {
        let id = "12345678-1234-5678-1234-567812345678";
        assert_eq!(canonical_uuid(id).as_deref(), Some(id));
        assert_eq!(canonical_uuid("{12345678123456781234567812345678}").as_deref(), Some(id));
        assert_eq!(canonical_uuid("urn:uuid:12345678-1234-5678-1234-567812345678").as_deref(), Some(id));
        assert_eq!(canonical_uuid("ABCDEF00-0000-0000-0000-000000000000").as_deref(), Some("abcdef00-0000-0000-0000-000000000000"));
        assert_eq!(canonical_uuid("PRIVATE USER SUPPLIED ID"), None);
        assert_eq!(canonical_uuid("session:utterance"), None);
        assert_eq!(canonical_uuid(""), None);
    }
}
