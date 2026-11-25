#!/usr/bin/env bash
# Temporary (Issue #1073): runs the Secret Service tests of native/core RUNS times, each on a new
# session bus and a new keyring folder, set up as voice-tests.yml does it ("current") or through
# tools/ci/with_unlocked_keyring.sh ("fixed"). Prints what each failure looked like.
set -uo pipefail
variant=$1
runs=$2
tests='cargo test --locked --manifest-path native/core/Cargo.toml --lib secret_service -- --ignored && cargo test --locked --manifest-path native/core/Cargo.toml --test secret_store -- --ignored'
pass=0
fail=0
for i in $(seq 1 "$runs"); do
  pkill -x gnome-keyring-d 2>/dev/null
  sleep 0.2
  rm -rf "$HOME/.local/share/keyrings" "${XDG_RUNTIME_DIR:-/nonexistent}"/keyring*
  case $variant in
    current) command="printf ci | gnome-keyring-daemon --unlock --components=secrets >/dev/null && $tests" ;;
    fixed) command="bash tools/ci/with_unlocked_keyring.sh bash -c '$tests'" ;;
  esac
  if dbus-run-session -- bash -c "$command" >"$RUNNER_TEMP/run-$i.log" 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "::group::run $i failed"
    grep -a 'Activating\|control socket\|discover_other\|panicked\|left:\|right:\|FAILED\|::error::\|exit status\|reason\|owner' "$RUNNER_TEMP/run-$i.log" | cut -c1-400
    pgrep -a gnome-keyring || true
    sudo dmesg | grep -i 'keyring\|segfault\|traps' | tail -5 || true
    sudo journalctl -b --no-pager 2>/dev/null | grep -i 'keyring' | tail -10 || true
    echo "::endgroup::"
  fi
done
echo "variant=$variant pass=$pass fail=$fail"
