"""Experimental features the user turns on one by one in the settings (Issue #361).

A feature tried on the experimental branch comes to develop once it has passed the hands-on
checks, and waits here until it graduates into a normal setting. Each one is off until the user
turns it on in the "Experimental features" page. Code that belongs to a feature runs only while
it is on, so a fault in it cannot reach a user who left it off.

The list of feature ids is written three times and a test keeps them equal:

- FEATURE_IDS here (the backend checks saved and requested values against it),
- EXPERIMENTAL_FEATURES in src-ui/logics/configs/experimentalFeatures.js (names, descriptions),
- EXPERIMENTAL_FEATURE_IDS in native/core/src/config/schema.rs (the Rust core).

To add a feature, add its id to all three and its name and description to locales/. To remove
one (it graduated or was dropped), take it out of all three; a saved value for it is dropped
the next time the settings are read.
"""
from typing import Any, Mapping

# Ids are lowercase snake_case, like the endpoint names. Empty until a feature graduates from the
# experimental branch.
FEATURE_IDS: tuple[str, ...] = ()


def defaults() -> dict[str, bool]:
    """Every feature off."""
    return {feature_id: False for feature_id in FEATURE_IDS}


def normalize(value: Any, current: Mapping[str, bool]) -> dict[str, bool] | None:
    """The values to store for a saved or requested `value`, or None to refuse it.

    A feature the request leaves out keeps its current value, so the UI can send one feature at a
    time. An id that is not listed is dropped rather than refused: a saved file may still name a
    feature that has since graduated or been removed. A value that is not a bool refuses the
    whole request.
    """
    if not isinstance(value, dict):
        return None
    result = {feature_id: current.get(feature_id) is True for feature_id in FEATURE_IDS}
    for feature_id in FEATURE_IDS:
        if feature_id not in value:
            continue
        if not isinstance(value[feature_id], bool):
            return None
        result[feature_id] = value[feature_id]
    return result


def is_enabled(values: Mapping[str, bool], feature_id: str) -> bool:
    """Whether the user turned `feature_id` on. An unknown id is never on."""
    return feature_id in FEATURE_IDS and values.get(feature_id) is True
