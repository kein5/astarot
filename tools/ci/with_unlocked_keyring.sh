#!/usr/bin/env bash
# Runs a command with GNOME Keyring on the session bus and its login keyring unlocked, for the tests
# that use the real Secret Service (voice-tests.yml, Issue #1073). Run it under dbus-run-session.
#
# The daemon runs in the foreground as this script's child, with a control folder of its own, and
# the command starts only once that daemon owns org.freedesktop.secrets. `gnome-keyring-daemon
# --unlock` on its own returns before the daemon is on the bus: a client in that gap starts a second
# daemon through D-Bus activation, without the unlocked keyring, and the tests see a locked or
# missing store. Afterwards the same daemon must still own the name, so that a test never passes or
# fails against another one.
set -euo pipefail

control=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/keyring.XXXXXX")
printf 'ci' | gnome-keyring-daemon --foreground --unlock --components=secrets --control-directory="$control" \
  >"$control/environment" 2>"$control/log" &
daemon=$!
trap 'kill "$daemon" 2>/dev/null; rm -rf "$control"' EXIT

owner() {
  dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
    org.freedesktop.DBus.GetConnectionUnixProcessID string:org.freedesktop.secrets 2>/dev/null |
    awk '/uint32/ { print $2 }'
}

report() {
  echo "::error::$1"
  echo "--- gnome-keyring-daemon (pid $daemon) ---"
  cat "$control/log" || true
  if ! kill -0 "$daemon" 2>/dev/null; then
    set +e
    wait "$daemon"
    echo "exit status: $?"
  fi
}

for _ in $(seq 1 100); do
  [ "$(owner)" = "$daemon" ] && break
  kill -0 "$daemon" 2>/dev/null || break
  sleep 0.1
done
if [ "$(owner)" != "$daemon" ]; then
  report "GNOME Keyring (pid $daemon) did not take org.freedesktop.secrets within 10 s; owner: $(owner)"
  exit 1
fi

status=0
"$@" || status=$?

if [ "$(owner)" != "$daemon" ]; then
  report "GNOME Keyring (pid $daemon) no longer owns org.freedesktop.secrets; owner: $(owner)"
  status=1
fi
exit "$status"
