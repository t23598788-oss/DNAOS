#!/usr/bin/env bash
# DNA OS AI Server — health check (Linux, Phase 3). Read-only probe.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"
port="${1:-}"
if [ -z "$port" ]; then
  latest="$(ls -t logs/daemon-*.log 2>/dev/null | head -1 || true)"
  if [ -n "$latest" ]; then port="$(grep -ho 'DNA_COMPUTE_READY port=[0-9]*' "$latest" | tail -1 | cut -d= -f2 || true)"; fi
fi
[ -n "$port" ] || { echo "no daemon port — start first (scripts/start.sh)" >&2; exit 1; }
base="http://127.0.0.1:$port"
curl -fsS "$base/health" | head -c 800; echo
if [ -n "${DNA_COMPUTE_TOKEN:-}" ]; then
  curl -fsS -H "Authorization: Bearer $DNA_COMPUTE_TOKEN" "$base/metering" | head -c 2000; echo
fi
echo "HEALTH OK"
