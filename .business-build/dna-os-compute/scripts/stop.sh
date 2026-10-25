#!/usr/bin/env bash
# DNA OS AI Server — stop (Linux, Phase 3). Graceful stop by PID only.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"
pidfile="logs/daemon.pid"
[ -f "$pidfile" ] || { echo "no daemon.pid — nothing to stop"; exit 0; }
pid="$(cat "$pidfile")"
if ! kill -0 "$pid" 2>/dev/null; then echo "pid $pid not running — removing stale pid"; rm -f "$pidfile"; exit 0; fi
cmdline="$(cat "/proc/$pid/comm" 2>/dev/null || echo unknown)"
case "$cmdline" in node*) kill "$pid"; rm -f "$pidfile"; echo "STOP OK (pid $pid)";; *) echo "pid $pid is not node ($cmdline) — refusing" >&2; exit 1;; esac
