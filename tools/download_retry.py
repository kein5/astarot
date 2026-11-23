"""Tries a download again when it failed for a passing reason.

The build and CI tools fetch pinned archives (ONNX Runtime, speech.cpp, the readings' dictionary,
the AppImage tools, a release's latest.json). A runner's network or a busy server sometimes
fails one request: a connection reset, a time-out, 429 or a 5xx answer. The CI audit of
2026-11-22 (item 4) counted such failures among the candidate builds, so each tool runs its whole
download through `retrying`: the download starts over after 5, 15 and 45 seconds.

An answer that will not change soon is not tried again: 404 (on 2026-11-17 and 18 ONNX Runtime's
GitHub releases answered 404 for a day), any other 4xx, and a file that does not match its pin.
"""
import http.client
import sys
import time
import urllib.error

# Seconds to wait before the second, third and fourth try.
DELAYS = (5, 15, 45)
# Answers that a later try may not get: a time-out, too many requests, a busy or failing server.
TRANSIENT_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})
# Kept here so that a test can wait without time passing.
SLEEP = time.sleep


def transient(error):
    """Whether `error` may not happen again on another try."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code in TRANSIENT_STATUS
    return isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException))


def retrying(attempt, what, *, delays=DELAYS):
    """Returns `attempt()`. While it fails for a passing reason, waits and calls it again, up to
    one more time than there are `delays`; then the last error goes up as it was."""
    for wait in (*delays, None):
        try:
            return attempt()
        except Exception as error:
            if wait is None or not transient(error):
                raise
            print(f"{what}: {error}; trying again in {wait} s", file=sys.stderr, flush=True)
            SLEEP(wait)
    raise AssertionError("unreachable")
