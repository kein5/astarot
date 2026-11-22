//! The usage events' hook in the error reports (#428). The hooks are one list for the whole
//! process, so this file is a test binary of its own: no other test adds hooks beside it.

mod common;

use common::Ui;

#[test]
fn a_run_takes_its_usage_hook_away_when_it_stops() {
    // Each run added a hook that was never removed: a run started again after a failed one
    // left the old run's usage events behind until the process ended.
    let before = astarot_core::errors::report_hook_count();
    for _ in 0..3 {
        let ui = Ui::start();
        ui.ready();
        assert_eq!(astarot_core::errors::report_hook_count(), before + 1, "one hook while the run lasts");
        assert_eq!(ui.ok("/run/shutdown", None), true);
        assert_eq!(astarot_core::errors::report_hook_count(), before, "taken away at the stop");
        ui.stop();
    }
}
