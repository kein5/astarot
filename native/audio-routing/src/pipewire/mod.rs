//! Linux: the PipeWire session through its native client API.

pub mod observer;
pub mod output;

use std::sync::{Arc, OnceLock};

use crate::graph::Graph;
use crate::graph_source::{GraphSource, GraphUnavailable, Observation, Snapshotter};

/// The process-wide graph observation every control reader shares.
pub fn graph_source() -> &'static Arc<GraphSource> {
    static SOURCE: OnceLock<Arc<GraphSource>> = OnceLock::new();
    SOURCE.get_or_init(|| GraphSource::new(Arc::new(|| observer::NativeSnapshotter::connect().map(|s| Box::new(s) as Box<dyn Snapshotter>))))
}

/// Read the shared graph. With `wait`, subscribe for the duration of the read.
pub fn read_graph(wait: bool, after: Option<f64>) -> Result<Observation, GraphUnavailable> {
    let source = graph_source();
    if !wait {
        return source.read(false, after);
    }
    let _user = source.subscribe(None)?;
    source.read(true, after)
}

/// The graph data of [`read_graph`].
pub fn read_graph_data(wait: bool, after: Option<f64>) -> Result<Arc<Graph>, GraphUnavailable> {
    read_graph(wait, after)?.data.ok_or(GraphUnavailable)
}

/// Stop the shared observation for good (process shutdown).
pub fn shutdown() {
    graph_source().close();
}
