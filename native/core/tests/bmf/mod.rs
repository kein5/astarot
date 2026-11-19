//! The voice pipeline's times in Bencher Metric Format (#738,
//! <https://bencher.dev/docs/reference/bencher-metric-format/>): each benchmark carries the 50th
//! and 95th percentiles of its times, nearest rank, in milliseconds. `tests/pipeline_overhead.rs`
//! and `examples/pipeline_latency.rs` write it; CI sends it to Bencher (`voice-tests.yml`).
// Each user takes what it needs.
#![allow(dead_code)]

use serde_json::{Map, Value, json};
use std::path::Path;

/// The measures, by their slugs on Bencher; both in milliseconds.
pub const P50: &str = "latency-p50";
pub const P95: &str = "latency-p95";

/// The `p`th percentile of `values`, nearest rank (`pipeline_latency`'s summary).
pub fn percentile(values: &[f64], p: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = ((p / 100.0) * sorted.len() as f64).ceil().max(1.0) as usize;
    sorted[rank.min(sorted.len()) - 1]
}

/// The results of `benchmarks`, each named with its times in milliseconds; a benchmark without
/// a time is left out.
pub fn results(benchmarks: &[(&str, &[f64])]) -> Value {
    let mut out = Map::new();
    for (name, values) in benchmarks {
        if values.is_empty() {
            continue;
        }
        out.insert((*name).to_owned(), json!({ P50: { "value": percentile(values, 50.0) }, P95: { "value": percentile(values, 95.0) } }));
    }
    Value::Object(out)
}

/// Writes [`results`] to `path`.
pub fn write(path: &Path, benchmarks: &[(&str, &[f64])]) {
    let text = serde_json::to_string_pretty(&results(benchmarks)).expect("the results are JSON");
    std::fs::write(path, text).unwrap_or_else(|e| panic!("the results cannot be written to {}: {e}", path.display()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_are_nearest_rank_and_empty_benchmarks_are_left_out() {
        let values: Vec<f64> = (1..=40).map(f64::from).collect();
        assert_eq!((percentile(&values, 50.0), percentile(&values, 95.0)), (20.0, 38.0));
        assert_eq!(percentile(&[7.0], 95.0), 7.0);
        let results = results(&[("a", &values), ("b", &[])]);
        assert_eq!(results, json!({ "a": { P50: { "value": 20.0 }, P95: { "value": 38.0 } } }));
    }
}
