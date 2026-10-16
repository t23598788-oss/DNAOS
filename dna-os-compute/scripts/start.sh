#!/usr/bin/env bash
# DNA OS AI Server — start (Linux, Phase 3). Loopback-only by default;
# requires DNA_COMPUTE_TOKEN; never opens a public port automatically.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"

if [ -z "${DNA_COMPUTE_TOKEN:-}" ]; then
  echo "DNA_COMPUTE_TOKEN is required before start. Generate once: openssl rand -base64 24" >&2
  exit 1
fi
[ -f dist/daemon.js ] || { echo "dist/daemon.js missing — run scripts/install-deps.sh first" >&2; exit 1; }
mkdir -p logs
stamp="$(date +%Y%m%d-%H%M%S)"
nohup node dist/server-entry.js > "logs/daemon-$stamp.log" 2>&1 &
pid=$!
echo "$pid" > logs/daemon.pid
sleep 2
if ! kill -0 "$pid" 2>/dev/null; then echo "daemon exited immediately — see logs/daemon-$stamp.log" >&2; exit 1; fi
grep -h "DNA_COMPUTE_READY" "logs/daemon-$stamp.log" | tail -1 || true
echo "START OK pid=$pid"
